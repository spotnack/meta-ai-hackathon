# triposg-mobile tooling

Dedicated home for TripoSG conversion, parity, and benchmark tooling. Kept at
the repo root (not under `client/`) so Metro never watches weights or logs.

- `audit/` — Phase 0 claim notes and source log (this checkpoint).
- `eval/` — fixed image set + manifest (Phase 1).
- `reference/` — golden tensors/meshes; large artifacts git-ignored, only
  manifest + hashes committed (Phase 1).
- `parity/` — parity harness + thresholds, set before optimizing (Phase 1).
- `conversion/` — per-runtime conversion scripts (Phase 2).
- `bench/` + `logs/` — on-device benchmark scripts and raw logs (Phase 2).
- `cpp/` — portable extraction/marching/GLB core + host tests (Phases 2–3;
  the Expo module builds this same copy).

Rules: no file over 10 MB in git; weights, tensors, and large logs stay
git-ignored. Conversion deps get pinned in `src/spotnack-muse/environment.yml`.

## Setup (from the repo root, you run this)

```sh
conda env update -n spotnack-muse --file src/spotnack-muse/environment.yml --prune
git clone https://github.com/VAST-AI-Research/TripoSG.git ~/.cache/triposg/TripoSG
git -C ~/.cache/triposg/TripoSG checkout fc5c40990181e2a756c4e0b1c2f4d6b5202faf8c
```

(`environment.yml` also pins the CUDA torch stack for export work; the
parity/probe commands below run with the `triposg-spike` interpreter and
need only numpy/scipy/trimesh/matplotlib from it.)

The golden-reference notebook (`reference/triposg_golden_5.ipynb`) runs on a
Colab GPU runtime (≥8 GB VRAM) and installs its own packages in its first
cell — nothing from it goes into the laptop env. Unzip the resulting
`goldens_5.zip` over `reference/goldens_5/` (only `report.json` is committed;
tensors/meshes are git-ignored).

## Run (from the repo root, you run this)

Phase 1 reference + parity, all 5 eval ids (verifies golden hashes, runs
the decimation + resampling mesh baselines, writes the report):

```sh
~/anaconda3/envs/triposg-spike/bin/python -u ml/triposg-mobile/parity/run_phase1.py
```

Later phases grade candidates against the same goldens with
`--candidate-dir <dir>` (same per-id layout, any subset of files); the same
table is written to `logs/phase1/phase1_report.{json,md}`.

Focused checks:

```sh
~/anaconda3/envs/triposg-spike/bin/python -m pytest ml/triposg-mobile/parity/test_parity.py
~/anaconda3/envs/triposg-spike/bin/python -u ml/triposg-mobile/parity/check_step0.py OUT.npy GOLDEN.npy
~/anaconda3/envs/triposg-spike/bin/python -u ml/triposg-mobile/parity/mesh_parity.py CAND.glb REF.glb --json out.json
```

## Reproduce Phase 2 (from the repo root, you run this)

Transformer units first (one process each, laptop, 8 GiB anon cap —
`export_all_b1.log` shows the pattern; `split_export_step.py --all-b1`
writes `logs/spike/b1/`), then the VAE:

```sh
systemd-run --user --scope -p MemoryMax=9G -p MemorySwapMax=0 ~/anaconda3/envs/triposg-spike/bin/python -u ml/triposg-mobile/bench/export_vae.py --unit flash-check
systemd-run --user --scope -p MemoryMax=9G -p MemorySwapMax=0 ~/anaconda3/envs/triposg-spike/bin/python -u ml/triposg-mobile/bench/export_vae.py --unit post
systemd-run --user --scope -p MemoryMax=9G -p MemorySwapMax=0 ~/anaconda3/envs/triposg-spike/bin/python -u ml/triposg-mobile/bench/export_vae.py --unit query
~/anaconda3/envs/triposg-spike/bin/python -u ml/triposg-mobile/bench/aihub_compile.py --stems vae_post,vae_query --profile
```

