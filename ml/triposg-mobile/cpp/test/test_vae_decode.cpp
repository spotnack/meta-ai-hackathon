// Host test: golden final_latents -> vae_post (ORT CPU) -> extract at
// full golden depth -> marching tetrahedra -> GLB.
//
// Usage:
//   test_vae_decode latents.npy vae_post.onnx vae_query.onnx out_dir [d0] [d1]
//
// The orchestrator grades out_dir/mesh.glb against the golden mesh with
// parity/run_phase1.py --candidate-dir. Prints stage timings, kv/noise
// stats, verts/faces, closedness, signed volume and peak RSS, so a bad
// run is diagnosable from the log alone.
#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <sys/resource.h>
#include <vector>

#include "../extract.h"
#include "../glb_writer.h"
#include "../mcubes.h"
#include "onnxruntime_cxx_api.h"

namespace {

std::vector<char> ReadFile(const char* path) {
  FILE* f = std::fopen(path, "rb");
  if (!f) {
    std::fprintf(stderr, "cannot open %s\n", path);
    std::exit(1);
  }
  std::fseek(f, 0, SEEK_END);
  long size = std::ftell(f);
  std::fseek(f, 0, SEEK_SET);
  std::vector<char> data(static_cast<size_t>(size));
  if (std::fread(data.data(), 1, data.size(), f) != data.size()) {
    std::fprintf(stderr, "short read %s\n", path);
    std::exit(1);
  }
  std::fclose(f);
  return data;
}

struct NpyArray {
  std::vector<int64_t> shape;
  std::vector<float> data;
};

NpyArray ReadNpy(const std::string& path) {
  std::vector<char> raw = ReadFile(path.c_str());
  if (raw.size() < 10 || std::memcmp(raw.data(), "\x93NUMPY", 6) != 0) {
    std::fprintf(stderr, "not an npy file: %s\n", path.c_str());
    std::exit(1);
  }
  uint16_t header_len;
  std::memcpy(&header_len, raw.data() + 8, 2);
  std::string header(raw.data() + 10, header_len);
  if (header.find("'descr': '<f4'") == std::string::npos ||
      header.find("'fortran_order': True") != std::string::npos) {
    std::fprintf(stderr, "only C-order float32 npy: %s\n", path.c_str());
    std::exit(1);
  }
  NpyArray out;
  size_t l = header.find('('), r = header.find(')');
  std::string dims = header.substr(l + 1, r - l - 1), tok;
  size_t pos = 0;
  while (pos <= dims.size()) {
    size_t comma = dims.find(',', pos);
    if (comma == std::string::npos) comma = dims.size();
    tok = dims.substr(pos, comma - pos);
    if (tok.find_first_not_of(" \t") != std::string::npos)
      out.shape.push_back(std::stoll(tok));
    pos = comma + 1;
  }
  size_t offset = 10 + header_len, count = 1;
  for (int64_t d : out.shape) count *= static_cast<size_t>(d);
  out.data.resize(count);
  std::memcpy(out.data.data(), raw.data() + offset, count * 4);
  return out;
}

void MeanMaxAbs(const std::vector<float>& v, const char* name) {
  double sum = 0, worst = 0;
  for (float x : v) {
    sum += x;
    double a = std::fabs(x);
    if (a > worst) worst = a;
  }
  std::printf("%s mean=%.6f maxabs=%.6f n=%zu\n", name, sum / v.size(), worst,
              v.size());
}

long PeakRssMb() {
  struct rusage ru;
  if (getrusage(RUSAGE_SELF, &ru) != 0) return -1;
  return ru.ru_maxrss / 1024;  // Linux ru_maxrss is KiB
}

using Clock = std::chrono::steady_clock;

class OrtBackend {
 public:
  OrtBackend(const std::string& post_path, const std::string& query_path)
      : env_(ORT_LOGGING_LEVEL_WARNING, "test_vae"),
        mem_(Ort::MemoryInfo::CreateCpu(OrtDeviceAllocator, OrtMemTypeCPU)) {
    Ort::SessionOptions opts;
    opts.SetGraphOptimizationLevel(ORT_ENABLE_ALL);
    post_ = Ort::Session(env_, post_path.c_str(), opts);
    query_ = Ort::Session(env_, query_path.c_str(), opts);
  }

