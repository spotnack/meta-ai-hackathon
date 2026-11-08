// Host test: source photo -> u2net (ORT CPU) -> prepare_image ->
// DINOv2 pixel_values, using the module's own preprocess.cpp.
//
// Usage:
//   test_preprocess src_dir u2net.onnx out_dir
// src_dir holds <id>.rgb.npy (H,W,3 uint8, from prep_preprocess_inputs.py).
// Writes per id: <id>.cutout.npy (H,W,4), <id>.prepared.npy (H,W,3),
// <id>.pixel_values.npy (float32), plus stage-isolated <id>.resized2000_iso,
// <id>.prepared_iso and <id>.pixel_values_iso (each stage rerun on the
// reference input). The orchestrator grades them with
// check_preprocess.py against the golden input_rgba.png,
// prepared_input.png and dinov2_pixel_values.npy.
#include <chrono>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <string>
#include <sys/resource.h>
#include <system_error>
#include <vector>

#include "preprocess.h"  // from MODULE_CPP (see CMakeLists.txt)
#include "onnxruntime_cxx_api.h"

namespace {

using Clock = std::chrono::steady_clock;

long PeakRssMb() {
  struct rusage ru;
  if (getrusage(RUSAGE_SELF, &ru) != 0) return -1;
  return ru.ru_maxrss / 1024;  // Linux ru_maxrss is KiB
}

struct U2netSession {
  Ort::Env env{ORT_LOGGING_LEVEL_WARNING, "test_pre"};
  Ort::MemoryInfo mem{Ort::MemoryInfo::CreateCpu(OrtDeviceAllocator,
                                                 OrtMemTypeCPU)};
  Ort::Session session{nullptr};

  explicit U2netSession(const std::string& path) {
    Ort::SessionOptions opts;
    opts.SetGraphOptimizationLevel(ORT_ENABLE_ALL);
    session = Ort::Session(env, path.c_str(), opts);
    Ort::AllocatorWithDefaultOptions alloc;
    std::printf("u2net in=%s out=%s\n",
                session.GetInputNameAllocated(0, alloc).get(),
                session.GetOutputNameAllocated(0, alloc).get());
    auto shape = session.GetInputTypeInfo(0)
                     .GetTensorTypeAndShapeInfo()
                     .GetShape();
    std::printf("u2net input shape=(%lld,%lld,%lld,%lld)\n", (long long)shape[0],
                (long long)shape[1], (long long)shape[2], (long long)shape[3]);
  }

  static void Query(const float* nchw, float* out, int out_n, void* user) {
    auto* self = static_cast<U2netSession*>(user);
    Ort::AllocatorWithDefaultOptions alloc;
    std::string in_name = self->session.GetInputNameAllocated(0, alloc).get();
    std::string out_name =
        self->session.GetOutputNameAllocated(0, alloc).get();
    std::vector<int64_t> shape{1, 3, 320, 320};
    const char* in_names[1] = {in_name.c_str()};
    const char* out_names[1] = {out_name.c_str()};
    Ort::Value in = Ort::Value::CreateTensor<float>(
        self->mem, const_cast<float*>(nchw), 3 * 320 * 320, shape.data(),
        shape.size());
    std::vector<Ort::Value> outs = self->session.Run(
        Ort::RunOptions{nullptr}, in_names, &in, 1, out_names, 1);
    auto got = outs[0].GetTensorTypeAndShapeInfo().GetShape();
    size_t total = 1;
    for (int64_t d : got) total *= static_cast<size_t>(d);
    // Channel 0 of the single output: in NCHW it is the first block.
    if (total < static_cast<size_t>(out_n) ||
        total % static_cast<size_t>(out_n) != 0) {
      std::fprintf(stderr, "u2net output size %zu, want %d\n", total, out_n);
      std::exit(1);
    }
    float* fp = outs[0].GetTensorMutableData<float>();
    std::memcpy(out, fp, static_cast<size_t>(out_n) * 4);
  }
};

}  // namespace

