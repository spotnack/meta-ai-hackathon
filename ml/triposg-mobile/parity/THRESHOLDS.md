# Parity acceptance thresholds (Phase 1, fixed before optimization)

Single source: `parity/thresholds.json`. Every tensor check runs through
`parity/tensor_parity.py` (`check_step0.py` is a thin wrapper); every mesh
check runs through `parity/mesh_parity.py`. `parity/run_phase1.py` applies
these gates to the golden baselines and to later `--candidate-dir` runs.

Rule: thresholds are fixed now, before any optimization. Phase 2 may only
**tighten** them. If a calibration baseline below fails a gate, that is a
finding to investigate (wrong method, corrupt file, mis-set gate) — never
a silent loosening after optimization has started.

## Tensor components

| Component | cosine_min | rel_l2_max | max_abs_max | Why |
| --- | --- | --- | --- | --- |
| `dinov2_last_hidden_state` | 0.99999 | 1.0e-4 | 1.0e-3 | Phone CPU DINOv2 already measures rel_l2 2.8e-6 vs the golden (35x margin) and cosine 1.0000001; ONNX-vs-golden max abs is 7.7e-5 (13x margin). A single forward pass has no error accumulation, so the gate sits just above export roundoff. |
| `step0_noise_pred` | 0.999 | 1.0e-2 | — | Phone NPU full guided step measures cosine 0.9999959 (about 240x margin in 1-cosine) and rel_l2 4.2e-3 (2.4x margin). The gate is the approved FP16 gate: tight enough to catch a wrong block or a bad quantization, loose enough for one FP16/NPU pass. |
| `final_latents` | 0.99 | 5.0e-2 | — | **Provisional** (marked in the JSON): no on-device full run exists yet. Looser because per-step error compounds over 50 guided steps — even roughly independent per-step perturbations of ~4e-3 grow to a few e-2 at the end, while the signal norm stays large so cosine stays high. Revisit (tighten) after the first on-device full-step chain lands in Phase 2. |

Per-batch-row metrics are reported for every tensor (row 0 = uncond, row 1 =
cond) but gated only whole-tensor: a row split is for diagnosis, and the
guided output mixes both rows.

## Mesh component (`mesh.glb` vs candidate)

Method: 20000 seeded surface samples per mesh, symmetric Chamfer (absolute
and / reference bbox diagonal) and F-score at τ = 1% of the reference
diagonal via `scipy.cKDTree`, plus volume IoU on a 64³ occupancy over the
union bbox (ray parity when both meshes are watertight, documented
surface-fill fallback otherwise).

| Metric | Threshold | Why |
| --- | --- | --- |
| `chamfer_over_diag_max` | 1.0e-2 | Must clear two noise floors with margin: decimation to ~80k faces moves the surface ~1e-4 of the diagonal, and two independent 20k samples of the same mesh sit a few e-3 apart (mean nearest-neighbour distance at 20k points). A genuinely broken candidate (wrong step count, bad decode) lands far above 1e-2. |
| `f_score_min` | 0.90 | Same reasoning at τ = 1% diagonal: decimation and resampling both score well above 0.95; 0.90 leaves margin while still failing visibly degraded meshes. |
| `volume_iou_min` | 0.95 | 64³ occupancy is deterministic for a fixed mesh (no sampling noise at all — the resampling baseline must read 1.0 modulo watertight-method choice), so 0.95 is far above any discretization wobble and far below what a wrong-shape candidate scores. |

Calibration: `run_phase1.py` runs both baselines for all 5 ids —
(a) `mesh.display.glb` vs `mesh.glb` (decimation noise) and
(b) `mesh.glb` vs itself with a different sampling seed (sampling noise) —
and gates each against the table above. Confirm every baseline passes with
margin before optimizing; record the confirmed margins in the Phase 1
report. Tighten later from the measured numbers if they allow it.
