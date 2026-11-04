#!/bin/sh
# Step 0: prove the phone is reachable and record its specs.
# You run this in your own terminal (outside the sandbox) and paste back
# the full output. Read-only: changes nothing on the phone.
set -eu
SERIAL="${ANDROID_SERIAL:-2dd745b1}"
adb -s "$SERIAL" wait-for-device
echo "== build =="
for prop in ro.product.model ro.build.version.release ro.build.display.id \
  ro.product.cpu.abi ro.hardware ro.soc.model; do
  echo "$prop=$(adb -s "$SERIAL" shell getprop "$prop")"
done
echo "== ram =="
adb -s "$SERIAL" shell "grep -E 'MemTotal|MemAvailable' /proc/meminfo"
echo "== storage =="
adb -s "$SERIAL" shell df -h /data/local/tmp
echo "== termux present? =="
adb -s "$SERIAL" shell \
  "ls /data/data/com.termux/files/usr/bin/python 2>/dev/null || echo NO_TERMUX"