  std::vector<float> RunPost(const std::vector<float>& latents) {
    Ort::AllocatorWithDefaultOptions alloc;
    std::string name = post_.GetInputNameAllocated(0, alloc).get();
    std::vector<int64_t> shape = {1, 2048, 64};
    Ort::Value in = Ort::Value::CreateTensor<float>(
        mem_, const_cast<float*>(latents.data()), latents.size(), shape.data(),
        shape.size());
    const char* in_names[1] = {name.c_str()};
    std::string oname = post_.GetOutputNameAllocated(0, alloc).get();
    const char* out_names[1] = {oname.c_str()};
    std::vector<Ort::Value> outs = post_.Run(Ort::RunOptions{nullptr},
                                             in_names, &in, 1, out_names, 1);
    float* fp = outs[0].GetTensorMutableData<float>();
    auto info = outs[0].GetTensorTypeAndShapeInfo();
    size_t n = 1;
    for (int64_t d : info.GetShape()) n *= d;
    return std::vector<float>(fp, fp + n);
  }

  Ort::Session& query_session() { return query_; }
  Ort::MemoryInfo& mem_info() { return mem_; }

  int QueryChunk() {
    // Fixed N comes from the exported model itself: robust to --chunk.
    Ort::AllocatorWithDefaultOptions alloc;
    for (size_t i = 0; i < query_.GetInputCount(); ++i) {
      std::string name = query_.GetInputNameAllocated(i, alloc).get();
      if (name == "queries")
        return static_cast<int>(
            query_.GetInputTypeInfo(i).GetTensorTypeAndShapeInfo().GetShape()[1]);
    }
    std::fprintf(stderr, "vae_query has no 'queries' input\n");
    std::exit(1);
  }

  // triposg::QueryBackend over the vae_query session (exact chunk each call).
  class SessionQuery : public triposg::QueryBackend {
   public:
    SessionQuery(Ort::Session* session, Ort::MemoryInfo* mem,
          const std::vector<float>& kv, int chunk)
        : session_(session), mem_(mem), kv_(kv), chunk_(chunk) {}
    void Query(const float* xyz, int n, float* out) override {
      if (n != chunk_) {
        std::fprintf(stderr, "backend got %d points, want chunk %d\n", n,
                     chunk_);
        std::exit(1);
      }
      Ort::AllocatorWithDefaultOptions alloc;
      const size_t ni = session_->GetInputCount();
      std::vector<std::string> hold;
      hold.reserve(ni);  // c_str() pointers below must stay valid (SSO)
      std::vector<const char*> names;
      std::vector<Ort::Value> ins;
      for (size_t i = 0; i < ni; ++i) {
        hold.push_back(session_->GetInputNameAllocated(i, alloc).get());
        names.push_back(hold.back().c_str());
        // Keep the TypeInfo alive: the shape info is a non-owning view.
        Ort::TypeInfo type_info = session_->GetInputTypeInfo(i);
        auto info = type_info.GetTensorTypeAndShapeInfo();
        std::vector<int64_t> shape = info.GetShape();
        size_t count = 1;
        for (int64_t d : shape) count *= d;
        if (hold.back() == "kv") {
          ins.push_back(Ort::Value::CreateTensor<float>(
              *mem_, const_cast<float*>(kv_.data()), count, shape.data(),
              shape.size()));
        } else {
          ins.push_back(Ort::Value::CreateTensor<float>(
              *mem_, const_cast<float*>(xyz), count, shape.data(),
              shape.size()));
        }
      }
      std::string oname = session_->GetOutputNameAllocated(0, alloc).get();
      const char* out_names[1] = {oname.c_str()};
      std::vector<Ort::Value> outs = session_->Run(
          Ort::RunOptions{nullptr}, names.data(), ins.data(), ins.size(),
          out_names, 1);
      float* fp = outs[0].GetTensorMutableData<float>();
      auto oinfo = outs[0].GetTensorTypeAndShapeInfo();
      size_t count = 1;
      for (int64_t d : oinfo.GetShape()) count *= d;
      if (count != static_cast<size_t>(n)) {
        std::fprintf(stderr, "query output has %zu values for %d points\n",
                     count, n);
        std::exit(1);
      }
      std::memcpy(out, fp, count * 4);
    }

