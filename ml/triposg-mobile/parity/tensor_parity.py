"""Generic per-component tensor comparator with file-backed gate thresholds.

One math implementation shared by every tensor parity check (DINOv2 hidden
states, one-step noise_pred, final latents, ...), so gates cannot drift
apart. Metrics per array:

- max_abs / mean_abs: absolute error scale.
- rel_l2: ||got - ref|| / ||ref|| (0/0 -> 0.0, x/0 -> inf).
- cosine: flat cosine similarity (1.0 when both sides are all zeros,
  0.0 when exactly one side is), clipped to [-1, 1] against float
  roundoff (identical arrays can otherwise read 1.0000000000000002).

Per batch row: the same metrics for each row, so a bad uncond/cond row in
a guided step shows up separately from the whole-tensor numbers.

Gate thresholds live in parity/thresholds.json (fixed before
optimization; see parity/THRESHOLDS.md). CLI flags override the file.

Usage:
  python -u parity/tensor_parity.py OUTPUT.npy GOLDEN.npy \
      [--component step0_noise_pred] [--thresholds parity/thresholds.json] \
      [--cos-min X] [--l2-max Y] [--json OUT.json]

Without --component the metrics are reported with no gate (exit 0).
With --component the file's gate applies (exit 0 pass, 1 fail).
Needs only numpy.
"""

import argparse
import json
import sys
from pathlib import Path

import numpy as np

DEFAULT_THRESHOLDS = Path(__file__).resolve().parent / "thresholds.json"


def compare(got: np.ndarray, ref: np.ndarray) -> dict:
    """Compare two arrays; return max_abs/mean_abs/rel_l2/cosine + finite."""
    got = np.asarray(got, dtype=np.float64)
    ref = np.asarray(ref, dtype=np.float64)
    finite = bool(np.isfinite(got).all() and np.isfinite(ref).all())
    diff = got - ref
    diff_norm = float(np.linalg.norm(diff.ravel()))
    ref_norm = float(np.linalg.norm(ref.ravel()))
    got_norm = float(np.linalg.norm(got.ravel()))
    if ref_norm > 0:
        rel_l2 = diff_norm / ref_norm
    else:
        rel_l2 = 0.0 if diff_norm == 0 else float("inf")
    if got_norm == 0 and ref_norm == 0:
        cosine = 1.0
    elif got_norm == 0 or ref_norm == 0:
        cosine = 0.0
    else:
        raw = got.ravel().dot(ref.ravel()) / got_norm / ref_norm
        cosine = float(np.clip(raw, -1.0, 1.0))
    return {
        "max_abs": float(np.abs(diff).max()),
        "mean_abs": float(np.abs(diff).mean()),
        "rel_l2": float(rel_l2),
        "cosine": float(cosine),
        "finite": finite,
    }


def compare_all(got: np.ndarray, ref: np.ndarray) -> dict:
    """Whole-tensor metrics plus per-batch-row metrics (row order kept)."""
    got = np.asarray(got)
    ref = np.asarray(ref)
    if got.shape != ref.shape:
        raise ValueError(f"shape {got.shape} != golden {ref.shape}")
    out = {
        "shape": list(got.shape),
        "whole": compare(got, ref),
        "rows": [compare(got[i], ref[i]) for i in range(got.shape[0])],
    }
    return out


def load_thresholds(path: str | Path = DEFAULT_THRESHOLDS) -> dict:
    """Load the thresholds file ({component: {metric: bound, ...}})."""
    with open(path) as handle:
        data = json.load(handle)
    return data.get("components", data)


def gate(component: str, result: dict, thresholds: dict) -> dict:
    """Apply one component's gate; return {pass, reasons} (never raises)."""
    bounds = thresholds.get(component)
    if bounds is None:
        return {
            "pass": False,
            "reasons": [f"no thresholds entry for {component!r}"],
        }
    whole = result["whole"]
    checks = [
        ("cosine", whole["cosine"], bounds.get("cosine_min"), "min"),
        ("rel_l2", whole["rel_l2"], bounds.get("rel_l2_max"), "max"),
        ("max_abs", whole["max_abs"], bounds.get("max_abs_max"), "max"),
        ("mean_abs", whole["mean_abs"], bounds.get("mean_abs_max"), "max"),
    ]
    reasons = []
    if not whole["finite"]:
        reasons.append("non-finite values")
    for name, value, bound, kind in checks:
        if bound is None:
            continue
        ok = value >= bound if kind == "min" else value <= bound
        if not ok:
            op = ">=" if kind == "min" else "<="
            reasons.append(f"{name}={value:.3e} violates {kind} {op}{bound}")
    return {"pass": not reasons, "reasons": reasons}


def format_line(numbers: dict) -> str:
    """One-line metric summary (matches the old check_step0.py format)."""
    return (
        f"max_abs={numbers['max_abs']:.3e} "
        f"mean_abs={numbers['mean_abs']:.3e} "
        f"rel_l2={numbers['rel_l2']:.3e} "
        f"cosine={numbers['cosine']:.7f}"
    )


def main() -> int:
    """Compare two .npy files, optionally gating on a named component."""
    parser = argparse.ArgumentParser()
    parser.add_argument("output")
    parser.add_argument("golden")
    parser.add_argument("--component", default=None)
    parser.add_argument("--thresholds", default=str(DEFAULT_THRESHOLDS))
    parser.add_argument("--cos-min", type=float, default=None)
    parser.add_argument("--l2-max", type=float, default=None)
    parser.add_argument("--json", default=None)
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

    report: dict = {
        "output": args.output,
        "golden": args.golden,
        "component": args.component,
        "result": result,
    }
    if args.component is None:
        print("REPORT (no gate)")
        report["gate"] = None
    else:
        thresholds = load_thresholds(args.thresholds)
        if args.cos_min is not None:
            thresholds = {
                **thresholds,
                args.component: {
                    **thresholds.get(args.component, {}),
                    "cosine_min": args.cos_min,
                },
            }
        if args.l2_max is not None:
            thresholds = {
                **thresholds,
                args.component: {
                    **thresholds.get(args.component, {}),
                    "rel_l2_max": args.l2_max,
                },
            }
        verdict = gate(args.component, result, thresholds)
        report["gate"] = verdict
        if verdict["pass"]:
            print("PASS")
        else:
            reason = "; ".join(verdict["reasons"])
            print(f"FAIL gate ({args.component}): {reason}")
            if args.json:
                with open(args.json, "w") as handle:
                    json.dump(report, handle, indent=2)
            return 1
    if args.json:
        with open(args.json, "w") as handle:
            json.dump(report, handle, indent=2)
    return 0


if __name__ == "__main__":
    sys.exit(main())
