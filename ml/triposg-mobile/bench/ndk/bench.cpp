// Minimal on-device spike runner: one DINOv2 encoder forward per run.
// Links against the prebuilt onnxruntime .so from the Android AAR.
// Usage: spike_bench model.onnx input.npy output.npy [timed_runs]
// Prints per-run ms, median/p90, output shape. Exit nonzero on failure.
#include <algorithm>
#include <chrono>
#include <cstdint>
#include <cstdio>
#include <cstring>
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
                 "[cpu|qnn] [qnn_backend_path]\n",
                 argv[0]);
    return 1;
  }
  const int timed_runs = argc > 4 ? std::atoi(argv[4]) : 5;
  const std::string provider = argc > 5 ? argv[5] : "cpu";
  const std::string qnn_backend =
      argc > 6 ? argv[6] : "/vendor/lib64/libQnnHtp.so";

  NpyArray input = read_npy(argv[2]);
  Ort::Env env(ORT_LOGGING_LEVEL_WARNING, "spike");
  Ort::SessionOptions opts;
  opts.SetIntraOpNumThreads(4);
  if (provider == "qnn") {
    std::unordered_map<std::string, std::string> qnn_opts;
    qnn_opts["backend_path"] = qnn_backend;
    opts.AppendExecutionProvider("QNN", qnn_opts);
  }
  Ort::Session session(env, argv[1], opts);

  Ort::AllocatorWithDefaultOptions alloc;
  Ort::AllocatedStringPtr in_name = session.GetInputNameAllocated(0, alloc);
  Ort::AllocatedStringPtr out_name = session.GetOutputNameAllocated(0, alloc);
  std::vector<int64_t> in_shape = input.shape;

  auto mem = Ort::MemoryInfo::CreateCpu(OrtDeviceAllocator, OrtMemTypeCPU);
  // Single-input models (encoder spike) pass one tensor; the transformer
  // step model takes hidden_states, timestep, encoder_hidden_states, which
  // the caller packs by extending this lambda via extra argv npy files.
  ONNXTensorElementDataType in_type =
      session.GetInputTypeInfo(0).GetTensorTypeAndShapeInfo().GetElementType();
  const bool in_fp16 =
      in_type == ONNX_TENSOR_ELEMENT_DATA_TYPE_FLOAT16;
  std::vector<uint16_t> input_half;
  if (in_fp16) {
    input_half.resize(input.data.size());
    for (size_t i = 0; i < input.data.size(); ++i) {
      input_half[i] = float_to_half(input.data[i]);
    }
  }
  // Transformer-step models take 3 inputs; extra input files follow the
  // provider args (argv[6] is the QNN backend path only for qnn runs).
  std::vector<NpyArray> extra_inputs;
  int first_extra = (provider == "qnn") ? 7 : 6;
  for (int a = first_extra; a < argc; ++a) {
    extra_inputs.push_back(read_npy(argv[a]));
  }
  auto run_once = [&]() {
    std::vector<Ort::Value> ins;
    std::vector<const char*> in_names;
    std::vector<std::string> name_store;
    size_t n_inputs = 0;
    {
      Ort::AllocatorWithDefaultOptions alloc2;
      for (size_t i = 0; i < session.GetInputCount(); ++i) {
        name_store.push_back(
            std::string(session.GetInputNameAllocated(i, alloc2).get()));
      }
    }
    for (size_t i = 0; i < name_store.size(); ++i) {
      in_names.push_back(name_store[i].c_str());
    }
    n_inputs = name_store.size();
    const NpyArray* src0 = &input;
    std::vector<uint16_t> half0;
    if (in_fp16) {
      half0 = input_half;
      ins.push_back(Ort::Value::CreateTensor<uint16_t>(
          mem, half0.data(), half0.size(), in_shape.data(), in_shape.size()));
    } else {
      ins.push_back(Ort::Value::CreateTensor<float>(
          mem, input.data.data(), input.data.size(), in_shape.data(),
          in_shape.size()));
    }
    for (size_t e = 0; e < extra_inputs.size() && ins.size() < n_inputs;
         ++e) {
      const NpyArray& src = extra_inputs[e];
      ONNXTensorElementDataType et = session.GetInputTypeInfo(ins.size())
                                         .GetTensorTypeAndShapeInfo()
                                         .GetElementType();
      if (et == ONNX_TENSOR_ELEMENT_DATA_TYPE_INT64) {
        std::vector<int64_t> vals(src.data.size());
        for (size_t i = 0; i < vals.size(); ++i) {
          vals[i] = static_cast<int64_t>(src.data[i]);
        }
        static thread_local std::vector<std::vector<int64_t>> keep;
        keep.push_back(std::move(vals));
        ins.push_back(Ort::Value::CreateTensor<int64_t>(
            mem, keep.back().data(), keep.back().size(), src.shape.data(),
            src.shape.size()));
      } else if (et == ONNX_TENSOR_ELEMENT_DATA_TYPE_FLOAT16) {
        static thread_local std::vector<std::vector<uint16_t>> keeph;
        keeph.emplace_back(src.data.size());
        for (size_t i = 0; i < src.data.size(); ++i) {
          keeph.back()[i] = float_to_half(src.data[i]);
        }
        ins.push_back(Ort::Value::CreateTensor<uint16_t>(
            mem, keeph.back().data(), keeph.back().size(), src.shape.data(),
            src.shape.size()));
      } else {
        ins.push_back(Ort::Value::CreateTensor<float>(
            mem, const_cast<float*>(src.data.data()), src.data.size(),
            src.shape.data(), src.shape.size()));
      }
    }
    (void)src0;
    const char* out_names[] = {out_name.get()};
    return session.Run(Ort::RunOptions{nullptr}, in_names.data(), ins.data(),
                       ins.size(), out_names, 1);
  };

  run_once();  // warmup not timed beyond this
  run_once();  // second warmup
  std::vector<double> ms;
  std::vector<Ort::Value> outs;
  for (int i = 0; i < timed_runs; ++i) {
    auto t0 = std::chrono::steady_clock::now();
    outs = run_once();
    auto t1 = std::chrono::steady_clock::now();
    ms.push_back(
        std::chrono::duration<double, std::milli>(t1 - t0).count());
  }
  auto out_info = outs[0].GetTensorTypeAndShapeInfo();
  std::vector<int64_t> out_shape = out_info.GetShape();
  size_t out_count = 1;
  for (int64_t d : out_shape) out_count *= static_cast<size_t>(d);
  std::vector<float> out_float(out_count);
  if (out_info.GetElementType() == ONNX_TENSOR_ELEMENT_DATA_TYPE_FLOAT16) {
    uint16_t* hp = outs[0].GetTensorMutableData<uint16_t>();
    for (size_t i = 0; i < out_count; ++i) {
      out_float[i] = half_to_float(hp[i]);
    }
  } else {
    float* fp = outs[0].GetTensorMutableData<float>();
    for (size_t i = 0; i < out_count; ++i) out_float[i] = fp[i];
  }
  write_npy(argv[3], out_shape, out_float.data(), out_count);

  std::sort(ms.begin(), ms.end());
  double p90 = ms[(ms.size() * 9) / 10];
  std::printf("runs=%d median_ms=%.1f p90_ms=%.1f\n", timed_runs,
              ms[ms.size() / 2], p90);
  std::printf("out_shape=");
  for (int64_t d : out_shape) std::printf("%lld ", (long long)d);
  std::printf("\n");
  return 0;
}
