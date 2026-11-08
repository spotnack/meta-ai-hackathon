// spike_chain: run one full guided transformer step on precompiled
// (AI Hub EPContext) batch-1 units and write the stacked noise_pred.
//
// Usage:
//   spike_chain resident|stream models.txt input_dir out.npy [runs] [qnn_backend]
//   models.txt: one "<model.onnx path> <stem>" per line in chain order,
//     where stem is head | blkNN | tail (every on-device model file is
//     named model.onnx, so the stem column drives the wiring).
//   input_dir: latent_r0.npy timestep_r0.npy enc_r0.npy latent_r1.npy
//     timestep_r1.npy enc_r1.npy (batch-1 float32; r0 = uncond, r1 = cond).
//   out.npy: stacked noise_pred (2,2048,64), row 0 = uncond, row 1 = cond.
//   runs: timed repetitions of the full two-row step (default 3; one
//     untimed warmup step runs first).
//   qnn_backend: QNN backend .so (default /vendor/lib64/libQnnHtp.so).
//
// Wiring: the compiled models rename outputs (output_0/output_1) and may
// reorder inputs, so session inputs are matched to the store by ORIGINAL
// export name, and session outputs are assigned by unit kind: single
// outputs directly; head's hidden/temb by element count (either order);
// blk twin outputs positionally (hidden and skip_i are the same tensor
// values, and a max-abs diff between the twins is reported per unit).
//
// Prints: per-unit median run/create ms, median total ms per pass (row0,
// row1), VmHWM after warmup and at end, PSS (smaps_rollup) after warmup
// and at end, and per-row noise stats. Env SPIKE_QNN_OPTS merges extra
// provider options. No ep.context_* options are ever set: the inputs are
// always precompiled EPContext models.
#include <algorithm>
#include <chrono>
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

// C-contiguous float32 .npy only (all chain inputs are float32).
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
  std::vector<std::string> in_names;   // expected original input names
  std::vector<std::string> out_names;  // expected original output names
};

// Original export input/output names per unit stem (must match
// split_export_step.py unit_io_names exactly).
Unit make_unit(const std::string& path, const std::string& stem) {
  Unit u{path, stem, {}, {}};
  if (stem == "head") {
    u.in_names = {"hidden_states", "timestep"};
    u.out_names = {"hidden", "temb"};
  } else if (stem == "tail") {
    u.in_names = {"hidden_in"};
    u.out_names = {"noise_pred"};
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
    std::fprintf(stderr, "bad stem '%s' (want head|blkNN|tail)\n", stem.c_str());
    std::exit(1);
  }
  return u;
}

}  // namespace

