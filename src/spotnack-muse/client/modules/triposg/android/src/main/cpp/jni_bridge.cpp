// JNI bridge between TripoSGModule.kt and the C++ engine.
//
// One process-wide Engine (the Kotlin side serializes conversions on a
// single-thread executor). Progress callbacks reattach the calling
// thread to the JVM; worker threads come from the Kotlin executor pool
// and stay attached, which is safe. Every native call returns null on
// success or an error string, except where noted.
#include <jni.h>

#include <android/log.h>

#include <atomic>
#include <chrono>
#include <cstdint>
#include <cstring>
#include <map>
#include <string>
#include <vector>

#include "models.h"
#include "pipeline.h"

namespace {

JavaVM* g_vm = nullptr;
triposg::Engine g_engine;
std::atomic<bool> g_cancel(false);

std::string JStringToStd(JNIEnv* env, jstring s) {
  const char* c = env->GetStringUTFChars(s, nullptr);
  std::string out(c ? c : "");
  if (c) env->ReleaseStringUTFChars(s, c);
  return out;
}

jstring StdToJString(JNIEnv* env, const std::string& s) {
  return env->NewStringUTF(s.c_str());
}

// Forwards C++ progress to a Kotlin (Double, String) -> Unit callback.
class ProgressForwarder {
 public:
  ProgressForwarder(JNIEnv* env, jobject cb)
      : cb_(env->NewGlobalRef(cb)),
        mid_(env->GetMethodID(env->GetObjectClass(cb_), "onProgress",
                              "(DLjava/lang/String;)V")) {}
  ~ProgressForwarder() {
    JNIEnv* env = Attach();
    if (env && cb_) env->DeleteGlobalRef(cb_);
  }
  void operator()(double f, const std::string& label) {
    JNIEnv* env = Attach();
    if (!env || !cb_ || !mid_) return;
    jstring jlabel = env->NewStringUTF(label.c_str());
    env->CallVoidMethod(cb_, mid_, f, jlabel);
    env->DeleteLocalRef(jlabel);
    if (env->ExceptionCheck()) env->ExceptionClear();
  }

