#!/bin/sh
# Step 4: run the spike benchmark on the phone and capture peak RAM.
# You run this in your own terminal (outside the sandbox) after the ONNX
# export exists. Pushes the binary, .so, model, and input; runs the bench
# in the background while sampling VmHWM from /proc/<pid>/status; pulls
# the output. Paste back the full output.
set -eu
SERIAL="${ANDROID_SERIAL:-2dd745b1}"
SPIKE="ml/triposg-mobile/logs/spike"
NDKOUT="ml/triposg-mobile/logs/spike-ndk/out"
REMOTE="/data/local/tmp/triposg-spike"
# Override per run: MODEL, INPUT, OUTPUT, PROVIDER (cpu|qnn), EXTRA inputs.
MODEL="${MODEL:-$SPIKE/dinov2_encoder.onnx}"
INPUT="${INPUT:-$SPIKE/dinov2_spike_input.npy}"
OUTPUT="${OUTPUT:-$SPIKE/dinov2_phone.npy}"
PROVIDER="${PROVIDER:-cpu}"
# QNN backend .so (Maven qnn-runtime 2.33.0 to match ORT 1.22.0, or vendor).
BACKEND="${BACKEND:-/vendor/lib64/libQnnHtp.so}"
# Dir holding the HTP Skel libs (push dir when using pushed libs).
ADSP_LIBRARY_PATH="${ADSP_LIBRARY_PATH:-/vendor/lib64}"
EXTRA="${EXTRA:-}"
for f in "$NDKOUT/build/spike_bench" "$NDKOUT/libonnxruntime.so" \
    "$MODEL" "$INPUT"; do
  [ -f "$f" ] || { echo "MISSING: $f"; exit 1; }
done
for f in $EXTRA; do
  [ -f "$f" ] || { echo "MISSING: $f"; exit 1; }
done
adb -s "$SERIAL" wait-for-device
adb -s "$SERIAL" shell "mkdir -p $REMOTE"
adb -s "$SERIAL" push "$NDKOUT/build/spike_bench" "$REMOTE/" >/dev/null
adb -s "$SERIAL" push "$NDKOUT/libonnxruntime.so" "$REMOTE/" >/dev/null
MODEL_BASE="$(basename "$MODEL")"
adb -s "$SERIAL" push "$MODEL" "$REMOTE/$MODEL_BASE" >/dev/null
# External-data sidecar (FP32/FP16 single-step exports): push when present.
if [ -f "$MODEL.data" ]; then
  adb -s "$SERIAL" push "$MODEL.data" "$REMOTE/$MODEL_BASE.data" >/dev/null
fi
adb -s "$SERIAL" push "$INPUT" "$REMOTE/input.npy" >/dev/null
i=0
for f in $EXTRA; do
  i=$((i + 1))
  adb -s "$SERIAL" push "$f" "$REMOTE/extra$i.npy" >/dev/null
done
# bench.cpp takes [runs] [cpu|qnn] [backend] [extras...]: the backend path
# must come before the extra inputs on qnn runs.
if [ "$PROVIDER" = "qnn" ]; then
  ARGS="input.npy out.npy 5 qnn $BACKEND"
else
  ARGS="input.npy out.npy 5 cpu"
fi
i=0
for f in $EXTRA; do
  i=$((i + 1))
  ARGS="$ARGS extra$i.npy"
done
adb -s "$SERIAL" shell "cd $REMOTE && chmod +x spike_bench && \
  (ADSP_LIBRARY_PATH=\"$ADSP_LIBRARY_PATH\" LD_LIBRARY_PATH=. \
   ./spike_bench $MODEL_BASE $ARGS > run.log 2>&1 & \
  echo \$! > pid.txt) && \
  PEAK=0; while kill -0 \$(cat pid.txt) 2>/dev/null; do \
  V=\$(grep VmHWM /proc/\$(cat pid.txt)/status 2>/dev/null | awk '{print \$2}'); \
  [ -n \"\$V\" ] && [ \"\$V\" -gt \"\$PEAK\" ] && PEAK=\$V; \
  sleep 0.2; done; \
  V=\$(grep VmHWM /proc/\$(cat pid.txt)/status 2>/dev/null | awk '{print \$2}'); \
  [ -n \"\$V\" ] && [ \"\$V\" -gt \"\$PEAK\" ] && PEAK=\$V; \
  echo PEAK_VMHWM_KB=\$PEAK; cat run.log"
adb -s "$SERIAL" pull "$REMOTE/out.npy" "$OUTPUT"
