"""Grade the C++ front-end outputs against local refs and goldens.

Per eval id, test_preprocess writes <id>.cutout.npy,
<id>.resized2000.npy, <id>.prepared.npy, <id>.pixel_values.npy and
<id>.pixel_values_from_golden.npy, plus stage-isolated
<id>.resized2000_iso.npy, <id>.prepared_iso.npy and
<id>.pixel_values_iso.npy (each stage rerun on the reference input);
make_preprocess_refs.py writes the refs/<id>.* bit-exact references
using the real cv2/torch/transformers code.

Gates (uint8 diffs are per-channel max abs on 0..255):
  C++ vs local reference (port exactness, stage-isolated so the only
  allowed difference source — u2net ORT CPU float, <= 1 LSB in the
  cutout — cannot cascade into them):
    cutout:       max abs <= 1, same shape   (rembg flow)
    resized2000_iso:  max abs == 0, same shape   (INTER_AREA port)
    prepared_iso:     max abs <= 1, same shape   (prepare_image port)
    pixel_values_iso: rel_l2 <= 1e-5             (DINOv2 preprocessing port)
  C++ vs goldens (reference fidelity):
    prepared shape equals prepared_input.png
    pixel_values and pixel_values_from_golden vs dinov2_pixel_values.npy:
      rel_l2 <= 2.5e-3 (the measured TripoSG-CPU-vs-golden floor is
      2.24e-3 on yuyyuw, so the gate sits just above it)

Run from the repo root (you run this):
~/anaconda3/envs/triposg-spike/bin/python \\
  ml/triposg-mobile/cpp/test/check_preprocess.py <test-out-dir>
Prints a per-id table; exits nonzero on any failure.
"""

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, "ml/triposg-mobile/parity")
from tensor_parity import compare  # noqa: E402

ROOT = Path("ml/triposg-mobile")
GOLDENS = ROOT / "reference" / "goldens_5"
DATA = ROOT / "cpp" / "test" / "data"
REFS = DATA / "refs"
MANIFEST = ROOT / "eval" / "manifest_5.json"

CUTOUT_MAX_ABS = 1.0
RESIZED_MAX_ABS = 0.0
PREPARED_MAX_ABS = 1.0
PIXEL_REL_L2 = 1e-5
GOLDEN_PIXEL_REL_L2 = 2.5e-3


def check_u8(name: str, got: np.ndarray, want: np.ndarray, max_abs: float) -> bool:
    """Compare two uint8 HWC arrays; report per-channel worst and gate."""
    ok = got.dtype == np.uint8 and want.dtype == np.uint8 and got.shape == want.shape
    worst = 0.0
    if ok:
        for c in range(got.shape[2]):
            diff = np.abs(
                got[:, :, c].astype(np.int16) - want[:, :, c].astype(np.int16)
            )
            worst = max(worst, float(diff.max()))
    passed = ok and worst <= max_abs
    print(
        f"{name}: shape {got.shape} vs {want.shape} "
        f"maxabs {worst:.1f} (gate {max_abs:g}) "
        f"{'PASS' if passed else 'FAIL'}"
    )
    return passed


def check_t(name: str, got: np.ndarray, want: np.ndarray, rel_l2_max: float) -> bool:
    """Compare two float arrays with the tensor comparator and gate."""
    ok = got.shape == want.shape
    stats = (
        compare(got, want) if ok else {"rel_l2": float("nan"), "cosine": float("nan")}
    )
    passed = ok and stats["rel_l2"] <= rel_l2_max
    print(
        f"{name}: shape {got.shape} vs {want.shape} "
        f"rel_l2 {stats['rel_l2']:.2e} (gate {rel_l2_max:g}) "
        f"cosine {stats['cosine']:.7f} "
        f"{'PASS' if passed else 'FAIL'}"
    )
    return passed


def main() -> None:
    """Grade every eval id; exit nonzero on failure."""
    out_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("out")
    manifest = json.loads(MANIFEST.read_text())
    all_ok = True
    for item in manifest["images"]:
        ident = item["id"]
        golden_dir = GOLDENS / ident

        all_ok &= check_u8(
            f"{ident} cutout",
            np.load(out_dir / f"{ident}.cutout.npy"),
            np.load(DATA / "rembg_cpu" / f"{ident}.cutout.npy"),
            CUTOUT_MAX_ABS,
        )
        all_ok &= check_u8(
            f"{ident} resized2000_iso",
            np.load(out_dir / f"{ident}.resized2000_iso.npy"),
            np.load(REFS / f"{ident}.resized2000.npy"),
            RESIZED_MAX_ABS,
        )
        all_ok &= check_u8(
            f"{ident} prepared_iso",
            np.load(out_dir / f"{ident}.prepared_iso.npy"),
            np.load(REFS / f"{ident}.prepared.npy"),
            PREPARED_MAX_ABS,
        )
        all_ok &= check_t(
            f"{ident} pixel_values_iso",
            np.load(out_dir / f"{ident}.pixel_values_iso.npy"),
            np.load(REFS / f"{ident}.pixel_values.npy"),
            PIXEL_REL_L2,
        )

        want_prep = np.asarray(
            Image.open(golden_dir / "prepared_input.png").convert("RGB")
        )
        got_prep = np.load(out_dir / f"{ident}.prepared.npy")
        shape_ok = got_prep.shape == want_prep.shape
        print(
            f"{ident} prepared-vs-golden: shape {got_prep.shape} "
            f"vs {want_prep.shape} "
            f"{'PASS' if shape_ok else 'FAIL'}"
        )
        all_ok &= shape_ok
        want_pv = np.load(golden_dir / "dinov2_pixel_values.npy")
        all_ok &= check_t(
            f"{ident} pixel_values-vs-golden",
            np.load(out_dir / f"{ident}.pixel_values.npy"),
            want_pv,
            GOLDEN_PIXEL_REL_L2,
        )
        all_ok &= check_t(
            f"{ident} pixel_values_from_golden-vs-golden",
            np.load(out_dir / f"{ident}.pixel_values_from_golden.npy"),
            want_pv,
            GOLDEN_PIXEL_REL_L2,
        )
    print("OVERALL " + ("PASS" if all_ok else "FAIL"))
    sys.exit(0 if all_ok else 1)


if __name__ == "__main__":
    main()
