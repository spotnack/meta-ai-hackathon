#!/bin/sh
# Step 3: pull on-device results back and capture peak-RAM evidence.
# Paste back the full output.
set -eu
SERIAL="${ANDROID_SERIAL:-2dd745b1}"
OUT="ml/triposg-mobile/logs/spike"
mkdir -p "$OUT"
adb -s "$SERIAL" wait-for-device
adb -s "$SERIAL" pull /data/local/tmp/triposg-spike/dinov2_out.npy \
  "$OUT/dinov2_phone.npy" 2>&1 || echo "NO_OUTPUT_YET"
adb -s "$SERIAL" shell dumpsys meminfo | head -n 30
