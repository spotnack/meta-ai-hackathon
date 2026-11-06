#!/bin/sh
# Step 5: run the 3-piece transformer chain on the phone with per-piece timing.
# You run this in your own terminal (outside the sandbox).
# Pushes the bench binary, .so, all 3 ONNX pieces (+ .data), and the golden
# step-0 inputs; runs A -> B -> C while sampling VmHWM; pulls the outputs.
# Piece A writes 9 outputs: outA.npy (hidden), outA_1.npy (temb, saved
# but unused downstream — blocks ignore temb), outA_2..8.npy
# (skip_0..skip_6). Requires the multi-output bench binary
# (rebuild with ml/triposg-mobile/bench/ndk/build.sh after the bench.cpp
# change) or the chain stops at A.
# PROVIDER=cpu|qnn (default cpu). qnn uses the QNN EP build (NDKOUT defaults
# to .../out-qnn, see bench/ndk/build.sh ORT_FLAVOR=qnn), pushes the five
# QNN HTP libs from $QNNLIB, and points BACKEND + ADSP_LIBRARY_PATH at the
# remote dir.
# OPT=all|basic (default all) selects the bench graph-optimization level
# (env SPIKE_OPT). A 60 s cooldown + battery/thermal-zone readout precedes
# each piece, since throttling skews the numbers.
# QNN_BACKEND=htp|gpu (default htp) selects the QNN backend for PROVIDER=qnn
# (env only; the bench detects a libQnnGpu.so backend path itself).
set -eu
SERIAL="${ANDROID_SERIAL:-2dd745b1}"
SPLIT="${SPLIT:-ml/triposg-mobile/logs/spike/split}"
GOLDEN="${GOLDEN:-ml/triposg-mobile/reference/goldens_5/hjswed}"
SUFFIX="${SUFFIX:-fp32}"
REMOTE="${REMOTE:-/data/local/tmp/triposg-spike}"
OUTDIR="${OUTDIR:-ml/triposg-mobile/logs/spike/phone_chain_$SUFFIX}"
PROVIDER="${PROVIDER:-cpu}"
case "$PROVIDER" in
  cpu|qnn) ;;
  *) echo "unknown PROVIDER=$PROVIDER (cpu|qnn)"; exit 1 ;;
esac
OPT="${OPT:-all}"
case "$OPT" in
  all|basic) ;;
  *) echo "unknown OPT=$OPT (all|basic)"; exit 1 ;;
esac
QNN_BACKEND="${QNN_BACKEND:-htp}"
case "$QNN_BACKEND" in
  htp|gpu) ;;
  *) echo "unknown QNN_BACKEND=$QNN_BACKEND (htp|gpu)"; exit 1 ;;
esac
# qnn runs use the QNN EP build (NDKOUT defaults to .../out-qnn, see
# bench/ndk/build.sh ORT_FLAVOR=qnn).
if [ -z "${NDKOUT:-}" ]; then
  if [ "$PROVIDER" = "qnn" ]; then
    NDKOUT="ml/triposg-mobile/logs/spike-ndk/out-qnn"
  else
    NDKOUT="ml/triposg-mobile/logs/spike-ndk/out"
  fi
fi
BACKEND="${BACKEND:-/vendor/lib64/libQnnHtp.so}"
ADSP_LIBRARY_PATH="${ADSP_LIBRARY_PATH:-/vendor/lib64}"
# QNN HTP userspace libs (qnn-runtime 2.33.0 extract); pushed to the phone
# on qnn runs so BACKEND/ADSP point at the remote dir, not /vendor.
QNNLIB="${QNNLIB:-ml/triposg-mobile/logs/spike/qnn/extract}"
if [ "$QNN_BACKEND" = "gpu" ]; then
  QNNLIBS="libQnnGpu.so"
  QNNMAIN="libQnnGpu.so"
else
  QNNLIBS="libQnnHtp.so libQnnHtpPrepare.so libQnnHtpV79Stub.so libQnnHtpV79Skel.so libQnnSystem.so"
  QNNMAIN="libQnnHtp.so"
fi
if [ "$PROVIDER" = "qnn" ]; then
  for f in $QNNLIBS; do
    [ -f "$QNNLIB/$f" ] || { echo "MISSING: $QNNLIB/$f"; exit 1; }
  done
  BACKEND="$REMOTE/$QNNMAIN"
  ADSP_LIBRARY_PATH="$REMOTE"
fi
RUNS="${RUNS:-5}"
mkdir -p "$OUTDIR"
for f in "$NDKOUT/build/spike_bench" "$NDKOUT/libonnxruntime.so" \
    "$SPLIT/dit_step_A_$SUFFIX.onnx" "$SPLIT/dit_step_A_$SUFFIX.onnx.data" \
    "$SPLIT/dit_step_B_$SUFFIX.onnx" "$SPLIT/dit_step_B_$SUFFIX.onnx.data" \
    "$SPLIT/dit_step_C_$SUFFIX.onnx" "$SPLIT/dit_step_C_$SUFFIX.onnx.data" \
    "$GOLDEN/step0_latent_model_input.npy" "$GOLDEN/step0_timestep.npy" \
    "$GOLDEN/step0_encoder_hidden_states.npy"; do
  [ -f "$f" ] || { echo "MISSING: $f"; exit 1; }
