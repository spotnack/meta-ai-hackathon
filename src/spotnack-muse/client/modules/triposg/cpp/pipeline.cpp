// See pipeline.h.
#include "pipeline.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <numeric>
#include <random>
#include <sstream>
#include <utility>
#include <fcntl.h>
#include <sys/stat.h>
#include <sys/statvfs.h>
#include <sys/sysinfo.h>
#include <unistd.h>
#include <unordered_map>
#include <vector>

#include "onnxruntime_cxx_api.h"

#include "decimate.h"
#include "extract.h"
#include "glb_writer.h"
#include "mcubes.h"
#include "models.h"
#include "preprocess.h"

namespace triposg {
namespace {

// Progress ranges, weighted by the measured stage durations in
// logs/phase2/ (50 steps: sampling ~250 s, extract ~11 s, mc ~1 s,
// DINOv2 ~1.1 s, u2net a few s, vae_post 0.2 s).
constexpr double kBgEnd = 0.010;
constexpr double kPrepEnd = 0.015;
constexpr double kDinoEnd = 0.020;
constexpr double kSampleEnd = 0.950;
constexpr double kPostEnd = 0.952;
constexpr double kExtractEnd = 0.992;
constexpr double kMcEnd = 0.996;

struct Tensor {
  std::vector<int64_t> shape;
  std::vector<float> data;
};

size_t Numel(const std::vector<int64_t>& s) {
  size_t n = 1;
  for (int64_t d : s) n *= static_cast<size_t>(d);
  return n;
}

std::vector<char> ReadFileBytes(const std::string& path, bool& ok) {
  FILE* f = std::fopen(path.c_str(), "rb");
  if (!f) {
    ok = false;
    return {};
  }
  std::fseek(f, 0, SEEK_END);
  long size = std::ftell(f);
  std::fseek(f, 0, SEEK_SET);
  std::vector<char> data(static_cast<size_t>(size));
  ok = std::fread(data.data(), 1, data.size(), f) == data.size();
  std::fclose(f);
  return data;
}

// C-order float32 .npy reader (noise-injection test hook).
bool ReadNpyF32(const std::string& path, std::vector<int64_t>& shape,
                std::vector<float>& data) {
  bool ok = false;
  std::vector<char> raw = ReadFileBytes(path, ok);
  if (!ok || raw.size() < 10 || std::memcmp(raw.data(), "\x93NUMPY", 6) != 0)
    return false;
  uint16_t hl;
  std::memcpy(&hl, raw.data() + 8, 2);
  std::string header(raw.data() + 10, hl);
  if (header.find("'descr': '<f4'") == std::string::npos ||
      header.find("'fortran_order': True") != std::string::npos)
    return false;
  shape.clear();
  size_t l = header.find('('), r = header.find(')');
  std::string dims = header.substr(l + 1, r - l - 1);
  size_t pos = 0;
  while (pos < dims.size()) {
    size_t comma = dims.find(',', pos);
    std::string tok = dims.substr(pos, comma - pos);
    if (!tok.empty() && tok.find_first_not_of(" \t") != std::string::npos)
      shape.push_back(std::stoll(tok));
    if (comma == std::string::npos) break;
    pos = comma + 1;
  }
  size_t off = 10 + hl;
  data.resize(Numel(shape));
  if (raw.size() < off + data.size() * 4) return false;
  std::memcpy(data.data(), raw.data() + off, data.size() * 4);
  return true;
}

struct Unit {
  std::string path;
  std::string stem;
  std::vector<std::string> in_names;   // original (pre-compile) names
  std::vector<std::string> out_names;  // logical names in the store
};

// Same unit table as the proven spike (bench/ndk/pipeline.cpp).
bool MakeUnit(const std::string& path, const std::string& stem, Unit& u,
              std::string& error) {
  u.path = path;
  u.stem = stem;
  u.in_names.clear();
  u.out_names.clear();
  if (stem == "head") {
    u.in_names = {"hidden_states", "timestep"};
    u.out_names = {"hidden", "temb"};
  } else if (stem == "tail") {
    u.in_names = {"hidden_in"};
    u.out_names = {"noise_pred"};
  } else if (stem == "vae_post") {
    u.in_names = {"latents"};
    u.out_names = {"kv"};
  } else if (stem == "vae_query") {
    u.in_names = {"queries", "kv"};
    u.out_names = {"sdf"};
  } else if (stem.size() == 5 && stem.compare(0, 3, "blk") == 0) {
    int layer = std::atoi(stem.c_str() + 3);
    if (layer < 0 || layer > 20) {
      error = "bad blk stem " + stem;
      return false;
    }
    u.in_names = {"hidden_in", "encoder_hidden_states"};
    if (layer > 10) u.in_names.push_back("skip_" + std::to_string(20 - layer));
    u.out_names = {"hidden"};
    if (layer < 10) u.out_names.push_back("skip_" + std::to_string(layer));
  } else {
    error = "bad stem " + stem;
    return false;
  }
  return true;
}

}  // namespace

// Best effort: ask the kernel to drop a file's cached pages.
static void DropFileCache(const std::string& path) {
  const int fd = open(path.c_str(), O_RDONLY | O_CLOEXEC);
  if (fd < 0) return;
  posix_fadvise(fd, 0, 0, POSIX_FADV_DONTNEED);
  close(fd);
}

struct Engine::Impl {
  Ort::Env env{ORT_LOGGING_LEVEL_WARNING, "triposg"};
  Ort::MemoryInfo mem{Ort::MemoryInfo::CreateCpu(OrtDeviceAllocator,
                                                 OrtMemTypeCPU)};
  std::string model_dir;
  std::string qnn_backend;
  ModelManifest manifest;
  // Per-run sessions, all released on Convert exit. Transformer: either one
  // merged QNN session (dit_chain.onnx, v2 model dirs) or the 23 per-unit
  // sessions (v1 dirs). VAE: created after sampling, released stage by
  // stage (post after kv, query after extraction).
  bool merged = false;
  std::unique_ptr<Ort::Session> chain_sess;
  std::vector<Unit> units;
  std::vector<Ort::Session> sessions;
  Unit post_unit, query_unit;
  Ort::Session* post_sess = nullptr;
  Ort::Session* query_sess = nullptr;
  std::vector<std::unique_ptr<Ort::Session>> owned;

