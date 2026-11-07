---
license: mit
base_model: VAST-AI/TripoSG
pipeline_tag: image-to-3d
tags:
  - image-to-3d
  - triposg
  - on-device
  - qualcomm
  - qnn
  - snapdragon
  - onnx
---

# TripoSG for Snapdragon 8 Elite (QNN, on-device)

[TripoSG](https://github.com/VAST-AI-Research/TripoSG) image-to-3D, converted to run fully offline on a phone's NPU. This is the model set the [Spotnack](https://github.com/spotnack/meta-ai-hackathon) app downloads to turn a photo into a 3D mesh in about 3 minutes, with no server.

This is an unofficial conversion. It is not made or endorsed by VAST, Qualcomm or Meta.

## Requirements

- **Chip:** Snapdragon 8 Elite (SM8750, Hexagon V79) only. The compiled NPU files do not load on other chips.
- **RAM:** 16 GB. A conversion locks about 7.1 GB of RAM for the NPU. Phones with 12 GB are untested.
- **Storage:** 6.9 GB free for the model files.

## Files

Everything lives under `v2-fp32-merged-50step/` (30 files, 6.9 GB). `models_manifest.json` lists every file with its size and SHA-256 hash.

| Part                                                              | Files                                                   | Size    | Runs on                                                              |
| ----------------------------------------------------------------- | ------------------------------------------------------- | ------- | -------------------------------------------------------------------- |
| Transformer (1.44 B parameters), 23 parts merged into one session | `dit_chain.onnx`, `head/`, `blk00/` … `blk20/`, `tail/` | 5.2 GB  | NPU, QNN context binaries, FP32 weights                              |
| VAE decoder (latent pass + point query)                           | `vae_post/`, `vae_query/`                               | 0.4 GB  | NPU, QNN context binaries, weights stored at 16 bits by the compiler |
| DINOv2 image encoder (ViT-Large)                                  | `dinov2_encoder.onnx`                                   | 1.1 GB  | CPU, ONNX, FP32                                                      |
| u2net background remover                                          | `u2net.onnx`                                            | 0.16 GB | CPU, ONNX, FP32 (unchanged rembg release file)                       |

## How it was made

1. The [official TripoSG code](https://github.com/VAST-AI-Research/TripoSG) at commit `fc5c4099` with the [`VAST-AI/TripoSG`](https://huggingface.co/VAST-AI/TripoSG) weights at revision `2c1c516d` was exported to ONNX (FP32) one block at a time.
2. Each transformer and VAE part was compiled on [Qualcomm AI Hub](https://aihub.qualcomm.com) (QAIRT 2.50, target `Samsung Galaxy S25 (Family)`, which is SM8750) into a QNN context binary.
3. The 23 transformer binaries were wired into one ONNX Runtime session (`dit_chain.onnx`, EPContext nodes) so the NPU shares one scratch buffer. The output is bit-identical to running the 23 parts separately.

Run with ONNX Runtime 1.29 and the QNN 2.50 runtime (`onnxruntime-android-qnn`, `qnn-runtime`). The full pipeline, scripts and step-by-step rebuild guide are in the [Spotnack repository](https://github.com/spotnack/meta-ai-hackathon) (`ml/triposg-mobile/`, `docs/reproduce_from_scratch.md`).

## Quality and speed (Xiaomi 15 Ultra)

- 50 sampling steps, guidance 7.0. A conversion takes about 176 s, fully offline.
- On 5 test images, the phone's meshes pass the match thresholds against the official FP32 pipeline on a cloud GPU (Chamfer/diagonal ≤ 5.5e-3, F-score ≥ 0.917, IoU ≥ 0.958).

## Limitations

- Shape only: TripoSG generates geometry without color, so meshes are untextured.
- Works best with one object, fully in frame, on a plain background.
- SM8750 only, 16 GB RAM (see Requirements).

## Licenses

- **TripoSG weights and code** (including the DINOv2 encoder weights shipped in the TripoSG release): MIT, Copyright (c) 2025 VAST-AI-Research and contributors. See [LICENSE](LICENSE). TripoSG's own [NOTICE](NOTICE) about code it derives from other projects is reproduced in full.
- **u2net** (U-2-Net by Xuebin Qin et al., binary from the [rembg](https://github.com/danielgatis/rembg) release): Apache-2.0. See [LICENSE-u2net](LICENSE-u2net).
- **QNN context binaries:** compiled by Qualcomm AI Hub from the MIT-licensed model above.
