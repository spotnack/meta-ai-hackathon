#!/bin/sh
# Probe ONE block-range model on the phone (QNN-first, CPU optional).
# You run this in your own terminal (outside the sandbox).
# Pushes the bench binary, .so, the probe model (+ .data under its recorded
# name), and the input files; runs once while sampling VmHWM; prints the
# machine lines. The EP context cache (<model>_ctx.onnx) stays on the
# device, so a second run shows the load-from-cache create time and memory.
# Requires the rebuilt bench binary (bench/ndk/build.sh, both flavors).
#
# Examples (paths relative to the repo root, ml/triposg-mobile/ implied):
#   PROVIDER=qnn MODEL=logs/spike/split/dit_blk07_fp16.onnx \
#     INPUT=logs/spike/split/stepA_torch_hidden.npy \
#     EXTRA=reference/goldens_5/hjswed/step0_encoder_hidden_states.npy \
#     bench/spike_adb_probe.sh
#   PROVIDER=qnn MODEL=logs/spike/split/dit_blk14_fp16.onnx \
#     INPUT=logs/spike/split/stepB_torch_hidden.npy \
#     EXTRA="reference/goldens_5/hjswed/step0_encoder_hidden_states.npy \
#       logs/spike/split/stepA_torch_skip_6.npy" \
#     bench/spike_adb_probe.sh
#   PROVIDER=qnn MODEL=logs/spike/split/dit_head_blk00_fp16.onnx \
#     INPUT=reference/goldens_5/hjswed/step0_latent_model_input.npy \
#     EXTRA="reference/goldens_5/hjswed/step0_timestep.npy \
#       reference/goldens_5/hjswed/step0_encoder_hidden_states.npy" \
#     bench/spike_adb_probe.sh
# Batch-1 probes use row-0-sliced inputs (parity/slice_batch.py) and _b1 models:
#   PROVIDER=qnn MODEL=logs/spike/split/dit_blk07_b1_fp16.onnx \
#     INPUT=logs/spike/split/stepA_torch_hidden_b1.npy \
#     EXTRA=reference/goldens_5/hjswed/step0_encoder_hidden_states_b1.npy \
#     bench/spike_adb_probe.sh
# QNN_BACKEND=htp|gpu (default htp) selects the QNN backend (env only; the
# bench detects a libQnnGpu.so backend path itself). SPIKE_QNN_OPTS passes
# extra QNN provider options, e.g. htp_graph_finalization_optimization_mode=1.
set -eu
SERIAL="${ANDROID_SERIAL:-2dd745b1}"
SPLIT="${SPLIT:-ml/triposg-mobile/logs/spike/split}"
GOLDEN="${GOLDEN:-ml/triposg-mobile/reference/goldens_5/hjswed}"
PROVIDER="${PROVIDER:-qnn}"
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
# qnn runs use the QNN EP build (see bench/ndk/build.sh ORT_FLAVOR=qnn).
if [ -z "${NDKOUT:-}" ]; then
  if [ "$PROVIDER" = "qnn" ]; then
    NDKOUT="ml/triposg-mobile/logs/spike-ndk/out-qnn"
  else
    NDKOUT="ml/triposg-mobile/logs/spike-ndk/out"
  fi
fi
REMOTE="${REMOTE:-/data/local/tmp/triposg-spike}"
OUTDIR="${OUTDIR:-ml/triposg-mobile/logs/spike/phone_probe}"
MODEL="${MODEL:-$SPLIT/dit_blk07_fp16.onnx}"
INPUT="${INPUT:-$SPLIT/stepA_torch_hidden.npy}"
OUTPUT="${OUTPUT:-$OUTDIR/probe_out.npy}"
EXTRA="${EXTRA:-$GOLDEN/step0_encoder_hidden_states.npy}"
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
RUNS="${RUNS:-3}"
mkdir -p "$OUTDIR"
for f in "$NDKOUT/build/spike_bench" "$NDKOUT/libonnxruntime.so" \
    "$MODEL" "$MODEL.data" "$INPUT"; do
  [ -f "$f" ] || { echo "MISSING: $f"; exit 1; }
done
for f in $EXTRA; do
  [ -f "$f" ] || { echo "MISSING: $f"; exit 1; }
done
adb -s "$SERIAL" wait-for-device
adb -s "$SERIAL" shell "mkdir -p $REMOTE"
adb -s "$SERIAL" push "$NDKOUT/build/spike_bench" "$REMOTE/" >/dev/null
adb -s "$SERIAL" push "$NDKOUT/libonnxruntime.so" "$REMOTE/" >/dev/null
# Keep the model's own basename: the .onnx records <stem>.onnx.data as its
# external-data location, and ORT resolves it next to the model.
MBASE="$(basename "$MODEL")"
adb -s "$SERIAL" push "$MODEL" "$REMOTE/$MBASE" >/dev/null
adb -s "$SERIAL" push "$MODEL.data" "$REMOTE/$MBASE.data" >/dev/null
adb -s "$SERIAL" push "$INPUT" "$REMOTE/input.npy" >/dev/null
i=0
for f in $EXTRA; do
  i=$((i + 1))
  adb -s "$SERIAL" push "$f" "$REMOTE/extra$i.npy" >/dev/null
done
if [ "$PROVIDER" = "qnn" ]; then
  for f in $QNNLIBS; do
    adb -s "$SERIAL" push "$QNNLIB/$f" "$REMOTE/" >/dev/null
  done
fi

ARGS="input.npy out.npy $RUNS $PROVIDER"
if [ "$PROVIDER" = "qnn" ]; then
  ARGS="$ARGS $BACKEND"
fi
i=0
for f in $EXTRA; do
  i=$((i + 1))
  ARGS="$ARGS extra$i.npy"
done
LOG=$(adb -s "$SERIAL" shell "cd $REMOTE && chmod +x spike_bench && \
  (ADSP_LIBRARY_PATH=\"$ADSP_LIBRARY_PATH\" LD_LIBRARY_PATH=\"$REMOTE\" \
   SPIKE_OPT=\"$OPT\" SPIKE_QNN_OPTS=\"${SPIKE_QNN_OPTS:-}\" \
   ./spike_bench $MBASE $ARGS > run_probe.log 2>&1 & \
  echo \$! > pid.txt) && \
  PEAK=0; while kill -0 \$(cat pid.txt) 2>/dev/null; do \
  V=\$(grep VmHWM /proc/\$(cat pid.txt)/status 2>/dev/null | awk '{print \$2}'); \
  [ -n \"\$V\" ] && [ \"\$V\" -gt \"\$PEAK\" ] && PEAK=\$V; \
  sleep 0.2; done; \
  echo PEAK_VMHWM_KB=\$PEAK; cat run_probe.log")
if [ "$PROVIDER" = "qnn" ]; then
  VBASE="out_ort_verbose.log"
  adb -s "$SERIAL" pull "$REMOTE/$VBASE" "$OUTDIR/probe_ort_verbose.log" \
    >/dev/null 2>&1 || true
fi
echo "[probe] $LOG" | tr '\n' ' '; echo
echo "$LOG" | grep -E '^(runs|out_shape|create_ms|vmhwm_warmup_kb|qnn_nodes|qnn_backend|qnn_opts|ort_verbose_log|ep_context|profile)=' | tr '\n' ' '; echo
adb -s "$SERIAL" pull "$REMOTE/out.npy" "$OUTPUT" >/dev/null
echo "pulled output -> $OUTPUT"
echo "re-run to compare create_ms/VmHWM with the EP context cache in place"