  bool MakeSession(const std::string& path, bool qnn, int cpu_threads,
                   std::unique_ptr<Ort::Session>& out, std::string& error) {
    try {
      Ort::SessionOptions opts;
      // NPU sessions run the whole graph on QNN, so they need no CPU pool;
      // and no session may busy-wait between runs (25 spinning pools would
      // steal the big cores from the UI).
      opts.SetIntraOpNumThreads(qnn ? 1 : cpu_threads);
      opts.AddConfigEntry("session.intra_op.allow_spinning", "0");
      opts.AddConfigEntry("session.inter_op.allow_spinning", "0");
      opts.DisableCpuMemArena();
      opts.DisableMemPattern();
      opts.SetGraphOptimizationLevel(ORT_ENABLE_ALL);
      if (qnn) {
        std::unordered_map<std::string, std::string> qnn_opts;
        qnn_opts["backend_path"] = qnn_backend;
        qnn_opts["htp_performance_mode"] = "burst";
        opts.AppendExecutionProvider("QNN", qnn_opts);
      }
      out = std::make_unique<Ort::Session>(env, path.c_str(), opts);
      // The QNN context now lives in NPU memory; the file pages ORT just
      // read are dead weight. Drop them so loading ~6 GB of models does not
      // evict other apps' pages (which is what makes the phone stutter).
      DropFileCache(path);
      if (qnn) {
        const auto slash = path.find_last_of('/');
        if (slash != std::string::npos)
          DropFileCache(path.substr(0, slash) + "/model.bin");
      }
    } catch (const Ort::Exception& e) {
      error = std::string("session create failed for ") + path + ": " +
              e.what();
      return false;
    }
    return true;
  }

