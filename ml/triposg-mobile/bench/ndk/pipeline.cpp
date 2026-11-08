// spike_pipeline: full on-device TripoSG pipeline on precompiled NPU units.
//
// Loads the 23 resident transformer units + vae_post + vae_query (AI Hub
// EPContext models), runs the rectified-flow sampling loop, decodes the
// VAE, extracts the octree SDF, polygonizes and writes a GLB.
//
// Usage:
//   spike_pipeline models.txt vae_post.onnx vae_query.onnx in_dir out_dir
//       steps d0 d1 [qnn_backend]
//   models.txt: "<model.onnx path> <stem>" per line (head|blkNN|tail).
//   in_dir: latent_r0.npy (initial noise (1,2048,64)), enc_r1.npy (cond
//     encoder states (1,257,1024)). The uncond row is zeros (matches the
//     golden row 0); timesteps come from the scheduler port below.
//   out_dir: final_latents.npy (1,2048,64) + mesh.glb.
//   steps: sampling steps (knob; goldens used 50). d0/d1: extraction
//     depths (golden-equivalent d0=6 d1=9; mobile starts lower).
//
// Sampling loop ports triposg/schedulers/scheduling_rectified_flow.py at
// fc5c4099 exactly (RectifiedFlowScheduler, shift=1, no dynamic shift):
//   sigma[i] = float32(1 - i/steps) for i < steps, sigma[steps] = 0;
//   timestep[i] = sigma[i] * 1000 (float32);
//   noise = uncond + 7.0 * (cond - uncond)              (guidance 7.0)
//   latents += (sigma[i] - sigma[i+1]) * noise          (FP32 Euler)
// The transformer runs both rows at batch 1 (HTP batch-2 attention is
// wrong); the VAE/extraction run once. Prints per-stage ms, VmHWM and PSS.
// Resident sessions only (stream was rejected: ~15 s per pass).
#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <numeric>
#include <sstream>
#include <string>
#include <unordered_map>
#include <vector>

#include "onnxruntime_cxx_api.h"

#include "../../cpp/extract.h"
#include "../../cpp/glb_writer.h"
#include "../../cpp/mcubes.h"