int main(int argc, char** argv) {
  if (argc < 4) {
    std::fprintf(stderr, "usage: %s src_dir u2net.onnx out_dir\n", argv[0]);
    return 1;
  }
  const std::string src_dir = argv[1], out_dir = argv[3];
  std::error_code ec;
  std::filesystem::create_directories(out_dir, ec);
  if (ec) {
    std::fprintf(stderr, "cannot create out dir %s: %s\n", out_dir.c_str(),
                 ec.message().c_str());
    return 1;
  }
  static const char* kIds[5] = {"hjswed", "iuvbww", "qwvfsd", "uegvsd",
                                "yuyyuw"};
  U2netSession u2net(argv[2]);
  const float kWhite[3] = {1.0f, 1.0f, 1.0f};
  for (const char* id : kIds) {
    auto t0 = Clock::now();
    std::vector<int64_t> shape;
    std::vector<uint8_t> rgb;
    if (!triposg::ReadNpyU8(src_dir + "/" + id + ".rgb.npy", shape, rgb) ||
        shape.size() != 3 || shape[2] != 3) {
      std::fprintf(stderr, "bad rgb %s\n", id);
      return 1;
    }
    const int w = static_cast<int>(shape[1]), h = static_cast<int>(shape[0]);
    triposg::RgbaImage cutout = triposg::RemoveBackgroundU2net(
        rgb.data(), w, h, &U2netSession::Query, &u2net);
    auto t1 = Clock::now();
    // cv2 2000-px stage, emitted for the exact INTER_AREA gate. Uses the
    // same Downscale2000 the device path runs inside PrepareImage.
    triposg::RgbaImage resized = triposg::Downscale2000(cutout);
    std::vector<uint8_t> prepared_u8;
    triposg::RgbFloat prepared =
        triposg::PrepareImage(cutout, kWhite, prepared_u8);
    if (prepared.w == 0 || prepared.h == 0) {
      std::fprintf(stderr, "empty prepared %s\n", id);
      return 1;
    }
    const int pw = prepared.w, ph = prepared.h;
    std::vector<float> pixel_values =
        triposg::Dinov2PixelValues(prepared_u8.data(), pw, ph);
    // Isolated resample check: golden prepared canvas -> pixel_values.
    // This separates bicubic fidelity from mask-edge chain drift. The
    // golden canvas is not square (F.pad sides differ by one px when
    // |bw-bh| is odd), so no square assumption here either.
    std::vector<int64_t> gshape;
    std::vector<uint8_t> golden_prepared;
    if (!triposg::ReadNpyU8(src_dir + "/" + id + ".prepared_golden.rgb.npy",
                            gshape, golden_prepared) ||
        gshape.size() != 3 || gshape[2] != 3) {
      std::fprintf(stderr, "bad golden prepared %s\n", id);
      return 1;
    }
    const int gw = static_cast<int>(gshape[1]), gh = static_cast<int>(gshape[0]);
    std::vector<float> pixel_values_from_golden = triposg::Dinov2PixelValues(
        golden_prepared.data(), gw, gh);
    // Stage-isolated port checks: each stage rerun on the reference
    // input, so the strict gates grade the port rather than the u2net
    // cascade drift (the only allowed difference source).
    std::vector<int64_t> rcshape;
    std::vector<uint8_t> ref_cutout_px;
    if (!triposg::ReadNpyU8(src_dir + "/rembg_cpu/" + id + ".cutout.npy",
                            rcshape, ref_cutout_px) ||
        rcshape.size() != 3 || rcshape[2] != 4) {
      std::fprintf(stderr, "bad ref cutout %s\n", id);
      return 1;
    }
    triposg::RgbaImage ref_cutout{static_cast<int>(rcshape[1]),
                                  static_cast<int>(rcshape[0]),
                                  std::move(ref_cutout_px)};
    triposg::RgbaImage resized_iso = triposg::Downscale2000(ref_cutout);
    std::vector<uint8_t> prepared_iso_u8;
    triposg::RgbFloat prepared_iso =
        triposg::PrepareImage(ref_cutout, kWhite, prepared_iso_u8);
    if (prepared_iso.w == 0 || prepared_iso.h == 0) {
      std::fprintf(stderr, "empty prepared iso %s\n", id);
      return 1;
    }
    std::vector<int64_t> rpshape;
    std::vector<uint8_t> ref_prepared;
    if (!triposg::ReadNpyU8(src_dir + "/refs/" + id + ".prepared.npy",
                            rpshape, ref_prepared) ||
        rpshape.size() != 3 || rpshape[2] != 3) {
      std::fprintf(stderr, "bad ref prepared %s\n", id);
      return 1;
    }
    std::vector<float> pixel_values_iso = triposg::Dinov2PixelValues(
        ref_prepared.data(), static_cast<int>(rpshape[1]),
        static_cast<int>(rpshape[0]));
    auto t2 = Clock::now();
    bool ok = triposg::WriteNpyU8(out_dir + "/" + id + ".cutout.npy",
                                  {h, w, 4}, cutout.px.data()) &&
              triposg::WriteNpyU8(out_dir + "/" + id + ".resized2000.npy",
                                  {resized.h, resized.w, 4},
                                  resized.px.data()) &&
              triposg::WriteNpyU8(out_dir + "/" + id + ".prepared.npy",
                                  {ph, pw, 3}, prepared_u8.data()) &&
              triposg::WriteNpyF32(out_dir + "/" + id + ".pixel_values.npy",
                                   {1, 3, 224, 224}, pixel_values.data()) &&
              triposg::WriteNpyF32(
                  out_dir + "/" + id + ".pixel_values_from_golden.npy",
                  {1, 3, 224, 224}, pixel_values_from_golden.data()) &&
              triposg::WriteNpyU8(out_dir + "/" + id + ".resized2000_iso.npy",
                                  {resized_iso.h, resized_iso.w, 4},
                                  resized_iso.px.data()) &&
              triposg::WriteNpyU8(out_dir + "/" + id + ".prepared_iso.npy",
                                  {prepared_iso.h, prepared_iso.w, 3},
                                  prepared_iso_u8.data()) &&
              triposg::WriteNpyF32(out_dir + "/" + id + ".pixel_values_iso.npy",
                                   {1, 3, 224, 224},
                                   pixel_values_iso.data());
    if (!ok) {
      std::fprintf(stderr, "write failed %s\n", id);
      return 1;
    }
    double bg_ms =
        std::chrono::duration<double, std::milli>(t1 - t0).count();
    double pre_ms =
        std::chrono::duration<double, std::milli>(t2 - t1).count();
    std::printf("%s src=(%d,%d) prepared=(%d,%d) bg_ms=%.0f prep_ms=%.0f "
                "rss_mb=%ld\n",
                id, w, h, pw, ph, bg_ms, pre_ms, PeakRssMb());
  }
  return 0;
}