  bool RunUnit(Ort::Session& session, const Unit& unit,
               std::unordered_map<std::string, Tensor>& store,
               std::string& error) {
    Ort::AllocatorWithDefaultOptions alloc;
    try {
      const size_t ni = session.GetInputCount();
      const size_t no = session.GetOutputCount();
      std::vector<std::string> sess_in, sess_out;
      for (size_t i = 0; i < ni; ++i)
        sess_in.push_back(session.GetInputNameAllocated(i, alloc).get());
      for (size_t i = 0; i < no; ++i)
        sess_out.push_back(session.GetOutputNameAllocated(i, alloc).get());
      std::vector<const char*> in_names;
      std::vector<Ort::Value> ins;
      for (size_t i = 0; i < ni; ++i) {
        auto it = store.find(sess_in[i]);
        if (it == store.end()) {
          error = unit.stem + ": session input '" + sess_in[i] +
                  "' not in store";
          return false;
        }
        Tensor& t = it->second;
        in_names.push_back(sess_in[i].c_str());
        ins.push_back(Ort::Value::CreateTensor<float>(
            mem, t.data.data(), t.data.size(), t.shape.data(),
            t.shape.size()));
      }
      std::vector<const char*> out_names;
      for (const auto& s : sess_out) out_names.push_back(s.c_str());
      std::vector<Ort::Value> outs =
          session.Run(Ort::RunOptions{nullptr}, in_names.data(), ins.data(),
                      ins.size(), out_names.data(), out_names.size());
      std::vector<Tensor> got;
      for (size_t j = 0; j < outs.size(); ++j) {
        auto shape = outs[j].GetTensorTypeAndShapeInfo().GetShape();
        Tensor t{shape, std::vector<float>(Numel(shape))};
        float* fp = outs[j].GetTensorMutableData<float>();
        for (size_t i = 0; i < t.data.size(); ++i) t.data[i] = fp[i];
        got.push_back(std::move(t));
      }
      if (unit.out_names.size() == 1) {
        store[unit.out_names[0]] = std::move(got[0]);
      } else if (unit.stem == "head") {
        if (Numel(got[0].shape) == Numel(got[1].shape)) {
          error = "head: outputs have the same size";
          return false;
        }
        size_t hi = Numel(got[0].shape) > Numel(got[1].shape) ? 0 : 1;
        store["hidden"] = std::move(got[hi]);
        store["temb"] = std::move(got[1 - hi]);
      } else {
        if (got[0].shape != got[1].shape) {
          error = unit.stem + ": twin outputs differ in shape";
          return false;
        }
        store[unit.out_names[0]] = std::move(got[0]);
        store[unit.out_names[1]] = std::move(got[1]);
      }
      auto h = store.find("hidden");
      if (h != store.end()) {
        store["hidden_in"] = std::move(h->second);
        store.erase(h);
      }
    } catch (const Ort::Exception& e) {
      error = unit.stem + ": " + e.what();
      return false;
    }
    return true;
  }