namespace {

std::vector<char> read_file(const char* path) {
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

// C-contiguous float32 .npy only.
struct NpyArray {
  std::vector<int64_t> shape;
  std::vector<float> data;
};

NpyArray read_npy(const std::string& path) {
  std::vector<char> raw = read_file(path.c_str());
  if (raw.size() < 10 || std::memcmp(raw.data(), "\x93NUMPY", 6) != 0) {
    std::fprintf(stderr, "not an npy file: %s\n", path.c_str());
    std::exit(1);
  }
  uint16_t header_len;
  std::memcpy(&header_len, raw.data() + 8, 2);
  std::string header(raw.data() + 10, header_len);
  if (header.find("'descr': '<f4'") == std::string::npos ||
      header.find("'fortran_order': True") != std::string::npos) {
    std::fprintf(stderr, "only C-order little-endian float32 npy: %s\n",
                 path.c_str());
    std::exit(1);
  }
  NpyArray out;
  size_t l = header.find('(');
  size_t r = header.find(')');
  std::string dims = header.substr(l + 1, r - l - 1);
  size_t pos = 0;
  while (pos < dims.size()) {
    size_t comma = dims.find(',', pos);
    std::string tok = dims.substr(pos, comma - pos);
    if (!tok.empty() && tok.find_first_not_of(" \t") != std::string::npos) {
      out.shape.push_back(std::stoll(tok));
    }
    if (comma == std::string::npos) break;
    pos = comma + 1;
  }
  size_t offset = 10 + header_len;
  size_t count = 1;
  for (int64_t d : out.shape) count *= static_cast<size_t>(d);
  if (raw.size() < offset + count * 4) {
    std::fprintf(stderr, "truncated data: %s\n", path.c_str());
    std::exit(1);
  }
  out.data.resize(count);
  std::memcpy(out.data.data(), raw.data() + offset, count * 4);
  return out;
}

void write_npy(const char* path, const std::vector<int64_t>& shape,
               const float* data, size_t count) {
  std::string dims;
  for (size_t i = 0; i < shape.size(); ++i) {
    dims += std::to_string(shape[i]);
    if (i + 1 < shape.size() || shape.size() == 1) dims += ", ";
  }
  std::string header = "{'descr': '<f4', 'fortran_order': False, 'shape': (" +
      dims + "), }";
  size_t pad = 64 - ((10 + header.size() + 1) % 64);
  header += std::string(pad, ' ');
  header += '\n';
  FILE* f = std::fopen(path, "wb");
  if (!f) {
    std::fprintf(stderr, "cannot write %s\n", path);
    std::exit(1);
  }
  std::fputc(0x93, f);
  std::fputs("NUMPY", f);
  std::fputc(1, f);
  std::fputc(0, f);
  uint16_t header_len = static_cast<uint16_t>(header.size());
  std::fwrite(&header_len, 2, 1, f);
  std::fputs(header.c_str(), f);
  std::fwrite(data, 4, count, f);
  std::fclose(f);
}

long vmhwm_kb() {
  std::FILE* f = std::fopen("/proc/self/status", "r");
  if (f == nullptr) return -1;
  char line[256];
  long val = -1;
  while (std::fgets(line, sizeof(line), f) != nullptr) {
    if (std::strncmp(line, "VmHWM:", 6) == 0) {
      val = std::strtol(line + 6, nullptr, 10);
      break;
    }
  }
  std::fclose(f);
  return val;
}

long pss_kb() {
  std::FILE* f = std::fopen("/proc/self/smaps_rollup", "r");
  if (f == nullptr) return -1;
  char line[256];
  long val = -1;
  while (std::fgets(line, sizeof(line), f) != nullptr) {
    if (std::strncmp(line, "Pss:", 4) == 0) {
      val = std::strtol(line + 4, nullptr, 10);
      break;
    }
  }
  std::fclose(f);
  return val;
}

double median(std::vector<double> v) {
  std::sort(v.begin(), v.end());
  return v[v.size() / 2];
}

struct Tensor {
  std::vector<int64_t> shape;
  std::vector<float> data;
};

struct Unit {
  std::string path;
  std::string stem;
  std::vector<std::string> in_names;
  std::vector<std::string> out_names;
};

// Original export input/output names per unit stem. Transformer stems must
// match split_export_step.py unit_io_names; vae stems match export_vae.py.
Unit make_unit(const std::string& path, const std::string& stem) {
  Unit u{path, stem, {}, {}};
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
      std::fprintf(stderr, "bad blk stem '%s'\n", stem.c_str());
      std::exit(1);
    }
    u.in_names = {"hidden_in", "encoder_hidden_states"};
    if (layer > 10) u.in_names.push_back("skip_" + std::to_string(20 - layer));
    u.out_names = {"hidden"};
    if (layer < 10) u.out_names.push_back("skip_" + std::to_string(layer));
  } else {
    std::fprintf(stderr, "bad stem '%s'\n", stem.c_str());
    std::exit(1);
  }
  return u;
}

Ort::Env* g_env = nullptr;
Ort::MemoryInfo* g_mem = nullptr;
std::string g_backend;
double g_query_ms = 0;
long g_query_calls = 0;

Ort::Session make_session(const std::string& model_path) {
  Ort::SessionOptions opts;
  opts.SetIntraOpNumThreads(4);
  opts.DisableCpuMemArena();
  opts.DisableMemPattern();
  opts.SetGraphOptimizationLevel(ORT_ENABLE_ALL);
  std::unordered_map<std::string, std::string> qnn_opts;
  qnn_opts["backend_path"] = g_backend;
  qnn_opts["htp_performance_mode"] = "burst";
  const char* qnn_opts_env = std::getenv("SPIKE_QNN_OPTS");
  if (qnn_opts_env != nullptr) {
    std::string rest = qnn_opts_env;
    while (!rest.empty()) {
      size_t comma = rest.find(',');
      std::string item = rest.substr(0, comma);
      size_t eq = item.find('=');
      if (eq == std::string::npos || eq == 0 || eq + 1 >= item.size()) {
        std::fprintf(stderr, "bad SPIKE_QNN_OPTS item '%s'\n", item.c_str());
        std::exit(1);
      }
      qnn_opts[item.substr(0, eq)] = item.substr(eq + 1);
      if (comma == std::string::npos) break;
      rest = rest.substr(comma + 1);
    }
  }
  opts.AppendExecutionProvider("QNN", qnn_opts);
  return Ort::Session(*g_env, model_path.c_str(), opts);
}

