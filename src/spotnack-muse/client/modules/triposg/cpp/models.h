// Model directory layout + verification against models_manifest.json.
//
// Device layout (under getExternalFilesDir(null)/triposg/<version>/):
//   models_manifest.json            // written by bench/make_model_manifest.py
//   <stem>/model.onnx + model.bin   // v1: 25 AI Hub EPContext units
//   dit_chain.onnx + <stem>/model.bin (23 stems, no per-unit .onnx)
//                                   // v2 merged: one session, shared spill-fill
//   dinov2_encoder.onnx             // FP32 ORT CPU graph
//   u2net.onnx                      // rembg background removal, ORT CPU
//
// verifyModels() always checks presence + byte sizes (cheap) and hashes
// every file with SHA-256 only on demand: ~7 GB streams slowly on-device,
// so the UI reports hash progress per file.
#pragma once

#include <atomic>
#include <functional>
#include <string>
#include <vector>

namespace triposg {

struct ModelFile {
  std::string path;    // relative to the model dir
  long long bytes = 0;
  std::string sha256;
};

struct ModelManifest {
  std::string version;
  std::vector<ModelFile> files;
  long long total_bytes = 0;
};

// Parses <dir>/models_manifest.json. Returns false + reason on error.
bool LoadManifest(const std::string& dir, ModelManifest& manifest,
                  std::string& error);

// Checks every file is present with the recorded byte size. When
// full_hash is true, streams SHA-256 over every file (slow); progress
// is (done_files, total_files, current_path). Cancel-safe via cancel.
bool VerifyModels(const std::string& dir, const ModelManifest& manifest,
                  bool full_hash,
                  const std::function<void(int, int, const std::string&)>&
                      progress,
                  std::atomic<bool>& cancel, std::string& error);

}  // namespace triposg
