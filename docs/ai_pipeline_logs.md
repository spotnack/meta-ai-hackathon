<div align='center'>
  <h1> AI Pipeline Logs </h1>
</div>

# Table of Contents

- [Phase 0 Audit (checkpoint)](#phase-0-audit-checkpoint)
- [Phase 1: Reference and Parity Method](#phase-1-reference-and-parity-method)
- [Phase 2: Runtime Evaluation and Decision](#phase-2-runtime-evaluation-and-decision)
- [Phase 3: Native Implementation (part A — engine + module)](#phase-3-native-implementation-part-a--engine--module)
- [Phase 3: Native Implementation (part B — app integration)](#phase-3-native-implementation-part-b--app-integration)
- [Phase 4: App Polish, Benchmarks, Docs](#phase-4-app-polish-benchmarks-docs)

---

# Phase 0 Audit (checkpoint)

Status: audit ready for your review; not committed (you will commit).
Do not start Phase 1 until you approve (per `ai_pipeline_prompt.md` §4).
No code, installs, weight downloads, or commits were done in this turn.
No measurements were taken, so nothing below is labeled _measured_.

Label key: _documented_ = an inspected source states it (linked); _unverified_
= neither measured nor documented, needs an experiment or source in Phase 1/2.

## 1. Real inference graph (source-checked)

| #   | Prompt claim                                                               | Verdict + source (inspected this turn)                                                                                                                                                                                                                                                                                                                                                                                   | Label                                                                                                                                                                                                                                                                                                                                   |
| --- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Rectified-flow transformer, ≈1.5B params                                   | Confirmed. README Updates: "Release of TripoSG 1.5B parameter rectified flow model and VAE trained on 2048 latent tokens"                                                                                                                                                                                                                                                                                                | _documented_ ([README](https://raw.githubusercontent.com/VAST-AI-Research/TripoSG/main/README.md))                                                                                                                                                                                                                                      |
| 2   | Shapes use 2,048 latent tokens                                             | Confirmed (same README line). Pipeline `prepare_latents` builds `(batch, num_tokens, in_channels)`                                                                                                                                                                                                                                                                                                                       | _documented_ ([README](https://raw.githubusercontent.com/VAST-AI-Research/TripoSG/main/README.md), [pipeline](https://raw.githubusercontent.com/VAST-AI-Research/TripoSG/main/triposg/pipelines/pipeline_triposg.py))                                                                                                                   |
| 3   | Image conditioning is a pretrained vision encoder, reportedly DINOv2-class | Confirmed as DINOv2 itself. Pipeline imports `Dinov2Model, BitImageProcessor` and `encode_image` uses `image_encoder_dinov2(...).last_hidden_state`; acknowledgements thank DINOv2                                                                                                                                                                                                                                       | _documented_ ([pipeline](https://raw.githubusercontent.com/VAST-AI-Research/TripoSG/main/triposg/pipelines/pipeline_triposg.py), [README](https://raw.githubusercontent.com/VAST-AI-Research/TripoSG/main/README.md))                                                                                                                   |
| 4   | CLIP + DINOv2 dual conditioning                                            | Partially confirmed only. A secondary summary of the paper mentions "CLIP-DINOv2 dual-conditioning", but the inspected pipeline file shows DINOv2. Whether CLIP also feeds the transformer needs a transformer-config read in Phase 1                                                                                                                                                                                    | _unverified_                                                                                                                                                                                                                                                                                                                            |
| 5   | Preprocessing may include a background-removal model                       | Confirmed: `briaai/RMBG-1.4`. `run_triposg` calls `prepare_image(image, white bg, rmbg_net)` with `BriaRMBG.from_pretrained(RMBG-1.4)`; README auto-downloads it to `pretrained_weights/RMBG-1.4`                                                                                                                                                                                                                        | _documented_ ([inference script](https://raw.githubusercontent.com/VAST-AI-Research/TripoSG/main/scripts/inference_triposg.py), [README](https://raw.githubusercontent.com/VAST-AI-Research/TripoSG/main/README.md))                                                                                                                    |
| 6   | VAE decodes latents into SDF/occupancy; mesh extraction → triangles        | Confirmed SDF (not occupancy). README: "Advanced VAE Architecture: Uses Signed Distance Functions (SDFs) with hybrid supervision (SDF + normal + eikonal)"; pipeline decodes via `vae.decode(latents, sampled_points).sample` through `hierarchical_extract_geometry` or `set_flash_decoder`/`flash_extract_geometry`, then `trimesh.Trimesh(v, f)`; optional decimation via pymeshlab quadric-edge-collapse (`--faces`) | _documented_ ([README](https://raw.githubusercontent.com/VAST-AI-Research/TripoSG/main/README.md), [pipeline](https://raw.githubusercontent.com/VAST-AI-Research/TripoSG/main/triposg/pipelines/pipeline_triposg.py), [inference script](https://raw.githubusercontent.com/VAST-AI-Research/TripoSG/main/scripts/inference_triposg.py)) |
| 7   | Sampling defaults: steps, guidance, CFG doubles batch                      | Confirmed. Defaults `num_inference_steps=50`, `guidance_scale=7.0`, `seed=42`, `device=cuda`, `dtype=float16`; `do_classifier_free_guidance = guidance_scale > 1`; guided path does `torch.cat([latents] * 2)` then `chunk(2)` guidance                                                                                                                                                                                  | _documented_ ([inference script](https://raw.githubusercontent.com/VAST-AI-Research/TripoSG/main/scripts/inference_triposg.py), [pipeline](https://raw.githubusercontent.com/VAST-AI-Research/TripoSG/main/triposg/pipelines/pipeline_triposg.py))                                                                                      |
| 8   | Scheduler                                                                  | FlowMatchEulerDiscreteScheduler (`FlowMatchEulerDiscreteScheduler` import in pipeline)                                                                                                                                                                                                                                                                                                                                   | _documented_ ([pipeline](https://raw.githubusercontent.com/VAST-AI-Research/TripoSG/main/triposg/pipelines/pipeline_triposg.py))                                                                                                                                                                                                        |
| 9   | GPU requirement ≈8 GB VRAM                                                 | Confirmed. README System Requirements: "CUDA-enabled GPU with at least 8GB VRAM"                                                                                                                                                                                                                                                                                                                                         | _documented_ ([README](https://raw.githubusercontent.com/VAST-AI-Research/TripoSG/main/README.md))                                                                                                                                                                                                                                      |
| 10  | 4B MoE / 4096-token scaling variant                                        | Paper describes MoE scaling per the prompt; README advertises a separate CFG-distilled 512-token scribble model, not the ship target. Ship target stays the 1.5B/2048 model unless evidence forces a change request                                                                                                                                                                                                      | _documented_ (prompt §2 + paper [abs](https://arxiv.org/abs/2502.06608)/[html](https://arxiv.org/html/2502.06608v3)); MoE details _unverified_ pending paper §3.2 read in Phase 1                                                                                                                                                       |

Exact component shapes, dtypes, and per-component parameter counts (transformer
vs. DINOv2 variant vs. VAE vs. RMBG) were not extracted this turn: they need
the transformer/VAE configs plus a weighed `snapshot_download` listing, which
is Phase 1 work on a GPU machine. Do not quote them until then.

## 2. Licenses (ship-blockers flagged)

| Artifact                            | License (inspected)                                                                                                                 | What it means for us                                                                                                                                                                                                                                                                                            | Label                                                                                                                             |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| TripoSG code                        | MIT, ©2025 VAST-AI-Research                                                                                                         | Ship/modify/convert OK with notice                                                                                                                                                                                                                                                                              | _documented_ ([LICENSE](https://raw.githubusercontent.com/VAST-AI-Research/TripoSG/main/LICENSE))                                 |
| TripoSG weights (`VAST-AI/TripoSG`) | Page shows `License: mit`                                                                                                           | Redistribution from our own host looks allowed, but re-verify the model-card license file (not just the code LICENSE) before hosting anything. Hosting stays undecided per your answer                                                                                                                          | _documented_ ([model page](https://huggingface.co/VAST-AI/TripoSG)); redistribution _unverified_ until card-file check in Phase 1 |
| RMBG-1.4 (`briaai/RMBG-1.4`)        | `bria-rmbg-1.4`: source-available, non-commercial (CC non-commercial); commercial use needs a BRIA agreement                        | SHIP-BLOCKER for a commercial app: bundling or re-hosting RMBG weights, and background removal as a pipeline stage, needs a BRIA commercial agreement or a maintainer-approved license-clean replacement for that stage only (not a TripoSG swap). Do not choose hosting or a replacement without your approval | _documented_ ([model page](https://huggingface.co/briaai/RMBG-1.4))                                                               |
| Deps to re-check in Phase 2         | `diffusers`, `transformers` (permissive upstream); `pymeshlab` (copyleft risk: avoid bundling; use custom C++/GLB writer on device) | Keep decimation out of the app via pymeshlab; confirm runtime licenses (LiteRT/ORT/Core ML/ExecuTorch) in the Phase 2 matrix                                                                                                                                                                                    | _unverified_                                                                                                                      |

## 3. Memory and storage budget

Computed (arithmetic, not measured): 1.5B params ≈ 3.0 GB FP16 / 1.5 GB INT8 /
0.75 GB INT4-weight-only, before the DINOv2 encoder, VAE decoder, RMBG stage,
activations, attention/KV buffers at 2,048 tokens, and the extraction grid.
_Unverified_: exact encoder/VAE/RMBG sizes, activation peaks, and octree-grid
costs need configs + on-device measurement (`phys_footprint` /
`VmHWM` / `dumpsys meminfo`) in Phase 2.

Revision (16.0 + 6.0 GB device): the Xiaomi has 16 GB physical RAM plus
6 GB system RAM expansion (≈22 GB total, ≈16 GB usable high-speed). The old
6 GB verdict no longer applies.
Revised verdict: GO for an INT8 or INT4-weight-only MVP with sequential
load/unload, memory-mapped weights, flash decoder, fewer steps, and a faces
cap; FP16 full-pipeline is plausible but unproven and stays a stretch goal.
Why still quantized-first: 1.5B params alone are ≈3.0 GB in FP16, and the app
shares the phone with the OS plus attention/KV buffers at 2,048 tokens and
the extraction grid, so peak per-stage RAM still has to be measured on the
device (`dumpsys meminfo` / `VmHWM`) before any FP16 fit claim. The
first on-device spike (§6) decides FP16 vs. INT8 vs. INT4.
RMBG is out of the memory path for the MVP (skipped, see §6), which removes
that stage's weights and peak from the budget.

Storage: weights are multi-GB. Keep all tooling/weights under
`ml/triposg-mobile/` (never `client/`, Metro watches that tree);
`.gitignore` already ignores `client/public/ai-models/`; the new
`ml/triposg-mobile/.gitignore` ignores weights/tensors/logs. The 10 MB commit
cap holds: only manifests, hashes, scripts, and small logs go into git.

## 4. Target devices and minimum tier

- Named test device (your correction): Xiaomi 15 Ultra, Android 16 (build
  16BP2A), 16.0 + 6.0 GB RAM. This is the Phase 2–4 perf device. No iPhone is
  named, so iOS is deferred for the MVP (see §6).
- Provisional minimum tier (pending spike measurement): Android flagship SoC
  class (Snapdragon 8 Gen 2 / 8 Elite or equivalent), 12 GB+ physical RAM
  recommended (16 GB preferred), 6 GB+ free storage, Android 13+. The Xiaomi
  16 GB device is the reference pass mark; if it OOMs even at INT4 +
  sequential + flash decoder, the step/face knobs tighten before the tier
  moves. iOS candidate later:
  iPhone 15 Pro or newer; only then would we use the increased-memory-limit
  entitlement you approved, because iOS caps app RAM well below physical RAM
  and a 1.5B model is exactly the case that entitlement exists for.
- Simulators/emulators: functional checks only, never perf (no NPU, wrong
  thermals).

## 5. Can Phase 1 run on your dev machine CPU?

No, not the full reference. Your machine (no CUDA, Intel HD 620 + AMD R7
M445, 4 cores, 15 GB RAM) can host the parity-harness code and a tiny reduced
plumbing smoke test, but a 1.5B FP32 reference over 5 images × 50 steps plus
hierarchical extraction would take hours per image and risk RAM pressure. Do
not run the golden set here.

Phase 1 GPU plan (your call: you run the notebook yourself on a Colab GPU
runtime):

1. Open `ml/triposg-mobile/reference/triposg_golden_5.ipynb` on Colab with a
   GPU runtime (≥8 GB VRAM), following the notebook's pinned env
   (`environment.yml` + TripoSG `requirements.txt`).
2. Run the official pipeline path at fixed seeds over the 5-image eval set
   (`ml/triposg-mobile/eval/manifest_5.json`, your rewrite, not edited here);
   save goldens as `.npy` (DINOv2 input/output, step-0 transformer
   input/output, final latents) plus final meshes and `report.json` (the only
   golden file kept in git per the ignore rules). The notebook uses
   `prepare_image(rmbg_net=None)` + `TripoSGPipeline` at pinned
   `triposg_commit fc5c4099`. The notebook skips RMBG (pre-cut inputs below).
3. Develop the parity harness locally on CPU against one tiny smoke output
   (reduced steps, flash decoder), then execute it against the Colab goldens.
   Thresholds are set before any optimization.

## 6. Demoable MVP for Nov 5, 10:00 AM (GMT+8), one platform first

Clock: 17:55 now → 10:00 tomorrow (≈16 h). Riskiest step goes first: the
minimal on-device spike below runs before the golden set is polished.
Fallback: at 04:00 I stop and report what is actually working (spike numbers,
golden status, blockers) so you can choose the demo path.

Platform: Android only on the Xiaomi 15 Ultra over adb (25010PN30G,
Android 16, SM8750 / Snapdragon 8 Elite, arm64-v8a, 16 GB RAM, MemTotal
15476092 kB). Budget uses the 16 GB physical RAM only; the 6 GB memory
extension is ignored. iOS, second-device parity, and the README diagram are
deferred.

MVP must still be real on-device TripoSG inference in airplane mode (no
simulated output, no cloud). RMBG is skipped for the MVP (your call). Your
rewrite (recorded, files untouched): inputs are RGBA cut-outs of 5 TripoSG
example images made with rembg/u2net, and those same cut-outs are the
pre-cut images the phone gets. Known limitation: arbitrary gallery photos
with backgrounds are out of scope for the demo; the app must reject or warn
on non-pre-cut inputs. The RMBG commercial-license blocker is therefore
deferred, not resolved.

Order of work (spike first):

1. Spike (tonight, started, not waiting for Colab): export the DINOv2
   encoder (`facebook/dinov2-large`, 24 layers, hidden 1024, patch 14,
   image 518, per the checkpoint config) to ONNX and run it on the Xiaomi
   via `bench/spike.md`. Until your Colab goldens arrive, parity is checked
   against a DINOv2 output computed on CPU here from the same RGBA input.
   Export done: `dinov2_encoder.onnx` + `dinov2_spike_input.npy`
   (seed 0) + `dinov2_cpu_baseline.npy` ((1, 1370, 1024),
   sha eef5ab72164718e245e94e0347894610a6a133c6f2018db3d4a2c6b1d8dda90c).
   ONNX-vs-torch parity here: max abs diff 5.5e-5 (float32 roundoff), so
   the phone output passes against an abs tolerance of 1e-4.
   Phone spike PASSED (Xiaomi 15 Ultra, ORT 1.22.0 CPU, 4 threads, FP32):
   median 6507 ms, p90 6564 ms over 5 runs after 2 warm-ups; peak VmHWM
   2470256 kB against 4.6 GB available; output (1, 1370, 1024) vs CPU
   baseline max abs diff 5.39e-05, relative L2 2.83e-06, cosine 1.0000045;
   thermal status 0 before and after. Raw log:
   `ml/triposg-mobile/logs/spike/phone_bench_run2.log` (git-ignored).
   Your `bench.cpp` npy-dtype fix (`<f4`) stands and is not reverted.
   Superseded: that run used a 518-px input, not the real 224-px one —
   its 6.5 s / 2.4 GB numbers are discarded (see §9). Re-run done: the
   224-px result is below (median 1084 ms, cosine 1.0000001).
   Transformer sizing (config + file list inspected, no download):
   `TripoSGDiTModel`, width 2048, 21 layers, 16 heads, in*channels 64,
   cross_attention_dim 1024; weight file
   `transformer/diffusion_pytorch_model.safetensors` is 5758280104 bytes
   (≈5.36 GiB FP32). One guided step doubles the batch, so activations run
   at batch 2 × 2048 tokens; attention scores alone are ≈0.5 GiB transient
   per layer at FP32.
   FP32 verdict: STOP — weights alone (5.36 GiB) exceed the 4.6 GB measured
   available on the phone, before ORT overhead and activations. No FP32
   transformer download or export; arithmetic, no experiment needed.
   Next: FP16 single step (≈2.68 GiB weights, ≈3.2 GB estimated peak, fits)
   then QNN-vs-CPU on the same artifact. The FP16 path still downloads the
   5.36 GiB FP32 file first (over the 2 GB line: needs your OK), and laptop
   export peak is ≈10 GB (close everything; the laptop already froze once).
   QNN availability on-device is unverified until the bench lists providers.
   FP16 export (`bench/spike_transformer_export.py`, black+flake8 clean):
   meta-device init, safetensors mmap, per-tensor FP16 cast (no FP32 copy),
   real encoder baseline as cond plus zeros as uncond, fixed seed
   latents/timestep saved as `.npy`, ONNX with external data
   (`external_data=True` exists in torch 2.5.1). Expected laptop peak
   ≈5–7 GiB (2.68 GiB FP16 dict shared into the model, FP16 trace
   activations at batch 2); the script prints measured peak RSS, which you
   report back. Export command for your terminal (after closing Chrome and
   other VS Code windows, transformer download finished):
   `~/anaconda3/envs/triposg-spike/bin/python
ml/triposg-mobile/bench/spike_transformer_export.py` from the repo root.
   Export fixes (your five, applied): repo cloned at pinned fc5c4099 into
   `~/.cache/triposg/TripoSG` on sys.path (no setup.py, so no pip git
   install); `diffusers==0.30.3` + `einops` installed in the env;
   meta-device `from_config(load_config(...))`; float32 timestep 1000.0
   (step 0 on the RectifiedFlowScheduler 1000→≈20 scale, matching your
   Colab step0 goldens); no CPU FP16 baseline forward (no FP16 math on
   the laptop) — parity comes from your Colab step0*\*.npy, whose exact
   inputs the phone runs. Smoke first: `--smoke` builds a 2-layer/256-wide
   random config, traces, and re-runs it in ORT before the big export.
   QNN AAR (`onnxruntime-android-qnn` 1.22.0, Maven): 6796460 bytes
   (≈6.5 MiB), arm64 `.so` staged; it ships no HTP backend libs, so the NPU
   run depends on the vendor lib on the device (default
   `/vendor/lib64/libQnnHtp.so`), unverified until the run. `bench.cpp`
   now takes `[runs] [cpu|qnn] [backend] [extra inputs...]` with FP16 I/O;
   `spike_adb_bench.sh` takes MODEL/INPUT/OUTPUT/PROVIDER/EXTRA. Phone
   verdict so far: FP32 transformer CANNOT fit (stopped); FP16 CPU baseline
   expected ≈3.2 GB peak, fits — run it as the baseline before QNN.
   04:00 report: encoder on-device PASSED (6507 ms median, 2.47 GB peak,
   parity 5.39e-05); transformer FP16 export and Colab goldens still
   pending on your side; recommended demo path is §9.
   Encoder weight is `image_encoder_dinov2/model.safetensors` (1.13 GiB,
   downloaded and size-verified, under the 2 GB notice line); only
   encoder-needed checkpoint files go into
   `ml/triposg-mobile/pretrained_weights/` (git-ignored).
   Env (approved, you run it outside the sandbox — conda has no writable
   dirs or pkgs cache inside it): `conda create -n triposg-spike
python=3.10`, then CPU-only torch plus transformers, onnx, onnxruntime,
   flake8. Measured wheel sizes: onnxruntime 1.22.0 cp310 ≈15.6 MiB, onnx
   1.23.2 cp310 ≈8.5 MiB, transformers ≈12.4 MiB; torch 2.5.1+cpu and the
   conda python env are estimates (≈190 MiB and ≈150–250 MiB), pip/conda
   print exact sizes before fetching. Total estimate ≈0.5 GiB, well under
   the 2 GB line. Pin `onnxruntime==1.22.0` (verified cp310 wheel; latest
   dropped 3.10).
   adb (phone visible only outside the sandbox): you run the step scripts
   in `ml/triposg-mobile/bench/` in your own terminal and paste back
   outputs. Serial is `2dd745b1` (25010PN30G is the model name, not the
   serial); your `info` fixes stand and are not reverted. Measured info:
   release 16, abi arm64-v8a, qcom SM8750, MemTotal 15476092 kB,
   MemAvailable 4776520 kB, /data 301G free, NO_TERMUX.
   Termux path dropped: build a small ORT benchmark with NDK 27.1.12297006
   (done: `bench/ndk/`, arm64 binary + 1.22.0 `.so` staged), run it from
   `/data/local/tmp/triposg-spike` via `spike_adb_bench.sh`, which samples
   VmHWM from `/proc/<pid>/status` while it runs. Report back latency +
   peak RAM per piece; that decides FP16 vs. INT8 vs. INT4 and the step/face
   knobs.
2. Golden set (5 images, you run the notebook): only after the spike runs.
   The eval set is 5 images (plan updated 2026-11-06): its size only bounds
   parity confidence, not on-device model speed or output quality.

Keep: audit (this file), 5-image Colab goldens, one runtime spike on
Android, real stage labels, background-safe conversion (foreground
service; user Cancel only), placeholder behind env
flag, airplane-mode convert → Explore → Stage flow on the Xiaomi.

Cut/defer: RMBG stage (pre-cut inputs only); iOS build and Documents-backup
wiring (decided: Documents excluded from backup, implemented after MVP);
polished model-management UI (manual weight sideload + manifest + hash check
only); resumable-download UI, cellular warnings, upgrade flows;
triangle-budget tuning beyond a provisional faces cap (final budget comes
from spike frame-time data); multi-card perf tuning; server changes; README
diagram (fix the link only if time permits).

Knobs for the demo: reduced steps (e.g. 20–30 vs. 50), guidance on,
weight-only quantization, flash decoder, provisional faces cap. Exact values
come from the spike numbers, not from estimates.

## 7. Go / no-go (revised)

GO for the Android MVP on the 16 GB Xiaomi with RMBG skipped and
quantization + sequential + flash decoder + fewer steps + faces cap. FP16
full-pipeline stays a stretch goal until the spike proves fit. If the spike
shows even the encoder or one transformer step missing fit or latency, I
report at 04:00 with evidence per rule 3 and will not distill, retrain, or
swap models without your written approval.

## 8. Your answers recorded (so Phase 1+ follows them)

Hardware: CPU-only dev machine → you run the Colab notebook on a GPU
runtime. Deadline: Nov 5 10:00 GMT+8; spike first, 04:00 fallback report.
Devices: Xiaomi 15 Ultra over adb (25010PN30G, Android 16, SM8750 /
Snapdragon 8 Elite, arm64-v8a, MemTotal 15476092 kB); budget uses 16 GB
physical only. Tier: provisional §4, entitlements OK with reason documented.
Hosting: undecided until the Phase 1 card-file license check. Inputs: your
rewrite — RGBA rembg/u2net cut-outs of 5 TripoSG examples; same files go to
the phone; goldens are DINOv2 in/out + step-0 in/out + final latents
(`.npy`) + `report.json`; notebook, manifest, and ignore rules untouched by
me. Parity: on-device vs. CPU DINOv2 baseline here until Colab goldens land.
Downloads: only encoder-needed checkpoint files into `pretrained_weights/`
(encoder weight 1.13 GiB, under the 2 GB line). Installs and anything over
2 GB need your prior OK. Backgrounding: cancel. iOS storage: Documents
excluded from backup (post-MVP). Latency/triangles: proposed from spike
data. Placeholder: env flag; Jest left as-is. Commits: 10 MB cap; you
review both checkpoints; no commits from me.

## 9. Recommended demo path for 10:00 (04:00 report, corrected for 224px)

Correction: TripoSG's DINOv2 input is 224×224 → 257 tokens (preprocessor
crop*size; golden pixel_values (1,3,224,224)), not 518 → 1370. The 6.5 s
number measured a 5× larger input and is discarded; the encoder was
re-exported at 224 and verified against `dinov2_last_hidden_state.npy`
(ONNX-vs-golden 7.70e-05, torch-vs-golden 4.20e-05).
Colab reference (your run, T4): 413–531 s per image at about 11 GiB of GPU
memory — the cost level the on-device path must undercut per step.
Transformer spike now runs on golden step-0 inputs (latent (2,2048,64),
timestep [1000,1000] float32, enc (2,257,1024) with zero uncond row);
phone output is checked against `step0_noise_pred.npy`. Old random
`dit_spike*\*.npy`inputs are deleted.
Given the goldens exist and the transformer export has not completed: demo
the proven chain on the Xiaomi — pre-cut RGBA input → on-device DINOv2
encoder at 224 (current result: median 1084.1 ms, p90 1110.0 ms, 5 runs +
2 warm-ups, peak VmHWM 2467560 kB against 6.6 GB available, thermal 0→0;
parity vs`dinov2_last_hidden_state.npy`: max abs 6.03e-05, mean abs
2.97e-06, relative L2 2.79e-06, cosine 1.0000001; log
`logs/spike/phone_bench_dinov2_224.log`) → report the number
live — and frame everything after the encoder as measured-next-steps, not
done: FP16 one-step export (your terminal, smoke first), FP16 CPU baseline
(≈3.2 GB expected), then QNN. Do NOT promise full-mesh conversion in the
demo: no transformer output has run on any device yet, and FP32 transformer
provably cannot fit. If the FP16 export lands before 10:00, add the
one-step CPU-vs-QNN latency table; if QNN fails, the honest fallback is
FP16 CPU with reduced steps. Backgrounding cancels; placeholder stays
behind its env flag.
FP16 export FAILED on the laptop (your watchdog, 06:09:58, after 61 min):
peak RSS 9848728 kB (≈9.4 GiB, above the ≈5–7 estimate — the trace holds
more than modeled), free memory down to 1.55 GB, no output written, and
stdout was buffered so nothing was visible (use `python -u` next time).

> Update (Phase 2, supersedes this whole demo-time block): the
> transformer export did run on the laptop — as 23 batch-1 FP32 units via
> split export, no cloud machine — and the full on-device pipeline now
> passes the mesh gate 5/5 at 50 steps. See "Phase 2: runtime evaluation
> and decision" below; the pre-demo cautions above are history, not
> status.

## Sources (all inspected this turn, underlying content non-empty)

- <https://raw.githubusercontent.com/VAST-AI-Research/TripoSG/main/README.md>
- <https://raw.githubusercontent.com/VAST-AI-Research/TripoSG/main/scripts/inference_triposg.py>
- <https://raw.githubusercontent.com/VAST-AI-Research/TripoSG/main/triposg/pipelines/pipeline_triposg.py>
- <https://raw.githubusercontent.com/VAST-AI-Research/TripoSG/main/requirements.txt>
- <https://raw.githubusercontent.com/VAST-AI-Research/TripoSG/main/LICENSE>
- <https://huggingface.co/VAST-AI/TripoSG>
- <https://huggingface.co/briaai/RMBG-1.4>
- <https://arxiv.org/abs/2502.06608> and <https://arxiv.org/html/2502.06608v3>

---

# Phase 1: Reference and Parity Method

Status: reference goldens landed; parity harness committed on
`on-device-pipeline`. Thresholds below were fixed before any optimization.

## 1. Eval set (5 images, fixed)

`ml/triposg-mobile/eval/manifest_5.json`: 5 rembg/u2net RGBA cut-outs of
TripoSG example images (ids `hjswed`, `iuvbww`, `qwvfsd`, `uegvsd`,
`yuyyuw`; seeds 42–46). The set was reduced from 20 to 5 on purpose: its
size only bounds parity confidence, it does not change on-device model
speed or output quality. The same cut-outs are the pre-cut inputs the
phone gets (RMBG is skipped for the MVP).

## 2. What the goldens are

Per id, `ml/triposg-mobile/reference/goldens_5/<id>/` holds the Colab
(Tesla T4, FP32, 50 steps, guidance 7.0, fixed seed) component-boundary
tensors plus the final mesh:

- `input_rgba.png`, `prepared_input.png` (official `prepare_image` with
  `rmbg_net=None` on the pre-cut RGBA);
- `dinov2_pixel_values.npy`, `dinov2_last_hidden_state.npy`;
- `step0_latent_model_input.npy`, `step0_timestep.npy`,
  `step0_encoder_hidden_states.npy`, `step0_noise_pred.npy` (batch-2
  guided-step tensors: row 0 = uncond with zero encoder states, row 1 =
  cond with the real DINOv2 states);
- `final_latents.npy`;
- `mesh.glb` (official pipeline mesh extraction, hierarchical 505³ final
  grid, same construction as `scripts/inference_triposg.py`; 660k–2.9M
  faces) and `mesh.display.glb` (quadric-edge-collapse decimated to
  ~80k faces by `reference/decimate_display.py` for the demo path).

`reference/goldens_5/report.json` (the only golden file in git) records
the TripoSG commit (`fc5c4099`), weights revision, package versions, and
the sha256 of every per-id file. Large tensors/meshes are git-ignored.

## 3. Metrics and thresholds

- Tensors (`parity/tensor_parity.py`, single math implementation;
  `parity/check_step0.py` is a thin wrapper): max_abs, mean_abs, rel_l2,
  cosine, whole-tensor plus per-batch-row. Gates in
  `parity/thresholds.json`, justified in `parity/THRESHOLDS.md`: DINOv2
  hidden state (cosine ≥ 0.99999, rel_l2 ≤ 1e-4 — phone CPU already
  measures 2.8e-6); one-step noise_pred (cosine ≥ 0.999, rel_l2 ≤ 1e-2 —
  phone NPU measures 0.9999959 / 4.2e-3); final latents looser
  (0.99 / 5e-2, provisional — FP16/NPU error compounds over 50 steps).
- Meshes (`parity/mesh_parity.py`): symmetric Chamfer (absolute and /
  reference diagonal) + F-score at τ = 1% of the diagonal over 20000
  seeded samples via `scipy.cKDTree` (the old dense 20000×20000 matrix
  peaked at ~3.2 GB), plus volume IoU on a 64³ occupancy over the union
  bbox — ray parity when both meshes are watertight, documented
  surface-fill fallback otherwise, with the method and watertight flags
  in the output. Optional `--render` writes 3 orthographic views.
  Initial gates (chamfer/diag ≤ 1e-2, F ≥ 0.90, IoU ≥ 0.95) clear
  decimation noise (~1e-4) and resampling noise (few e-3) with margin and
  may only be tightened later.

## 4. Reproduce

On Colab (GPU runtime, ≥8 GB VRAM): open
`ml/triposg-mobile/reference/triposg_golden_5.ipynb`, run all cells, bring
back the zip over `reference/goldens_5/`. On the laptop: one command runs
hash verification, both mesh baselines ((a) display-vs-full, (b) two
sampling seeds), and writes `logs/phase1/phase1_report.{json,md}` —
`ml/triposg-mobile/README.md` has the setup and run commands.
`parity/run_phase1.py --candidate-dir` reuses the same table for later
candidate outputs. `parity/test_parity.py` holds the synthetic harness
regression tests (no goldens needed).

---

# Phase 2: Runtime Evaluation and Decision

Status: full pipeline runs on-device and passes the mesh gate 5/5.
Evidence: `ml/triposg-mobile/eval/matrix.md` (per-component × runtime),
`ml/triposg-mobile/eval/summary.md` (recommendation + knob tables),
`ml/triposg-mobile/logs/phase2/` (parity reports + phone logs).

## Decision (recommended hybrid configuration)

- Background removal: rembg u2net on CPU (Apache-2.0; Phase 3 port).
  RMBG-1.4 excluded (non-commercial).
- DINOv2 encoder: FP32 on ORT CPU — 1084 ms median, 2.47 GB transient
  peak, cosine 1.0000001 vs golden
  (`logs/spike/phone_bench_dinov2_224.log`).
- Transformer (23 batch-1 FP32 units) + `vae_post` + `vae_query`:
  QNN HTP via AI Hub EPContext (QAIRT 2.50, ORT 1.29.0 + qnn-runtime
  2.50.0, burst), FP32 throughout — 100% NPU layers, stream rejected.
- Sampling: 50 steps, CFG 7.0, batch-1 uncond+cond rows.
- Extraction d0=6, d1=8 in the portable C++ core on CPU.

## Evidence highlights

- One guided transformer step on NPU: 3.5 s resident burst, parity
  cosine 0.9999959 / rel_l2 4.2e-3 vs the golden step-0 noise.
- VAE on NPU: post 199.6 ms (533 NPU layers), query 33.7 ms per 8192
  points (51 NPU layers) — `logs/phase2/aihub_vae.log`.
- C++ extraction exactness (host, golden latents, d1=9): chamfer/diag
  3.488e-3, F 0.999, IoU 0.9985 — at the sampling-noise floor.
- Phone end-to-end (Xiaomi 15 Ultra): 50 steps d1=8 passes 5/5
  (`logs/phase2/parity_s50_d8.md`), ≈253–420 s total; 25 steps passes
  2/5 with same-object drift on the rest. VmHWM ≤ 677 MB, PSS ≤ 363 MB.
- `final_latents` is report-only: cosine 0.945–0.984 at 50 steps (CFG +
  ODE compound the 4e-3 step error) while every mesh passes — the mesh
  gate, not the latent gate, is the end-to-end acceptance.
- Not evaluated, with reasons: LiteRT/ExecuTorch/Core ML (no iOS
  device; HTP already meets the gate), background-removal port and
  on-device decimation (≈1M tris / ≈25–50 MB per GLB must shrink to
  ≈100k faces for Explore cards) — both Phase 3, with 5.6 GB + 440 MB
  of model bins forcing download management first.

## NPU memory (DMA-BUF) and the w8a16 follow-up

The VmHWM/PSS numbers above are host-side process memory. On the phone
the NPU weights live in DMA-BUF (unswappable), which is what actually
kills the app:

- `dmabuf_dump` on the resident 23-unit FP32 DiT chain: **8.96 GB**.
  Per unit: one ~240–272 MB buffer (the context weights; `model.bin` is
  247 MB per block) plus ~130–150 MB of per-session scratch/I-O buffers.
  VAE adds ~0.8 GB → app total ≈ 9.8 GB.
- HyperOS kills the app mid-run: `am_kill … stop com.spotnackmuse.ondevice
due to used too many dmabuf resource, dmabuf used rss:9842572kb, dmabuf
threshold:1572864kb` (adj 0, while loading); lmkd logs `thrashing
(74%)`, `critical pressure`, dozens of kills per minute.
- Probe (`bench/aihub_memory_probe.py`, `logs/spike/memprobe/`): forcing
  `default_graph_htp_precision=FLOAT16` gives byte-identical 247 MB bins
  (no gain); linking 3 blocks with `qnn_dlc` + `submit_link_job` works,
  but AI Hub refuses to wrap the multi-graph context as ONNX ("Wrapping
  QNN Context Binary with multiple graphs is currently not supported").

The fix is int8 weights / int16 activations (w8a16) on the DiT chain via
the ORT QNN QDQ path, cutting weights ≈ 4× (247 MB → ~60 MB per block)
and total DMA-BUF from ~9 GB toward ≲ 3 GB:

- `bench/capture_calib.py`: runs the FP32 b1 units on ORT CPU over real
  10-step CFG-7 trajectories (3 goldens, held-out uegvsd + yuyyuw) into
  `logs/spike/calib/<golden>/<stem>_s<ii>_r<r>.npz`.
- `bench/quantize_units.py`: per unit, `qnn_preprocess_model` → QDQ
  static quant (`QUInt16` activations / `QInt8` per-tensor symmetric
  weights; per-channel MatMul is unsupported on QNN) → CPU check vs FP32
  on held-out samples (stops above rel_l2 0.1) → `logs/spike/w8a16/`.
  VAE post/query stay FP32.
- `bench/aihub_compile.py --variant w8a16` → `logs/spike/aihub_w8a16/`
  (same QAIRT 2.50 / S25 / precompiled_qnn_onnx; ~70 MB uploads).
- Phone: `spike_adb_chain_npu.sh AIHUB=.../aihub_w8a16
REMOTE=/data/local/tmp/triposg-chain-w8a16` (step-0 parity),
  `bench/spike_adb_dmabuf.sh` (before/after DMA-BUF),
  `spike_adb_pipeline.sh ID=<golden> REMOTE=<same>` (mesh parity 5/5,
  same gate as today: 50 steps, CFG 7, d0=6, d1=8).
- Release: `make_model_manifest.py --version v2-w8a16-50step
--aihub-manifest .../aihub_w8a16/manifest_w8a16.json --out
.../models_manifest_w8a16.json --js-out <bundled manifest>`; sideload
  with `VERSION=v2-w8a16-50step AIHUB=... MANIFEST=...`. The app needs no
  code change: the native side picks the newest version dir holding a
  manifest, and the JS version comes from the manifest data.

## One merged NPU session (shipping): 9.0 GB → 7.1 GB DMA-BUF

QNN's verbose log (`estimated PD size ... nonSharedWeight / I/O /
runlist / spillfill`) showed every context pins its own **spill-fill
buffer**: 99 MiB for blk00–10, 73 MiB for blk11–20, 65 MiB for tail —
1.8 GiB together, while only one unit runs at a time. ORT's QNN EP
shares one spill-fill buffer across all EPContext nodes of a single
session (`QNN_HTP_CONTEXT_CONFIG_OPTION_REGISTER_MULTI_CONTEXTS`,
sized by the EPContext attribute `max_size`), but AI Hub writes no
`max_size`, and the units cannot share a graph as compiled: ORT binds
EPContext I/O to QNN tensors by name and every unit uses the same names
(`hidden_in`, `output_0`).

`bench/merge_chain.py` fixes both without recompiling: it copies each
`model.bin`, rewrites only the flatbuffer I/O names in the first 2 KB
of the header (length-prefixed, in place: `hd`, `h00..h20`,
`s00..s09`, `temb`, `noise_pred`; the HTP blob refers to tensors by id
and is untouched), and writes `dit_chain.onnx` — 23 EPContext nodes
wired head → blk00..blk20 → tail with `ep_cache_context =
"<stem>/model.bin"` and `max_size` = 100 MiB (true max 103,809,024 B
from blk00). `temb` is exposed as a second graph output because ORT
drops unused fused-node outputs and the head QNN graph would otherwise
have no match.

On-device (spike_bench, cond row, step 0):

| Variant                                    | Peak DMA-BUF   | Row pass        | Parity                          |
| ------------------------------------------ | -------------- | --------------- | ------------------------------- |
| FP32, 23 sessions (shipping)               | ~9.0 GB (+VAE) | 2.07 s          | baseline                        |
| **FP32 merged (`logs/spike/merged/fp32`)** | **7.14 GB**    | **1.48–1.69 s** | **bit-identical (max abs 0.0)** |
| w8a16 mixed, merged                        | 6.67 GB        | 2.73 s          | rel_l2 1.0e-2; not worth it     |

Session create is ~6.8 s for the whole merged chain.

In the app (release on-device build, figurine photo, Xiaomi 15 Ultra):

| Metric                           | 23 sessions (before) | One merged session                         |
| -------------------------------- | -------------------- | ------------------------------------------ |
| Lowest MemAvailable during a run | ≈1.1 GB              | ≈2.0 GB, ≈2.6 GB while sampling            |
| Background apps killed per run   | ≈100–120             | 0 (Spotify and YouTube Music kept running) |
| Full conversion                  | ≈191 s               | ≈176 s                                     |

Why not w8a16 / FP16: quantized blocks shrink weights to 70 MB, but
their runlist grows to 133 MB (vs 10 MB) and their spill-fill to
~210 MB — net saving only ~0.5 GB, at 15% slower plus a quality risk.
FP16 ONNX does not help either: QNN still pins 245 MB of weights per
block. So we ship **FP32 merged** (`v2-fp32-merged-50step`); the w8a16
tooling above stays as documented research.

App changes (`modules/triposg/cpp/pipeline.cpp`): merged mode creates
ONE QNN session from `<model_dir>/dit_chain.onnx` when present (same
options as `MakeSession`: burst, no spinning, intra-op 1, arena off),
runs each row as a single `Run` fetching `noise_pred` only, and
`DropFileCache`s the onnx plus all 23 `<stem>/model.bin` after
creation. The 23-session path stays as the fallback for v1 model dirs.
VAE sessions are deferred until after sampling (vae_post's bin alone is
413 MB) and released stage by stage — post after kv, query after
extraction, before polygonize/decimate. A single merged `Run` cannot be
interrupted mid-row; at ~1.6 s the cancel bound stays between steps.

Mitigations already in the app (`modules/triposg/cpp/pipeline.cpp`):
every Convert releases all sessions on exit, the transformer
session(s) are dropped before the VAE stage, `DropFileCache()` after
each session load, QNN sessions use 1 intra-op thread with spinning
disabled.

---

# Phase 3: Native Implementation (part A — engine + module)

Status: engine + local Expo module written, not yet built on-device.
Part B (JS adapter, model-management UI, hook swap) comes next.

## Architecture

- `client/modules/triposg/` — local Expo module (`@spotnack/triposg`,
  portal-linked). Kotlin (`TripoSGModule`) + JNI + CMake; Gradle pulls
  `onnxruntime-android-qnn:1.29.0` + `qnn-runtime:2.50.0` from Maven
  Central (the exact spike versions) and extracts the AAR's headers +
  `libonnxruntime.so` for CMake. iOS is a stub reporting `unsupported`.
- `client/modules/triposg/cpp/` — engine: `pipeline.{h,cpp}`
  (orchestration ported from the proven `bench/ndk/pipeline.cpp`),
  `preprocess.{h,cpp}` (u2net bg removal + prepare_image + DINOv2
  preprocessing), `decimate.{h,cpp}` (meshoptimizer v0.24, MIT, vendored),
  `models.{h,cpp}` (manifest + verify). The `ml/triposg-mobile/cpp`
  core (extract/marching/GLB) is reused via `add_subdirectory` — one
  copy, never forked.
- Threads: JS calls return immediately (jobId); one native worker thread
  runs conversions serially. Progress weights follow the measured stage
  durations in `logs/phase2/`.

## Memory / load-unload plan

- No session stays resident between runs: every Convert releases all
  sessions on exit (weights live in HTP DMA-BUF; PSS stayed ≤ 363 MB in
  Phase 2, but DMA-BUF is what kills). Within a run, only one stage's
  sessions exist at a time: transformer (one merged session, 7.1 GB, or
  23 fallback sessions) → released → VAE (created after sampling; post
  released after kv, query after extraction) → released before
  polygonize/decimate. `release()` drops everything on memory pressure
  while idle — never mid-conversion.
- DINOv2 + u2net CPU sessions open per conversion and close before the
  transformer stage. Preflight requires 3 GB MemAvailable and
  models + 1 GiB free storage.

## Model management (part A side)

- Models live in `getExternalFilesDir(null)/triposg/<version>/` (v1: 25
  `<stem>/model.{onnx,bin}`; v2 merged: `dit_chain.onnx` +
  `<stem>/model.bin` for the 23 transformer stems, VAE unchanged; plus
  `dinov2_encoder.onnx` + `u2net.onnx` + `models_manifest.json`).
  `bench/make_model_manifest.py` (`--merged-dir` for v2) builds the
  manifest; `bench/sideload_models.sh` (`MERGED=` for v2) adb-pushes it.
- Native `verifyModels()` checks sizes always, SHA-256 on demand
  (streamed, with progress). The resumable downloader (base URL
  `EXPO_PUBLIC_TRIPOSG_MODEL_BASE_URL`) is part B; the native API is
  already shaped for it (`getStatus` reports modelDir/version).

## Cancel bounds

Atomic flag checked between steps, per VAE-query chunk, and around
polygonization (between transformer units only on the v1 fallback
path). A stop lands within ~1 row pass (~1.6 s merged), or the running
extraction/marching pass finishes first (~12 s worst case at d1=8).
Partial outputs use temp names + rename; cancel deletes them.

---

# Phase 3: Native Implementation (part B — app integration)

Status: built and measured on-device; see Phase 4 for the numbers
(release build, merged session, `v2-fp32-merged-50step` models).

## Adapter + hook swap

- `triposg-image-to-3d.adapter.js` implements `ImageTo3dPort` over the
  module: `signal → cancel(jobId)` rejecting with
  `ImageTo3dCancelledError`; native labels mapped to card copy, with the
  sampling window ([0.020, 0.950] in `pipeline.cpp`) carrying the step
  counter ("Generating shape (step 12/50)"); the DISPLAY mesh
  (`mesh.display.glb`, 100k tris default) is copied under `Paths.cache`
  for the caller to move. `generator = triposg@2c1c516d+qnn-htp-fp16`
  (weights revision + runtime + precision).
- Unsupported / models-missing surface as `ImageTo3dUnavailableError`
  (new, in the conversion entity); the hook falls back to the
  placeholder so the workflow keeps working, and the model-status row
  carries the reason.
- `EXPO_PUBLIC_IMAGE_TO_3D_MODE=ondevice` sends gallery photos to the
  TripoSG adapter (`eas.json` gains an `ondevice` profile: APK, internal,
  `APP_VARIANT=ondevice`, ondevice + demo-auth env).

## Model management

- `domain/model-management.port.js` + `infrastructure/
model-management.adapter.js`: states not-installed / downloading
  (bytes, fraction) / paused / verifying / installed / corrupt /
  unsupported. State is derived from the device on every read (no
  cached state), so a restart lands in PAUSED (partials on disk),
  INSTALLED (sizes match), or NOT_INSTALLED.
- The manifest ships in the app as GENERATED
  `triposg-models.manifest.js` (7,696 bytes for the 52 files;
  `make_model_manifest.py --js-out`); the adapter passes its file list
  to native, so download and verify can never drift from the manifest.
- Download runs in Kotlin (`TripoSGDownload.kt`): HTTP Range resume per
  file, `.part` temp + SHA-256 + rename (never a half-written model),
  `models_manifest.json` written last, progress events ~2 Hz, pause via
  a worker flag that never touches the C++ engine. Re-calling resumes
  after pause or restart. A corrupt set is wiped before its retry
  (size-matching files would otherwise be skipped).
- Guards before starting: `downloadPreflight` (free space via
  `usableSpace` on the remainder; metered-link detection via
  `ConnectivityManager`) → `ModelSpaceError` / a cellular confirm row
  (`ModelMeteredNetworkError`); no base URL → sideload copy + Verify
  (`ModelSideloadRequiredError`). Delete removes the version dir.
- UI: one compact model-status row in the existing card style (status
  text, total size, download/pause/resume/verify/delete, progress bar);
  convert stays disabled until INSTALLED. Unsupported devices get the
  native one-liner and keep placeholder behavior.

## Lifecycle

- Conversions run inside a `dataSync` Android foreground service
  (`TripoSGService`, owned by the module): ongoing notification with
  stage + percent and a Cancel action, partial wake lock while running.
  dataSync covers this job (local file processing: photo in, GLB out);
  shortService was rejected (its ~3 min timeout ANRs midway through a
  ~5 min run) and specialUse is for cases no other type covers. Runs
  start from the foreground, so Android 15's BOOT_COMPLETED restriction
  on dataSync does not apply. Manifest declares `FOREGROUND_SERVICE` +
  `FOREGROUND_SERVICE_DATA_SYNC` (install-time) + `WAKE_LOCK`;
  `POST_NOTIFICATIONS` is requested once before the first conversion —
  denied only hides the notification, the service still runs.
- A conversion stops only on the user's Cancel (in-app button or
  notification action), on error, or if the OS kills the service. The
  hook's AppState-background cancel is gone; leaving the screen (e.g.
  sign-out) still aborts, because the save pipeline is torn down with it.
- `release()` on trim memory / low memory only when no conversion runs
  (a backgrounded conversion keeps its HTP sessions by design).
- Result delivery: the module persists one job record
  (`filesDir/triposg/job.json`: id, status, output paths, save context;
  paths captured once, never a re-resolved background Context). The
  worker writes fraction/label at most every 5 s and the terminal
  status the moment it finishes, before the service stops. The hook
  reads it on mount — a live job reattaches to its events, a done job
  completes its save exactly like a normal completion, a
  failed/interrupted job reports and a cancelled one clears silently.
  Cancelled/failed jobs leave no files; outputs live in filesDir (not
  cache) so they survive backgrounding. A "running" record with no live
  worker (process died) reports interrupted and offers a retry.
- Notification budget: dedicated thread, one reused builder, posts only
  on stage change or ≥ 5 s with a changed percent; worker thread at
  `THREAD_PRIORITY_DEFAULT` with the wake lock held. HyperOS may still
  throttle backgrounded apps (a background run measured ~2× a
  foreground one even after this).
- Save gate: engine temp-names + rename-on-success only; JS saves a
  done record only after both meshes pass a GLB header + length check.
  Interrupted/failed runs delete outputs and never save.

## Explore during a conversion

Opening Explore ~25 s into a conversion (NPU sessions loading,
MemAvailable ≈ 1.1 GB) killed the app: `JavascriptException: Error: GL
is currently not available`, and the conversion — same process, foreground
service and all — died with it. Mechanism: expo-gl's `GLView` throws
`CodedError(ERR_GL_NOT_AVAILABLE)` from its `_onSurfaceCreate` _event
handler_ when the native context cannot be created (memory pressure, or
several viewers mounting at once). Error boundaries cannot catch
event-handler throws, so release builds treat it as fatal.

Fix (all app-side, `src/features/explore/.../explore-card/`):

- `gl-availability.js` installs a narrow global-handler filter: only the
  exact expo-gl code/message is reported non-fatally (console warning +
  viewer notification); every other error still goes to the previous
  handler, so dev LogBox and release fatal behavior are unchanged for
  real bugs. No node_modules fork (R3F owns the GLView; patch-package
  was the fallback and was not needed).
- `GlbModelViewer` shows a static photo/icon fallback on notification
  and retries on remount (new uri, or the card scrolling back into
  view); the render-phase error boundary and its 2 auto-remounts are
  unchanged. Stage-3d (explicit tap) still attempts live GL and falls
  back with a message instead of crashing.
- While a conversion runs, every Explore card renders its static
  thumbnail: `useConversionRunning` (persisted-job backed, so it covers
  service-side runs after relaunch too) flows through the Explore
  view-model into `previewOnly` on every section list. No PNG poster
  pipeline was added: the creation's source photo — already persisted
  with the shape — is the static thumbnail, and the neutral placeholder
  covers shapes with no photo.
- Live views are capped at 2 app-wide even when idle: each section list
  tracks its visible cards (FlatList viewability, 50% threshold) and
  cards compete for leases in `gl-view-lease.js` (most recently seen
  wins); losers keep their static thumbnail. GLB preload is likewise
  gated on live intent, so static cards never park multi-MB meshes in
  JS memory.

## APK size

- `modules/triposg/app.plugin.js` (config plugin, listed in
  `app.json`) appends `packaging.jniLibs.excludes` for the unused QNN
  backends: DSP (+V66), GPU, HTP skels/stubs V68/V69/V73/V75/V81, and
  `libQnnHtpPrepare.so` (all units are precompiled EPContext binaries,
  so nothing calls the prepare path — verified on device 2026-11-07).
  Kept: `libQnnHtp.so`, `libQnnHtpV79Skel.so`, `libQnnHtpV79Stub.so`,
  `libQnnSystem.so`, plus ORT's `libonnxruntime.so` and
  `libtriposg_jni.so`. Measured release APK: 98 MB (Phase 3) → 63 MB.
- `TRIPOSG_DEBUGGABLE=1` in the prebuild environment appends
  `debuggable true` to the release build type (same plugin, separate
  marker-guarded block) for `run-as` inspection and golden-noise parity
  runs. Default builds are untouched; never ship a build made with it.

## Host-side trigger (no UI)

- `src/app/dev-triposg.jsx` is deleted. Usage: push a photo, then
  `adb shell am broadcast -a expo.modules.triposg.DEBUG_CONVERT`
  (optional extras: `image`, default
  `file:///sdcard/Download/triposg-test.png`; `noise`, a device path
  to a (1,2048,64) float32 `.npy` for golden-noise grading; `tag`, a
  subfolder of `triposg/debug/` for the outputs); follow
  `adb logcat -s TripoSGDebug`. The receiver
  (`TripoSGDebugReceiver.kt`, fixed knobs: 50 steps, d0 6 / d1 8) uses
  seed 42 unless `-e noise` is given, writes its GLBs under the app
  cache `triposg/debug[/<tag>/]`, and logs one TIMINGS line with
  per-stage wall seconds at DONE. It refuses to run unless the app is
  debuggable (see TRIPOSG_DEBUGGABLE above), so it is harmless in
  release. Grant the photo permission once via the app's picker first
  (shared-storage reads need it).

# Phase 4: App Polish, Benchmarks, Docs

Status: done on-device 2026-11-07 (Xiaomi 15 Ultra, release build,
merged FP32 session, `v2-fp32-merged-50step` sideloaded models).

## Final configuration

50 steps, guidance 7.0, d0 6 / d1 8 (d1 9 + 200k display mesh with the
high-detail toggle), FP32 merged transformer session on the NPU, VAE
post + query on the NPU, u2net cut-out and DINOv2 on ORT CPU,
meshoptimizer decimation (100k, 200k high detail). Models were
sideload-only during the hackathon. On 2026-11-07 the set was published
on Hugging Face (`spotnack/triposg-sm8750-qnn`, commit `a58b6607`) for
in-app download. iOS unsupported (QNN is Android-only).

## Benchmarks (all measured on the Xiaomi 15 Ultra)

Methodology: release on-device build; figurine photo for timing runs;
5 GPU goldens for parity (debug receiver with golden initial noise, d0
6 / d1 8, 50 steps, graded with `parity/run_phase1.py
--candidate-dir`); `adb shell dumpsys meminfo` / lmkd logcat for
memory; gfxinfo framestats for scroll. Report:
`ml/triposg-mobile/logs/phase4/parity_inapp_core/phase1_report.md`
(+ `timings.txt`).

- In-app conversion, merged session: figurine in 176 s. Lowest
  MemAvailable 2.0 GB (baseline 7.2 GB with Spotify + YouTube Music
  open); 0 lmkd kills, both music apps survived; tab switch < 2 s
  during sampling; switching to Spotify and back kept the job running.
- Airplane mode (no network at all, golden dinosaur photo): 185 s,
  saved, 0 network errors, 0 kills, lowest MemAvailable 2.09 GB.
- Stop: the job reported `cancelled` 1.5 s and 2.8 s after the tap
  (one sampling step ≈ 3.2 s). No leftover job folder for either
  cancelled job (checked with `run-as` on a debuggable build).
- App-core parity vs the 5 GPU goldens: OVERALL PASS for both
  `mesh.glb` and `mesh.display.glb`. The 5 runs were back to back, so
  the drift from 177 s to 233 s is thermal.

| id     | chamfer/diag | F     | IoU   | total   |
| ------ | ------------ | ----- | ----- | ------- |
| hjswed | 4.0e-3       | 0.987 | 0.974 | 177.6 s |
| iuvbww | 5.5e-3       | 0.917 | 0.968 | 194.6 s |
| qwvfsd | 5.5e-3       | 0.923 | 0.958 | 214.4 s |
| uegvsd | 4.6e-3       | 0.965 | 0.972 | 225.8 s |
| yuyyuw | 5.2e-3       | 0.929 | 0.962 | 232.9 s |

Stage times from TIMINGS: dinov2 3–5 s; session create 11–17 s;
sampling 150–189 s; vae 0.3 s; extraction 11–23 s; display 1.5–6 s.

- High detail (d1 9), figurine: 251 s vs 176 s (+75 s). Full
  `mesh.glb` 135 MB vs 34 MB. Peak app RSS 1.68 GB; lowest
  MemAvailable 1.98 GB; 0 kills. The toggle hint reads "≈ +1–2 min".
- Cut-out preview: 1.0 s for an 856×664 photo. It warned "cut off" on
  a two-person selfie and showed no warning on the figurine.
- Explore scroll (gfxinfo): 988 frames, 0 janky, p99 7 ms (static
  thumbnails while converting).

## What changed in Phase 4

- Storage: a job's folder is deleted once its result is saved (native
  `clearJob` now deletes the outDir for done records too — the full
  mesh is only validity-checked, never kept), or found already saved
  on relaunch. App start sweeps orphaned job folders and stale
  `cache/triposg/*` dirs (`getStorageState` + `deleteSweepPaths`,
  planned by the tested pure function `planStorageSweep`); a running
  job's folder and (in debuggable builds) `cache/triposg/debug` are
  never touched. Measured before the fix: 174 MB of job folders for 5
  conversions plus 104 MB of stale cache folders.
- High-detail saves used to fail with "Model file is missing or
  unreadable (full mesh)": the GLB check read the whole 135 MB full mesh
  into the Java heap (256 MB limit, `OutOfMemoryError` on device).
  `assertValidGlb` now reads only the 20-byte header through a
  `FileHandle` and compares the GLB length field with the file size.
  Re-tested on the release build: high-detail figurine saved in 249 s,
  0 OOM, 0 kills, and app user data grew by only 4.4 MB (the saved
  200k-triangle display mesh; the job folder was deleted).
- High detail raises the display mesh to 200k tris (100k when off).
  The viewer (`useGLTF` + clone, no tri-count assumptions) and the
  2-live-view Explore cap are unchanged: a 200k mesh is ~2× the GPU
  buffers of a 100k one, still single-digit MB.
- Cut-out chip uses the app's normal font (was monospace).
- `no-undef` is on for `.js`/`.jsx` (with the RN/Metro globals), off
  for `.ts`/`.tsx` (tsc covers those) — it catches the undeclared-
  variable class that crashed a release build in round 25. Plus render
  tests for the card and the auth restore (need the pinned
  `react-test-renderer` devDependency installed).
- Auth guest-restore race fixed (initial `isLoading` waits for the
  AsyncStorage read in demo mode).

## Limitations

- Single-object inputs; cropped subjects warn but may still convert
  poorly. Background removal is u2net (Apache-2.0); BiRefNet (MIT) is
  the post-hackathon upgrade.
- SM8750-only: other SoCs need their own AI Hub compile. 16 GB RAM
  effectively required (~7 GB pinned NPU memory during sampling).
- 6.9 GB model download (Hugging Face `spotnack/triposg-sm8750-qnn`), or
  sideload over adb. The app refuses phones with under 13 GiB total RAM,
  so 12 GB phones are not offered the download.
- The golden demo images (license UNVERIFIED) were removed from the
  app; no build ships them.