// Run one unit; session inputs matched by original name from the store,
// outputs assigned by unit kind (same rules as spike_chain).
void run_unit(Ort::Session& session, const Unit& unit,
              std::unordered_map<std::string, Tensor>& store) {
  Ort::AllocatorWithDefaultOptions alloc;
  const size_t n_inputs = session.GetInputCount();
  const size_t n_outputs = session.GetOutputCount();
  if (n_inputs != unit.in_names.size() ||
      n_outputs != unit.out_names.size()) {
    std::fprintf(stderr,
                 "%s: session io counts (%zu in, %zu out) != expected "
                 "(%zu in, %zu out)\n",
                 unit.stem.c_str(), n_inputs, n_outputs,
                 unit.in_names.size(), unit.out_names.size());
    std::exit(1);
  }
  auto numel = [](const std::vector<int64_t>& s) {
    size_t n = 1;
    for (int64_t d : s) n *= static_cast<size_t>(d);
    return n;
  };
  std::vector<std::string> sess_in, sess_out;
  for (size_t i = 0; i < n_inputs; ++i)
    sess_in.push_back(session.GetInputNameAllocated(i, alloc).get());
  for (size_t i = 0; i < n_outputs; ++i)
    sess_out.push_back(session.GetOutputNameAllocated(i, alloc).get());
  std::vector<const char*> in_names;
  std::vector<Ort::Value> ins;
  for (size_t i = 0; i < n_inputs; ++i) {
    auto it = store.find(sess_in[i]);
    if (it == store.end()) {
      std::fprintf(stderr, "%s: session input '%s' not in store\n",
                   unit.stem.c_str(), sess_in[i].c_str());
      std::exit(1);
    }
    Tensor& t = it->second;
    in_names.push_back(sess_in[i].c_str());
    ins.push_back(Ort::Value::CreateTensor<float>(
        *g_mem, t.data.data(), t.data.size(), t.shape.data(), t.shape.size()));
  }
  std::vector<const char*> out_names;
  for (const auto& s : sess_out) out_names.push_back(s.c_str());
  std::vector<Ort::Value> outs =
      session.Run(Ort::RunOptions{nullptr}, in_names.data(), ins.data(),
                  ins.size(), out_names.data(), out_names.size());
  std::vector<Tensor> got;
  for (size_t j = 0; j < outs.size(); ++j) {
    auto shape = outs[j].GetTensorTypeAndShapeInfo().GetShape();
    Tensor t{shape, std::vector<float>(numel(shape))};
    float* fp = outs[j].GetTensorMutableData<float>();
    for (size_t i = 0; i < t.data.size(); ++i) t.data[i] = fp[i];
    got.push_back(std::move(t));
  }
  if (unit.out_names.size() == 1) {
    store[unit.out_names[0]] = std::move(got[0]);
  } else if (unit.stem == "head") {
    if (numel(got[0].shape) == numel(got[1].shape)) {
      std::fprintf(stderr, "head: outputs have the same size\n");
      std::exit(1);
    }
    size_t hi = numel(got[0].shape) > numel(got[1].shape) ? 0 : 1;
    store["hidden"] = std::move(got[hi]);
    store["temb"] = std::move(got[1 - hi]);
  } else {
    if (got[0].shape != got[1].shape) {
      std::fprintf(stderr, "%s: twin outputs differ in shape\n",
                   unit.stem.c_str());
      std::exit(1);
    }
    store[unit.out_names[0]] = std::move(got[0]);
    store[unit.out_names[1]] = std::move(got[1]);
  }
  auto h = store.find("hidden");
  if (h != store.end()) {
    store["hidden_in"] = std::move(h->second);
    store.erase(h);
  }
}

// One batch-1 transformer pass over the resident units.
Tensor run_row(std::vector<Ort::Session>& sessions,
               const std::vector<Unit>& units, const Tensor& latent,
               const Tensor& timestep, const Tensor& enc) {
  std::unordered_map<std::string, Tensor> store;
  store["hidden_states"] = latent;
  store["timestep"] = timestep;
  store["encoder_hidden_states"] = enc;
  for (size_t i = 0; i < units.size(); ++i)
    run_unit(sessions[i], units[i], store);
  return store["noise_pred"];
}