(The 23 transformer units compile the same way with the default stems;
see `bench/aihub_compile.py --help`. Needs the QAI_HUB API token.)

Laptop host test of the C++ core (heavy: ~515 MiB final grid at d1=9),
then grade vs the golden mesh:

```sh
cmake -S ml/triposg-mobile/cpp/test -B /tmp/vae-test-build && cmake --build /tmp/vae-test-build -j4
systemd-run --user --scope -p MemoryMax=9G -p MemorySwapMax=0 /tmp/vae-test-build/test_vae_decode ml/triposg-mobile/reference/goldens_5/hjswed/final_latents.npy ml/triposg-mobile/logs/spike/vae/vae_post_fp32.onnx ml/triposg-mobile/logs/spike/vae/vae_query_fp32.onnx /tmp/vae-test-out 6 9
mkdir -p /tmp/cand/hjswed && cp /tmp/vae-test-out/mesh.glb /tmp/cand/hjswed/mesh.glb
~/anaconda3/envs/triposg-spike/bin/python -u ml/triposg-mobile/parity/run_phase1.py --candidate-dir /tmp/cand
```

Phone pipeline (23 units already on the phone; pushes only the new
binary, the 2 VAE units and the inputs; heavy — minutes on-device):

```sh
cd ml/triposg-mobile && ORT_FLAVOR=qnn ORT_AAR=<qnn-1.29-aar> NDKOUT=logs/spike-ndk/out-qnn129 bench/ndk/build.sh && cd ../..
SERIAL=<serial> STEPS=50 D0=6 D1=8 sh ml/triposg-mobile/bench/spike_adb_pipeline.sh
```

Results and the recommended configuration live in `eval/summary.md`,
per-component evidence in `eval/matrix.md`, raw logs in `logs/phase2/`.

### w8a16 DiT (NPU-memory follow-up)

The FP32 chain pins ~9 GB of unswappable DMA-BUF and HyperOS kills the
app for it (see `docs/ai_pipeline_logs.md` "NPU memory"). The quantized chain
(int8 weights / uint16 activations, VAE stays FP32) targets ≲ 3 GB with
the same 50-step mesh gate. Capture is the only heavy laptop job
(~0.5–1.5 h per golden); quantization + compile are light:

```sh
systemd-run --user --scope -p MemoryMax=9G -p MemorySwapMax=0 ~/anaconda3/envs/triposg-spike/bin/python -u ml/triposg-mobile/bench/capture_calib.py
~/anaconda3/envs/triposg-spike/bin/python -u ml/triposg-mobile/bench/quantize_units.py
~/anaconda3/envs/triposg-spike/bin/python -m pytest ml/triposg-mobile/bench/test_aihub_compile.py
~/anaconda3/envs/triposg-spike/bin/python -u ml/triposg-mobile/bench/aihub_compile.py --variant w8a16
```

Phone (needs the QAI_HUB token for the compile; the rest is adb):

```sh
AIHUB=ml/triposg-mobile/logs/spike/aihub_w8a16 REMOTE=/data/local/tmp/triposg-chain-w8a16 sh ml/triposg-mobile/bench/spike_adb_chain_npu.sh
SERIAL=<serial> REMOTE=/data/local/tmp/triposg-chain-w8a16 sh ml/triposg-mobile/bench/spike_adb_dmabuf.sh
SERIAL=<serial> STEPS=50 D0=6 D1=8 REMOTE=/data/local/tmp/triposg-chain-w8a16 sh ml/triposg-mobile/bench/spike_adb_pipeline.sh
```

Release as model version `v2-w8a16-50step` (no app code change: the native
side discovers version dirs by manifest, the JS version is manifest data):

