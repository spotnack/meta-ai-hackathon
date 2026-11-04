# Spike first: smallest on-device piece on the Xiaomi (tonight)

Goal: prove fit before polishing goldens. Export and run the smallest
useful piece on the Xiaomi 15 Ultra and report latency + peak RAM. That
result decides FP16 vs. INT8 vs. INT4 and the step/face knobs for the demo.

## Order (stop at the first piece that runs)

1. DINOv2 encoder only: export the exact `Dinov2Model` variant from the
   TripoSG checkpoint to ONNX, run it with ONNX Runtime Mobile on the
   Xiaomi, and time one forward pass plus peak native RAM.
2. Else one transformer step: export a single rectified-flow step
   (one `TripoSGDiTModel` forward at one timestep, batch 1, guidance off)
   and run it the same way. Do not export the full 50-step loop yet.
3. Else VAE decode of a cached latent (no transformer): proves the mesh
   path (`flash_extract_geometry` → GLB) on device.

## What to record (per piece)

- Device, OS build, SoC, RAM, runtime version, precision, commit hash.
- 2 warm-ups, then ≥5 runs: median + p90 latency, thermal state.
- Peak RAM: `dumpsys meminfo` / `VmHWM` during the run.
- Pass/fail: converts? runs? parity error vs. the Colab golden for that
  piece (tolerance set in the notebook), OOM or crash log if any.

## MVP rules for the spike

- RMBG is skipped: feed pre-cut white/transparent inputs only.
- Weights come from the pinned checkpoint; only manifests + hashes go to
  git (10 MB cap). Converted spike weights stay git-ignored.
- If the smallest piece fails fit or latency, stop and report at 04:00
  with the logs. No distillation, retraining, or model swap without
  written approval.
