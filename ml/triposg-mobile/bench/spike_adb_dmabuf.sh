#!/bin/sh
# DMA-BUF probe: sample per-process dmabuf_dump totals while spike_chain
# resident runs on the phone NPU. This is how the 8.96 GB resident DiT
# chain (weights + per-session scratch) and the HyperOS dmabuf kill were
# measured, and the before/after check for the w8a16 variant.
#
# Env (defaults shown): SERIAL=<adb serial, required>,
# REMOTE=/data/local/tmp/triposg-chain (models root override: point at the
# w8a16 remote dir to probe the quantized chain),
# RUNS=1, NDKOUT=logs/spike-ndk/out-qnn129,
# OUTDIR=logs/spike/phone_dmabuf[-<remote-base>].
#
# Launch note: `adb shell "... &"` does not return the pid, so the run is
# started host-backgrounded and the pid is found on-device with
# `pidof spike_chain` (first pid wins if several match).
set -eu
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"  # repo root
SERIAL="${SERIAL:?set SERIAL to the adb device serial}"
REMOTE="${REMOTE:-/data/local/tmp/triposg-chain}"
RUNS="${RUNS:-1}"
if [ -z "${NDKOUT:-}" ]; then
  NDKOUT="ml/triposg-mobile/logs/spike-ndk/out-qnn129"
fi
OUTDIR_DEFAULT="$ROOT/ml/triposg-mobile/logs/spike/phone_dmabuf"
case "$(basename "$REMOTE")" in
  triposg-chain) ;;
  *) OUTDIR_DEFAULT="$OUTDIR_DEFAULT-$(basename "$REMOTE")" ;;
esac
OUTDIR="${OUTDIR:-$OUTDIR_DEFAULT}"
BACKEND="$REMOTE/libQnnHtp.so"
MAX_SAMPLES="${MAX_SAMPLES:-900}"  # 30 min at 2 s
mkdir -p "$OUTDIR"
[ -f "$NDKOUT/build/spike_chain" ] || { echo "MISSING: $NDKOUT/build/spike_chain" >&2; exit 1; }
[ -f "$NDKOUT/libonnxruntime.so" ] || { echo "MISSING: $NDKOUT/libonnxruntime.so" >&2; exit 1; }
adb -s "$SERIAL" wait-for-device
adb -s "$SERIAL" shell "ls $REMOTE/models_b1.txt" >/dev/null || {
  echo "MISSING $REMOTE/models_b1.txt: push units first (see spike_adb_chain_npu.sh)" >&2; exit 1; }
adb -s "$SERIAL" shell "ls $REMOTE/in/latent_r0.npy" >/dev/null || {
  echo "MISSING $REMOTE/in/: push inputs first (see spike_adb_chain_npu.sh)" >&2; exit 1; }

adb -s "$SERIAL" push "$NDKOUT/build/spike_chain" "$REMOTE/" >/dev/null
adb -s "$SERIAL" push "$NDKOUT/libonnxruntime.so" "$REMOTE/" >/dev/null
LOG="$OUTDIR/dmabuf_run.log"
SAMPLES="$OUTDIR/dmabuf_samples.log"
: > "$SAMPLES"
# Host-backgrounded so this shell stays free to sample; the phone-side run
# logs to dmabuf_run.log on device.
adb -s "$SERIAL" shell "cd $REMOTE && chmod +x spike_chain && \
  LD_LIBRARY_PATH=$REMOTE ADSP_LIBRARY_PATH=$REMOTE \
  ./spike_chain resident models_b1.txt in/ out_dmabuf.npy $RUNS $BACKEND \
  > dmabuf_run.log 2>&1" &
ADB_PID=$!
echo "run launched (host pid $ADB_PID); waiting for spike_chain pid..."
PID=""
for _ in $(seq 1 120); do
  PID="$(adb -s "$SERIAL" shell "pidof spike_chain" 2>/dev/null | tr -d '\r' | awk '{print $1}')"
  [ -n "$PID" ] && break
  sleep 1
done
[ -n "$PID" ] || { echo "STOP: spike_chain never appeared; phone log:" >&2;
  adb -s "$SERIAL" shell "cat $REMOTE/dmabuf_run.log" >&2; kill "$ADB_PID" 2>/dev/null; exit 1; }
echo "spike_chain pid=$PID; sampling dmabuf_dump every 2 s..."
n=0
while [ "$n" -lt "$MAX_SAMPLES" ]; do
  ALIVE="$(adb -s "$SERIAL" shell "pidof spike_chain" 2>/dev/null | tr -d '\r' | awk '{print $1}')"
  [ -n "$ALIVE" ] || break
  {
    echo "--- sample $n pid=$PID"
    adb -s "$SERIAL" shell "dmabuf_dump $PID" 2>&1
  } >> "$SAMPLES"
  adb -s "$SERIAL" shell "dmabuf_dump $PID" 2>&1 | grep -i "process.*total" || true
  n=$((n + 1))
  sleep 2
done
wait "$ADB_PID"
echo "run finished after $n samples"
adb -s "$SERIAL" pull "$REMOTE/dmabuf_run.log" "$LOG" >/dev/null
grep -E '^(pass_row|create_total|vmhwm_|pss_|noise_row)' "$LOG" | tr '\n' ' '; echo
echo "peak PROCESS TOTAL lines (units as printed by dmabuf_dump):"
grep -i "process.*total" "$SAMPLES" | sort -u
echo "full dumps -> $SAMPLES"
