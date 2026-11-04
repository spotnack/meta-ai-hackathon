#!/bin/sh
# Step 2: probe on-device runtimes for the spike.
# Prefers Termux python + onnxruntime when present; otherwise reports what
# is available so the next step (APK runner vs. Termux install) can be
# chosen with evidence. Paste back the full output.
set -eu
SERIAL="${ANDROID_SERIAL:-2dd745b1}"
adb -s "$SERIAL" wait-for-device
echo "== files on device =="
adb -s "$SERIAL" shell "ls -la /data/local/tmp/triposg-spike/ || echo NO_FILES"
echo "== termux python =="
adb -s "$SERIAL" shell \
  "/data/data/com.termux/files/usr/bin/python --version 2>/dev/null || echo NO_TERMUX_PYTHON"
echo "== onnxruntime in termux =="
adb -s "$SERIAL" shell \
  "/data/data/com.termux/files/usr/bin/python -c 'import onnxruntime, numpy; print(onnxruntime.__version__, numpy.__version__)' 2>&1 | tail -n 3"
echo "== cpu =="
adb -s "$SERIAL" shell "grep -m 1 'Hardware\|model name' /proc/cpuinfo || true"
