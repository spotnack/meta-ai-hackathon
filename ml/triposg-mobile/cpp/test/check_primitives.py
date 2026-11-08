"""Bit-exact primitive checks: C++ ports vs PIL/cv2/transformers.

Generates synthetic + real-image cases, runs each through the real
library and primitives_probe (which calls the shipped module code),
and requires byte equality for every case. Exits nonzero on the first
mismatch, printing max abs diff, its location, and the case.

Usage (you run this, or the agent in its sandbox):
  triposg-spike/bin/python ml/triposg-mobile/cpp/test/check_primitives.py \\
    <probe-bin> [workdir]
"""

import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image
from transformers.image_transforms import center_crop
from transformers.image_transforms import get_resize_output_image_size

MODES = {1: "L", 3: "RGB", 4: "RGBA"}
FILTERS = {
    "lanczos": Image.LANCZOS,
    "bicubic": Image.BICUBIC,
}
rng = np.random.default_rng(7)


def run_probe(probe, *args):
    """Run the probe CLI; raise on failure."""
    cmd = [str(probe), *map(str, args)]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"probe {' '.join(cmd[1:])} failed: {proc.stderr}")
    return proc.stdout.strip()


def check_equal(name, got_path, want, workdir):
    """Require byte equality; report max diff + location on mismatch."""
    got = np.load(workdir / got_path)
    # cv2 drops trailing singleton dims for single-channel output
    # (256,256) vs the probe's (256,256,1); compare bytes when the
    # element count matches.
    if got.shape != want.shape and got.size == want.size:
        got = got.reshape(want.shape)
    ok = got.shape == want.shape and bool(np.all(got == want))
    if ok:
        print(f"{name}: EXACT {want.shape}")
        return True
    if got.shape != want.shape:
        print(f"{name}: SHAPE {got.shape} vs {want.shape} FAIL")
        return False
    diff = np.abs(got.astype(np.int16) - want.astype(np.int16))
    loc = np.unravel_index(int(np.argmax(diff)), diff.shape)
    print(
        f"{name}: maxabs {diff.max()} at {loc} " f"got {got[loc]} want {want[loc]} FAIL"
    )
    return False


