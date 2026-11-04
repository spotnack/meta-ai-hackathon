#!/bin/sh
# Step 1: push the exported spike files to the phone.
# Run from the repo root after the ONNX export exists in
# ml/triposg-mobile/logs/spike/. Paste back the full output.
set -eu
SERIAL="${ANDROID_SERIAL:-2dd745b1}"
OUT="ml/triposg-mobile/logs/spike"
for f in "$OUT/dinov2_encoder.onnx" "$OUT/dinov2_cpu_baseline.npy"; do
  [ -f "$f" ] || { echo "MISSING: $f (run the export first)"; exit 1; }
done
adb -s "$SERIAL" wait-for-device
adb -s "$SERIAL" shell "mkdir -p /data/local/tmp/triposg-spike"
adb -s "$SERIAL" push "$OUT/dinov2_encoder.onnx" \
  /data/local/tmp/triposg-spike/dinov2_encoder.onnx
adb -s "$SERIAL" push "$OUT/dinov2_cpu_baseline.npy" \
  /data/local/tmp/triposg-spike/dinov2_cpu_baseline.npy
adb -s "$SERIAL" shell "ls -la /data/local/tmp/triposg-spike/"
