# Phase 2 summary: recommended hybrid configuration

Evidence: [matrix.md](matrix.md), `logs/phase2/` (parity reports + phone
logs), `logs/spike/` (conversion + bench logs). Device: Xiaomi 15 Ultra
(SM8750). NPU = QNN HTP via AI Hub EPContext (QAIRT 2.50, ORT 1.29.0 +
qnn-runtime 2.50.0, burst).

## Recommendation

- Background removal: **rembg u2net on CPU** (Apache-2.0; Phase 3 port,
  to be measured). RMBG-1.4 excluded (non-commercial).
- DINOv2 encoder: **FP32 on ORT CPU** (1.08 s, fits the budget; no NPU).
- Transformer (23 batch-1 units) + `vae_post` + `vae_query`: **QNN HTP**,
  AI Hub precompiled EPContext (FP32 graphs; the HTP executes them at FP16
  precision, the source of the step-level error).
- Sampling: **50 steps, CFG 7.0**, batch-1 uncond+cond rows.
- Extraction: **d0=6, d1=8**, octree + marching tetrahedra + GLB in the
  portable C++ core on CPU.
- This config passes the mesh gate **5/5** (end-to-end acceptance gate).
- Fast preset: **25 steps, d1=8** (≈138 s) — below the parity gate on 3/5
  (fidelity drift from the 50-step reference, same object/silhouette),
  documented for iteration speed, not acceptance.

| Dimension | Value |
| --- | --- |
| Conversion | Split batch-1 FP32 ONNX (opset 20, fixed shapes) on the laptop + AI Hub `precompiled_qnn_onnx` (QAIRT 2.50, S25 Family). On-device QNN compile OOMs (8.5–9.4 GB), so offline compile is mandatory. |
| Runtime support | ORT 1.29.0 QNN EP + qnn-runtime 2.50.0, `htp_performance_mode=burst`; ORT CPU for DINOv2 + C++ core. QNN GPU backend fails to finalize; HTP batch-2 attention is wrong, batch 1 correct. |
| CPU / GPU / NPU | DINOv2 CPU; transformer + VAE NPU; extraction/marching CPU. GPU: nothing (no path evaluated — no need). |
| Precision | FP32 end to end. `--quantize_full_type float16` changed neither bin size (226.5 MB zipped either way) nor accuracy (rel_l2 2.7e-3): the default compile already stores what HTP needs. INT8 needs calibration: future work. |
| Parity | Mesh gate 5/5 at 50 steps d1=8 (chamfer/diag ≤ 1e-2, F ≥ 0.90, IoU ≥ 0.95). Step-0 noise PASS (cosine 0.9999959, rel_l2 4.2e-3). Final latents report-only (cosine 0.945–0.984 at 50 steps; CFG+ODE compound the 4e-3 step error — wrong end-to-end gate). |
| End-to-end latency | 50/d1=8: ≈230–386 s sampling + ≈12 s extract + ≈1 s mc (253–420 s total; 7.5 s steps only when hot). 25/d1=8: ≈138 s. Host d1=9 correctness run: ≈29 min CPU (never a latency path). |
| Load time | Session create 11–15 s once for 25 resident units. |
| Peak RAM | VmHWM 420–445 MB at d1=8, 677 MB at d1=9; PSS ≤ 363 MB (HyperOS ≈3.5 GB kill far away). DINOv2 CPU peak 2.47 GB (model-dominated, transient). |
| Storage | 5.6 GB transformer bins + ≈440 MB VAE bins → model download/management is mandatory in Phase 3. |
| Binary size | `spike_pipeline` 2.9 MB + `libonnxruntime.so` 24 MB (+ qnn-runtime libs pushed alongside). |
| Integration | Phase 3 wraps `cpp/` unchanged in the Expo module; the sampler still takes golden-supplied encoder states until on-device DINOv2 is wired in. |
| Complexity | 25 sessions, one sampler + extractor; no server, no cloud at inference. |
| License | rembg u2net Apache-2.0; meshoptimizer MIT (decimation, Phase 3); RMBG-1.4 excluded (non-commercial). TripoSG weights retain their upstream terms — check before shipping. |

## Knob trade-offs (measured, hjswed ablation, guidance 7.0, d0=6)

| steps | d1 | sampling s | extract s | mc s | total s | tris | chamfer/diag | F@1% | IoU | gate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 50 | 9 | 251.1 | 47.2 | 31.8 | 385.9 | 4,274,688 | 4.718e-3 | 0.964 | 0.9554 | PASS |
| 50 | 8 | 229.8 | 11.3 | 0.9 | 253.3 | 1,064,256 | 4.723e-3 | 0.965 | 0.9556 | PASS |
| 25 | 8 | 114.2 | 11.3 | 1.0 | 138.2 | 1,041,540 | 4.265e-3 | 0.978 | 0.9662 | PASS |
| 15 | 8 | 68.2 | 11.8 | 1.1 | 93.5 | 1,088,788 | 5.130e-3 | 0.949 | 0.9372 | FAIL |
| 10 | 8 | 46.8 | 11.2 | 0.9 | 70.2 | 1,082,504 | 6.400e-3 | 0.855 | 0.9075 | FAIL |

Reports: `logs/phase2/parity_s{50,25,15,10}_d8.md`, `parity_s50_d9.md`.

## All 5 goldens (d1=8)

50 steps — 5/5 PASS (`logs/phase2/parity_s50_d8.md`):

| id | chamfer/diag | F | IoU | total s | step median s |
| --- | --- | --- | --- | --- | --- |
| hjswed | 4.723e-3 | 0.965 | 0.9556 | 253 | 4.6 |
| iuvbww | 4.427e-3 | 0.979 | 0.9849 | 291 | 5.0 |
| qwvfsd | 5.283e-3 | 0.933 | 0.9699 | 298 | 5.2 |
| uegvsd | 4.089e-3 | 0.988 | 0.9825 | 420 | 7.5 (thermal, back-to-back) |
| yuyyuw | 4.449e-3 | 0.982 | 0.9835 | 358 | 5.4 |

25 steps — 2/5 pass (`logs/phase2/parity_s25_d8.md`): hjswed PASS;
iuvbww F 0.893 FAIL; qwvfsd IoU 0.9475 FAIL; uegvsd F 0.848 / IoU 0.879
FAIL (render: same object and silhouette, slightly thinner back);
yuyyuw PASS (F 0.978, IoU 0.977). The failures are fidelity drift from
the 50-step reference, not broken geometry.

## Display + storage notes for Phase 3

- At d1=8 the GLB carries ≈1.06M triangles and ≈25–50 MB per mesh —
  far too heavy for Explore cards. The app needs on-device decimation
  to ≈100k faces (meshoptimizer is MIT and fine to vendor).
- 5.6 GB of transformer bins + ≈440 MB of VAE bins cannot ship inside
  the app: Phase 3 needs model download/management (per-unit files,
  resume, versioning) before any on-device run.
