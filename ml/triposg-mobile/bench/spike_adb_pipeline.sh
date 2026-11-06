#!/bin/sh
# Full TripoSG pipeline on the phone NPU: rectified-flow sampling loop over
# the 23 resident transformer units, vae_post + vae_query, octree
# extraction, marching tetrahedra, GLB output.
#
# Env (defaults shown): SERIAL=<adb serial, required>, STEPS=20, D0=6,
# D1=7, NDKOUT=logs/spike-ndk/out-qnn129, ORT_AAR override for the AAR,
# RUNS is unused (single sampling run), OUTDIR=logs/spike/phone_pipeline.
# The 23 transformer units are already on the phone from the chain runs;
# only the new binary, the 2 VAE units and the inputs are pushed.
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"  # ml/triposg-mobile
SERIAL="${SERIAL:?set SERIAL to the adb device serial}"
STEPS="${STEPS:-20}"
D0="${D0:-6}"
D1="${D1:-7}"
REMOTE=/data/local/tmp/triposg-chain
AIHUB="$ROOT/logs/spike/aihub"
B1="$ROOT/logs/spike/b1"
NDKOUT="${NDKOUT:-$ROOT/logs/spike-ndk/out-qnn129}"
OUTDIR="${OUTDIR:-$ROOT/logs/spike/phone_pipeline}"
# qnn-runtime 2.50 HTP libs already pushed to $REMOTE by spike_adb_chain_npu.sh
# (the AI Hub bins need QAIRT 2.50, not the vendor libQnnHtp).
BACKEND="$REMOTE/libQnnHtp.so"

BIN="$NDKOUT/build/spike_pipeline"
SO="$NDKOUT/libonnxruntime.so"
[ -x "$BIN" ] || { echo "MISSING BINARY: build it first:" >&2;
  echo "  ORT_FLAVOR=qnn ORT_AAR=<qnn-1.29-aar> NDKOUT=$NDKOUT bench/ndk/build.sh" >&2;
  echo "  (run from $ROOT/ml/triposg-mobile)" >&2; exit 1; }
[ -f "$SO" ] || { echo "MISSING $SO (same build)" >&2; exit 1; }
for u in vae_post vae_query; do
  [ -f "$AIHUB/$u/device/model.onnx" ] || { echo "MISSING $AIHUB/$u/device/model.onnx" >&2;
    echo "  compile it: python -u bench/aihub_compile.py --stems $u --profile" >&2;
    echo "  (run from $ROOT/ml/triposg-mobile)" >&2; exit 1; }
done
# Chain inputs (written by split_export_step.py --all-b1; older exports
# only have the per-unit dit_* copies, which are the same tensors).
# spike_pipeline reads latent_r0 (initial noise) + enc_r1 (cond states).
for pair in "latent_r0:dit_head_in_hidden_states_r0" \
           "enc_r1:dit_blk00_in_encoder_hidden_states_r1"; do
  name="${pair%%:*}"
  fallback="${pair##*:}"
  if [ ! -f "$B1/$name.npy" ]; then
    if [ -f "$B1/$fallback.npy" ]; then
      echo "copying $fallback.npy -> $name.npy (same tensor, pre-alias export)"
      cp "$B1/$fallback.npy" "$B1/$name.npy"
    else
      echo "MISSING $B1/$name.npy (and fallback $fallback.npy)" >&2; exit 1
    fi
  fi
done
adb -s "$SERIAL" shell "ls $REMOTE/models_b1.txt" >/dev/null || {
  echo "MISSING $REMOTE/models_b1.txt: push the 23 units first (see spike_adb_chain_npu.sh)" >&2; exit 1; }

# ID selects the golden image (default hjswed). Inputs are sliced from the
# golden step-0 tensors: initial noise = latent_model_input row 0, cond
# states = encoder_hidden_states row 1 (row 0 is the zero uncond).
ID="${ID:-hjswed}"
PY="${PY:-$HOME/anaconda3/envs/triposg-spike/bin/python}"
GOLD="$ROOT/reference/goldens_5/$ID"
IDIR="$OUTDIR/in_$ID"
mkdir -p "$IDIR" "$OUTDIR/$ID"
if [ "$ID" = "hjswed" ]; then
  cp "$B1/latent_r0.npy" "$IDIR/"
  cp "$B1/enc_r1.npy" "$IDIR/"
else
  [ -f "$GOLD/step0_latent_model_input.npy" ] || { echo "MISSING $GOLD" >&2; exit 1; }
  "$PY" -c "import numpy as np, sys; g, o = sys.argv[1], sys.argv[2]
np.save(o + '/latent_r0.npy', np.ascontiguousarray(np.load(g + '/step0_latent_model_input.npy')[0:1].astype(np.float32)))
np.save(o + '/enc_r1.npy', np.ascontiguousarray(np.load(g + '/step0_encoder_hidden_states.npy')[1:2].astype(np.float32)))" "$GOLD" "$IDIR"
fi

adb -s "$SERIAL" shell "mkdir -p $REMOTE/pipe_in $REMOTE/pipe_out $REMOTE/vae_post $REMOTE/vae_query" >/dev/null
adb -s "$SERIAL" push "$BIN" "$REMOTE/spike_pipeline" >/dev/null
adb -s "$SERIAL" push "$SO" "$REMOTE/" >/dev/null
adb -s "$SERIAL" push "$AIHUB/vae_post/device/model.onnx" "$REMOTE/vae_post/model.onnx" >/dev/null
adb -s "$SERIAL" push "$AIHUB/vae_post/device/model.bin" "$REMOTE/vae_post/model.bin" >/dev/null
adb -s "$SERIAL" push "$AIHUB/vae_query/device/model.onnx" "$REMOTE/vae_query/model.onnx" >/dev/null
adb -s "$SERIAL" push "$AIHUB/vae_query/device/model.bin" "$REMOTE/vae_query/model.bin" >/dev/null
adb -s "$SERIAL" push "$IDIR/latent_r0.npy" "$REMOTE/pipe_in/latent_r0.npy" >/dev/null
adb -s "$SERIAL" push "$IDIR/enc_r1.npy" "$REMOTE/pipe_in/enc_r1.npy" >/dev/null

adb -s "$SERIAL" shell "mkdir -p $REMOTE/pipe_in $REMOTE/pipe_out && \
  cd $REMOTE && LD_LIBRARY_PATH=$REMOTE ADSP_LIBRARY_PATH=$REMOTE \
  ./spike_pipeline models_b1.txt vae_post/model.onnx vae_query/model.onnx pipe_in pipe_out $STEPS $D0 $D1 $BACKEND" \
  2>&1 | tee "$OUTDIR/pipeline_steps${STEPS}_d${D0}${D1}.log"
adb -s "$SERIAL" pull "$REMOTE/pipe_out/mesh.glb" "$OUTDIR/$ID/mesh.glb" >/dev/null
adb -s "$SERIAL" pull "$REMOTE/pipe_out/final_latents.npy" "$OUTDIR/$ID/final_latents.npy" >/dev/null
echo "pulled mesh.glb + final_latents.npy -> $OUTDIR/$ID/"
echo "grade (expect FAIL at reduced steps/depths until ablations land):"
echo "  ~/anaconda3/envs/triposg-spike/bin/python -u ml/triposg-mobile/parity/run_phase1.py --candidate-dir $OUTDIR"
