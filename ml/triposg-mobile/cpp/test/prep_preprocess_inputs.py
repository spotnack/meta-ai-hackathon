"""Decode the 5 eval source photos to raw RGB .npy for test_preprocess.

The C++ front-end test stays dependency-free (no PNG decoder), so this
script does the PNG decoding once with PIL: for each manifest image it
reads <TripoSG>/assets/example_data/<id>.png and writes
cpp/test/data/<id>.rgb.npy (H,W,3 uint8, RGB).

Run from the repo root (you run this):
~/anaconda3/envs/triposg-spike/bin/python \\
  ml/triposg-mobile/cpp/test/prep_preprocess_inputs.py
"""

import json
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path("ml/triposg-mobile")
TRIPOSG_DIR = Path.home() / ".cache" / "triposg" / "TripoSG"
MANIFEST = ROOT / "eval" / "manifest_5.json"
GOLDENS = ROOT / "reference" / "goldens_5"
OUT_DIR = ROOT / "cpp" / "test" / "data"


def main() -> None:
    """Decode every manifest source photo to .rgb.npy."""
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    manifest = json.loads(MANIFEST.read_text())
    for item in manifest["images"]:
        src = TRIPOSG_DIR / item["source"]
        rgb = np.asarray(Image.open(src).convert("RGB"))
        assert rgb.ndim == 3 and rgb.shape[2] == 3, src
        out = OUT_DIR / f"{item['id']}.rgb.npy"
        np.save(out, rgb)
        print(f"{item['id']} {rgb.shape} -> {out}")
        # Golden prepared canvas, for the isolated resample check.
        golden = np.asarray(
            Image.open(GOLDENS / item["id"] / "prepared_input.png").convert("RGB")
        )
        assert golden.ndim == 3 and golden.shape[2] == 3
        # prepare_image can leave the canvas 1 px off square (e.g. 2161x2160).
        gout = OUT_DIR / f"{item['id']}.prepared_golden.rgb.npy"
        np.save(gout, golden)
        print(f"{item['id']} golden prepared {golden.shape} -> {gout}")


if __name__ == "__main__":
    main()
