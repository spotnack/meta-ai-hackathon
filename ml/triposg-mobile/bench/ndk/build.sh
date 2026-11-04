#!/bin/sh
# Build the spike benchmark for arm64-v8a with the NDK. Run from anywhere.
# Output lands in ml/triposg-mobile/logs/spike-ndk/out/ (git-ignored).
set -eu
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
NDK="${ANDROID_NDK_HOME:-$HOME/Android/Sdk/ndk/27.1.12297006}"
SRC="$ROOT/bench/ndk"
OUT="$ROOT/logs/spike-ndk/out"
cmake -S "$SRC" -B "$OUT/build" \
  -DCMAKE_TOOLCHAIN_FILE="$NDK/build/cmake/android.toolchain.cmake" \
  -DANDROID_ABI=arm64-v8a -DANDROID_PLATFORM=android-34 \
  -DCMAKE_BUILD_TYPE=Release
cmake --build "$OUT/build" -j4
cp "$OUT/build/ort/jni/arm64-v8a/libonnxruntime.so" "$OUT/"
ls -la "$OUT" "$OUT/build/spike_bench"