```sh
~/anaconda3/envs/triposg-spike/bin/python ml/triposg-mobile/bench/make_model_manifest.py --version v2-w8a16-50step --aihub-manifest ml/triposg-mobile/logs/spike/aihub_w8a16/manifest_w8a16.json --out ml/triposg-mobile/logs/spike/models_manifest_w8a16.json --js-out src/spotnack-muse/client/src/features/image-to-3d/infrastructure/triposg-models.manifest.js
SERIAL=<serial> VERSION=v2-w8a16-50step AIHUB=ml/triposg-mobile/logs/spike/aihub_w8a16 MANIFEST=ml/triposg-mobile/logs/spike/models_manifest_w8a16.json sh ml/triposg-mobile/bench/sideload_models.sh
```

### Merged FP32 chain (shipping, `v2-fp32-merged-50step`)

w8a16 concluded not worth it (saves only ~0.5 GB: the runlist grows to
133 MB and spill-fill to ~210 MB per block; 15% slower plus quality
risk — see `docs/ai_pipeline_logs.md` "One merged NPU session"). FP16 does
not help either (QNN still pins 245 MB of weights per block). Instead,
one FP32 session shares a single spill-fill buffer: 9.0 GB → **7.14 GB**
peak DMA-BUF, row pass 2.07 s → ~1.6 s, bit-identical output. Recipe
(`aihub_compile.py` fp32 output → merge → manifest → sideload):

```sh
~/anaconda3/envs/triposg-spike/bin/python -u ml/triposg-mobile/bench/aihub_compile.py
~/anaconda3/envs/triposg-spike/bin/python -u ml/triposg-mobile/bench/merge_chain.py ml/triposg-mobile/logs/spike/aihub ml/triposg-mobile/logs/spike/merged/fp32
~/anaconda3/envs/triposg-spike/bin/python -m pytest ml/triposg-mobile/bench/test_make_model_manifest.py
~/anaconda3/envs/triposg-spike/bin/python ml/triposg-mobile/bench/make_model_manifest.py --version v2-fp32-merged-50step --merged-dir ml/triposg-mobile/logs/spike/merged/fp32 --out ml/triposg-mobile/logs/spike/models_manifest_merged.json --js-out src/spotnack-muse/client/src/features/image-to-3d/infrastructure/triposg-models.manifest.js
SERIAL=<serial> VERSION=v2-fp32-merged-50step MERGED=ml/triposg-mobile/logs/spike/merged/fp32 MANIFEST=ml/triposg-mobile/logs/spike/models_manifest_merged.json sh ml/triposg-mobile/bench/sideload_models.sh
```

The app runs merged mode automatically when the version dir holds
`dit_chain.onnx` (v1 dirs keep the 23-session fallback, no rebuild
needed to go back).

## Reproduce Phase 3A (from the repo root, you run this)

Front-end parity (u2net CPU + prepare_image + DINOv2 preprocessing vs
the 5 goldens; light — 176 MB u2net + laptop ORT):

```sh
~/anaconda3/envs/triposg-spike/bin/python ml/triposg-mobile/cpp/test/prep_preprocess_inputs.py
~/anaconda3/envs/triposg-spike/bin/python ml/triposg-mobile/cpp/test/make_preprocess_refs.py
cmake -S ml/triposg-mobile/cpp/test -B /tmp/pre-test-build && cmake --build /tmp/pre-test-build -j4 --target test_preprocess
/tmp/pre-test-build/test_preprocess ml/triposg-mobile/cpp/test/data ml/triposg-mobile/pretrained_weights/u2net/u2net.onnx /tmp/pre-test-out
~/anaconda3/envs/triposg-spike/bin/python ml/triposg-mobile/cpp/test/check_preprocess.py /tmp/pre-test-out
```

(`make_preprocess_refs.py` runs TripoSG's real `load_image` + the
transformers `BitImageProcessor` on CPU to build the bit-exact stage
references under `cpp/test/data/refs/`; the checker grades the C++
outputs against those plus the goldens.)

Model manifest + sideload (~7 GB hashed, then pushed over adb).
`--js-out` also emits the GENERATED manifest copy the app bundles
(`triposg-models.manifest.js`, 7,696 bytes for the 52 files) — rerun it
whenever the weights change:

