<div align='center'>
  <h1> AI Pipeline </h1>
</div>

# Table of Contents

- [On-Device AI Inference Pipeline](#on-device-ai-inference-pipeline)
- [Phase 0 Audit (checkpoint)](#phase-0-audit-checkpoint)
- [Phase 1: Reference and Parity Method](#phase-1-reference-and-parity-method)
- [Phase 2: Runtime Evaluation and Decision](#phase-2-runtime-evaluation-and-decision)

---

# On-Device AI Inference Pipeline

Placeholder for the full pipeline doc. Phase 0 (audit) below is the only
filled section. Later phases will append: desktop reference, runtime decision,
final configuration, model management, benchmarks, limitations, licenses.

---

# Phase 0 Audit (checkpoint)

Status: audit ready for your review; not committed (you will commit).
Do not start Phase 1 until you approve (per `ai_pipeline_prompt.md` §4).
No code, installs, weight downloads, or commits were done in this turn.
No measurements were taken, so nothing below is labeled *measured*.

Label key: *documented* = an inspected source states it (linked); *unverified*
= neither measured nor documented, needs an experiment or source in Phase 1/2.

## 1. Real inference graph (source-checked)

| # | Prompt claim | Verdict + source (inspected this turn) | Label |
| --- | --- | --- | --- |
| 1 | Rectified-flow transformer, ≈1.5B params | Confirmed. README Updates: "Release of TripoSG 1.5B parameter rectified flow model and VAE trained on 2048 latent tokens" | *documented* ([README](https://raw.githubusercontent.com/VAST-AI-Research/TripoSG/main/README.md)) |
| 2 | Shapes use 2,048 latent tokens | Confirmed (same README line). Pipeline `prepare_latents` builds `(batch, num_tokens, in_channels)` | *documented* ([README](https://raw.githubusercontent.com/VAST-AI-Research/TripoSG/main/README.md), [pipeline](https://raw.githubusercontent.com/VAST-AI-Research/TripoSG/main/triposg/pipelines/pipeline_triposg.py)) |
| 3 | Image conditioning is a pretrained vision encoder, reportedly DINOv2-class | Confirmed as DINOv2 itself. Pipeline imports `Dinov2Model, BitImageProcessor` and `encode_image` uses `image_encoder_dinov2(...).last_hidden_state`; acknowledgements thank DINOv2 | *documented* ([pipeline](https://raw.githubusercontent.com/VAST-AI-Research/TripoSG/main/triposg/pipelines/pipeline_triposg.py), [README](https://raw.githubusercontent.com/VAST-AI-Research/TripoSG/main/README.md)) |
| 4 | CLIP + DINOv2 dual conditioning | Partially confirmed only. A secondary summary of the paper mentions "CLIP-DINOv2 dual-conditioning", but the inspected pipeline file shows DINOv2. Whether CLIP also feeds the transformer needs a transformer-config read in Phase 1 | *unverified* |
| 5 | Preprocessing may include a background-removal model | Confirmed: `briaai/RMBG-1.4`. `run_triposg` calls `prepare_image(image, white bg, rmbg_net)` with `BriaRMBG.from_pretrained(RMBG-1.4)`; README auto-downloads it to `pretrained_weights/RMBG-1.4` | *documented* ([inference script](https://raw.githubusercontent.com/VAST-AI-Research/TripoSG/main/scripts/inference_triposg.py), [README](https://raw.githubusercontent.com/VAST-AI-Research/TripoSG/main/README.md)) |
| 6 | VAE decodes latents into SDF/occupancy; mesh extraction → triangles | Confirmed SDF (not occupancy). README: "Advanced VAE Architecture: Uses Signed Distance Functions (SDFs) with hybrid supervision (SDF + normal + eikonal)"; pipeline decodes via `vae.decode(latents, sampled_points).sample` through `hierarchical_extract_geometry` or `set_flash_decoder`/`flash_extract_geometry`, then `trimesh.Trimesh(v, f)`; optional decimation via pymeshlab quadric-edge-collapse (`--faces`) | *documented* ([README](https://raw.githubusercontent.com/VAST-AI-Research/TripoSG/main/README.md), [pipeline](https://raw.githubusercontent.com/VAST-AI-Research/TripoSG/main/triposg/pipelines/pipeline_triposg.py), [inference script](https://raw.githubusercontent.com/VAST-AI-Research/TripoSG/main/scripts/inference_triposg.py)) |
| 7 | Sampling defaults: steps, guidance, CFG doubles batch | Confirmed. Defaults `num_inference_steps=50`, `guidance_scale=7.0`, `seed=42`, `device=cuda`, `dtype=float16`; `do_classifier_free_guidance = guidance_scale > 1`; guided path does `torch.cat([latents] * 2)` then `chunk(2)` guidance | *documented* ([inference script](https://raw.githubusercontent.com/VAST-AI-Research/TripoSG/main/scripts/inference_triposg.py), [pipeline](https://raw.githubusercontent.com/VAST-AI-Research/TripoSG/main/triposg/pipelines/pipeline_triposg.py)) |
| 8 | Scheduler | FlowMatchEulerDiscreteScheduler (`FlowMatchEulerDiscreteScheduler` import in pipeline) | *documented* ([pipeline](https://raw.githubusercontent.com/VAST-AI-Research/TripoSG/main/triposg/pipelines/pipeline_triposg.py)) |
| 9 | GPU requirement ≈8 GB VRAM | Confirmed. README System Requirements: "CUDA-enabled GPU with at least 8GB VRAM" | *documented* ([README](https://raw.githubusercontent.com/VAST-AI-Research/TripoSG/main/README.md)) |
| 10 | 4B MoE / 4096-token scaling variant | Paper describes MoE scaling per the prompt; README advertises a separate CFG-distilled 512-token scribble model, not the ship target. Ship target stays the 1.5B/2048 model unless evidence forces a change request | *documented* (prompt §2 + paper [abs](https://arxiv.org/abs/2502.06608)/[html](https://arxiv.org/html/2502.06608v3)); MoE details *unverified* pending paper §3.2 read in Phase 1 |

Exact component shapes, dtypes, and per-component parameter counts (transformer
vs. DINOv2 variant vs. VAE vs. RMBG) were not extracted this turn: they need
the transformer/VAE configs plus a weighed `snapshot_download` listing, which
is Phase 1 work on a GPU machine. Do not quote them until then.

## 2. Licenses (ship-blockers flagged)

| Artifact | License (inspected) | What it means for us | Label |
| --- | --- | --- | --- |
| TripoSG code | MIT, ©2025 VAST-AI-Research | Ship/modify/convert OK with notice | *documented* ([LICENSE](https://raw.githubusercontent.com/VAST-AI-Research/TripoSG/main/LICENSE)) |
| TripoSG weights (`VAST-AI/TripoSG`) | Page shows `License: mit` | Redistribution from our own host looks allowed, but re-verify the model-card license file (not just the code LICENSE) before hosting anything. Hosting stays undecided per your answer | *documented* ([model page](https://huggingface.co/VAST-AI/TripoSG)); redistribution *unverified* until card-file check in Phase 1 |
| RMBG-1.4 (`briaai/RMBG-1.4`) | `bria-rmbg-1.4`: source-available, non-commercial (CC non-commercial); commercial use needs a BRIA agreement | SHIP-BLOCKER for a commercial app: bundling or re-hosting RMBG weights, and background removal as a pipeline stage, needs a BRIA commercial agreement or a maintainer-approved license-clean replacement for that stage only (not a TripoSG swap). Do not choose hosting or a replacement without your approval | *documented* ([model page](https://huggingface.co/briaai/RMBG-1.4)) |
| Deps to re-check in Phase 2 | `diffusers`, `transformers` (permissive upstream); `pymeshlab` (copyleft risk: avoid bundling; use custom C++/GLB writer on device) | Keep decimation out of the app via pymeshlab; confirm runtime licenses (LiteRT/ORT/Core ML/ExecuTorch) in the Phase 2 matrix | *unverified* |

## 3. Memory and storage budget

Computed (arithmetic, not measured): 1.5B params ≈ 3.0 GB FP16 / 1.5 GB INT8 /
0.75 GB INT4-weight-only, before the DINOv2 encoder, VAE decoder, RMBG stage,
activations, attention/KV buffers at 2,048 tokens, and the extraction grid.
*Unverified*: exact encoder/VAE/RMBG sizes, activation peaks, and octree-grid
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
   `TripoSGDiTModel`, width 2048, 21 layers, 16 heads, in_channels 64,
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
   the laptop) — parity comes from your Colab step0_*.npy, whose exact
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
Android, real stage labels, cancel on background, placeholder behind env
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
crop_size; golden pixel_values (1,3,224,224)), not 518 → 1370. The 6.5 s
number measured a 5× larger input and is discarded; the encoder was
re-exported at 224 and verified against `dinov2_last_hidden_state.npy`
(ONNX-vs-golden 7.70e-05, torch-vs-golden 4.20e-05).
Colab reference (your run, T4): 413–531 s per image at about 11 GiB of GPU
memory — the cost level the on-device path must undercut per step.
Transformer spike now runs on golden step-0 inputs (latent (2,2048,64),
timestep [1000,1000] float32, enc (2,257,1024) with zero uncond row);
phone output is checked against `step0_noise_pred.npy`. Old random
`dit_spike_*.npy` inputs are deleted.
Given the goldens exist and the transformer export has not completed: demo
the proven chain on the Xiaomi — pre-cut RGBA input → on-device DINOv2
encoder at 224 (current result: median 1084.1 ms, p90 1110.0 ms, 5 runs +
2 warm-ups, peak VmHWM 2467560 kB against 6.6 GB available, thermal 0→0;
parity vs `dinov2_last_hidden_state.npy`: max abs 6.03e-05, mean abs
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
