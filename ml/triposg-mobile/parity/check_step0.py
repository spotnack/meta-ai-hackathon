"""Parity gate for one transformer step: output vs golden noise_pred.

Thin wrapper over tensor_parity (single math implementation; see
parity/THRESHOLDS.md). Gate defaults come from parity/thresholds.json
(component step0_noise_pred); CLI flags override them.

Usage:
  python -u parity/check_step0.py OUTPUT.npy GOLDEN.npy \
      [--cos-min 0.999] [--l2-max 0.01]

Prints whole-tensor metrics, per-batch-row metrics (row 0 = uncond,
row 1 = cond), then PASS/FAIL. Exit 0 = gate pass, 1 = fail.
Needs only numpy (already in the triposg-spike env).
"""

import argparse
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from tensor_parity import (  # noqa: E402
    compare_all,
    format_line,
    gate,
    load_thresholds,
)

COMPONENT = "step0_noise_pred"


def main() -> int:
    """Compare two .npy files and apply the step-0 gate."""
    parser = argparse.ArgumentParser()
    parser.add_argument("output")
    parser.add_argument("golden")
    parser.add_argument("--cos-min", type=float, default=None)
    parser.add_argument("--l2-max", type=float, default=None)
    args = parser.parse_args()

    got = np.load(args.output)
    ref = np.load(args.golden)
    try:
        result = compare_all(got, ref)
    except ValueError as error:
        print(f"FAIL {error}")
        return 1

    print(format_line(result["whole"]))
    for i, row in enumerate(result["rows"]):
        print(f"row{i}: {format_line(row)}")

    thresholds = load_thresholds()
    if args.cos_min is not None:
        thresholds[COMPONENT]["cosine_min"] = args.cos_min
    if args.l2_max is not None:
        thresholds[COMPONENT]["rel_l2_max"] = args.l2_max
    verdict = gate(COMPONENT, result, thresholds)
    if verdict["pass"]:
        print("PASS")
        return 0
    print(f"FAIL gate ({COMPONENT}): " + "; ".join(verdict["reasons"]))
    return 1


if __name__ == "__main__":
    sys.exit(main())