// vae_query session as an extraction backend (exact chunk each call).
class NpuQuery : public triposg::QueryBackend {
 public:
  NpuQuery(Ort::Session* session, const Tensor& kv, int chunk)
      : session_(session), kv_(kv), chunk_(chunk) {}
  void Query(const float* xyz, int n, float* out) override {
    if (n != chunk_) {
      std::fprintf(stderr, "backend got %d points, want chunk %d\n", n,
                   chunk_);
      std::exit(1);
    }
    auto t0 = std::chrono::steady_clock::now();
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
      size_t count = 1;
      for (int64_t d : shape) count *= static_cast<size_t>(d);
      if (hold.back() == "kv") {
        ins.push_back(Ort::Value::CreateTensor<float>(
            *g_mem, const_cast<float*>(kv_.data.data()), count, shape.data(),
            shape.size()));
      } else {
        ins.push_back(Ort::Value::CreateTensor<float>(
            *g_mem, const_cast<float*>(xyz), count, shape.data(),
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
    auto t1 = std::chrono::steady_clock::now();
    g_query_ms += std::chrono::duration<double, std::milli>(t1 - t0).count();
    g_query_calls += 1;
  }

 private:
  Ort::Session* session_;
  const Tensor& kv_;
  int chunk_;
};

}  // namespace

int main(int argc, char** argv) {
  if (argc < 9) {
    std::fprintf(stderr,
                 "usage: %s models.txt vae_post.onnx vae_query.onnx in_dir "
                 "out_dir steps d0 d1 [qnn_backend]\n",
                 argv[0]);
    return 1;
  }
  const int steps = std::atoi(argv[6]);
  const int d0 = std::atoi(argv[7]);
  const int d1 = std::atoi(argv[8]);
  if (steps < 1 || d0 < 1 || d1 < 1) {
    std::fprintf(stderr, "need steps,d0,d1 >= 1\n");
    return 1;
  }
  g_backend = argc > 9 ? argv[9] : "/vendor/lib64/libQnnHtp.so";
  const std::string indir = argv[4], outdir = argv[5];
  const double guidance = 7.0;

  std::vector<Unit> units;
  {
    std::ifstream list(argv[1]);
    if (!list) {
      std::fprintf(stderr, "cannot open %s\n", argv[1]);
      return 1;
    }
    std::string line;
    while (std::getline(list, line)) {
      if (line.empty()) continue;
      std::istringstream words(line);
      std::string path, stem;
      if (!(words >> path >> stem)) {
        std::fprintf(stderr, "bad models.txt line: %s\n", line.c_str());
        return 1;
      }
      units.push_back(make_unit(path, stem));
    }
  }
  if (units.size() != 23) {
    std::fprintf(stderr, "want 23 transformer units, got %zu\n", units.size());
    return 1;
  }
  Unit post = make_unit(argv[2], "vae_post");
  Unit query_u = make_unit(argv[3], "vae_query");

  NpyArray latent_npy = read_npy(indir + "/latent_r0.npy");
  NpyArray enc_npy = read_npy(indir + "/enc_r1.npy");
  if (latent_npy.shape != std::vector<int64_t>({1, 2048, 64}) ||
      enc_npy.shape != std::vector<int64_t>({1, 257, 1024})) {
    std::fprintf(stderr, "bad input shapes\n");
    return 1;
  }
  Tensor latent{latent_npy.shape, latent_npy.data};
  Tensor enc{enc_npy.shape, enc_npy.data};
  Tensor zeros{{1, 257, 1024},
               std::vector<float>(257 * 1024, 0.0f)};

  Ort::Env env(ORT_LOGGING_LEVEL_WARNING, "spike_pipeline");
  g_env = &env;
  Ort::MemoryInfo mem = Ort::MemoryInfo::CreateCpu(OrtDeviceAllocator,
                                                   OrtMemTypeCPU);
  g_mem = &mem;

  auto t_all0 = std::chrono::steady_clock::now();
  std::vector<Ort::Session> sessions;
  double create_total_ms = 0;
  for (const auto& u : units) {
    auto t0 = std::chrono::steady_clock::now();
    sessions.emplace_back(make_session(u.path));
    auto t1 = std::chrono::steady_clock::now();
    create_total_ms += std::chrono::duration<double, std::milli>(t1 - t0).count();
  }
  auto t_post0 = std::chrono::steady_clock::now();
  Ort::Session post_sess = make_session(post.path);
  Ort::Session query_sess = make_session(query_u.path);
  auto t_post1 = std::chrono::steady_clock::now();
  create_total_ms += std::chrono::duration<double, std::milli>(t_post1 - t_post0).count();
  std::printf("create_total_ms=%.1f n_models=%zu\n", create_total_ms,
              units.size() + 2);
  std::printf("vmhwm_after_load_kb=%ld pss_after_load_kb=%ld\n", vmhwm_kb(),
              pss_kb());

  // Rectified-flow sigmas (float32(1 - i/steps), trailing 0) and timesteps.
  std::vector<float> sigmas(steps + 1), times(steps);
  for (int i = 0; i < steps; ++i) {
    double s = 1.0 - static_cast<double>(i) / steps;
    sigmas[i] = static_cast<float>(s);
    times[i] = sigmas[i] * 1000.0f;
  }
  sigmas[steps] = 0.0f;

  std::vector<double> step_ms;
  for (int i = 0; i < steps; ++i) {
    auto t0 = std::chrono::steady_clock::now();
    Tensor ts{{1}, {times[i]}};
    Tensor n0 = run_row(sessions, units, latent, ts, zeros);
    Tensor n1 = run_row(sessions, units, latent, ts, enc);
    const float dt = sigmas[i] - sigmas[i + 1];
    for (size_t k = 0; k < latent.data.size(); ++k) {
      float guided = n0.data[k] + guidance * (n1.data[k] - n0.data[k]);
      latent.data[k] += dt * guided;
    }
    auto t1 = std::chrono::steady_clock::now();
    double ms = std::chrono::duration<double, std::milli>(t1 - t0).count();
    step_ms.push_back(ms);
    std::printf("step %d/%d t=%.1f ms=%.0f vmhwm_kb=%ld\n", i + 1, steps,
                times[i], ms, vmhwm_kb());
  }
  std::printf("sampling_ms=%.0f step_median_ms=%.0f guidance=%.1f\n",
              std::accumulate(step_ms.begin(), step_ms.end(), 0.0),
              median(step_ms), guidance);

  std::string lat_path = outdir + "/final_latents.npy";
  write_npy(lat_path.c_str(), latent.shape, latent.data.data(),
            latent.data.size());

  auto t_v0 = std::chrono::steady_clock::now();
  std::unordered_map<std::string, Tensor> pstore;
  pstore["latents"] = latent;
  run_unit(post_sess, post, pstore);
  Tensor kv = pstore["kv"];
  auto t_v1 = std::chrono::steady_clock::now();
  std::printf("vae_post_ms=%.0f kv=(%lld,%lld,%lld)\n",
              std::chrono::duration<double, std::milli>(t_v1 - t_v0).count(),
              (long long)kv.shape[0], (long long)kv.shape[1],
              (long long)kv.shape[2]);

  Ort::AllocatorWithDefaultOptions alloc;
  int chunk = 0;
  for (size_t i = 0; i < query_sess.GetInputCount(); ++i) {
    std::string nm = query_sess.GetInputNameAllocated(i, alloc).get();
    if (nm == "queries")
      chunk = static_cast<int>(query_sess.GetInputTypeInfo(i)
                                   .GetTensorTypeAndShapeInfo()
                                   .GetShape()[1]);
  }
  if (chunk < 1) {
    std::fprintf(stderr, "vae_query has no 'queries' input\n");
    return 1;
  }
  triposg::ExtractConfig cfg;
  cfg.d0 = d0;
  cfg.d1 = d1;
  cfg.chunk_points = chunk;
  NpuQuery backend(&query_sess, kv, chunk);
  std::vector<float> grid;
  int res = 0;
  auto t_e0 = std::chrono::steady_clock::now();
  if (!triposg::ExtractSdf(&backend, cfg, grid, res)) {
    std::fprintf(stderr, "extract failed\n");
    return 1;
  }
  auto t_e1 = std::chrono::steady_clock::now();
  std::printf("extract_ms=%.0f query_ms=%.0f query_calls=%ld grid=%d "
              "vmhwm_kb=%ld\n",
              std::chrono::duration<double, std::milli>(t_e1 - t_e0).count(),
              g_query_ms, g_query_calls, res, vmhwm_kb());

  triposg::McubesConfig mc;
  mc.spacing = 2 * cfg.bound / (1 << d1);
  mc.ox = mc.oy = mc.oz = -cfg.bound;
  triposg::McubesResult mesh = triposg::Polygonize(grid.data(), res, mc);
  grid.clear();
  grid.shrink_to_fit();
  auto t_m1 = std::chrono::steady_clock::now();
  std::printf("mc_ms=%.0f verts=%zu tris=%zu closed=%d volume=%.6f\n",
              std::chrono::duration<double, std::milli>(t_m1 - t_e1).count(),
              mesh.positions.size() / 3, mesh.indices.size() / 3,
              (int)mesh.closed, mesh.signed_volume);

  triposg::GlbMesh glb{mesh.positions, mesh.normals, mesh.indices};
  std::string mesh_path = outdir + "/mesh.glb";
  if (!triposg::WriteGlb(glb, mesh_path)) {
    std::fprintf(stderr, "write failed: %s\n", mesh_path.c_str());
    return 1;
  }
  auto t_all1 = std::chrono::steady_clock::now();
  std::printf("wrote %s and %s total_ms=%.0f vmhwm_end_kb=%ld pss_end_kb=%ld\n",
              mesh_path.c_str(), lat_path.c_str(),
              std::chrono::duration<double, std::milli>(t_all1 - t_all0)
                  .count(),
              vmhwm_kb(), pss_kb());
  return 0;
}
