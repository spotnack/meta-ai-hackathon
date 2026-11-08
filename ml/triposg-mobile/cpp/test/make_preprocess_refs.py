"""Bit-exact local references for the C++ front-end port.

For every eval id this runs the REAL reference code on CPU and saves,
under cpp/test/data/refs/:
  <id>.cutout.png       RGBA cutout (rewritten from data/rembg_cpu/)
  <id>.resized2000.npy  RGBA after load_image's cv2 2000-px resize (H,W,4)
  <id>.prepared.npy     load_image canvas (H,W,3 uint8)
  <id>.pixel_values.npy BitImageProcessor output (float32)

load_image comes from TripoSG's clone at fc5c4099 with Tensor.cuda
patched to a no-op (the function is device-agnostic; only the .cuda()
calls need neutralizing). The cutouts themselves were made in the base
Anaconda python, because rembg 2.0.86 installs only there — see
data/rembg_cpu/ (CPU run matches the golden input_rgba.png to 1 LSB).

Per-id and light by construction (one id at a time, no u2net load), so
no memwatch/systemd wrapper is needed.

Run from the repo root (you run this):
~/anaconda3/envs/triposg-spike/bin/python \\
  ml/triposg-mobile/cpp/test/make_preprocess_refs.py
"""

import gc
import json
import sys
from pathlib import Path

import cv2
import numpy as np
import torch
from PIL import Image
from transformers import BitImageProcessor

sys.path.insert(0, str(Path.home() / ".cache" / "triposg" / "TripoSG" / "scripts"))
sys.path.insert(0, "ml/triposg-mobile/parity")
from image_process import load_image  # noqa: E402
from tensor_parity import compare  # noqa: E402

# load_image is device-agnostic except for .cuda() calls.
torch.Tensor.cuda = lambda self, *args, **kwargs: self  # type: ignore

ROOT = Path("ml/triposg-mobile")
DATA = ROOT / "cpp" / "test" / "data"
REFS = DATA / "refs"
GOLDENS = ROOT / "reference" / "goldens_5"
MANIFEST = ROOT / "eval" / "manifest_5.json"
FE_DIR = ROOT / "pretrained_weights" / "feature_extractor_dinov2"
WHITE = np.array([1.0, 1.0, 1.0])


def load_cutout(ident: str) -> np.ndarray:
    """Read the rembg_cpu cutout reference (H,W,4 uint8)."""
    cutout = np.load(DATA / "rembg_cpu" / f"{ident}.cutout.npy")
    assert cutout.dtype == np.uint8 and cutout.ndim == 3
    assert cutout.shape[2] == 4, cutout.shape
    return cutout


def cv2_resize_stage(png_path: Path) -> np.ndarray:
    """Replicate load_image's 2000-px cv2 block; return RGBA (H,W,4).

    cv2 works in BGRA order; the reference is converted to RGBA so the
    exact gate compares like with like against the C++ RGBA image.
    """
    img = cv2.imread(str(png_path), cv2.IMREAD_UNCHANGED)
    assert img is not None and img.ndim == 3 and img.shape[2] == 4
    height, width = img.shape[:2]
    if height > width:
        scale = 2000 / height
    else:
        scale = 2000 / width
    if scale < 1:
        new_size = (int(width * scale), int(height * scale))
        img = cv2.resize(img, new_size, interpolation=cv2.INTER_AREA)
    return cv2.cvtColor(img, cv2.COLOR_BGRA2RGBA)


def main() -> None:
    """Build every stage reference and print the ref-vs-golden table."""
    REFS.mkdir(parents=True, exist_ok=True)
    manifest = json.loads(MANIFEST.read_text())
    processor = BitImageProcessor.from_pretrained(FE_DIR)
    for item in manifest["images"]:
        ident = item["id"]
        cutout = load_cutout(ident)
        png_path = REFS / f"{ident}.cutout.png"
        Image.fromarray(cutout, mode="RGBA").save(png_path)

        resized = cv2_resize_stage(png_path)
        np.save(REFS / f"{ident}.resized2000.npy", resized)

        canvas = load_image(str(png_path), bg_color=WHITE, rmbg_net=None)
        if isinstance(canvas, str):
            raise RuntimeError(f"{ident}: load_image failed: {canvas}")
        prepared = (canvas.permute(1, 2, 0).numpy() * 255).astype(np.uint8)
        np.save(REFS / f"{ident}.prepared.npy", prepared)

        pixel_values = (
            processor(Image.fromarray(prepared), return_tensors="pt")["pixel_values"]
            .numpy()
            .astype(np.float32)
        )
        np.save(REFS / f"{ident}.pixel_values.npy", pixel_values)

        golden_prepared = np.asarray(
            Image.open(GOLDENS / ident / "prepared_input.png").convert("RGB")
        )
        golden_pv = np.load(GOLDENS / ident / "dinov2_pixel_values.npy")
        stats = compare(pixel_values, golden_pv)
        shape_ok = prepared.shape == golden_prepared.shape
        print(
            f"{ident}: resized {resized.shape} prepared {prepared.shape} "
            f"vs golden {golden_prepared.shape} "
            f"{'SHAPE-OK' if shape_ok else 'SHAPE-MISMATCH'} "
            f"pv rel_l2 {stats['rel_l2']:.2e} cosine {stats['cosine']:.7f}"
        )
        del cutout, resized, canvas, prepared, pixel_values
        gc.collect()
    print("refs written to", REFS)


if __name__ == "__main__":
    main()
