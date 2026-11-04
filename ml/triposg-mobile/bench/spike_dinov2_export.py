"""Export the TripoSG DINOv2 encoder to ONNX and save a CPU baseline.

Reads the encoder-only checkpoint files under
ml/triposg-mobile/pretrained_weights/ (git-ignored). Needs the
triposg-spike conda env. Run from the repo root:
~/anaconda3/envs/triposg-spike/bin/python
ml/triposg-mobile/bench/spike_dinov2_export.py
"""

import hashlib
from pathlib import Path

import numpy as np
import torch
from transformers import BitImageProcessor, Dinov2Model

ROOT = Path("ml/triposg-mobile")
ENC_DIR = ROOT / "pretrained_weights" / "image_encoder_dinov2"
FE_DIR = ROOT / "pretrained_weights" / "feature_extractor_dinov2"
OUT_DIR = ROOT / "logs" / "spike"
MANIFEST = ROOT / "eval" / "manifest_5.json"
# Golden preprocessed input (1, 3, 224, 224): the exact tensor the phone
# runs. The 518-px random input from the first spike is superseded.
GOLDEN_PIXEL_VALUES = (
    ROOT / "reference" / "goldens_5" / "hjswed" / "dinov2_pixel_values.npy"
)
GOLDEN_LAST_HIDDEN = (
    ROOT / "reference" / "goldens_5" / "hjswed" / "dinov2_last_hidden_state.npy"
)


def sha_of(array: np.ndarray) -> str:
    """Return the hex sha256 of an array's bytes."""
    return hashlib.sha256(np.ascontiguousarray(array).tobytes()).hexdigest()


def main() -> None:
    """Load encoder, export ONNX, and save the CPU baseline output."""
    import json

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    encoder = Dinov2Model.from_pretrained(ENC_DIR, dtype=torch.float32)
    encoder.eval()
    processor = BitImageProcessor.from_pretrained(FE_DIR)

    manifest = json.loads(MANIFEST.read_text())
    first = manifest["images"][0]["source"]
    print(f"first manifest input: {first}")

    pixel_values = torch.from_numpy(np.load(GOLDEN_PIXEL_VALUES))
    print(f"trace input {tuple(pixel_values.shape)} (golden 224px)")
    with torch.no_grad():
        baseline = encoder(pixel_values).last_hidden_state.numpy()
    np.save(OUT_DIR / "dinov2_cpu_baseline.npy", baseline)
    golden = np.load(GOLDEN_LAST_HIDDEN)
    print(
        f"baseline {baseline.shape} sha {sha_of(baseline)}, "
        f"vs golden maxabs "
        f"{float(np.max(np.abs(baseline - golden))):.2e}"
    )

    torch.onnx.export(
        encoder,
        (pixel_values,),
        OUT_DIR / "dinov2_encoder.onnx",
        input_names=["pixel_values"],
        output_names=["last_hidden_state"],
        dynamic_axes={"pixel_values": {0: "batch"}},
        opset_version=17,
    )
    print(f"preprocessor: {processor.size}")


if __name__ == "__main__":
    main()