  // One Run through the merged chain (bench/merge_chain.py layout): fixed
  // fp32 inputs, noise_pred only. temb is a graph output too, but fetching
  // it would copy it back for nothing, so it stays on the device.
  bool RunChainRow(const Tensor& lat, const Tensor& ts, const Tensor& enc,
                   Tensor& out, std::string& error) {
    try {
      if (chain_sess->GetInputCount() != 3) {
        error = "dit_chain.onnx: want 3 inputs";
        return false;
      }
      const char* in_names[3] = {"hidden_states", "timestep",
                                 "encoder_hidden_states"};
      const Tensor* ins_t[3] = {&lat, &ts, &enc};
      std::vector<Ort::Value> ins;
      for (int i = 0; i < 3; ++i) {
        const Tensor* t = ins_t[i];
        ins.push_back(Ort::Value::CreateTensor<float>(
            mem, const_cast<float*>(t->data.data()), t->data.size(),
            t->shape.data(), t->shape.size()));
      }
      const char* out_names[1] = {"noise_pred"};
      std::vector<Ort::Value> outs =
          chain_sess->Run(Ort::RunOptions{nullptr}, in_names, ins.data(), 3,
                          out_names, 1);
      auto shape = outs[0].GetTensorTypeAndShapeInfo().GetShape();
      if (shape != std::vector<int64_t>({1, 2048, 64})) {
        error = "dit_chain.onnx: noise_pred has the wrong shape";
        return false;
      }
      out.shape = shape;
      float* fp = outs[0].GetTensorMutableData<float>();
      out.data.assign(fp, fp + Numel(shape));
    } catch (const Ort::Exception& e) {
      error = std::string("dit_chain: ") + e.what();
      return false;
    }
    return true;
  }
};

Engine::Engine() : impl_(std::make_unique<Impl>()) {}
Engine::~Engine() = default;

bool Engine::Configure(const std::string& model_dir,
                       const std::string& qnn_backend, std::string& error) {
  Release();
  ModelManifest manifest;
  if (!LoadManifest(model_dir, manifest, error)) return false;
  std::atomic<bool> no_cancel(false);
  if (!VerifyModels(model_dir, manifest, false, nullptr, no_cancel, error))
    return false;
  struct stat st;
  if (::stat(qnn_backend.c_str(), &st) != 0) {
    error = "QNN backend missing: " + qnn_backend;
    return false;
  }
  impl_->model_dir = model_dir;
  impl_->qnn_backend = qnn_backend;
  impl_->manifest = std::move(manifest);
  return true;
}

// u2net query shim for RemoveBackgroundU2net.
struct U2netQuery {
  Ort::Env* env;
  Ort::MemoryInfo* mem;
  Ort::Session* session;
  static void Run(const float* nchw, float* out, int out_n, void* user) {
    auto* q = static_cast<U2netQuery*>(user);
    Ort::AllocatorWithDefaultOptions alloc;
    std::string in_name =
        q->session->GetInputNameAllocated(0, alloc).get();
    std::string out_name =
        q->session->GetOutputNameAllocated(0, alloc).get();
    auto in_shape = q->session->GetInputTypeInfo(0)
                        .GetTensorTypeAndShapeInfo()
                        .GetShape();
    if (in_shape != std::vector<int64_t>({1, 3, 320, 320})) {
      std::fprintf(stderr, "u2net input is not (1,3,320,320)\n");
      std::exit(1);
    }
    std::vector<int64_t> shape = in_shape;
    const char* in_names[1] = {in_name.c_str()};
    const char* out_names[1] = {out_name.c_str()};
    Ort::Value in = Ort::Value::CreateTensor<float>(
        *q->mem, const_cast<float*>(nchw), Numel(shape), shape.data(),
        shape.size());
    std::vector<Ort::Value> outs = q->session->Run(
        Ort::RunOptions{nullptr}, in_names, &in, 1, out_names, 1);
    auto got_shape = outs[0].GetTensorTypeAndShapeInfo().GetShape();
    float* fp = outs[0].GetTensorMutableData<float>();
    // Channel 0 of the single output: in NCHW it is the first block.
    size_t total = Numel(got_shape);
    if (total < static_cast<size_t>(out_n) ||
        total % static_cast<size_t>(out_n) != 0) {
      std::fprintf(stderr, "u2net output size %zu, want %d\n", total, out_n);
      std::exit(1);
    }
    std::memcpy(out, fp, static_cast<size_t>(out_n) * 4);
  }
};

bool Engine::PreviewCutout(const uint8_t* rgba_bytes, int w, int h,
                          std::vector<uint8_t>& out_rgb, int& out_w,
                          int& out_h, MaskStats& stats, std::string& error) {
  if (impl_->model_dir.empty()) {
    error = "not configured";
    return false;
  }
  if (rgba_bytes == nullptr || w < 1 || h < 1) {
    error = "empty image";
    return false;
  }
  RgbaImage input{w, h,
                  std::vector<uint8_t>(rgba_bytes, rgba_bytes + size_t(w) * h * 4)};

  // Same rule as Convert: skip u2net when the input already carries
  // alpha, so the preview matches the real run exactly.
  RgbaImage cutout;
  if (HasValidAlpha(input)) {
    cutout = input;
  } else {
    std::unique_ptr<Ort::Session> u2net;
    if (!impl_->MakeSession(impl_->model_dir + "/u2net.onnx", false, 4, u2net,
                            error))
      return false;
    std::vector<uint8_t> rgb(static_cast<size_t>(w) * h * 3);
    for (int i = 0; i < w * h; ++i) {
      rgb[i * 3 + 0] = rgba_bytes[i * 4 + 0];
      rgb[i * 3 + 1] = rgba_bytes[i * 4 + 1];
      rgb[i * 3 + 2] = rgba_bytes[i * 4 + 2];
    }
    U2netQuery q{&impl_->env, &impl_->mem, u2net.get()};
    try {
      cutout = RemoveBackgroundU2net(rgb.data(), w, h, &U2netQuery::Run, &q);
    } catch (const Ort::Exception& e) {
      error = std::string("u2net: ") + e.what();
      return false;
    }
    u2net.reset();
  }

  // Stats come from the original-size cutout alpha (the prepared canvas
  // is cropped to the subject, so everything would touch its border).
  std::vector<uint8_t> alpha(static_cast<size_t>(cutout.w) * cutout.h);
  for (int i = 0; i < cutout.w * cutout.h; ++i)
    alpha[i] = cutout.px[i * 4 + 3];
  stats = AnalyzeMask(alpha.data(), cutout.w, cutout.h);

  // The exact canvas Convert feeds DINOv2 (white bg).
  const float kWhite[3] = {1.0f, 1.0f, 1.0f};
  std::vector<uint8_t> prepared_u8;
  RgbFloat prepared = PrepareImage(cutout, kWhite, prepared_u8);
  if (prepared.w == 0 || prepared.h == 0 || prepared_u8.empty()) {
    error = "input image too small";
    return false;
  }
  out_rgb = std::move(prepared_u8);
  out_w = prepared.w;
  out_h = prepared.h;
  return true;
}

void Engine::Release() {
  impl_->chain_sess.reset();
  impl_->merged = false;
  impl_->sessions.clear();
  impl_->owned.clear();
  impl_->units.clear();
  impl_->post_sess = nullptr;
  impl_->query_sess = nullptr;
}

// vae_query as an extraction backend, with cancel checked per chunk.
class NpuQueryCancel : public QueryBackend {
 public:
  NpuQueryCancel(Ort::MemoryInfo* mem, Ort::Session* session,
                 const Tensor& kv, int chunk, std::atomic<bool>& cancel)
      : mem_(mem),
        session_(session),
        kv_(kv),
        chunk_(chunk),
        cancel_(cancel) {}
  void Query(const float* xyz, int n, float* out) override {
    if (cancel_.load()) {
      std::memset(out, 0, static_cast<size_t>(n) * 4);
      return;
    }
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
      auto shape = session_->GetInputTypeInfo(i)
                       .GetTensorTypeAndShapeInfo()
                       .GetShape();
      size_t count = Numel(shape);
      if (hold.back() == "kv") {
        ins.push_back(Ort::Value::CreateTensor<float>(
            *mem_, const_cast<float*>(kv_.data.data()), count, shape.data(),
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
    std::memcpy(out, fp, static_cast<size_t>(n) * 4);
  }

 private:
  Ort::MemoryInfo* mem_;
  Ort::Session* session_;
  const Tensor& kv_;
  int chunk_;
  std::atomic<bool>& cancel_;
};

// Deterministic Gaussian noise (mt19937_64 + Box-Muller). This cannot
// match the CUDA goldens' torch.Generator stream; it only needs to be
// deterministic per seed. The noise_path hook feeds golden noise in
// tests.
Tensor InitialNoise(uint64_t seed) {
  constexpr double kPi = 3.141592653589793;
  Tensor t{{1, 2048, 64}, std::vector<float>(2048 * 64)};
  std::mt19937_64 rng(seed);
  std::uniform_real_distribution<double> u(0.0, 1.0);
  for (size_t i = 0; i < t.data.size(); i += 2) {
    double u1 = u(rng), u2 = u(rng);
    if (u1 <= 0) u1 = 1e-12;
    const double r = std::sqrt(-2.0 * std::log(u1));
    t.data[i] = static_cast<float>(r * std::cos(2 * kPi * u2));
    if (i + 1 < t.data.size())
      t.data[i + 1] = static_cast<float>(r * std::sin(2 * kPi * u2));
  }
  return t;
}

bool Engine::Convert(const uint8_t* rgba_bytes, int w, int h,
                     const ConvertOptions& opts, const std::string& out_dir,
                     const ProgressCallback& progress,
                     std::atomic<bool>& cancel, std::string& error) {
  auto report = [&](double f, const std::string& label) {
    if (progress) progress(f, label);
  };
  auto cancelled = [&]() { return cancel.load(); };
  // The NPU sessions pin gigabytes of unswappable DMA-BUF memory (~7.1 GB
  // merged, ~9 GB fallback). Holding them between runs starves the rest of
  // the phone (other apps get killed, the UI stutters, HyperOS may stop
  // the app), so every run releases them on exit, success or not. The next
  // run pays the reload (~6.8 s merged).
  struct ReleaseOnExit {
    Engine* engine;
    ~ReleaseOnExit() { engine->Release(); }
  } release_on_exit{this};
  if (impl_->model_dir.empty()) {
    error = "engine not configured";
    return false;
  }

  // Preflight: free storage (models + 1 GiB headroom) and RAM.
  {
    struct statvfs vfs;
    if (::statvfs(impl_->model_dir.c_str(), &vfs) == 0) {
      unsigned long long free_bytes =
          static_cast<unsigned long long>(vfs.f_bavail) * vfs.f_frsize;
      unsigned long long need =
          static_cast<unsigned long long>(impl_->manifest.total_bytes) +
          (1ULL << 30);
      if (free_bytes < need) {
        char msg[256];
        std::snprintf(msg, sizeof(msg),
                      "free storage %llu MB < needed %llu MB",
                      free_bytes >> 20, need >> 20);
        error = msg;
        return false;
      }
    }
    // MemAvailable (not sysinfo freeram == MemFree): Android keeps most
    // spare RAM as reclaimable cache, so MemFree is routinely ~200 MB on a
    // 16 GB phone. Peak need is the DINOv2 CPU stage (~2.5 GB).
    unsigned long long avail_kb = 0;
    if (FILE* f = std::fopen("/proc/meminfo", "r")) {
      char line[256];
      while (std::fgets(line, sizeof(line), f)) {
        if (std::sscanf(line, "MemAvailable: %llu kB", &avail_kb) == 1) break;
      }
      std::fclose(f);
    }
    if (avail_kb > 0 && avail_kb < (3ULL << 20)) {
      char msg[256];
      std::snprintf(msg, sizeof(msg),
                    "available RAM %llu MB < 3072 MB; close other apps",
                    avail_kb >> 10);
      error = msg;
      return false;
    }
  }

  RgbaImage input{w, h,
                  std::vector<uint8_t>(rgba_bytes, rgba_bytes + size_t(w) * h * 4)};

  // Background removal (skipped when the input already carries alpha).
  report(0.0, "Isolating subject");
  RgbaImage cutout;
  if (HasValidAlpha(input)) {
    cutout = input;
  } else {
    std::unique_ptr<Ort::Session> u2net;
    if (!impl_->MakeSession(impl_->model_dir + "/u2net.onnx", false, 4, u2net,
                            error))
      return false;
    std::vector<uint8_t> rgb(static_cast<size_t>(w) * h * 3);
    for (int i = 0; i < w * h; ++i) {
      rgb[i * 3 + 0] = rgba_bytes[i * 4 + 0];
      rgb[i * 3 + 1] = rgba_bytes[i * 4 + 1];
      rgb[i * 3 + 2] = rgba_bytes[i * 4 + 2];
    }
    U2netQuery q{&impl_->env, &impl_->mem, u2net.get()};
    try {
      cutout = RemoveBackgroundU2net(rgb.data(), w, h, &U2netQuery::Run, &q);
    } catch (const Ort::Exception& e) {
      error = std::string("u2net: ") + e.what();
      return false;
    }
    u2net.reset();  // free before the transformer stage
  }
  if (cancelled()) {
    error = "cancelled";
    return false;
  }
  report(kBgEnd, "Preparing image");

  // prepare_image + DINOv2 preprocessing.
  const float kWhite[3] = {1.0f, 1.0f, 1.0f};
  std::vector<uint8_t> prepared_u8;
  RgbFloat prepared = PrepareImage(cutout, kWhite, prepared_u8);
  if (prepared.w == 0 || prepared.h == 0 || prepared_u8.empty()) {
    error = "input image too small";
    return false;
  }
  cutout.px.clear();
  cutout.px.shrink_to_fit();
  report(kPrepEnd, "Encoding image");
  std::vector<float> pixel_values =
      Dinov2PixelValues(prepared_u8.data(), prepared.w, prepared.h);
  prepared.px.clear();
  prepared.px.shrink_to_fit();
  prepared_u8.clear();
  prepared_u8.shrink_to_fit();

  // DINOv2 FP32 ORT CPU; freed before the transformer stage.
  Tensor cond{{1, 257, 1024}, std::vector<float>(257 * 1024)};
  {
    std::unique_ptr<Ort::Session> dino;
    if (!impl_->MakeSession(impl_->model_dir + "/dinov2_encoder.onnx", false,
                            4, dino, error))
      return false;
    try {
      Ort::AllocatorWithDefaultOptions alloc;
      std::string in_name = dino->GetInputNameAllocated(0, alloc).get();
      std::string out_name = dino->GetOutputNameAllocated(0, alloc).get();
      std::vector<int64_t> shape{1, 3, 224, 224};
      const char* in_names[1] = {in_name.c_str()};
      const char* out_names[1] = {out_name.c_str()};
      Ort::Value in = Ort::Value::CreateTensor<float>(
          impl_->mem, pixel_values.data(), pixel_values.size(), shape.data(),
          shape.size());
      std::vector<Ort::Value> outs = dino->Run(Ort::RunOptions{nullptr},
                                               in_names, &in, 1, out_names, 1);
      auto got_shape = outs[0].GetTensorTypeAndShapeInfo().GetShape();
      if (Numel(got_shape) != cond.data.size()) {
        error = "dinov2: unexpected output size";
        return false;
      }
      float* fp = outs[0].GetTensorMutableData<float>();
      for (size_t i = 0; i < cond.data.size(); ++i) cond.data[i] = fp[i];
    } catch (const Ort::Exception& e) {
      error = std::string("dinov2: ") + e.what();
      return false;
    }
  }
  pixel_values.clear();
  pixel_values.shrink_to_fit();
  if (cancelled()) {
    error = "cancelled";
    return false;
  }
  report(kDinoEnd, "Generating geometry");

  // Transformer sessions. Merged v2 dirs (dit_chain.onnx present) create
  // ONE QNN session sharing a single spill-fill buffer; v1 dirs keep the
  // 23 per-unit sessions. VAE sessions come later: vae_post pins a 413 MB
  // bin, so it must not sit resident through the sampling loop.
  static const char* kStems[23] = {
      "head",  "blk00", "blk01", "blk02", "blk03", "blk04", "blk05",
      "blk06", "blk07", "blk08", "blk09", "blk10", "blk11", "blk12",
      "blk13", "blk14", "blk15", "blk16", "blk17", "blk18", "blk19",
      "blk20", "tail"};
  report(kDinoEnd, "Loading models");
  {
    struct stat chain_st;
    impl_->merged =
        ::stat((impl_->model_dir + "/dit_chain.onnx").c_str(), &chain_st) == 0;
  }
  if (impl_->merged) {
    if (cancelled()) {
      error = "cancelled";
      return false;
    }
    std::unique_ptr<Ort::Session> chain;
    if (!impl_->MakeSession(impl_->model_dir + "/dit_chain.onnx", true, 4,
                            chain, error))
      return false;
    impl_->chain_sess = std::move(chain);
    // MakeSession drops the .onnx pages; the 23 context bins it just read
    // are dead weight too.
    for (const char* stem : kStems)
      DropFileCache(impl_->model_dir + "/" + stem + "/model.bin");
  } else {
    for (const char* stem : kStems) {
      if (cancelled()) {
        error = "cancelled";
        return false;
      }
      Unit u;
      if (!MakeUnit(impl_->model_dir + "/" + stem + "/model.onnx", stem, u,
                    error))
        return false;
      std::unique_ptr<Ort::Session> s;
      if (!impl_->MakeSession(u.path, true, 4, s, error)) return false;
      impl_->units.push_back(std::move(u));
      impl_->sessions.push_back(std::move(*s));
    }
  }

  // Initial noise: golden hook or seeded Gaussian.
  Tensor latent;
  if (!opts.noise_path.empty()) {
    if (!ReadNpyF32(opts.noise_path, latent.shape, latent.data) ||
        latent.shape != std::vector<int64_t>({1, 2048, 64})) {
      error = "bad noise hook " + opts.noise_path;
      return false;
    }
  } else {
    latent = InitialNoise(opts.seed);
  }
  Tensor zeros{{1, 257, 1024}, std::vector<float>(257 * 1024, 0.0f)};

  // Rectified-flow sigmas (float32(1 - i/steps), trailing 0), scheduler
  // port from bench/ndk/pipeline.cpp.
  const int steps = opts.steps;
  if (steps < 1) {
    error = "steps < 1";
    return false;
  }
  std::vector<float> sigmas(steps + 1), times(steps);
  for (int i = 0; i < steps; ++i) {
    double s = 1.0 - static_cast<double>(i) / steps;
    sigmas[i] = static_cast<float>(s);
    times[i] = sigmas[i] * 1000.0f;
  }
  sigmas[steps] = 0.0f;

  // A single merged Run cannot be interrupted mid-row; at ~1.6 s per
  // row the cancel bound stays between steps (checked below).
  auto run_row = [&](const Tensor& lat, const Tensor& ts,
                     const Tensor& enc, Tensor& out) {
    if (impl_->merged)
      return impl_->RunChainRow(lat, ts, enc, out, error);
    std::unordered_map<std::string, Tensor> store;
    store["hidden_states"] = lat;
    store["timestep"] = ts;
    store["encoder_hidden_states"] = enc;
    for (size_t i = 0; i < impl_->units.size(); ++i) {
      if (cancelled()) return false;
      if (!impl_->RunUnit(impl_->sessions[i], impl_->units[i], store, error))
        return false;
    }
    out = store["noise_pred"];
    return true;
  };

  for (int i = 0; i < steps; ++i) {
    if (cancelled()) {
      error = "cancelled";
      return false;
    }
    Tensor ts{{1}, {times[i]}};
    Tensor n0, n1;
    if (!run_row(latent, ts, zeros, n0)) {
      if (cancelled()) error = "cancelled";
      return false;
    }
    if (!run_row(latent, ts, cond, n1)) {
      if (cancelled()) error = "cancelled";
      return false;
    }
    const float dt = sigmas[i] - sigmas[i + 1];
    for (size_t k = 0; k < latent.data.size(); ++k) {
      float guided = n0.data[k] +
                     static_cast<float>(opts.guidance) * (n1.data[k] - n0.data[k]);
      latent.data[k] += dt * guided;
    }
    report(kDinoEnd + (kSampleEnd - kDinoEnd) * (i + 1) / steps,
           "Generating geometry");
  }
  cond.data.clear();
  cond.data.shrink_to_fit();
  zeros.data.clear();
  zeros.data.shrink_to_fit();

  // Sampling is done: drop the transformer session(s) — most of the pinned
  // NPU memory — before creating the VAE sessions below.
  impl_->sessions.clear();
  impl_->units.clear();
  impl_->chain_sess.reset();

  // VAE sessions, created only now: vae_post's bin alone is 413 MB, and
  // neither session is needed before this point.
  if (!MakeUnit(impl_->model_dir + "/vae_post/model.onnx", "vae_post",
                impl_->post_unit, error) ||
      !MakeUnit(impl_->model_dir + "/vae_query/model.onnx", "vae_query",
                impl_->query_unit, error))
    return false;
  {
    std::unique_ptr<Ort::Session> ps, qs;
    if (!impl_->MakeSession(impl_->post_unit.path, true, 4, ps, error))
      return false;
    if (!impl_->MakeSession(impl_->query_unit.path, true, 4, qs, error))
      return false;
    impl_->owned.push_back(std::move(ps));
    impl_->owned.push_back(std::move(qs));
    impl_->post_sess = impl_->owned[0].get();
    impl_->query_sess = impl_->owned[1].get();
  }

  // VAE decode.
  report(kSampleEnd, "Decoding shape");
  std::unordered_map<std::string, Tensor> pstore;
  pstore["latents"] = latent;
  latent.data.clear();
  latent.data.shrink_to_fit();
  if (!impl_->RunUnit(*impl_->post_sess, impl_->post_unit, pstore, error))
    return false;
  Tensor kv = pstore["kv"];
  pstore.clear();
  // vae_post is done: release it (owned[0]) before extraction.
  impl_->post_sess = nullptr;
  impl_->owned[0].reset();
  if (cancelled()) {
    error = "cancelled";
    return false;
  }
  report(kPostEnd, "Extracting mesh");

  Ort::AllocatorWithDefaultOptions alloc;
  int chunk = 0;
  for (size_t i = 0; i < impl_->query_sess->GetInputCount(); ++i) {
    std::string nm =
        impl_->query_sess->GetInputNameAllocated(i, alloc).get();
    if (nm == "queries")
      chunk = static_cast<int>(impl_->query_sess->GetInputTypeInfo(i)
                                   .GetTensorTypeAndShapeInfo()
                                   .GetShape()[1]);
  }
  if (chunk < 1) {
    error = "vae_query has no 'queries' input";
    return false;
  }
  ExtractConfig cfg;
  cfg.d0 = opts.d0;
  cfg.d1 = opts.d1;
  cfg.chunk_points = chunk;
  NpuQueryCancel backend(&impl_->mem, impl_->query_sess, kv, chunk,
                         cancel);
  std::vector<float> grid;
  int res = 0;
  if (!ExtractSdf(&backend, cfg, grid, res)) {
    error = "extract failed";
    return false;
  }
  kv.data.clear();
  kv.data.shrink_to_fit();
  // vae_query is done: release it (owned[1]) before the CPU-heavy
  // polygonize/decimate below.
  impl_->query_sess = nullptr;
  impl_->owned[1].reset();
  if (cancelled()) {
    error = "cancelled";
    return false;
  }
  report(kExtractEnd, "Building mesh");

  McubesConfig mc;
  mc.spacing = 2 * cfg.bound / (1 << opts.d1);
  mc.ox = mc.oy = mc.oz = -cfg.bound;
  McubesResult mesh = Polygonize(grid.data(), res, mc);
  grid.clear();
  grid.shrink_to_fit();
  if (cancelled()) {
    error = "cancelled";
    return false;
  }
  report(kMcEnd, "Writing model");

  DecimatedMesh display;
  if (!DecimateMesh(mesh.positions.data(), mesh.positions.size() / 3,
                    mesh.indices.data(), mesh.indices.size() / 3,
                    static_cast<size_t>(opts.target_tris), display)) {
    error = "decimate failed";
    return false;
  }

  GlbMesh full{mesh.positions, mesh.normals, mesh.indices};
  GlbMesh disp{display.positions, display.normals, display.indices};
  const std::string tmp_full = out_dir + "/mesh.glb.tmp";
  const std::string tmp_disp = out_dir + "/mesh.display.glb.tmp";
  const std::string dst_full = out_dir + "/mesh.glb";
  const std::string dst_disp = out_dir + "/mesh.display.glb";
  if (!WriteGlb(full, tmp_full) || !WriteGlb(disp, tmp_disp)) {
    std::remove(tmp_full.c_str());
    std::remove(tmp_disp.c_str());
    error = "write failed";
    return false;
  }
  if (cancelled()) {
    std::remove(tmp_full.c_str());
    std::remove(tmp_disp.c_str());
    error = "cancelled";
    return false;
  }
  std::rename(tmp_full.c_str(), dst_full.c_str());
  std::rename(tmp_disp.c_str(), dst_disp.c_str());
  report(1.0, "Done");
  return true;
}

}  // namespace triposg
