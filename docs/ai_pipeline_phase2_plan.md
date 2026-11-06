# AI Pipeline Phase 2 Plan — Transformer One-Step Export + Phone Benchmark

Branch: `on-device-pipeline`. `main` is untouched. No commits from me; you commit.
No downloads over 2 GB and no new dependencies without your OK. Long jobs use
`python -u` (or `flush=True`) and log peak RSS.

Scope: To Do items 1–3 only (one guided transformer step: split export,
parity, phone CPU/QNN benchmark, latency decision table). VAE/decoder and
in-app wiring are out of scope.

Route change: no Modal (no card, $1 credit). `bench/modal_export_step.py`
stays as an unused alternative and is not extended. The export runs on the
laptop as 3 FP32 pieces — an explicit exception to the no-heavy-jobs rule,
with a hard 8 GiB peak-RSS cap per process (enforced by a watchdog thread).

## 0. Starting facts (not re-derived)

- Goldens: `ml/triposg-mobile/reference/goldens_5/hjswed/` holds FP32
  `step0_latent_model_input.npy` (2, 2048, 64), `step0_timestep.npy` (2,),
  `step0_encoder_hidden_states.npy` (2, 257, 1024; row 0 = **uncond** (zero
  encoder states), row 1 = **cond** (real DINOv2)), `step0_noise_pred.npy`
  (2, 2048, 64). ≈34 MB per id. (Corrected 2026-11-05: verified by
  `absmax` — row 0 enc is all zeros, row 1 peaks at ≈17.8. The earlier
  revision had the rows swapped.)
- FP32 weights are on the laptop:
  `pretrained_weights/transformer/diffusion_pytorch_model.safetensors`
  (5,758,280,104 bytes). Weights revision pinned to the goldens:
  `2c1c516d22d58db486a058d98d31bb6177344e06`.
- Forward wiring (verified by reading `TripoSGDiTModel.forward` at fc5c4099,
  not from memory): `time_embed` is a stateless `Timesteps` (zero checkpoint
  keys — nothing to materialise); `time_proj` → unsqueeze(1); `proj_in`
  (2,2048,64) → (2,2048,2048); `cat([temb, hidden])` → (2,2049,2048), temb as
  token 0. With `num_layers=21` (MID=10): layers 0–9 push, layer 10 is mid,
  layers 11–20 pop 9…0. Output tail: `norm_out` → `[:, -2048:]` (temb token
  dropped) → `proj_out` → (2,2048,64).
- Per-piece FP32 weight sizes (measured from the safetensors header):
  A (embed + blocks 0–6) 1.90 GB, B (blocks 7–13) 1.86 GB,
  C (blocks 14–20 + out) 2.00 GB. Every key is accounted for.
- `bench/ndk/bench.cpp` now writes **all** outputs (`out.npy` for the first,
  `<stem>_<i>.npy` for the rest) and prints `n_out`. Single-output models are
  unaffected, but the bench binary must be rebuilt (`bench/ndk/build.sh`).

## 1. Split FP32 export on the laptop (8 GiB cap per process)

Script: `ml/triposg-mobile/bench/split_export_step.py` (written, not run).
One piece per process, run as e.g.
`systemd-run --user --scope -p MemoryMax=9G -p MemorySwapMax=0 python -u bench/split_export_step.py --piece A`
from `ml/triposg-mobile/`: meta-device model, materialise only
that piece's `blocks.{i}.*` (+ embed/out) modules from the safetensors mmap,
watchdog aborts above 8 GiB anon RSS (`bench/memwatch.py`, shared with parity),
peak_anon logged per stage.

