#!/bin/sh
# Run the full 23-unit batch-1 chain on the phone NPU and pull the results.
# You run this in your own terminal (outside the sandbox).
# Models are the AI Hub precompiled EPContext units
# (logs/spike/aihub/<stem>/device/{model.onnx,model.bin} from
# bench/aihub_compile.py, or AIHUB=.../aihub_w8a16 for the w8a16 variant):
# each unit dir is pushed to $REMOTE/<stem>/ so the
# EPContext node's ./model.bin reference resolves. Runs resident (all 23
# sessions once) and stream (create/run/destroy per unit) with a cooldown
# between them, sampling peak VmHWM externally; then gate both outputs with
# parity/check_step0.py against step0_noise_pred.npy.
# Requires the spike_chain binary (bench/ndk/build.sh with ORT_FLAVOR=qnn,
# e.g. ORT_AAR=.../onnxruntime-android-qnn-1.29.0.aar
# NDKOUT=.../out-qnn129). SPIKE_CTX is unnecessary: spike_chain never sets
# ep.context_* options (inputs are always precompiled).
set -eu
SERIAL="${ANDROID_SERIAL:-2dd745b1}"
AIHUB="${AIHUB:-ml/triposg-mobile/logs/spike/aihub}"
B1="${B1:-ml/triposg-mobile/logs/spike/b1}"
GOLDEN="${GOLDEN:-ml/triposg-mobile/reference/goldens_5/hjswed}"
REMOTE="${REMOTE:-/data/local/tmp/triposg-chain}"
# AIHUB selects the compiled variant (fp32 default, or AIHUB=.../aihub_w8a16
# for the quantized chain after aihub_compile.py --variant w8a16 with a
# matching --remote-dir). A non-default AIHUB dir gets its own OUTDIR so
# quantized parity outputs never overwrite the fp32 ones.
OUTDIR_DEFAULT="ml/triposg-mobile/logs/spike/phone_chain_b1"
case "$(basename "$AIHUB")" in
  aihub) ;;
  *) OUTDIR_DEFAULT="$OUTDIR_DEFAULT-$(basename "$AIHUB")" ;;
esac
OUTDIR="${OUTDIR:-$OUTDIR_DEFAULT}"
if [ -z "${NDKOUT:-}" ]; then
  NDKOUT="ml/triposg-mobile/logs/spike-ndk/out-qnn129"
fi
BACKEND="${BACKEND:-/vendor/lib64/libQnnHtp.so}"
ADSP_LIBRARY_PATH="${ADSP_LIBRARY_PATH:-/vendor/lib64}"
# QNN HTP userspace libs (qnn-runtime 2.50.0 extract); pushed to the phone
# so BACKEND + ADSP_LIBRARY_PATH point at the remote dir, not /vendor.
QNNLIB="${QNNLIB:-ml/triposg-mobile/logs/spike/qnn250/extract}"
QNNLIBS="libQnnHtp.so libQnnHtpPrepare.so libQnnHtpV79Stub.so libQnnHtpV79Skel.so libQnnSystem.so"
BACKEND="$REMOTE/libQnnHtp.so"
ADSP_LIBRARY_PATH="$REMOTE"
RUNS="${RUNS:-3}"
CHAINLIST="$AIHUB/chain_remote.txt"
mkdir -p "$OUTDIR"
[ -f "$NDKOUT/build/spike_chain" ] || { echo "MISSING: $NDKOUT/build/spike_chain (rebuild with bench/ndk/build.sh ORT_FLAVOR=qnn)"; exit 1; }
[ -f "$NDKOUT/libonnxruntime.so" ] || { echo "MISSING: $NDKOUT/libonnxruntime.so"; exit 1; }
[ -f "$CHAINLIST" ] || { echo "MISSING: $CHAINLIST (run bench/aihub_compile.py)"; exit 1; }
[ "$(wc -l < "$CHAINLIST")" -eq 23 ] || { echo "STOP: $CHAINLIST has $(wc -l < "$CHAINLIST") lines, want 23"; exit 1; }
for f in $QNNLIBS; do
  [ -f "$QNNLIB/$f" ] || { echo "MISSING: $QNNLIB/$f"; exit 1; }
done
for r in 0 1; do
  for n in latent timestep enc; do
    [ -f "$B1/${n}_r${r}.npy" ] || { echo "MISSING: $B1/${n}_r${r}.npy (run split_export_step.py --all-b1)"; exit 1; }
  done