done
adb -s "$SERIAL" wait-for-device
adb -s "$SERIAL" shell "mkdir -p $REMOTE"
adb -s "$SERIAL" push "$NDKOUT/build/spike_bench" "$REMOTE/" >/dev/null
adb -s "$SERIAL" push "$NDKOUT/libonnxruntime.so" "$REMOTE/" >/dev/null
for p in A B C; do
  adb -s "$SERIAL" push "$SPLIT/dit_step_${p}_$SUFFIX.onnx" \
    "$REMOTE/model$p.onnx" >/dev/null
  # Keep the .data file name: each .onnx records it as its external-data
  # location, and ORT resolves it next to the model.
  adb -s "$SERIAL" push "$SPLIT/dit_step_${p}_$SUFFIX.onnx.data" \
    "$REMOTE/dit_step_${p}_$SUFFIX.onnx.data" >/dev/null
done
adb -s "$SERIAL" push "$GOLDEN/step0_latent_model_input.npy" \
  "$REMOTE/latent.npy" >/dev/null
adb -s "$SERIAL" push "$GOLDEN/step0_timestep.npy" \
  "$REMOTE/timestep.npy" >/dev/null
adb -s "$SERIAL" push "$GOLDEN/step0_encoder_hidden_states.npy" \
  "$REMOTE/enc.npy" >/dev/null
if [ "$PROVIDER" = "qnn" ]; then
  for f in $QNNLIBS; do
    adb -s "$SERIAL" push "$QNNLIB/$f" "$REMOTE/" >/dev/null
  done
fi

# run_piece <tag> <model> <input> <output> <extra...>: one timed bench run,
# peak VmHWM sampled while it runs. Prints the tag + bench timing line.
run_piece() {
  TAG="$1"; MODEL="$2"; INPUT="$3"; OUTPUT="$4"; shift 4
  ARGS="$INPUT $OUTPUT $RUNS $PROVIDER"
  if [ "$PROVIDER" = "qnn" ]; then
    ARGS="$ARGS $BACKEND"
  fi
  for f in "$@"; do
    ARGS="$ARGS $f"
  done
  LOG=$(adb -s "$SERIAL" shell "cd $REMOTE && chmod +x spike_bench && \
    (ADSP_LIBRARY_PATH=\"$ADSP_LIBRARY_PATH\" LD_LIBRARY_PATH=\"$REMOTE\" \
     SPIKE_OPT=\"$OPT\" SPIKE_QNN_OPTS=\"${SPIKE_QNN_OPTS:-}\" \
     ./spike_bench $MODEL $ARGS > run_$TAG.log 2>&1 & \
    echo \$! > pid.txt) && \
    PEAK=0; while kill -0 \$(cat pid.txt) 2>/dev/null; do \
    V=\$(grep VmHWM /proc/\$(cat pid.txt)/status 2>/dev/null | awk '{print \$2}'); \
    [ -n \"\$V\" ] && [ \"\$V\" -gt \"\$PEAK\" ] && PEAK=\$V; \
    sleep 0.2; done; \
    echo PEAK_VMHWM_KB=\$PEAK; cat run_$TAG.log")
  if [ "$PROVIDER" = "qnn" ]; then
    VBASE="$(basename "$OUTPUT" .npy)_ort_verbose.log"
    adb -s "$SERIAL" pull "$REMOTE/$VBASE" "$OUTDIR/${TAG}_ort_verbose.log" \
      >/dev/null 2>&1 || true
  fi
  echo "[$TAG] $LOG" | tr '\n' ' '; echo
  echo "$LOG" | grep -E '^(runs|out_shape|create_ms|vmhwm_warmup_kb|qnn_nodes|qnn_backend|qnn_opts|ort_verbose_log|ep_context|profile)=' | tr '\n' ' '; echo
}

# pre_piece <sleep_secs>: cooldown + thermal readout before each piece, since
# throttling skews the numbers. Reads are best-effort (a missing zone file
# must not kill the chain under set -eu).
pre_piece() {
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

# A: (latent, timestep, enc) -> hidden + temb (unused downstream) + skip_0..6.
pre_piece 0
run_piece A modelA.onnx latent.npy outA.npy timestep.npy enc.npy
# B: (hidden, enc) -> hidden.
pre_piece 60
run_piece B modelB.onnx outA.npy outB.npy enc.npy
# C: (hidden, enc, skip_0..6) -> noise_pred.
pre_piece 60
run_piece C modelC.onnx outB.npy outC.npy enc.npy \
  outA_2.npy outA_3.npy outA_4.npy outA_5.npy outA_6.npy outA_7.npy outA_8.npy

adb -s "$SERIAL" pull "$REMOTE/outC.npy" "$OUTDIR/noise_pred.npy" >/dev/null
adb -s "$SERIAL" pull "$REMOTE/outA.npy" "$OUTDIR/hidden_A.npy" >/dev/null
echo "pulled noise -> $OUTDIR/noise_pred.npy"
echo "parity: ~/anaconda3/envs/triposg-spike/bin/python -u \\"
echo "  ml/triposg-mobile/parity/check_step0.py \\"
echo "  $OUTDIR/noise_pred.npy $GOLDEN/step0_noise_pred.npy"
