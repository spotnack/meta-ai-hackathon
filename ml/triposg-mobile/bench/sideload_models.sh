#!/bin/sh
# Sideload the 25 AI Hub units + DINOv2 + u2net + manifest to the app's
# external files dir (no app code needed: getExternalFilesDir is
# world-readable over adb). Run from anywhere (you run this).
#
#   SERIAL=<serial> VERSION=<manifest version> sh ml/triposg-mobile/bench/sideload_models.sh
#
# VERSION must match the manifest built by make_model_manifest.py
# (default v1-fp32-50step; v2-w8a16-50step with AIHUB=.../aihub_w8a16 and
# MANIFEST=.../models_manifest_w8a16.json; v2-fp32-merged-50step with
# MERGED=<merge_chain.py out dir> and MANIFEST=.../models_manifest_merged.json).
# FROM=<dir> pushes an already-assembled version folder as-is (e.g. the
# private laptop copy): VERSION is read from <dir>/models_manifest.json
# and every entry is pushed, so no other mode vars are needed.
# APP_PACKAGE selects the app's external dir (default com.spotnackmuse.ondevice, the APP_VARIANT=ondevice
# local build; the EAS preview build is com.spotnackmuse). The native side
# resolves the same dir via getExternalFilesDir, so no code changes when
# the package or version changes. Pushes ~7 GB (v1) / ~6.9 GB
# (v2-fp32-merged-50step); takes several minutes.
set -eu
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"  # repo root
VERSION="${VERSION:-v1-fp32-50step}"
APP_PACKAGE="${APP_PACKAGE:-com.spotnackmuse.ondevice}"
ADB="${ADB:-adb}"
if [ -n "${SERIAL:-}" ]; then ADB="$ADB -s $SERIAL"; fi
AIHUB="${AIHUB:-$ROOT/ml/triposg-mobile/logs/spike/aihub}"
MANIFEST="${MANIFEST:-$ROOT/ml/triposg-mobile/logs/spike/models_manifest.json}"

if [ -n "${FROM:-}" ]; then
  # Assembled-folder mode: the folder already holds the exact on-phone
  # layout (models_manifest.json + model files). VERSION comes from the
  # manifest so the push cannot land under the wrong version dir.
  [ -f "$FROM/models_manifest.json" ] || {
    echo "MISSING $FROM/models_manifest.json" >&2
    exit 1
  }
  VERSION="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['version'])" "$FROM/models_manifest.json")"
  DEST="/sdcard/Android/data/$APP_PACKAGE/files/triposg/$VERSION"
  $ADB shell "mkdir -p $DEST"
  for entry in "$FROM"/*; do
    $ADB push "$entry" "$DEST/"
  done
  # adb creates these as uid shell (mode rws---); the app runs as its own
  # uid and cannot read them. Grant read/traverse to the app.
  $ADB shell "chmod -R a+rX /sdcard/Android/data/$APP_PACKAGE/files/triposg"
  $ADB shell "ls -la $DEST | head -8; du -sh $DEST"
  exit 0
fi

DEST="/sdcard/Android/data/$APP_PACKAGE/files/triposg/$VERSION"

[ -f "$MANIFEST" ] || {
  echo "MISSING $MANIFEST: run bench/make_model_manifest.py first" >&2
  exit 1
}
$ADB shell "mkdir -p $DEST"
$ADB push "$MANIFEST" "$DEST/models_manifest.json"
if [ -n "${MERGED:-}" ]; then
  # Merged layout: dit_chain.onnx + <stem>/model.bin (no per-unit .onnx).
  $ADB push "$MERGED/dit_chain.onnx" "$DEST/dit_chain.onnx"
  for stem in head $(seq -f "blk%02g" 0 20) tail; do
    $ADB shell "mkdir -p $DEST/$stem"
    $ADB push "$MERGED/$stem/model.bin" "$DEST/$stem/model.bin"
  done
  for stem in vae_post vae_query; do
    $ADB shell "mkdir -p $DEST/$stem"
    $ADB push "$AIHUB/$stem/device/model.onnx" "$DEST/$stem/model.onnx"
    $ADB push "$AIHUB/$stem/device/model.bin" "$DEST/$stem/model.bin"
  done
else
  for stem in head $(seq -f "blk%02g" 0 20) tail vae_post vae_query; do
    $ADB shell "mkdir -p $DEST/$stem"
    $ADB push "$AIHUB/$stem/device/model.onnx" "$DEST/$stem/model.onnx"
    $ADB push "$AIHUB/$stem/device/model.bin" "$DEST/$stem/model.bin"
  done
fi
$ADB push "$ROOT/ml/triposg-mobile/logs/spike/dinov2_encoder.onnx" "$DEST/dinov2_encoder.onnx"
$ADB push "$ROOT/ml/triposg-mobile/pretrained_weights/u2net/u2net.onnx" "$DEST/u2net.onnx"
# adb creates these as uid shell (mode rws---); the app runs as its own uid
# and cannot read them. Grant read/traverse to the app.
$ADB shell "chmod -R a+rX /sdcard/Android/data/$APP_PACKAGE/files/triposg"
$ADB shell "ls -la $DEST | head -8; du -sh $DEST"