int main(int argc, char** argv) {
  if (argc < 5) {
    std::fprintf(stderr,
                 "usage: %s resident|stream models.txt input_dir out.npy "
                 "[runs] [qnn_backend]\n",
                 argv[0]);
    return 1;
  }
  const std::string mode = argv[1];
  if (mode != "resident" && mode != "stream") {
    std::fprintf(stderr, "unknown mode %s (resident|stream)\n", mode.c_str());
    return 1;
  }
  int runs = argc > 5 ? std::atoi(argv[5]) : 3;
  if (runs < 1) runs = 1;
  const std::string qnn_backend =
      argc > 6 ? argv[6] : "/vendor/lib64/libQnnHtp.so";

  std::vector<Unit> units;
  {
    std::ifstream list(argv[2]);
    if (!list) {
      std::fprintf(stderr, "cannot open %s\n", argv[2]);
      return 1;
    }
    std::string line;
    while (std::getline(list, line)) {
      if (line.empty()) continue;
      std::istringstream words(line);
      std::string path, stem;
      if (!(words >> path >> stem)) {
        std::fprintf(stderr, "bad models.txt line (want '<path> <stem>'): %s\n",
                     line.c_str());
        return 1;
      }
      units.push_back(make_unit(path, stem));
    }
  }
  if (units.empty()) {
    std::fprintf(stderr, "no models in %s\n", argv[2]);
    return 1;
  }

  const std::string indir = argv[3];
  std::unordered_map<std::string, Tensor> row_inputs[2];
  for (int r = 0; r < 2; ++r) {
    const std::string s = std::to_string(r);
    for (const char* name : {"latent", "timestep", "enc"}) {
      NpyArray a = read_npy(indir + "/" + name + "_r" + s + ".npy");
      row_inputs[r][name] = Tensor{a.shape, a.data};
    }
  }

  Ort::Env env(ORT_LOGGING_LEVEL_WARNING, "spike_chain");
  auto make_session = [&](const std::string& model_path) {
    Ort::SessionOptions opts;
    opts.SetIntraOpNumThreads(4);
    opts.DisableCpuMemArena();
    opts.DisableMemPattern();
    opts.SetGraphOptimizationLevel(ORT_ENABLE_ALL);
    std::unordered_map<std::string, std::string> qnn_opts;
    qnn_opts["backend_path"] = qnn_backend;
    // Default power profile runs blocks ~3.5x slower; SPIKE_QNN_OPTS can override.
    qnn_opts["htp_performance_mode"] = "burst";
    const char* qnn_opts_env = std::getenv("SPIKE_QNN_OPTS");
    if (qnn_opts_env != nullptr) {
      std::string rest = qnn_opts_env;
      while (!rest.empty()) {
        size_t comma = rest.find(',');
        std::string item = rest.substr(0, comma);
        size_t eq = item.find('=');
        if (eq == std::string::npos || eq == 0 || eq + 1 >= item.size()) {
          std::fprintf(stderr, "bad SPIKE_QNN_OPTS item '%s' (want key=value)\n",
                       item.c_str());
          std::exit(1);
        }
        qnn_opts[item.substr(0, eq)] = item.substr(eq + 1);
        if (comma == std::string::npos) break;
        rest = rest.substr(comma + 1);
      }
    }
    // No ep.context_* entries: inputs are always precompiled EPContext
    // models (AI Hub precompiled_qnn_onnx), which must not be re-cached.
    opts.AppendExecutionProvider("QNN", qnn_opts);
    return Ort::Session(env, model_path.c_str(), opts);
  };
  auto mem = Ort::MemoryInfo::CreateCpu(OrtDeviceAllocator, OrtMemTypeCPU);
  Ort::AllocatorWithDefaultOptions alloc;

  // Run one unit, wiring session inputs by original name from the store
  // and assigning session outputs by unit kind (see file header).
  auto run_unit = [&](Ort::Session& session, const Unit& unit,
                      std::unordered_map<std::string, Tensor>& store,
                      double& dup_maxabs) {
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
    std::vector<std::string> sess_in, sess_out;
    for (size_t i = 0; i < n_inputs; ++i)
      sess_in.push_back(session.GetInputNameAllocated(i, alloc).get());
    for (size_t i = 0; i < n_outputs; ++i)
      sess_out.push_back(session.GetOutputNameAllocated(i, alloc).get());
    std::vector<const char*> in_names;
    std::vector<Ort::Value> ins;
    ins.reserve(n_inputs);
    for (size_t i = 0; i < n_inputs; ++i) {
      auto it = store.find(sess_in[i]);
      if (it == store.end()) {
        std::fprintf(stderr, "%s: session input '%s' not in store\n",
                     unit.stem.c_str(), sess_in[i].c_str());
        std::exit(1);
      }
      Tensor& t = it->second;
      auto type = session.GetInputTypeInfo(i)
                      .GetTensorTypeAndShapeInfo()
                      .GetElementType();
      if (type != ONNX_TENSOR_ELEMENT_DATA_TYPE_FLOAT) {
        std::fprintf(stderr, "%s: input '%s' is not float32\n",
                     unit.stem.c_str(), sess_in[i].c_str());
        std::exit(1);
      }
      in_names.push_back(sess_in[i].c_str());
      ins.push_back(Ort::Value::CreateTensor<float>(
          mem, t.data.data(), t.data.size(), t.shape.data(), t.shape.size()));
    }
    std::vector<const char*> out_names;
    for (const auto& s : sess_out) out_names.push_back(s.c_str());
    std::vector<Ort::Value> outs =
        session.Run(Ort::RunOptions{nullptr}, in_names.data(), ins.data(),
                    ins.size(), out_names.data(), out_names.size());
    // Assign outputs to expected original names (see file header).
    auto numel = [](const std::vector<int64_t>& s) {
      size_t n = 1;
      for (int64_t d : s) n *= static_cast<size_t>(d);
      return n;
    };
    std::vector<Tensor> got;
    for (size_t j = 0; j < outs.size(); ++j) {
      auto shape = outs[j].GetTensorTypeAndShapeInfo().GetShape();
      size_t count = numel(shape);
      Tensor t{shape, std::vector<float>(count)};
      float* fp = outs[j].GetTensorMutableData<float>();
      for (size_t i = 0; i < count; ++i) t.data[i] = fp[i];
      got.push_back(std::move(t));
    }
    if (unit.out_names.size() == 1) {
      store[unit.out_names[0]] = std::move(got[0]);
    } else if (unit.stem == "head") {
      // hidden vs temb: different element counts, either order.
      if (numel(got[0].shape) == numel(got[1].shape)) {
        std::fprintf(stderr, "head: outputs have the same size\n");
        std::exit(1);
      }
      size_t hi = numel(got[0].shape) > numel(got[1].shape) ? 0 : 1;
      store["hidden"] = std::move(got[hi]);
      store["temb"] = std::move(got[1 - hi]);
    } else {
      // blk unit: hidden and skip_i are the same tensor values.
      if (got[0].shape != got[1].shape) {
        std::fprintf(stderr, "%s: twin outputs differ in shape\n",
                     unit.stem.c_str());
        std::exit(1);
      }
      double worst = 0;
      for (size_t i = 0; i < got[0].data.size(); ++i) {
        double d = std::abs(double(got[0].data[i]) - double(got[1].data[i]));
        if (d > worst) worst = d;
      }
      if (worst > dup_maxabs) dup_maxabs = worst;
      store[unit.out_names[0]] = std::move(got[0]);
      store[unit.out_names[1]] = std::move(got[1]);
    }
    // Each unit's "hidden" output is the next unit's "hidden_in" input.
    auto h = store.find("hidden");
    if (h != store.end()) {
      store["hidden_in"] = std::move(h->second);
      store.erase(h);
    }
  };

  std::vector<std::vector<double>> run_ms(units.size()), create_ms(units.size());
  std::vector<double> pass_ms[2];
  std::vector<double> dup_max(units.size(), 0.0);
  Tensor noise[2];

  // Resident sessions, created once up front.
  std::vector<Ort::Session> resident;
  double create_total_ms = 0;
  if (mode == "resident") {
    for (size_t i = 0; i < units.size(); ++i) {
      auto t0 = std::chrono::steady_clock::now();
      resident.emplace_back(make_session(units[i].path));
      auto t1 = std::chrono::steady_clock::now();
      double ms = std::chrono::duration<double, std::milli>(t1 - t0).count();
      create_ms[i].push_back(ms);
      create_total_ms += ms;
    }
    std::printf("create_total_ms=%.1f\n", create_total_ms);
  }
  long vmhwm_after_load = -1, pss_after_load = -1;
  if (mode == "resident") {
    vmhwm_after_load = vmhwm_kb();
    pss_after_load = pss_kb();
    std::printf("vmhwm_after_load_kb=%ld pss_after_load_kb=%ld\n",
                vmhwm_after_load, pss_after_load);
  }
  auto clock_ms = []() { return std::chrono::steady_clock::now(); };

  long vmhwm_warmup = -1, pss_warmup = -1;
  // rep -1 is the untimed warmup step; timed reps follow.
  for (int rep = -1; rep < runs; ++rep) {
    for (int r = 0; r < 2; ++r) {
      std::unordered_map<std::string, Tensor> store;
      store["hidden_states"] = row_inputs[r]["latent"];
      store["timestep"] = row_inputs[r]["timestep"];
      store["encoder_hidden_states"] = row_inputs[r]["enc"];
      auto t_pass0 = clock_ms();
      for (size_t i = 0; i < units.size(); ++i) {
        double create = 0, run = 0;
        if (mode == "stream") {
          auto t_c0 = clock_ms();
          Ort::Session session = make_session(units[i].path);
          auto t_c1 = clock_ms();
          create =
              std::chrono::duration<double, std::milli>(t_c1 - t_c0).count();
          auto t0 = clock_ms();
          run_unit(session, units[i], store, dup_max[i]);
          auto t1 = clock_ms();
          run = std::chrono::duration<double, std::milli>(t1 - t0).count();
        } else {
          auto t0 = clock_ms();
          run_unit(resident[i], units[i], store, dup_max[i]);
          auto t1 = clock_ms();
          run = std::chrono::duration<double, std::milli>(t1 - t0).count();
        }
        if (rep >= 0) {
          run_ms[i].push_back(run);
          if (mode == "stream") create_ms[i].push_back(create);
        }
      }
      auto t_pass1 = clock_ms();
      if (rep >= 0) {
        pass_ms[r].push_back(
            std::chrono::duration<double, std::milli>(t_pass1 - t_pass0)
                .count());
        noise[r] = store["noise_pred"];
      }
    }
    if (rep == -1) {
      vmhwm_warmup = vmhwm_kb();
      pss_warmup = pss_kb();
      std::printf("vmhwm_warmup_kb=%ld pss_warmup_kb=%ld\n", vmhwm_warmup,
                  pss_warmup);
    }
  }

  if (noise[0].shape != noise[1].shape || noise[0].shape.size() != 3 ||
      noise[0].shape[0] != 1) {
    std::fprintf(stderr, "bad noise shapes\n");
    return 1;
  }
  std::vector<int64_t> out_shape = {2, noise[0].shape[1], noise[0].shape[2]};
  std::vector<float> stacked;
  stacked.reserve(noise[0].data.size() * 2);
  stacked.insert(stacked.end(), noise[0].data.begin(), noise[0].data.end());
  stacked.insert(stacked.end(), noise[1].data.begin(), noise[1].data.end());
  write_npy(argv[4], out_shape, stacked.data(), stacked.size());

  auto stat = [](const Tensor& t) {
    double sum = 0, worst = 0;
    for (float v : t.data) {
      sum += v;
      double a = std::abs(double(v));
      if (a > worst) worst = a;
    }
    return std::make_pair(sum / t.data.size(), worst);
  };
  auto s0 = stat(noise[0]);
  auto s1 = stat(noise[1]);
  std::printf("noise_row0_mean=%.6f noise_row0_maxabs=%.6f\n", s0.first,
              s0.second);
  std::printf("noise_row1_mean=%.6f noise_row1_maxabs=%.6f\n", s1.first,
              s1.second);
  for (size_t i = 0; i < units.size(); ++i) {
    std::printf("unit %02zu %s run_ms=%.1f create_ms=%.1f", i,
                units[i].stem.c_str(), median(run_ms[i]),
                median(create_ms[i]));
    if (units[i].stem.compare(0, 3, "blk") == 0 &&
        units[i].out_names.size() == 2)
      std::printf(" dup_maxabs=%.3e", dup_max[i]);
    std::printf("\n");
  }
  std::printf("pass_row0_ms=%.1f pass_row1_ms=%.1f\n", median(pass_ms[0]),
              median(pass_ms[1]));
  if (mode == "stream") {
    double total = 0;
    for (size_t i = 0; i < units.size(); ++i) total += median(create_ms[i]);
    std::printf("create_total_ms=%.1f\n", total);
  }
  std::printf("vmhwm_end_kb=%ld pss_end_kb=%ld\n", vmhwm_kb(), pss_kb());
  std::printf("out_shape=");
  for (int64_t d : out_shape) std::printf("%lld ", (long long)d);
  std::printf("\nn_models=%zu mode=%s runs=%d\n", units.size(), mode.c_str(),
              runs);
  return 0;
}