   private:
    Ort::Session* session_;
    Ort::MemoryInfo* mem_;
    const std::vector<float>& kv_;
    int chunk_;
  };

 private:
  Ort::Env env_;
  Ort::MemoryInfo mem_;
  Ort::Session post_{nullptr}, query_{nullptr};
};

}  // namespace

int main(int argc, char** argv) {
  if (argc < 5) {
    std::fprintf(stderr,
                 "usage: %s latents.npy vae_post.onnx vae_query.onnx out_dir "
                 "[d0] [d1]\n",
                 argv[0]);
    return 1;
  }
  const int d0 = argc > 5 ? std::atoi(argv[5]) : 6;
  const int d1 = argc > 6 ? std::atoi(argv[6]) : 9;
  const std::string out_dir = argv[4];

  auto t0 = Clock::now();
  NpyArray lat = ReadNpy(argv[1]);
  if (lat.shape != std::vector<int64_t>({1, 2048, 64})) {
    std::fprintf(stderr, "want latents (1,2048,64), got (");
    for (int64_t d : lat.shape) std::fprintf(stderr, "%lld,", (long long)d);
    std::fprintf(stderr, ")\n");
    return 1;
  }
  OrtBackend ort(argv[2], argv[3]);
  auto t1 = Clock::now();
  std::vector<float> kv = ort.RunPost(lat.data);
  auto t2 = Clock::now();
  MeanMaxAbs(kv, "kv");
  std::printf("kv tokens=%zu post_ms=%.0f peak_rss_mb=%ld\n",
              kv.size() / 1024,
              std::chrono::duration<double, std::milli>(t2 - t1).count(),
              PeakRssMb());

  triposg::ExtractConfig cfg;
  cfg.d0 = d0;
  cfg.d1 = d1;
  cfg.chunk_points = ort.QueryChunk();
  std::printf("extract d0=%d d1=%d chunk=%d\n", d0, d1, cfg.chunk_points);
  OrtBackend::SessionQuery backend(&ort.query_session(), &ort.mem_info(), kv,
                            cfg.chunk_points);
  std::vector<float> grid;
  int res = 0;
  if (!triposg::ExtractSdf(&backend, cfg, grid, res)) {
    std::fprintf(stderr, "extract failed\n");
    return 1;
  }
  auto t3 = Clock::now();
  std::printf("extract_ms=%.0f grid=%d peak_rss_mb=%ld\n",
              std::chrono::duration<double, std::milli>(t3 - t2).count(), res,
              PeakRssMb());

  triposg::McubesConfig mc;
  mc.spacing = 2 * cfg.bound / (1 << d1);  // golden vertex mapping (/2^d1)
  mc.ox = mc.oy = mc.oz = -cfg.bound;
  triposg::McubesResult mesh = triposg::Polygonize(grid.data(), res, mc);
  grid.clear();
  grid.shrink_to_fit();
  auto t4 = Clock::now();
  std::printf("mc_ms=%.0f verts=%zu tris=%zu closed=%d volume=%.6f "
              "peak_rss_mb=%ld\n",
              std::chrono::duration<double, std::milli>(t4 - t3).count(),
              mesh.positions.size() / 3, mesh.indices.size() / 3,
              (int)mesh.closed, mesh.signed_volume, PeakRssMb());

  triposg::GlbMesh glb{mesh.positions, mesh.normals, mesh.indices};
  std::string out_path = out_dir + "/mesh.glb";
  if (!triposg::WriteGlb(glb, out_path)) {
    std::fprintf(stderr, "write failed: %s\n", out_path.c_str());
    return 1;
  }
  auto t5 = Clock::now();
  std::printf("wrote %s total_ms=%.0f\n", out_path.c_str(),
              std::chrono::duration<double, std::milli>(t5 - t0).count());
  return 0;
}