def main() -> None:
    """Run every primitive case; exit nonzero on any mismatch."""
    probe = Path(sys.argv[1])
    workdir = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("prim-cases")
    workdir.mkdir(parents=True, exist_ok=True)
    data = Path("ml/triposg-mobile/cpp/test/data")
    all_ok = True

    photo = np.load(data / "hjswed.rgb.npy")
    assert photo.dtype == np.uint8 and photo.shape == (2048, 2048, 3)

    # Pillow resize: filters x channels x shapes (down, up, non-square).
    shapes = [
        ((2048, 2048), (320, 320)),
        ((320, 320), (2048, 2048)),
        ((100, 77), (55, 43)),
        ((517, 333), (256, 256)),
        ((2161, 2160), (256, 256)),
        ((1024, 1024), (320, 320)),
        ((7, 5), (5, 7)),
    ]
    for fname, pil_filter in FILTERS.items():
        for ch in (1, 3, 4):
            for (sh, sw), (dh, dw) in shapes:
                if (sh, sw) == (2048, 2048) and ch == 3:
                    base = photo
                elif (sh, sw) == (2048, 2048) and ch == 1:
                    base = np.asarray(Image.fromarray(photo).convert("L"))[:, :, None]
                elif (sh, sw) == (2048, 2048):
                    base = np.concatenate(
                        [photo, np.full((sh, sw, 1), 200, dtype=np.uint8)], axis=2
                    )
                else:
                    base = rng.integers(0, 256, (sh, sw, ch), dtype=np.uint8)
                src = base.reshape(sh, sw, ch)
                np.save(workdir / "in.npy", src)
                run_probe(
                    probe,
                    "resize",
                    fname,
                    workdir / "in.npy",
                    workdir / "out.npy",
                    dw,
                    dh,
                )
                want = np.asarray(
                    Image.fromarray(
                        src.reshape(sh, sw) if ch == 1 else src, MODES[ch]
                    ).resize((dw, dh), pil_filter)
                )
                if ch == 1:
                    want = want[:, :, None]
                name = f"resize/{fname}/c{ch}/{sw}x{sh}->{dw}x{dh}"
                all_ok &= check_equal(name, "out.npy", want, workdir)
                if not all_ok:
                    raise SystemExit(1)

    # Composite with L mask (RGB bands + alpha).
    masks = {
        "random": rng.integers(
            0, 256, (photo.shape[0], photo.shape[1]), dtype=np.uint8
        ),
        "zeros": np.zeros(photo.shape[:2], dtype=np.uint8),
        "full": np.full(photo.shape[:2], 255, dtype=np.uint8),
        "gradient": np.tile(
            np.arange(photo.shape[1], dtype=np.uint8)[None, :], (photo.shape[0], 1)
        ),
    }
    for mname, mask in masks.items():
        np.save(workdir / "src.npy", photo)
        np.save(workdir / "mask.npy", mask)
        run_probe(
            probe,
            "composite",
            workdir / "src.npy",
            workdir / "mask.npy",
            workdir / "out.npy",
        )
        want = np.asarray(
            Image.composite(
                Image.fromarray(photo),
                Image.new("RGBA", (photo.shape[1], photo.shape[0]), (0, 0, 0, 0)),
                Image.fromarray(mask),
            )
        )
        name = f"composite/{mname}"
        all_ok &= check_equal(name, "out.npy", want, workdir)
        if not all_ok:
            raise SystemExit(1)

    # INTER_AREA downscales (downscale only: upscale takes another path).
    cutout = np.load(data / "rembg_cpu" / "hjswed.cutout.npy")
    area_cases = [
        (cutout, 2000, 2000),
        (rng.integers(0, 256, (100, 77, 3), dtype=np.uint8), 55, 43),
        (rng.integers(0, 256, (517, 333, 1), dtype=np.uint8), 256, 256),
        (rng.integers(0, 256, (33, 17, 4), dtype=np.uint8), 16, 8),
        (rng.integers(0, 256, (480, 640, 3), dtype=np.uint8), 150, 200),
    ]
    for i, (src, dw, dh) in enumerate(area_cases):
        np.save(workdir / "in.npy", src)
        run_probe(probe, "area", workdir / "in.npy", workdir / "out.npy", dw, dh)
        want = cv2.resize(src, (dw, dh), interpolation=cv2.INTER_AREA)
        name = f"area/case{i}/{src.shape[1]}x{src.shape[0]}->{dw}x{dh}"
        all_ok &= check_equal(name, "out.npy", want, workdir)
        if not all_ok:
            raise SystemExit(1)

    # transformers geometry: sizes + crop window on a known array.
    for w, h in [
        (2161, 2160),
        (797, 797),
        (1228, 1228),
        (1000, 1001),
        (1968, 1967),
        (320, 320),
        (55, 43),
    ]:
        probed = run_probe(probe, "dinosize", w, h).split()
        nw, nh, ox, oy = map(int, probed)
        oh, ow = get_resize_output_image_size(
            np.zeros((h, w, 3), dtype=np.uint8), 256, default_to_square=False
        )
        known = np.arange(h * w * 3, dtype=np.uint8).reshape(h, w, 3)
        # Crop offsets are in resized-image coordinates: resize first,
        # then compare the probe window against transformers center_crop.
        resized = np.asarray(Image.fromarray(known).resize((ow, oh), Image.BICUBIC))
        cropped = center_crop(resized, (224, 224))
        mine = resized[oy : oy + 224, ox : ox + 224]
        ok = (
            (nw, nh) == (ow, oh)
            and mine.shape == cropped.shape
            and bool(np.all(mine == cropped))
        )
        print(
            f"dinosize/{w}x{h}: probe=({nw},{nh},{ox},{oy}) "
            f"ref=({ow},{oh}) {'EXACT' if ok else 'FAIL'}"
        )
        all_ok &= ok
        if not all_ok:
            raise SystemExit(1)

    # Mask quality stats (AnalyzeMask): synthetic alpha fixtures. Floats
    # compare within 1e-6 (C++ float32 division vs numpy float64),
    # component counts exactly.
    def mask_stats(mask):
        top = mask[0, :] > 0
        bottom = mask[-1, :] > 0
        left = mask[:, 0] > 0
        right = mask[:, -1] > 0
        border = max(top.mean(), bottom.mean(), left.mean(), right.mean())
        area = (mask > 0).mean()
        # 4-connected components, pure Python (no scipy dependency).
        h, w = mask.shape
        seen = np.zeros_like(mask, dtype=bool)
        big = 0
        if area > 0:
            need = int(area * h * w * 0.05) + 1
            for y in range(h):
                for x in range(w):
                    if mask[y, x] == 0 or seen[y, x]:
                        continue
                    size = 0
                    stack = [(x, y)]
                    seen[y, x] = True
                    while stack:
                        cx, cy = stack.pop()
                        size += 1
                        for nx, ny in (
                            (cx - 1, cy),
                            (cx + 1, cy),
                            (cx, cy - 1),
                            (cx, cy + 1),
                        ):
                            if (
                                0 <= nx < w
                                and 0 <= ny < h
                                and mask[ny, nx] > 0
                                and not seen[ny, nx]
                            ):
                                seen[ny, nx] = True
                                stack.append((nx, ny))
                    if size >= need:
                        big += 1
        return border, area, big

    clean = np.zeros((100, 100), dtype=np.uint8)
    clean[30:70, 30:70] = 200
    cropped = np.zeros((100, 100), dtype=np.uint8)
    cropped[20:80, 0:60] = 200  # touches the left edge along 60 rows
    two = np.zeros((100, 100), dtype=np.uint8)
    two[10:30, 10:30] = 200
    two[60:80, 60:80] = 200
    speckled = np.zeros((100, 100), dtype=np.uint8)
    speckled[30:70, 30:70] = 200
    speckled[5:7, 5:7] = 200  # 4 px speck: 0.25% of the mask, not big
    speckled[90:92, 80:82] = 200
    empty = np.zeros((100, 100), dtype=np.uint8)
    for mname, mask in [
        ("clean", clean),
        ("cropped", cropped),
        ("two", two),
        ("speckled", speckled),
        ("empty", empty),
    ]:
        np.save(workdir / "mask.npy", mask)
        probed = run_probe(probe, "maskstats", workdir / "mask.npy").split()
        border, area, big = float(probed[0]), float(probed[1]), int(probed[2])
        want_border, want_area, want_big = mask_stats(mask)
        ok = (
            abs(border - want_border) < 1e-6
            and abs(area - want_area) < 1e-6
            and big == want_big
        )
        print(
            f"maskstats/{mname}: probe=({border:.4f},{area:.4f},{big}) "
            f"ref=({want_border:.4f},{want_area:.4f},{want_big}) "
            f"{'EXACT' if ok else 'FAIL'}"
        )
        all_ok &= ok
        if not all_ok:
            raise SystemExit(1)

    print("PRIMITIVES " + ("ALL EXACT" if all_ok else "FAIL"))
    sys.exit(0 if all_ok else 1)


if __name__ == "__main__":
    main()