- **Piece A:** time_embed/time_proj/proj_in/concat + blocks 0–6 (push
  skip_0…6). In: hidden_states (2,2048,64), timestep (2,),
  encoder_hidden_states (2,257,1024). Out: hidden (2,2049,2048), temb
  (2,1,2048), skip_0…6 (temb output is saved but unused downstream —
  `TripoSGDiTBlock.forward` takes temb but never uses it, verified fc5c4099;
  the time embedding enters only as token 0 of hidden via A's concat).
- **Piece B:** blocks 7–13 (push 7–9, mid 10, pop 9/8/7 inside B). In: hidden,
  encoder_hidden_states. Out: hidden.
- **Piece C:** blocks 14–20 (pop skip_6…skip_0) + norm_out/slice/proj_out.
  In: hidden, encoder_hidden_states, skip_0…6. Out: noise_pred.
- Each run first runs its piece in torch FP32 on the previous piece's saved
  outputs (goldens for A), saves reference `.npy` in `logs/spike/split/`,
  exports `dit_step_{A,B,C}_fp32.onnx` with single-file external data, checks
  ORT FP32 vs the torch outputs (fail above rel-L2 1e-4), then frees everything.
- Expected per piece: ≈5–10 min, peak ≈4–6 GiB (weights ≈2 GB + trace
  activations + ORT arena), all under the cap. First run calibrates.
- Parity: `parity/check_split.py` chains ORT A→B→C on the goldens (one
  session at a time — each piece runs in a `run_piece` helper so the session
  is unreachable on return; A's temb and hidden are freed once consumed) and
  applies the gate — cosine ≥ 0.999 and rel-L2 ≤ 1e-2
  vs `step0_noise_pred.npy` — to both the ORT chain and the saved chained
  torch C output. Exit 0 pass, 1 fail. Report: `split_report_fp32.json`.
  Run it under the same `systemd-run … MemoryMax=9G … MemorySwapMax=0` prefix.
- Every heavy laptop job runs under that `systemd-run` prefix so the kernel
  kills only the job (not the desktop) on overflow — added after the
  2026-11-05 OOM, when `check_split.py` held two ORT sessions alive at once
  (anon-rss 10.46 GB) and froze the laptop.

## 2. Phone benchmark: 3-piece chain, CPU first, then QNN (HTP)

Script: `ml/triposg-mobile/bench/spike_adb_chain.sh` (written, not run).
Pushes the rebuilt bench binary, all 3 ONNX pieces (+ `.data`, auto-pushed by
`spike_adb_bench.sh` for single runs too) and the golden step-0 inputs; runs
A → B → C with per-piece median/p90 and chain-wide peak VmHWM; pulls the
final noise plus A's intermediates.

- CPU run first (`PROVIDER=cpu`, defaults); parity via `check_step0.py`
  against `step0_noise_pred.npy` with the same gate.
- QNN run (`PROVIDER=qnn BACKEND=… ADSP_LIBRARY_PATH=…`): Maven
  `com.qualcomm.qti:qnn-runtime:2.33.0` (pinned by ORT 1.22.0's POM),
  AAR 42,416,342 bytes (≈40.5 MB), **Qualcomm AI Hub Model License**
  (proprietary). Push `libQnnHtp.so` + `libQnnSystem.so` (+ v79 stub/skel if
  present — confirm with `unzip -l`) to `/data/local/tmp/triposg-spike/`.
  No full QAIRT SDK.
- If the HTP session fails to build on the single-file pieces… there are no
  single-file pieces anymore: the 3-way split IS the graph-size contingency.
  If a piece still fails, the fallback is splitting that piece further (same
  script pattern) — decided only on the actual error.

## 3. Decision table: per-step latency × steps → total

Rows are measured per-piece `median_ms` (CPU fp32, CPU fp16, QNN fp16) summed
for one step; columns are total = per-step × N for N in {10, 20, 30} (your
Colab re-runs). Target: **≤ 2 min of sampling on the phone** — the table turns
that into pass/fail per row once filled.

| Lever | What changes | How it is checked against goldens |
| --- | --- | --- |
| Fewer steps (30/20/10) | Total = per-step × N | Your re-run cells (§5) save `final_latents_{N}.npy` + `mesh_{N}.glb`; `parity/mesh_parity.py` reports Chamfer + F-score vs the 50-step `mesh.glb`. |
| Guidance off | Batch 2 → 1 | Only if the cloud comparison (guidance=1.0 arm in §5 cells) shows acceptable mesh parity. Separate batch-1 split export; decided after numbers land. |
| INT8 | Later | Only if FP16 phone peak/latency fails. Method TBD then. |
| FP32 CPU fallback | Ship CPU-only if QNN fails | The FP32 chain row *is* this option. |
| FP16 | ~half the weights traffic | Conversion is per piece (`--fp16`, `keep_io_types=True`). Try the ORT FP16 chain on the laptop first (`check_split.py --fp16`, 20-min cap): if too slow or kernels are missing, that is recorded and the FP16 gate runs on the phone CPU instead. |

## 4. Your answers recorded

1. Export host: **laptop split FP32** (this plan). Modal script kept, unused.
   Modal client no longer needed (`rm -rf ~/.venvs/modal` or keep it).
2. HF download: not needed anymore — weights are already on the laptop.
3. No QAIRT SDK — Maven qnn-runtime 2.33.0 instead (§2).
4. You re-run the Colab notebook at 10/20/30 steps; cells in §5; harness
   started in `ml/triposg-mobile/parity/` (`check_step0.py`,
   `mesh_parity.py`, `check_split.py`).
5. Target ≤ 2 min sampling; guidance-off only on acceptable comparison.
6. INT8 later, agreed.

## 5. Colab ablation cells (paste-ready; run after the 50-step cells)

Cell A — reduced-step + guidance-off arms (same seeds, same pipe; reuses
`prepare_image`, `WHITE`, `pipe`, `MANIFEST` from the golden notebook):

```python
import time
import torch
import trimesh

ABLATION = [
    {"tag": "s30_g7", "steps": 30, "guidance": 7.0},
    {"tag": "s20_g7", "steps": 20, "guidance": 7.0},
    {"tag": "s10_g7", "steps": 10, "guidance": 7.0},
    {"tag": "s20_g1", "steps": 20, "guidance": 1.0},  # guidance-off comparison
]
ablation_results = []
with torch.no_grad():
    for cfg in ABLATION:
        for item in MANIFEST["images"]:
            d = os.path.join(OUT_DIR, item["id"])
            started = time.perf_counter()
            image = prepare_image(
                os.path.join(d, "input_rgba.png"), bg_color=WHITE, rmbg_net=None
            )
            out = pipe(
                image=image,
                generator=torch.Generator(device=pipe.device).manual_seed(item["seed"]),
                num_inference_steps=cfg["steps"],
                guidance_scale=cfg["guidance"],
            ).samples[0]
            np.save(os.path.join(d, f"final_latents_{cfg['tag']}.npy"),
                    np.asarray(out))
            mesh = trimesh.Trimesh(
                np.asarray(out[0], dtype=np.float32),
                np.ascontiguousarray(out[1]))
            mesh.export(os.path.join(d, f"mesh_{cfg['tag']}.glb"))
            ablation_results.append({"id": item["id"], **cfg,
                "seconds": round(time.perf_counter() - started, 1),
                "faces": len(mesh.faces)})
            print(item["id"], cfg["tag"], len(mesh.faces), "faces")
with open(os.path.join(OUT_DIR, "ablation.json"), "w") as f:
    json.dump({"steps_note": "same seeds/pipe as 50-step goldens",
               "items": ablation_results}, indent=2)
```

Cell B — mesh parity vs the 50-step goldens (self-contained; needs only
numpy + trimesh, no repo files):

```python
import numpy as np
import trimesh

def sample_points(path, n=20000, seed=0):
    m = trimesh.load(path, force="mesh")
    pts, _ = trimesh.sample.sample_surface(m, n, seed=seed)
    return np.asarray(pts, dtype=np.float64)

def chamfer(a, b):
    d2 = ((a[:, None, :] - b[None, :, :]) ** 2).sum(-1)
    return float(np.sqrt(d2.min(1)).mean() + np.sqrt(d2.min(0)).mean()) / 2

def fscore(a, b, tau):
    d2 = ((a[:, None, :] - b[None, :, :]) ** 2).sum(-1)
    p = (np.sqrt(d2.min(0)) < tau).mean()
    r = (np.sqrt(d2.min(1)) < tau).mean()
    return float(2 * p * r / (p + r)) if (p + r) > 0 else 0.0

for cfg in ABLATION:
    print("==", cfg["tag"])
    for item in MANIFEST["images"]:
        d = os.path.join(OUT_DIR, item["id"])
        ref = sample_points(os.path.join(d, "mesh.glb"))
        cand = sample_points(os.path.join(d, f"mesh_{cfg['tag']}.glb"))
        diag = float(np.linalg.norm(ref.max(0) - ref.min(0)))
        print(f"  {item['id']}: chamfer={chamfer(ref, cand):.4f} "
              f"chamfer/diag={chamfer(ref, cand)/diag:.4f} "
              f"F@1%={fscore(ref, cand, 0.01*diag):.3f}")
```

`parity/mesh_parity.py` is the durable host-side version of cell B (same
math, CLI). Bring back `ablation.json` plus the `final_latents_{tag}.npy`
and `mesh_{tag}.glb` files with the next goldens zip.

## 7. NPU results (2026-11-05; recorded after the plan doc was last updated)

Findings from the on-device QNN bring-up. Standing stack: FP32 batch-1
per-unit ONNX compiled offline on Qualcomm AI Hub (`qai-hub==0.57.0`),
`--target_runtime precompiled_qnn_onnx --qairt_version 2.50`,
device `"Samsung Galaxy S25 (Family)"` (SM8750, same SoC as the
Xiaomi 15 Ultra). Phone loader: `onnxruntime-android-qnn` 1.29.0 plus
`qnn-runtime` 2.50.0 (`logs/spike-ndk/thirdparty/…-1.29.0.aar`,
`logs/spike/qnn250/extract/`), bench at `logs/spike-ndk/out-qnn129`,
`SPIKE_CTX=0` in `bench/ndk/bench.cpp` (skips the `ep.context_*` cache
entries, required for precompiled models).

1. The on-device QNN compile (`QnnGraph_finalize`) dies at 8.5–9.4 GB
   even for one block, so all NPU models are compiled offline on AI Hub.
   Upload is an FP32 ONNX directory named `<stem>.onnx/` holding the
   `.onnx` plus its `.onnx.data` (single-file external data). ORT's
   FP16-converted files are rejected by AI Hub: their nodes are not
   topologically sorted.
2. The phone reproduces AI Hub's device output bit-for-bit.
3. **HTP attention is numerically wrong at batch 2**: the cond and uncond
   rows interfere. Same result with QAIRT 2.45, 2.50 and 2.51, with and
   without onnxsim. FFN is fine at batch 2. **At batch 1 everything is
   correct**, so the pipeline switches to batch-1: one uncond pass plus
   one cond pass per guided step.
4. Full block 7 at batch 1 vs torch: rel_l2 3.3e-3 (uncond row) / 2.7e-3
   (cond row), **45.8 ms per call** on the S25 NPU, ≈100 MB, warm load
   0.36 s. Batch 2 was 492 ms and wrong.
5. Golden row order (§0, corrected): step-0 row 0 = uncond (zero encoder
   states), row 1 = cond.
6. The opset-20 export turns GELU into ONNX `Gelu` (opset-17 `Erf` is
   unsupported by the QNN EP). `onnxsim==0.7.3` is installed and pinned.
7. AI Hub's compiled block 7 `model.bin` is 283 MB for a 252 MB FP32
   block. Open: whether the weights in `model.bin` are stored as FP32 —
   the size ratio (283 vs 252 MB, far above the ≈126 MB an FP16 store
   would need) is consistent with FP32 plus graph overhead, but the
   context binary is opaque so this is not proven.

Consequences for the build (all landed after this plan revision):
`bench/split_export_step.py --all-b1` (23 batch-1 units:
head + blk00…blk20 + tail), `bench/aihub_compile.py` (offline compile +
profile + `manifest_b1.json`), `bench/ndk/chain.cpp` (`spike_chain`,
resident/stream full-step chain), `bench/spike_adb_chain_npu.sh`
(device runs + `parity/check_step0.py` gate).

### Full guided step on the phone NPU (2026-11-05)

All 23 batch-1 units compiled on AI Hub (QAIRT 2.50, S25 Family), 100%
NPU layers, 5.6 GB total bins. AI Hub estimate: blocks 45–54 ms,
1.05 s per pass.

On the Xiaomi, `spike_chain` resident with `htp_performance_mode=burst`
(now the default in chain.cpp): 1.75 s per pass → **3.5 s per guided
step**. Blocks run 75–90 ms (the gap vs AI Hub is likely host FP32 I/O
copies; blk00–09 return twin hidden+skip outputs). Without burst:
≈300 ms per block, 12.5 s per step.

Parity vs step0_noise_pred: cosine 0.9999959, rel_l2 4.2e-3, PASS.
Resident and stream outputs are identical.

Resident: PSS 18–26 MB, VmHWM ≈300 MB (weights live in HTP memory), so
the HyperOS 3.5 GB PSS kill is not hit. Session create 8.3 s for all 23.
Stream: ≈15 s per pass (create ≈370 ms per unit), rejected.

Fixes made on the host side:

- adb inside `while read` ate stdin (`< /dev/null`) in
  `spike_adb_chain_npu.sh`;
- chain.cpp now renames each unit's `hidden` output to `hidden_in`;
- burst is the default.

## 8. Part A: sampling loop + VAE + extraction (this build)

New tooling (all on `on-device-pipeline`, nothing committed by the agent):

- `bench/export_vae.py`: `vae_post` (final_latents (1,2048,64) →
  decoder-transformer kv (1,2048,1024), once per mesh) and `vae_query`
  (queries (1,N,3) + kv → negated SDF (1,N,1), fixed N). Exports the
  default (non-flash) attention math; `--unit flash-check` proves it
  equals the golden flash path (set_topk(False) ⇒ plain SDPA) numerically
  before export. Torch refs for golden id `hjswed` (kv; fixed random
  points + coarse-grid slice) plus per-unit ORT-vs-torch gates land in
  `logs/spike/vae/`.
- `cpp/` (portable C++17, reused unchanged by Phase 3): `extract`
  (flash-style octree refinement — dense coarse grid, sign-change + |sdf|
  band, dilations, re-query; backend-pluggable queries),
  `mcubes` (marching tetrahedra, uniform 6-fold split: crack-free, same
  zero-crossings as cubes on all 12 cube edges, NaN-fringe skip, outward
  winding by signed volume, closedness stat), `glb_writer` (positions +
  normals + uint32 indices, one PBR material, no axis transform — TripoSG
  coords already line up with the golden `mesh.glb`).
- `cpp/test/` (laptop CMake): `test_vae_decode` drives extract with ORT
  CPU sessions (1.22 headers from the AAR + pip wheel lib), decodes golden
  `final_latents` at full depth, writes a GLB for `run_phase1.py
  --candidate-dir` grading. Vertex mapping reuses the golden quirk
  (index / 2^d1 * bounds + min).
- `bench/ndk/pipeline.cpp` (`spike_pipeline`): 23 resident transformer
  units + `vae_post`/`vae_query`, full rectified-flow loop (CFG 7.0,
  batch-1 rows, FP32 Euler with the exact sigma/timestep schedule),
  initial noise from golden row 0, cond states from row 1, then decode +
  extract → GLB + `final_latents.npy`, with per-stage ms/VmHWM/PSS.
  `chain.cpp` untouched. `bench/spike_adb_pipeline.sh` pushes only the
  new binary, the 2 VAE units and the inputs (23 units already on the
  phone). `aihub_compile.py` takes `--stems vae_post,vae_query` without
  touching the transformer units.

Knobs to sweep next (steps × d0/d1 × N):

| Knob | Golden value | First sweep | Decides |
| --- | --- | --- | --- |
| steps | 50 (175 s, over budget) | 10 / 20 / 30 | sampling time vs final-latents drift (grade vs golden latents at 50 only) |
| d0 / d1 | 6 / 9 | 6/7, 6/8, 5/7 | extract time + mesh parity (grade vs golden mesh; reduced depths grade against the Colab ablation meshes when they land) |
| N (query chunk) | n/a (CPU chunks ≤10000) | 8192 first | HTP viability: 8192 ⇒ 512 MiB worst-case score transient; 32768 ⇒ 2 GiB, likely over limits — move only on profile evidence (`--chunk` re-export, no code change) |

First runs: laptop `test_vae_decode` at d0=6 d1=9 (heavy: ~515 MiB final
grid + ORT CPU minutes), then phone `STEPS=20 D0=6 D1=7`. Both write
layouts gradable by `run_phase1.py --candidate-dir`; expect FAIL at
reduced steps/depths (legitimate deviation, numbers still recorded).

## 9. Part A results (measured 2026-11-06, Xiaomi 15 Ultra)

End to end works on the phone: 50 steps, CFG 7.0, d0=6, d1=8 passes the
mesh gate 5/5 (`ml/triposg-mobile/logs/phase2/parity_s50_d8.md`). Full
tables: `ml/triposg-mobile/eval/summary.md`; per-component evidence:
`ml/triposg-mobile/eval/matrix.md`; raw logs: `logs/phase2/`.

- C++ extraction exactness (host, golden latents, d1=9): chamfer/diag
  3.488e-3, F 0.999, IoU 0.9985 — sampling-noise floor. 29 min host CPU.
- AI Hub: vae_post 199.6 ms (533 NPU layers), vae_query 33.7 ms / 8192
  pts (51 NPU layers); blocks 45–54 ms. FP16 compile changed nothing
  (226.5 MB zipped, rel_l2 2.7e-3) — FP32 stays; INT8 needs calibration.
- Phone sweep (hjswed, d0=6): 50/d1=9 total 386 s PASS; 50/d1=8 total
  253 s PASS; 25/d1=8 total 138 s PASS; 15 FAIL; 10 FAIL. 25 steps over
  5 ids: 2/5 pass (drift, not breakage — uegvsd render shows the same
  object). 50 steps over 5 ids: 5/5 PASS (253–420 s; 7.5 s steps only
  when hot).
- `final_latents` at 50 steps: cosine 0.945–0.984, rel_l2 0.18–0.33 —
  report-only from here (mesh is the acceptance gate; see
  `parity/THRESHOLDS.md`). No other threshold changed.
- Memory: VmHWM 420–445 MB (d1=8), 677 MB (d1=9); PSS ≤ 363 MB. Create
  11–15 s once for 25 units.
- Landed bug fixes kept in this round: 16 (not 17) decoder layers in
  `export_vae.py`, `embed_include_pi` from config, post+query weights in
  `run_query`, VAE source path in `aihub_compile.py`, SSO-safe name
  handling + session-lifetime discipline in the C++ runners, `ROOT` /
  `LD_LIBRARY_PATH` / qnn-runtime libs / `ID` slicing in
  `spike_adb_pipeline.sh`.
- Open for Phase 3: u2net CPU port, DINOv2 wiring (golden states for
  now), meshoptimizer decimation to ≈100k faces, 5.6 GB + 440 MB model
  download management.

## 6. Open questions remaining

1. `onnxconverter-common` is (probably) not in the `triposg-spike` env — it
   is only needed for the optional laptop `--fp16` step. Approve the tiny
   install (`pip install onnxconverter-common==1.16.0`, ≈100 KB), or skip
   laptop FP16 and gate FP16 on the phone CPU?
2. What Chamfer/diag and F@1% count as "acceptable" for guidance-off and for
   each step count (§5 cells)?