```sh
~/anaconda3/envs/triposg-spike/bin/python ml/triposg-mobile/bench/make_model_manifest.py \
  --js-out src/spotnack-muse/client/src/features/image-to-3d/infrastructure/triposg-models.manifest.js
SERIAL=<serial> sh ml/triposg-mobile/bench/sideload_models.sh
```

In-app download instead of sideload: serve the model files over HTTP as
`<base>/<version>/<path>` (the manifest's relative paths, e.g.
`<base>/v1-fp32-50step/head/model.bin`) with Range support, and set
`EXPO_PUBLIC_TRIPOSG_MODEL_BASE_URL=<base>` (see `client/.env.example`).
The app downloads with per-file resume + SHA-256 into the same external
dir the sideload uses, so both flows are interchangeable.

Sideload notes (measured): the script runs from the repo root and fixes
permissions on-device (`chmod -R a+rX .../files/triposg`), without which
the app cannot read its own external dir. `run-as` cannot inspect
`/storage/emulated` (no app mount namespace) — verify external-dir
access from the app itself: `getStatus` logs the root listing and the
size-check result under logcat tag `TripoSG`.

App build (needs the vendored meshoptimizer first — see
`client/modules/triposg/cpp/third_party/meshoptimizer/README.md`):

```sh
cd src/spotnack-muse/client && yarn install
adb push <photo.png> /sdcard/Download/triposg-test.png
APP_VARIANT=ondevice npx expo prebuild -p android
APP_VARIANT=ondevice npx expo run:android --variant release
```

(`APP_VARIANT=ondevice` switches the package to
`com.spotnackmuse.ondevice` via `app.config.js`, so the test build
installs next to the preview build without uninstalling it. Without the
env var the config is exactly `app.json`.)

Then trigger a conversion without the UI (the `/dev-triposg` route is
deleted; the debug receiver replaced it) and read `adb logcat` for the
`TripoSG` / `TripoSGDebug` lines. Lint/typecheck the JS: `yarn lint`
and `npx tsc --noEmit` from `client/`.

## Reproduce Phase 4 (from the repo root, you run this)

Golden-noise parity of the app's own C++ core vs the 5 GPU goldens.
Needs a debuggable build (the receiver refuses otherwise) — no
hand-editing of `android/`, set the env var for prebuild:

```sh
cd src/spotnack-muse/client && yarn install
TRIPOSG_DEBUGGABLE=1 APP_VARIANT=ondevice npx expo prebuild -p android
TRIPOSG_DEBUGGABLE=1 APP_VARIANT=ondevice npx expo run:android --variant release
```

Then, per golden id. The receiver takes a batch-1 (1,2048,64) float32
`.npy`; slice it from row 0 of the golden's batch-2
`step0_latent_model_input.npy` (the same row Phase 2 seeds from) and
push it to the device first:

```sh
~/anaconda3/envs/triposg-spike/bin/python -c "import numpy as np; np.save('/tmp/noise_<id>.npy', np.load('ml/triposg-mobile/reference/goldens_5/<id>/step0_latent_model_input.npy')[0:1])"
adb push /tmp/noise_<id>.npy /sdcard/Download/noise_<id>.npy
adb shell am broadcast -a expo.modules.triposg.DEBUG_CONVERT -e noise /sdcard/Download/noise_<id>.npy -e tag <id>
adb logcat -s TripoSGDebug   # one TIMINGS line at DONE
```

Pull each run's `mesh.glb` + `mesh.display.glb` out of the app cache
`triposg/debug/<id>/` (e.g. via `run-as` on the debuggable build)
into `<cand>/<id>/`, then grade:

```sh
~/anaconda3/envs/triposg-spike/bin/python -u ml/triposg-mobile/parity/run_phase1.py --candidate-dir <cand>
```

Phase 4 result: OVERALL PASS on all 5 ids for both meshes
(`logs/phase4/parity_inapp_core/phase1_report.md`). The 5 runs were
back to back, so expect thermal drift in the totals (≈177 s cool,
≈233 s warm).
