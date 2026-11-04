# Phase 0 claim log (all inspected 2026-11-04; no runs, so no *measured* claims)

- 1.5B params + 2048 latent tokens — *documented*,
  `raw.githubusercontent.com/VAST-AI-Research/TripoSG/main/README.md` (Updates).
- DINOv2 encoder (`Dinov2Model` + `BitImageProcessor`, `last_hidden_state`) —
  *documented*,
  `raw.githubusercontent.com/VAST-AI-Research/TripoSG/main/triposg/pipelines/pipeline_triposg.py`
  (imports + `encode_image`); README acknowledgements.
- CLIP dual-conditioning — *unverified* (secondary summary only; pipeline file
  shows DINOv2; check transformer config in Phase 1).
- RMBG-1.4 background removal (`BriaRMBG`, `prepare_image`, white bg) —
  *documented*,
  `raw.githubusercontent.com/VAST-AI-Research/TripoSG/main/scripts/inference_triposg.py`
  (`run_triposg`, `snapshot_download briaai/RMBG-1.4`) + README weights section.
- SDF VAE + hybrid SDF/normal/eikonal supervision — *documented* (README
  Technical Highlights; paper §3.3 per arXiv TOC at
  `arxiv.org/html/2502.06608v3`).
- Mesh path `vae.decode → hierarchical/flash extract → trimesh`, optional
  pymeshlab `--faces` decimation — *documented* (pipeline tail + inference
  `simplify_mesh`).
- Defaults steps=50, guidance=7.0, seed=42, cuda, fp16; CFG doubles batch
  (`torch.cat([latents]*2)`, `chunk(2)`) — *documented* (inference script +
  pipeline `do_classifier_free_guidance`).
- Scheduler FlowMatchEulerDiscreteScheduler — *documented* (pipeline import).
- 8 GB VRAM CUDA requirement — *documented* (README System Requirements).
- TripoSG code MIT — *documented*
  (`raw.githubusercontent.com/VAST-AI-Research/TripoSG/main/LICENSE`).
- TripoSG weights `License: mit` — *documented* page label
  (`huggingface.co/VAST-AI/TripoSG`); redistribution *unverified* until the
  model-card license file is read in Phase 1.
- RMBG-1.4 non-commercial source-available, commercial via BRIA — *documented*
  (`huggingface.co/briaai/RMBG-1.4`, License: bria-rmbg-1.4).
- FP16/INT8/INT4 weight sizes, encoder/VAE/RMBG sizes, activation/grid peaks,
  per-app caps, latencies — *unverified* (need configs + on-device runs).
