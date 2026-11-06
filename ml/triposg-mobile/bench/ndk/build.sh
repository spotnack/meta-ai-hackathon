#!/bin/sh
# Build the spike benchmark for arm64-v8a with the NDK. Run from anywhere.
# ORT_FLAVOR=cpu|qnn selects the ONNX Runtime Android build (qnn links the
# QNN EP build). Each flavor gets its own output dir so both binaries can
# coexist: cpu -> logs/spike-ndk/out/, qnn -> logs/spike-ndk/out-qnn/
# (both git-ignored). Override the AAR with ORT_AAR, the dir with NDKOUT.
set -eu
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
NDK="${ANDROID_NDK_HOME:-$HOME/Android/Sdk/ndk/27.1.12297006}"
SRC="$ROOT/bench/ndk"
ORT_FLAVOR="${ORT_FLAVOR:-cpu}"
case "$ORT_FLAVOR" in
  cpu) OUT_DEFAULT="$ROOT/logs/spike-ndk/out" ;;
  qnn) OUT_DEFAULT="$ROOT/logs/spike-ndk/out-qnn" ;;
  *) echo "unknown ORT_FLAVOR=$ORT_FLAVOR (cpu|qnn)" >&2; exit 1 ;;
esac
OUT="${NDKOUT:-$OUT_DEFAULT}"
if [ "$ORT_FLAVOR" = "qnn" ]; then
  AAR_DEFAULT="$ROOT/logs/spike-ndk/thirdparty/onnxruntime-android-qnn-1.22.0.aar"
else
  AAR_DEFAULT="$ROOT/logs/spike-ndk/thirdparty/onnxruntime-android-1.22.0.aar"
fi
ORT_AAR="${ORT_AAR:-$AAR_DEFAULT}"
[ -f "$ORT_AAR" ] || { echo "MISSING AAR: $ORT_AAR" >&2; exit 1; }
cmake -S "$SRC" -B "$OUT/build" \
  -DCMAKE_TOOLCHAIN_FILE="$NDK/build/cmake/android.toolchain.cmake" \
  -DANDROID_ABI=arm64-v8a -DANDROID_PLATFORM=android-34 \
  -DORT_FLAVOR="$ORT_FLAVOR" -DORT_AAR="$ORT_AAR" \
  -DCMAKE_BUILD_TYPE=Release
cmake --build "$OUT/build" -j4
cp "$OUT/build/ort/jni/arm64-v8a/libonnxruntime.so" "$OUT/"
ls -la "$OUT" "$OUT/build/spike_bench" "$OUT/build/spike_chain" "$OUT/build/spike_pipeline"