done
# Every chain-list line is "<remote model path> <stem>"; the local unit dir
# holds model.onnx + model.bin under stable names.
while read -r RPATH STEM DUMMY; do
  [ -n "$RPATH" ] && [ -n "$STEM" ] && [ -z "${DUMMY:-}" ] || { echo "STOP: bad chain_remote line: $RPATH $STEM $DUMMY"; exit 1; }
  [ -f "$AIHUB/$STEM/device/model.onnx" ] || { echo "MISSING: $AIHUB/$STEM/device/model.onnx"; exit 1; }
  [ -f "$AIHUB/$STEM/device/model.bin" ] || { echo "MISSING: $AIHUB/$STEM/device/model.bin"; exit 1; }
done < "$CHAINLIST"
adb -s "$SERIAL" wait-for-device
adb -s "$SERIAL" shell "mkdir -p $REMOTE"
adb -s "$SERIAL" push "$NDKOUT/build/spike_chain" "$REMOTE/" >/dev/null
adb -s "$SERIAL" push "$NDKOUT/libonnxruntime.so" "$REMOTE/" >/dev/null
adb -s "$SERIAL" push "$CHAINLIST" "$REMOTE/models_b1.txt" >/dev/null
adb -s "$SERIAL" shell "mkdir -p $REMOTE/in"
for r in 0 1; do
  for n in latent timestep enc; do
    adb -s "$SERIAL" push "$B1/${n}_r${r}.npy" "$REMOTE/in/${n}_r${r}.npy" >/dev/null
  done
done
while read -r RPATH STEM DUMMY; do
  adb -s "$SERIAL" shell "mkdir -p $REMOTE/$STEM" < /dev/null
  adb -s "$SERIAL" push "$AIHUB/$STEM/device/model.onnx" "$REMOTE/$STEM/model.onnx" >/dev/null < /dev/null
  adb -s "$SERIAL" push "$AIHUB/$STEM/device/model.bin" "$REMOTE/$STEM/model.bin" >/dev/null < /dev/null
done < "$CHAINLIST"
for f in $QNNLIBS; do
  adb -s "$SERIAL" push "$QNNLIB/$f" "$REMOTE/" >/dev/null
done

# run_mode <mode>: one timed chain run with peak-VmHWM sampling. Prints the
# machine lines.
run_mode() {
  MODE="$1"
  LOG=$(adb -s "$SERIAL" shell "cd $REMOTE && chmod +x spike_chain && \
    (ADSP_LIBRARY_PATH=\"$ADSP_LIBRARY_PATH\" LD_LIBRARY_PATH=\"$REMOTE\" \
     SPIKE_QNN_OPTS=\"${SPIKE_QNN_OPTS:-}\" \
     ./spike_chain $MODE models_b1.txt in/ out_$MODE.npy $RUNS $BACKEND > run_$MODE.log 2>&1 & \
    echo \$! > pid.txt) && \
    PEAK=0; while kill -0 \$(cat pid.txt) 2>/dev/null; do \
    V=\$(grep VmHWM /proc/\$(cat pid.txt)/status 2>/dev/null | awk '{print \$2}'); \
    [ -n \"\$V\" ] && [ \"\$V\" -gt \"\$PEAK\" ] && PEAK=\$V; \
    sleep 0.2; done; \
    echo PEAK_VMHWM_KB=\$PEAK; cat run_$MODE.log")
  echo "[$MODE] $LOG" | tr '\n' ' '; echo
  echo "$LOG" | grep -E '^(n_models|pass_row|create_total|vmhwm_|pss_|noise_row|unit|out_shape|dup)' | tr '\n' ' '; echo
}

# pre_mode <sleep_secs>: cooldown + battery/thermal-zone readout, since
# throttling skews the numbers. Best-effort reads (missing zone files must
# not kill the chain under set -eu).
pre_mode() {
  if [ "$1" -gt 0 ]; then
    echo "[thermal] cooling $1 s..."
    sleep "$1"
  fi
  echo "[thermal] $(adb -s "$SERIAL" shell \
    'dumpsys battery | grep temperature' || true)"
  echo "[thermal] max_zone: $(adb -s "$SERIAL" shell \
    'cat /sys/class/thermal/thermal_zone*/temp 2>/dev/null | sort -n | tail -1' \
    || true)"
}

pre_mode 0
run_mode resident
pre_mode 60
run_mode stream

adb -s "$SERIAL" pull "$REMOTE/out_resident.npy" "$OUTDIR/noise_resident.npy" >/dev/null
adb -s "$SERIAL" pull "$REMOTE/out_stream.npy" "$OUTDIR/noise_stream.npy" >/dev/null
echo "pulled outputs -> $OUTDIR/noise_{resident,stream}.npy"
echo "parity (needs only numpy):"
echo "  python -u ml/triposg-mobile/parity/check_step0.py \\"
echo "    $OUTDIR/noise_resident.npy $GOLDEN/step0_noise_pred.npy"
echo "  python -u ml/triposg-mobile/parity/check_step0.py \\"
echo "    $OUTDIR/noise_stream.npy $GOLDEN/step0_noise_pred.npy"
