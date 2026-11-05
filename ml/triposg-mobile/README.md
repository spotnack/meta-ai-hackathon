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
