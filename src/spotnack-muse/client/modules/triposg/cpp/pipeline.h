// On-device TripoSG engine: orchestration over ORT sessions.
//
// Pipeline (matches the Phase 2 spike_pipeline proven on the phone):
//   RGBA bytes -> u2net CPU -> prepare_image -> DINOv2 pixel_values ->
//   DINOv2 FP32 ORT CPU -> rectified-flow sampling loop (23 resident
//   transformer units on QNN HTP, CFG as two batch-1 passes, burst) ->
//   vae_post + vae_query on HTP -> octree extraction + marching
//   tetrahedra on CPU -> mesh.glb + decimated mesh.display.glb.
//
// threading: one Convert at a time (the Kotlin side serializes calls on
// a single-thread executor). Transformer + VAE sessions stay resident
// across generations; Release() drops them (called on trim-memory).
// Cancel is cooperative: checked between transformer units, between
// sampling steps, per VAE-query chunk, and around polygonization, so a
// stop lands within ~1 guided step plus the marching pass. Partial
// outputs are written to temp names and renamed only on success; a
// cancelled run deletes its temp files.
#pragma once

#include <atomic>
#include <cstdint>
#include <functional>
#include <memory>
#include <string>
#include <vector>

#include "preprocess.h"

namespace triposg {

struct ConvertOptions {
  int steps = 50;              // sampling steps (goldens used 50)
  double guidance = 7.0;       // CFG scale
  int d0 = 6;                  // coarse extraction depth
  int d1 = 8;                  // fine extraction depth
  uint64_t seed = 0;           // deterministic Gaussian noise seed
  int target_tris = 100000;    // display-mesh triangle budget
  std::string noise_path;      // test hook: .npy (1,2048,64) initial noise
};

// fraction in [0, 1], label = current stage name.
using ProgressCallback = std::function<void(double, const std::string&)>;

class Engine {
 public:
  Engine();
  ~Engine();
  Engine(const Engine&) = delete;
  Engine& operator=(const Engine&) = delete;

  // model_dir holds models_manifest.json + the model files; qnn_backend
  // is the full path of libQnnHtp.so. Verifies sizes (not hashes).
  bool Configure(const std::string& model_dir,
                 const std::string& qnn_backend, std::string& error);

  // Full image -> GLB conversion. rgba is w*h RGBA bytes.
  // Writes out_dir/mesh.glb + out_dir/mesh.display.glb on success.
  bool Convert(const uint8_t* rgba, int w, int h,
               const ConvertOptions& opts, const std::string& out_dir,
               const ProgressCallback& progress, std::atomic<bool>& cancel,
               std::string& error);

  // Cut-out preview: the exact RGB canvas Convert feeds DINOv2
  // (background removal with the same HasValidAlpha rule + PrepareImage
  // on white), with mask stats for the input warnings. Creates the u2net
  // CPU session for the call and releases it before returning; never
  // touches the transformer/VAE or any NPU session. Requires Configure
  // first (for the model dir). Not bit-shared with a later Convert: the
  // conversion recomputes it (cheap next to 176 s).
  bool PreviewCutout(const uint8_t* rgba, int w, int h,
                     std::vector<uint8_t>& out_rgb, int& out_w, int& out_h,
                     MaskStats& stats, std::string& error);

  // Drops resident transformer + VAE sessions.
  void Release();

 private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
};

}  // namespace triposg