 private:
  JNIEnv* Attach() {
    JNIEnv* env = nullptr;
    if (g_vm->GetEnv(reinterpret_cast<void**>(&env), JNI_VERSION_1_6) !=
        JNI_OK) {
      if (g_vm->AttachCurrentThread(&env, nullptr) != JNI_OK) return nullptr;
    }
    return env;
  }
  jobject cb_ = nullptr;
  jmethodID mid_ = nullptr;
};

extern "C" {

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void*) {
  g_vm = vm;
  return JNI_VERSION_1_6;
}

// null on success, else the error.
JNIEXPORT jstring JNICALL
Java_expo_modules_triposg_TripoSGModule_nativeConfigure(
    JNIEnv* env, jobject, jstring modelDir, jstring backendPath) {
  std::string error;
  if (!g_engine.Configure(JStringToStd(env, modelDir),
                          JStringToStd(env, backendPath), error))
    return StdToJString(env, error);
  return nullptr;
}

// null on success, "cancelled" on cancel, else the error.
JNIEXPORT jstring JNICALL
Java_expo_modules_triposg_TripoSGModule_nativeConvert(
    JNIEnv* env, jobject, jbyteArray rgba, jint w, jint h, jint steps,
    jdouble guidance, jint d0, jint d1, jlong seed, jint targetTris,
    jstring noisePath, jstring outDir, jobject progressCb) {
  g_cancel.store(false);
  jbyte* bytes = env->GetByteArrayElements(rgba, nullptr);
  if (!bytes) return StdToJString(env, "empty image bytes");
  triposg::ConvertOptions opts;
  opts.steps = steps;
  opts.guidance = guidance;
  opts.d0 = d0;
  opts.d1 = d1;
  opts.seed = static_cast<uint64_t>(seed);
  opts.target_tris = targetTris;
  opts.noise_path = JStringToStd(env, noisePath);
  ProgressForwarder forward(env, progressCb);
  auto progress = [&](double f, const std::string& label) {
    forward(f, label);
  };
  std::string error;
  bool ok = g_engine.Convert(reinterpret_cast<uint8_t*>(bytes), w, h, opts,
                             JStringToStd(env, outDir), progress, g_cancel,
                             error);
  env->ReleaseByteArrayElements(rgba, bytes, JNI_ABORT);
  if (ok) return nullptr;
  return StdToJString(env, error.empty() ? "convert failed" : error);
}

JNIEXPORT void JNICALL
Java_expo_modules_triposg_TripoSGModule_nativeCancel(JNIEnv*, jobject) {
  g_cancel.store(true);
}

// Cut-out preview: same bg removal + PrepareImage as Convert, no NPU.
// Returns a byte[] of header + RGB pixels, or null on failure (the
// caller treats null as "no preview", never fatal).
// Header (little-endian): "CUT1" u8[4], w i32, h i32, borderTouch f32,
// bigComponents i32, maskAreaFrac f32; then w*h*3 RGB bytes.
JNIEXPORT jbyteArray JNICALL
Java_expo_modules_triposg_TripoSGModule_nativePreviewCutout(
    JNIEnv* env, jobject, jbyteArray rgba, jint w, jint h) {
  jbyte* bytes = env->GetByteArrayElements(rgba, nullptr);
  if (!bytes) return nullptr;
  std::vector<uint8_t> rgb;
  int out_w = 0, out_h = 0;
  triposg::MaskStats stats;
  std::string error;
  bool ok = g_engine.PreviewCutout(reinterpret_cast<uint8_t*>(bytes), w, h,
                                   rgb, out_w, out_h, stats, error);
  env->ReleaseByteArrayElements(rgba, bytes, JNI_ABORT);
  if (!ok) return nullptr;
  const size_t npix = static_cast<size_t>(out_w) * out_h;
  if (rgb.size() != npix * 3) return nullptr;
  std::vector<uint8_t> buf;
  buf.reserve(24 + rgb.size());
  buf.insert(buf.end(), {'C', 'U', 'T', '1'});
  auto put32 = [&](uint32_t v) {
    buf.push_back(v & 0xFF);
    buf.push_back((v >> 8) & 0xFF);
    buf.push_back((v >> 16) & 0xFF);
    buf.push_back((v >> 24) & 0xFF);
  };
  put32(static_cast<uint32_t>(out_w));
  put32(static_cast<uint32_t>(out_h));
  uint32_t border_bits, area_bits;
  std::memcpy(&border_bits, &stats.border_touch, 4);
  std::memcpy(&area_bits, &stats.area_frac, 4);
  put32(border_bits);
  put32(static_cast<uint32_t>(stats.big_components));
  put32(area_bits);
  buf.insert(buf.end(), rgb.begin(), rgb.end());
  jbyteArray out = env->NewByteArray(static_cast<jsize>(buf.size()));
  if (!out) return nullptr;
  env->SetByteArrayRegion(out, 0, static_cast<jsize>(buf.size()),
                          reinterpret_cast<jbyte*>(buf.data()));
  return out;
}

// Debug-only adb trigger (see TripoSGDebugReceiver.kt): a fixed-knob
// conversion (50 steps, guidance 7.0, seed 42 unless noisePath names a
// (1,2048,64) float32 .npy initial latent, d0 6 / d1 8, 100k display
// tris) with logcat progress. The receiver refuses to run in
// non-debuggable builds, so this is dead code in release. Null on
// success, else the error.
JNIEXPORT jstring JNICALL
Java_expo_modules_triposg_TripoSGDebug_nativeDebugConvert(
    JNIEnv* env, jobject, jstring modelDir, jstring backendPath,
    jbyteArray rgba, jint w, jint h, jstring outDir, jstring noisePath) {
  std::string error;
  if (!g_engine.Configure(JStringToStd(env, modelDir),
                          JStringToStd(env, backendPath), error))
    return StdToJString(env, error);
  g_cancel.store(false);
  jbyte* bytes = env->GetByteArrayElements(rgba, nullptr);
  if (!bytes) return StdToJString(env, "empty image bytes");
  triposg::ConvertOptions opts;
  opts.steps = 50;
  opts.guidance = 7.0;
  opts.d0 = 6;
  opts.d1 = 8;
  opts.seed = 42;
  opts.target_tris = 100000;
  opts.noise_path = JStringToStd(env, noisePath);
  // Per-stage wall clock from the engine's progress labels (first-seen
  // timestamps; "Generating geometry" repeats per sampling step, so the
  // sampling span starts at its second occurrence). Unreached stages log
  // -1. Label order in pipeline.cpp: Isolating subject -> Preparing
  // image -> Encoding image -> Generating geometry -> Loading models ->
  // (Generating geometry x steps) -> Decoding shape -> Extracting mesh ->
  // Building mesh -> Writing model -> Done.
  auto t0 = std::chrono::steady_clock::now();
  auto elapsed = [&]() {
    return std::chrono::duration<double>(
               std::chrono::steady_clock::now() - t0)
        .count();
  };
  std::map<std::string, double> first_seen;
  int generating_count = 0;
  double sampling_start = -1.0;
  auto progress = [&](double f, const std::string& label) {
    __android_log_print(ANDROID_LOG_INFO, "TripoSGDebug",
                        "progress %.1f%% %s", f * 100.0, label.c_str());
    if (!first_seen.count(label)) first_seen[label] = elapsed();
    if (label == "Generating geometry" && ++generating_count == 2)
      sampling_start = elapsed();
  };
  bool ok = g_engine.Convert(reinterpret_cast<uint8_t*>(bytes), w, h, opts,
                             JStringToStd(env, outDir), progress, g_cancel,
                             error);
  env->ReleaseByteArrayElements(rgba, bytes, JNI_ABORT);
  auto at = [&](const char* label) {
    auto it = first_seen.find(label);
    return it == first_seen.end() ? -1.0 : it->second;
  };
  auto span = [](double a, double b) {
    return (a < 0 || b < 0) ? -1.0 : b - a;
  };
  double t_end = elapsed();
  __android_log_print(
      ANDROID_LOG_INFO, "TripoSGDebug",
      "TIMINGS preprocess=%.1f dinov2=%.1f session_create=%.1f "
      "sampling=%.1f vae=%.1f extraction=%.1f display=%.1f total=%.1f",
      span(at("Isolating subject"), at("Encoding image")),
      span(at("Encoding image"), at("Generating geometry")),
      span(at("Loading models"), sampling_start),
      span(sampling_start, at("Decoding shape")),
      span(at("Decoding shape"), at("Extracting mesh")),
      span(at("Extracting mesh"), at("Building mesh")),
      span(at("Building mesh"),
           at("Done") >= 0 ? at("Done") : t_end),
      t_end);
  if (ok) return nullptr;
  return StdToJString(env, error.empty() ? "convert failed" : error);
}

JNIEXPORT void JNICALL
Java_expo_modules_triposg_TripoSGModule_nativeRelease(JNIEnv*, jobject) {
  g_cancel.store(true);
  g_engine.Release();
}

// "" = all present with recorded sizes, else the first problem.
JNIEXPORT jstring JNICALL
Java_expo_modules_triposg_TripoSGModule_nativeVerifySizes(
    JNIEnv* env, jobject, jstring modelDir) {
  std::string dir = JStringToStd(env, modelDir);
  triposg::ModelManifest manifest;
  std::string error;
  if (!triposg::LoadManifest(dir, manifest, error))
    return StdToJString(env, error);
  std::atomic<bool> no_cancel(false);
  if (!triposg::VerifyModels(dir, manifest, false, nullptr, no_cancel, error))
    return StdToJString(env, error);
  return StdToJString(env, "");
}

// null on success, "cancelled" on cancel, else the error. Progress goes
// to the Kotlin callback as (done, total) encoded in the fraction/label.
JNIEXPORT jstring JNICALL
Java_expo_modules_triposg_TripoSGModule_nativeVerifyFull(
    JNIEnv* env, jobject, jstring modelDir, jobject progressCb) {
  std::string dir = JStringToStd(env, modelDir);
  triposg::ModelManifest manifest;
  std::string error;
  if (!triposg::LoadManifest(dir, manifest, error))
    return StdToJString(env, error);
  g_cancel.store(false);
  ProgressForwarder forward(env, progressCb);
  auto progress = [&](int done, int total, const std::string& path) {
    forward(total > 0 ? static_cast<double>(done) / total : 1.0, path);
  };
  if (!triposg::VerifyModels(dir, manifest, true, progress, g_cancel, error))
    return StdToJString(env, error.empty() ? "verify failed" : error);
  return nullptr;
}

}  // extern "C"
}  // namespace
