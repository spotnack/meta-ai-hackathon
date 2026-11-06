// On-device bench runner: runs one model (encoder or one transformer piece)
// per invocation and times it. Links against the prebuilt onnxruntime .so
// from the Android AAR.
// Usage: spike_bench model.onnx input.npy output.npy [runs] [cpu|qnn]
//        [qnn_backend_path]
// Fetches ALL session outputs (argv[3] for the first, <stem>_<i>.npy for
// the rest). Prints median/p90 plus session-create time and VmHWM readings.
// Env SPIKE_OPT=all|basic selects the graph optimization level.
// Env SPIKE_QNN_OPTS="key=value,..." merges extra QNN provider options
// after the defaults (a QNN GPU backend is picked by a libQnnGpu.so path).
#include <algorithm>
#include <chrono>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <mutex>
#include <numeric>
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

// Reads a C-contiguous float32 .npy file. Returns data + shape.
struct NpyArray {
  std::vector<int64_t> shape;
  std::vector<float> data;
};

NpyArray read_npy(const char* path) {
  std::vector<char> raw = read_file(path);
  if (raw.size() < 10 || std::memcmp(raw.data(), "\x93NUMPY", 6) != 0) {
    std::fprintf(stderr, "not an npy file: %s\n", path);
    std::exit(1);
  }
  uint16_t header_len;
  std::memcpy(&header_len, raw.data() + 8, 2);
  std::string header(raw.data() + 10, header_len);
  // NumPy writes float32 as descr '<f4' (little-endian), never 'float32'.
  if (header.find("'descr': '<f4'") == std::string::npos ||
      header.find("'fortran_order': True") != std::string::npos) {
    std::fprintf(stderr, "only C-order little-endian float32 npy: %s\n", path);
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
    std::fprintf(stderr, "truncated data: %s\n", path);
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

}  // namespace

// QNN verbose-log sink: ORT calls this per message; it appends to a file
// (capped so a chatty run cannot fill the device). Only enabled for qnn.
namespace {

std::FILE* g_verbose_log = nullptr;
std::mutex g_verbose_mutex;
size_t g_verbose_bytes = 0;
constexpr size_t kVerboseCap = 4u * 1024u * 1024u;

void verbose_to_file(void*, OrtLoggingLevel, const char*, const char*,
                     const char*, const char* message) {
  std::lock_guard<std::mutex> lock(g_verbose_mutex);
  if (g_verbose_log != nullptr && g_verbose_bytes < kVerboseCap) {
    int n = std::fprintf(g_verbose_log, "%s\n", message);
    if (n > 0) g_verbose_bytes += static_cast<size_t>(n);
  }
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

size_t count_occurrences(const std::string& hay, const std::string& needle) {
  size_t n = 0;
  size_t pos = 0;
  while ((pos = hay.find(needle, pos)) != std::string::npos) {
    ++n;
    pos += needle.size();
  }
  return n;
}

}  // namespace

uint16_t float_to_half(float v) {
  uint32_t bits;
  std::memcpy(&bits, &v, 4);
  uint32_t sign = (bits >> 16) & 0x8000;
  int32_t exp = ((bits >> 23) & 0xff) - 112;
  uint32_t mant = bits & 0x7fffff;
  if (exp <= 0) return static_cast<uint16_t>(sign);
  if (exp >= 31) return static_cast<uint16_t>(sign | 0x7bff);
  return static_cast<uint16_t>(sign | (exp << 10) | (mant >> 13));
}

float half_to_float(uint16_t h) {
  uint32_t sign = (h & 0x8000) << 16;
  uint32_t exp = (h >> 10) & 0x1f;
  uint32_t mant = h & 0x3ff;
  uint32_t bits;
  if (exp == 0) {
    bits = sign;
  } else if (exp == 31) {
    bits = sign | 0x7f800000 | (mant << 13);
  } else {
    bits = sign | ((exp + 112) << 23) | (mant << 13);
  }
  float v;
  std::memcpy(&v, &bits, 4);
  return v;
}

int main(int argc, char** argv) {
  if (argc < 4) {
    std::fprintf(stderr,
                 "usage: %s model.onnx input.npy output.npy [runs] "
                 "[cpu|qnn] [qnn_backend_path]\n"
                 "  env SPIKE_OPT=all|basic selects the graph optimization "
                 "level (default all).\n",
                 argv[0]);
    return 1;
  }
  int timed_runs = argc > 4 ? std::atoi(argv[4]) : 5;
  if (timed_runs < 1) timed_runs = 1;
  const std::string provider = argc > 5 ? argv[5] : "cpu";
  if (provider != "cpu" && provider != "qnn") {
    std::fprintf(stderr, "unknown provider %s (cpu|qnn)\n", provider.c_str());
    return 1;
  }
  const bool is_qnn = (provider == "qnn");
  const std::string qnn_backend =
      argc > 6 ? argv[6] : "/vendor/lib64/libQnnHtp.so";
  // A QNN GPU backend is selected by backend path alone (docs: backend_path
  // is the alternative to backend_type). HTP-only options are skipped for it.
  const bool is_gpu = is_qnn && qnn_backend.size() >= 12 &&
      qnn_backend.compare(qnn_backend.size() - 12, 12, "libQnnGpu.so") == 0;
  GraphOptimizationLevel opt_level = ORT_ENABLE_ALL;
  const char* opt_env = std::getenv("SPIKE_OPT");
  const std::string opt_str = (opt_env != nullptr) ? opt_env : "all";
  if (opt_str == "all") {
    opt_level = ORT_ENABLE_ALL;
  } else if (opt_str == "basic") {
    opt_level = ORT_ENABLE_BASIC;
  } else {
    std::fprintf(stderr, "unknown SPIKE_OPT=%s (all|basic)\n",
                 opt_str.c_str());
    return 1;
  }

  NpyArray input = read_npy(argv[2]);
  std::string stem = argv[3];
  if (stem.size() > 4 && stem.substr(stem.size() - 4) == ".npy") {
    stem = stem.substr(0, stem.size() - 4);
  }

  std::string verbose_path;
  if (is_qnn) {
    verbose_path = stem + "_ort_verbose.log";
    g_verbose_log = std::fopen(verbose_path.c_str(), "w");
    if (g_verbose_log == nullptr) {
      std::fprintf(stderr, "cannot write %s\n", verbose_path.c_str());
      return 1;
    }
  }
  Ort::Env env = is_qnn
      ? Ort::Env(ORT_LOGGING_LEVEL_VERBOSE, "spike", verbose_to_file,
                 nullptr)
      : Ort::Env(ORT_LOGGING_LEVEL_WARNING, "spike");
  Ort::SessionOptions opts;
  opts.SetIntraOpNumThreads(4);
  // Lowest CPU memory floor: no arena pre-allocation, no pattern reuse.
  opts.DisableCpuMemArena();
  opts.DisableMemPattern();
  opts.SetGraphOptimizationLevel(opt_level);
  std::string ctx_path;
  if (is_qnn) {
    std::unordered_map<std::string, std::string> qnn_opts;
    qnn_opts["backend_path"] = qnn_backend;
    if (!is_gpu) {
      qnn_opts["htp_performance_mode"] = "burst";
    }
    // Extra/override provider options, e.g.
    // SPIKE_QNN_OPTS="htp_graph_finalization_optimization_mode=1,vtcm_mb=4".
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
          return 1;
        }
        qnn_opts[item.substr(0, eq)] = item.substr(eq + 1);
        if (comma == std::string::npos) break;
        rest = rest.substr(comma + 1);
      }
    }
    opts.AppendExecutionProvider("QNN", qnn_opts);
    std::printf("qnn_backend=%s\n", is_gpu ? "gpu" : "htp");
    std::printf("qnn_opts=");
    bool first_opt = true;
    for (const auto& kv : qnn_opts) {
      std::printf("%s%s=%s", first_opt ? "" : ",", kv.first.c_str(),
                  kv.second.c_str());
      first_opt = false;
    }
    std::printf("\n");
    // SPIKE_CTX=0 skips the cache: for models that are already precompiled
    // (AI Hub `precompiled_qnn_onnx`, an EPContext node + model.bin).
    const char* ctx_env = std::getenv("SPIKE_CTX");
    const bool want_ctx = !(ctx_env && std::string(ctx_env) == "0");
    if (!is_gpu && want_ctx) {
      // Compile the HTP graph once; later runs reload the context binary.
      // (GPU backend: no context cache — minimal surface for the experiment.)
      ctx_path = std::string(argv[1]) + "_ctx.onnx";
      opts.AddConfigEntry("ep.context_enable", "1");
      opts.AddConfigEntry("ep.context_file_path", ctx_path.c_str());
      opts.AddConfigEntry("ep.context_embed_mode", "0");
    }
    opts.EnableProfiling((stem + "_profile").c_str());
  }
  auto t_create0 = std::chrono::steady_clock::now();
  Ort::Session session(env, argv[1], opts);
  auto t_create1 = std::chrono::steady_clock::now();
  const double create_ms =
      std::chrono::duration<double, std::milli>(t_create1 - t_create0).count();
  const long vmhwm_create = vmhwm_kb();
  std::printf("create_ms=%.1f\n", create_ms);
  if (is_qnn && !is_gpu) std::printf("ep_context=%s\n", ctx_path.c_str());

  Ort::AllocatorWithDefaultOptions alloc;
  const size_t n_inputs = session.GetInputCount();
  const size_t n_outputs = session.GetOutputCount();
  std::vector<std::string> in_name_strs, out_name_strs;
  for (size_t i = 0; i < n_inputs; ++i) {
    in_name_strs.push_back(session.GetInputNameAllocated(i, alloc).get());
  }
  for (size_t i = 0; i < n_outputs; ++i) {
    out_name_strs.push_back(session.GetOutputNameAllocated(i, alloc).get());
  }
  std::vector<const char*> in_names, out_names;
  for (const auto& s : in_name_strs) in_names.push_back(s.c_str());
  for (const auto& s : out_name_strs) out_names.push_back(s.c_str());
  std::vector<int64_t> in_shape = input.shape;

  auto mem = Ort::MemoryInfo::CreateCpu(OrtDeviceAllocator, OrtMemTypeCPU);
  // Single-input models (encoder spike) take one tensor; the split
  // transformer pieces take N inputs (A: hidden_states + timestep, enc;
  // B: hidden_in + enc; C: hidden_in + enc + skip_0..6 — blocks ignore
  // temb, so A's temb output is not forwarded). Extra input files follow the
  // provider args (argv[6] is the QNN backend path only for qnn runs) in
  // session input order.
  std::vector<NpyArray> extra_inputs;
  const int first_extra = is_qnn ? 7 : 6;
  for (int a = first_extra; a < argc; ++a) {
    extra_inputs.push_back(read_npy(argv[a]));
  }
  if (extra_inputs.size() + 1 < n_inputs) {
    std::fprintf(stderr, "need %zu inputs, have 1 + %zu extra files\n",
                 n_inputs, extra_inputs.size());
    return 1;
  }
  // Convert every input exactly once up front; the Ort::Values below borrow
  // these buffers and are reused by every run (the old code appended a fresh
  // converted copy per run and leaked it in a thread_local).
  std::vector<ONNXTensorElementDataType> in_types;
  for (size_t i = 0; i < n_inputs; ++i) {
    in_types.push_back(session.GetInputTypeInfo(i)
                           .GetTensorTypeAndShapeInfo()
                           .GetElementType());
  }
  const bool in_fp16 =
      in_types[0] == ONNX_TENSOR_ELEMENT_DATA_TYPE_FLOAT16;
  std::vector<uint16_t> input_half;
  if (in_fp16) {
    input_half.resize(input.data.size());
    for (size_t i = 0; i < input.data.size(); ++i) {
      input_half[i] = float_to_half(input.data[i]);
    }
  }
  const size_t n_extra = n_inputs - 1;
  std::vector<int> conv_kind(n_extra, 0);  // 0=float direct, 1=int64, 2=fp16
  std::vector<std::vector<int64_t>> keep_i64(n_extra);
  std::vector<std::vector<uint16_t>> keep_f16(n_extra);
  for (size_t e = 0; e < n_extra; ++e) {
    const NpyArray& src = extra_inputs[e];
    if (in_types[e + 1] == ONNX_TENSOR_ELEMENT_DATA_TYPE_INT64) {
      conv_kind[e] = 1;
      keep_i64[e].resize(src.data.size());
      for (size_t i = 0; i < src.data.size(); ++i) {
        keep_i64[e][i] = static_cast<int64_t>(src.data[i]);
      }
    } else if (in_types[e + 1] == ONNX_TENSOR_ELEMENT_DATA_TYPE_FLOAT16) {
      conv_kind[e] = 2;
      keep_f16[e].resize(src.data.size());
      for (size_t i = 0; i < src.data.size(); ++i) {
        keep_f16[e][i] = float_to_half(src.data[i]);
      }
    }
  }
  std::vector<Ort::Value> ins;
  ins.reserve(n_inputs);
  if (in_fp16) {
    ins.push_back(Ort::Value::CreateTensor<uint16_t>(
        mem, input_half.data(), input_half.size(), in_shape.data(),
        in_shape.size()));
  } else {
    ins.push_back(Ort::Value::CreateTensor<float>(
        mem, input.data.data(), input.data.size(), in_shape.data(),
        in_shape.size()));
  }
  for (size_t e = 0; e < n_extra; ++e) {
    const NpyArray& src = extra_inputs[e];
    if (conv_kind[e] == 1) {
      ins.push_back(Ort::Value::CreateTensor<int64_t>(
          mem, keep_i64[e].data(), keep_i64[e].size(), src.shape.data(),
          src.shape.size()));
    } else if (conv_kind[e] == 2) {
      ins.push_back(Ort::Value::CreateTensor<uint16_t>(
          mem, keep_f16[e].data(), keep_f16[e].size(), src.shape.data(),
          src.shape.size()));
    } else {
      ins.push_back(Ort::Value::CreateTensor<float>(
          mem, const_cast<float*>(src.data.data()), src.data.size(),
          src.shape.data(), src.shape.size()));
    }
  }
  auto run_once = [&]() {
    return session.Run(Ort::RunOptions{nullptr}, in_names.data(), ins.data(),
                       ins.size(), out_names.data(), out_names.size());
  };

  if (is_qnn) {
    // One profiling run to record per-node EP placement (each node appears
    // exactly once), then stop profiling so the timed runs are unperturbed.
    { std::vector<Ort::Value> probe = run_once(); }
    Ort::AllocatorWithDefaultOptions prof_alloc;
    const std::string profile_path =
        session.EndProfilingAllocated(prof_alloc).get();
    std::vector<char> praw = read_file(profile_path.c_str());
    const std::string pstr(praw.begin(), praw.end());
    const size_t n_qnn = count_occurrences(pstr, "QNNExecutionProvider");
    const size_t n_cpu = count_occurrences(pstr, "CPUExecutionProvider");
    std::printf("qnn_nodes=%zu cpu_nodes=%zu\n", n_qnn, n_cpu);
    std::printf("profile=%s\n", profile_path.c_str());
  }

  run_once();  // warmup not timed beyond this
  run_once();  // second warmup
  const long vmhwm_warmup = vmhwm_kb();
  std::printf("vmhwm_warmup_kb=%ld\n", vmhwm_warmup);
  std::vector<double> ms;
  std::vector<Ort::Value> outs;
  for (int i = 0; i < timed_runs; ++i) {
    auto t0 = std::chrono::steady_clock::now();
    outs = run_once();
    auto t1 = std::chrono::steady_clock::now();
    ms.push_back(
        std::chrono::duration<double, std::milli>(t1 - t0).count());
  }
  const long vmhwm_end = vmhwm_kb();
  // Write every output: argv[3] for the first, <stem>_<i>.npy for the rest
  // (single-output models like the encoder behave exactly as before).
  for (size_t o = 0; o < outs.size(); ++o) {
    auto out_info = outs[o].GetTensorTypeAndShapeInfo();
    std::vector<int64_t> out_shape = out_info.GetShape();
    size_t out_count = 1;
    for (int64_t d : out_shape) out_count *= static_cast<size_t>(d);
    std::vector<float> out_float(out_count);
    if (out_info.GetElementType() == ONNX_TENSOR_ELEMENT_DATA_TYPE_FLOAT16) {
      uint16_t* hp = outs[o].GetTensorMutableData<uint16_t>();
      for (size_t i = 0; i < out_count; ++i) {
        out_float[i] = half_to_float(hp[i]);
      }
    } else {
      float* fp = outs[o].GetTensorMutableData<float>();
      for (size_t i = 0; i < out_count; ++i) out_float[i] = fp[i];
    }
    std::string path = (o == 0)
        ? argv[3]
        : (stem + "_" + std::to_string(o) + ".npy");
    write_npy(path.c_str(), out_shape, out_float.data(), out_count);
  }

  std::sort(ms.begin(), ms.end());
  double p90 = ms[(ms.size() * 9) / 10];
  std::printf(
      "runs=%d median_ms=%.1f p90_ms=%.1f create_ms=%.1f "
      "vmhwm_create_kb=%ld vmhwm_end_kb=%ld n_out=%zu\n",
      timed_runs, ms[ms.size() / 2], p90, create_ms, vmhwm_create, vmhwm_end,
      outs.size());
  std::printf("out_shape=");
  for (int64_t d : outs[0].GetTensorTypeAndShapeInfo().GetShape()) {
    std::printf("%lld ", (long long)d);
  }
  std::printf("n_out=%zu\n", outs.size());
  if (is_qnn && g_verbose_log != nullptr) {
    std::fclose(g_verbose_log);
    g_verbose_log = nullptr;
    std::printf("ort_verbose_log=%s (%zu bytes)\n", verbose_path.c_str(),
                g_verbose_bytes);
  }
  return 0;
}
