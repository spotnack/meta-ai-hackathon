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
