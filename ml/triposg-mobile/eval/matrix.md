# Phase 2 runtime matrix: per-component × runtime

Cell key: **M** = measured (log path given), **D** = documented (link
given), **NS** = not-supported (evidence given), **NE** = not-evaluated
(reason given). No estimates as measurements: profile projections are
marked P. Device is the Xiaomi 15 Ultra (SM8750) unless noted; NPU means
QNN HTP via AI Hub EPContext (QAIRT 2.50, ORT 1.29.0 + qnn-runtime 2.50.0,
burst). All logs below are git-ignored.

| Component | Laptop CPU | Phone CPU | Phone NPU | Colab T4 (reference) |
| --- | --- | --- | --- | --- |
| Background removal (rembg u2net) | NE (Phase 3 measures the CPU port) | NE (Phase 3) | NE (not planned; CPU target) | M: goldens cut with it (`reference/goldens_5/report.json`, notebook) |
| DINOv2 encoder (FP32 ORT) | D: converts + runs (`bench/spike_dinov2_export.py`, `logs/spike/dinov2_encoder.onnx`) | M: 1084 ms median, 2.47 GB peak, cosine 1.0000001 (`logs/spike/phone_bench_dinov2_224.log`) | NE (no need: CPU fits the budget; never attempted) | M: golden states (`dinov2_last_hidden_state.npy`) |
| One transformer step (23 batch-1 FP32 units) | M converts (`logs/spike/export_all_b1.log`); runs ORT-vs-torch gate (`logs/spike/check_split.log`), latency not benchmarked | M: ≈100 s/step, rejected (`logs/spike/phone_chain_fp16_cpu.log`) | M: 3.5 s/guided step resident burst, cosine 0.9999959 / rel_l2 4.2e-3 ([§7](docs/ai_pipeline_phase2_plan.md#7-npu-results-2026-11-05-recorded-after-the-plan-doc-was-last-updated)); non-burst + stream in `logs/phase2/phone_chain_npu.log` | M: golden step-0 tensors (`step0_*.npy`) |
| VAE post (latents → kv) | D: converts + runs in-export ORT gate (`bench/export_vae.py`, `logs/spike/vae/vae_post_fp32.onnx`) | NE (never attempted; NPU path works) | M: 199.6 ms, 533 NPU / 0 CPU layers (`logs/phase2/aihub_vae.log`, `logs/spike/aihub/vae_post/profile.json`) | — (no reference; decode inputs are `final_latents.npy`) |
| VAE query (points + kv → SDF, N=8192) | D: converts + runs in-export ORT gate (`bench/export_vae.py`, `logs/spike/vae/vae_query_fp32.onnx`) | NE | M: 33.7 ms per 8192 points, 51 NPU / 0 CPU (`logs/phase2/aihub_vae.log`, `logs/spike/aihub/vae_query/profile.json`) | — |
| Extraction + marching + GLB (C++ core) | M correctness: chamfer/diag 3.488e-3, F 0.999, IoU 0.9985 vs golden (`logs/phase2/parity_host_cpp_extract_golden_latents.md`); ≈29 min host CPU (orchestrator-reported, no log) | M at d1=8: extract ≈11 s + mc ≈1 s, closed=1 (`logs/phase2/phone_pipeline_s50_d8.log`); VmHWM 426 MB, PSS 188 MB | — (CPU code by design: `cpp/extract.h`) | M: golden mesh (DiffDMC, `mesh.glb`) |
| Full sampling loop | NE (exists only in `bench/ndk/pipeline.cpp`) | NS with evidence: transformer CPU ≈100 s/step rules it out (`logs/spike/phone_chain_fp16_cpu.log`) | M: 50 steps ≈230–386 s + ≈12 s extract at d1=8 (`logs/phase2/phone_pipeline_s50_d8*.log`); 5/5 mesh PASS (`logs/phase2/parity_s50_d8.md`) | M: 50-step golden latents + meshes |

## Notes per component

- **Background removal.** License Apache-2.0 (shippable); RMBG-1.4 is
  non-commercial and excluded. Runs on Colab only so far; the CPU port
  and its latency/RAM numbers are Phase 3 work.
- **DINOv2.** The 224-px phone run is the valid one (median 1084.1 ms,
  p90 1110.0 ms, peak VmHWM 2467560 kB, parity max-abs 6.03e-05 /
  rel_l2 2.79e-06 / cosine 1.0000001). The older 518-px run (6.5 s,
  2.47 GB) is discarded.
- **Transformer step.** AI Hub estimates: blocks 45–54 ms, head 3.7 ms,
  tail ≈4.5 ms, ≈1.05 s per pass; measured burst on device 75–90 ms per
  block (host FP32 I/O copies explain the gap), 1.75 s per pass.
  Resident sessions: create 11–15 s once for 25 units, VmHWM ≈300–445 MB,
  PSS ≤ 363 MB — the HyperOS ≈3.5 GB PSS kill is far away. Stream
  (≈15 s per pass) rejected. On-device QNN compile OOMs at 8.5–9.4 GB,
  so AI Hub offline compile is mandatory; QNN GPU backend fails to
  finalize; HTP batch-2 attention is wrong, batch 1 correct.
- **VAE.** `--quantize_full_type float16` changed neither bin size
  (226.5 MB zipped either way) nor accuracy (rel_l2 2.7e-3): the default
  compile already stores what HTP needs. FP32 stays. INT8 needs
  calibration: future work. Bins: vae_post 413 MB, vae_query 27.5 MB.
- **Extraction.** 192 query calls at d1=8 (≈10.6 s of the ≈11.3 s
  extract). Host d1=9 run proves the C++ core exact (sampling-noise
  floor); it is a correctness test only, never a latency path.
- **Full loop.** Step time 4.5–5.4 s cool, up to 7.5 s hot (thermal
  throttling, back-to-back runs). `final_latents` drift (cosine
  0.945–0.984 at 50 steps) is report-only: CFG 7.0 amplifies the
  cond−uncond difference and the ODE compounds it, while meshes pass.

## Not evaluated, with reasons

- LiteRT, ExecuTorch, Core ML: no iOS device on hand; QNN HTP already
  meets the gate on Android, and the time box goes to the working app.
- DINOv2 / VAE on phone CPU: the working NPU/CPU split needs no fallback.
- Transformer / loop on laptop CPU: conversion gates (ORT-vs-torch) ran;
  full-loop latency was never needed on the laptop.
