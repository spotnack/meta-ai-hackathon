<div align='center'>
  <h1> Reproduce From Scratch </h1>
</div>

# Introduction

This file explains how to reproduce this project from a fresh clone to on-device TripoSG inference on your own phone.

Summary: export the PyTorch model to ONNX on a laptop, compile it for the phone's NPU on Qualcomm AI Hub, and sideload the result over USB.

To only try the app on a supported phone, you don't need to rebuild anything: the compiled model set is on Hugging Face ([spotnack/triposg-sm8750-qnn](https://huggingface.co/spotnack/triposg-sm8750-qnn)), and the on-device build downloads it when you tap **Download**.

# Requirements

- **Phone:** Snapdragon 8 Elite (SM8750) with 16 GB RAM and USB debugging on. The compiled models only run on this chip.

- **Laptop:** Linux, 16 GB RAM (each export step peaks near 9 GB) and about 50 GB of free disk space.

- **Tools:** conda, Node + Yarn ([Install Dependencies](../README.md#dependencies)), Android SDK + NDK, JDK 17 and `adb`.

- **Accounts:** a free [Qualcomm AI Hub](https://aihub.qualcomm.com) account (for the compile step) and a Google account for Colab. The weights download needs no login.

All commands run from the repository root unless a step says otherwise.

# 1. Python environment, TripoSG code and AI Hub token

```bash
conda env create -f src/spotnack-muse/environment.yml && conda activate spotnack-muse
git clone https://github.com/VAST-AI-Research/TripoSG.git ~/.cache/triposg/TripoSG
git -C ~/.cache/triposg/TripoSG checkout fc5c40990181e2a756c4e0b1c2f4d6b5202faf8c
qai-hub configure --api_token <your AI Hub token>   # token: AI Hub → Account → Settings
```

# 2. Download the original weights (about 7.6 GB)

```bash
W=ml/triposg-mobile/pretrained_weights
huggingface-cli download VAST-AI/TripoSG --revision 2c1c516d22d58db486a058d98d31bb6177344e06 --local-dir $W
mkdir -p $W/u2net && curl -L -o $W/u2net/u2net.onnx https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net.onnx
sha256sum $W/u2net/u2net.onnx   # must be 8d10d2f3bb75ae3b6d527c77944fc5e7dcd94b29809d47a739a7a728a912b491
```

# 3. Golden reference set (Colab GPU, required)

The export scripts trace and check each part of the model against the GPU results, so this step can't be skipped. Open [triposg_golden_5.ipynb](../ml/triposg-mobile/reference/triposg_golden_5.ipynb) in Colab with a T4 GPU runtime (free tier) and run all cells. It takes about 8 minutes per image. Download the `goldens_5.zip` it produces, then:

```bash
unzip -o goldens_5.zip -d ml/triposg-mobile/reference/
```

The notebook records the weights revision it used: it should be `2c1c516d`, the one from step 2.

# 4. Export the model to ONNX (FP32, laptop CPU)

`CAP` caps each process at 9 GB, so a memory spike kills only the export instead of freezing the laptop. Skip it on non-Linux systems.

```bash
CAP="systemd-run --user --scope -p MemoryMax=9G -p MemorySwapMax=0"
$CAP python -u ml/triposg-mobile/bench/split_export_step.py --all-b1   # transformer: 23 parts
$CAP python -u ml/triposg-mobile/bench/export_vae.py --unit post        # VAE latent pass
$CAP python -u ml/triposg-mobile/bench/export_vae.py --unit query       # VAE point query
$CAP python -u ml/triposg-mobile/bench/spike_dinov2_export.py           # image encoder (runs on the phone CPU)
```

# 5. Compile for the NPU on Qualcomm AI Hub, then merge

Qualcomm's QAIRT SDK can build context binaries offline on a Linux x86-64 laptop with tools such as `qnn-onnx-converter` and `qnn-context-binary-generator`, however, this project uses Qualcomm AI Hub.

AI Hub uploads each ONNX part, compiles it into a QNN context binary for SM8750, and downloads the result.

```bash
python -u ml/triposg-mobile/bench/aihub_compile.py                        # 23 transformer parts
python -u ml/triposg-mobile/bench/aihub_compile.py --stems vae_post,vae_query
python -u ml/triposg-mobile/bench/merge_chain.py ml/triposg-mobile/logs/spike/aihub ml/triposg-mobile/logs/spike/merged/fp32
python ml/triposg-mobile/bench/make_model_manifest.py --version v2-fp32-merged-50step \
  --merged-dir ml/triposg-mobile/logs/spike/merged/fp32 \
  --out ml/triposg-mobile/logs/spike/models_manifest_merged.json \
  --js-out src/spotnack-muse/client/src/features/image-to-3d/infrastructure/triposg-models.manifest.js
```

The manifest lists every model file with its size and SHA-256 hash, and its copy is compiled into the app so the app can check the sideloaded files.

# 6. Build and install the on-device app

With the phone connected over USB:

```bash
cd src/spotnack-muse/client && yarn install
APP_VARIANT=ondevice EXPO_PUBLIC_IMAGE_TO_3D_MODE=ondevice EXPO_PUBLIC_AUTH_MODE=demo npx expo prebuild -p android
APP_VARIANT=ondevice EXPO_PUBLIC_IMAGE_TO_3D_MODE=ondevice EXPO_PUBLIC_AUTH_MODE=demo npx expo run:android --variant release
cd ../../..
```

Open the app once, so Android creates its storage folder.

# 7. Sideload the models (about 6.9 GB)

```bash
SERIAL=<adb serial> VERSION=v2-fp32-merged-50step \
  MERGED=ml/triposg-mobile/logs/spike/merged/fp32 \
  MANIFEST=ml/triposg-mobile/logs/spike/models_manifest_merged.json \
  sh ml/triposg-mobile/bench/sideload_models.sh
```

In the app, tap **Verify** next to "TripoSG models". It hashes all files, which takes a few minutes. Then pick a photo and tap **Convert to 3D**. A conversion takes about 3 minutes.

# 8. Optional: check the output against the GPU

[ml/triposg-mobile/README.md](../ml/triposg-mobile/README.md) ("Reproduce Phase 4") explains how to run the app's pipeline on the 5 golden inputs and grade the meshes with `ml/triposg-mobile/parity/run_phase1.py`.
