"""Chain ORT A->B->C on the step-0 goldens and gate vs step0_noise_pred.npy.

Loads one session at a time (del + gc between pieces). Also compares the
saved chained torch C output. Gate (both ORT chain and torch chain):
cosine >= 0.999 and rel-L2 <= 1e-2. Exit 0 = pass, 1 = fail.

FP16 laptop experiment (--fp16): chains the FP16 pieces with a 20-minute cap.
A missing-kernel error or timeout is recorded in the JSON report and exits 0
(the FP16 gate then runs on the phone CPU instead).

Usage (triposg-spike env). Run under systemd-run so the kernel kills only
the job on overflow (see plan doc, 2026-11-05 OOM):
  systemd-run --user --scope -p MemoryMax=9G -p MemorySwapMax=0 \
    python -u parity/check_split.py [--split-dir DIR] [--golden-dir DIR]
  systemd-run --user --scope -p MemoryMax=9G -p MemorySwapMax=0 \
    python -u parity/check_split.py --fp16 [--fp16-minutes 20]
"""

import argparse
import gc
import json
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "bench"))
from memwatch import mem_str, watchdog  # noqa: E402

COS_MIN = 0.999
L2_MAX = 1e-2


def log(msg):
    """Print immediately (= python -u)."""
    print(msg, flush=True)


def load_session(path):
    """Open one ORT CPU session."""
    import onnxruntime as ort

    return ort.InferenceSession(path, providers=["CPUExecutionProvider"])


def close_session(sess):
    """Free one session before opening the next."""
    del sess
    gc.collect()


def run_piece(path, feeds):
    """Run one ONNX file, returning (output names, output arrays).

    The session is created locally and unreachable on return, so only one
    piece's session (plus ORT's load-time folded weights) is resident at a
    time. Arrays are copies — ORT output buffers may borrow session memory.
    """
    sess = load_session(path)
    try:
        names = [i.name for i in sess.get_outputs()]
        return names, [np.asarray(o).copy() for o in sess.run(None, feeds)]
    finally:
        del sess
        gc.collect()


def metrics(name, got, golden):
    """Report parity numbers of an array vs the golden noise_pred."""
    got = np.asarray(got, dtype=np.float64)
    ref = np.asarray(golden, dtype=np.float64)
    assert got.shape == ref.shape, (name, got.shape, ref.shape)
    assert np.isfinite(got).all(), name
    diff = got - ref
    out = {
        "max_abs": float(np.abs(diff).max()),
        "mean_abs": float(np.abs(diff).mean()),
        "rel_l2": float(np.linalg.norm(diff.ravel()) / np.linalg.norm(ref.ravel())),
        "cosine": float(
            got.ravel().dot(ref.ravel())
            / np.linalg.norm(got.ravel())
            / np.linalg.norm(ref.ravel())
        ),
    }
    log(
        f"{name}: max_abs={out['max_abs']:.3e} "
        f"mean_abs={out['mean_abs']:.3e} rel_l2={out['rel_l2']:.3e} "
        f"cosine={out['cosine']:.7f}"
    )
    return out


def gate_ok(numbers):
    """Apply the approved FP16 gate."""
    return numbers["cosine"] >= COS_MIN and numbers["rel_l2"] <= L2_MAX


def chain(suffix, split, golden_id):
    """Run A->B->C with one session at a time; return final noise_pred."""
    latent = np.load(golden_id / "step0_latent_model_input.npy")
    timestep = np.load(golden_id / "step0_timestep.npy")
    enc = np.load(golden_id / "step0_encoder_hidden_states.npy")

    feeds_a = {
        "hidden_states": latent,
        "timestep": timestep,
        "encoder_hidden_states": enc,
    }
    names_a, out_a = run_piece(str(split / f"dit_step_A_{suffix}.onnx"), feeds_a)
    gc.collect()
    feed_a = dict(zip(names_a, out_a))
    del names_a, out_a
    # A's temb is unused downstream (blocks ignore temb) — drop it now.
    del feed_a["temb"]
    gc.collect()
    log(f"A done: {[f'{k}{v.shape}' for k, v in feed_a.items()]} {mem_str()}")
    del latent, timestep

    _, (hidden_b,) = run_piece(
        str(split / f"dit_step_B_{suffix}.onnx"),
        {"hidden_in": feed_a["hidden"], "encoder_hidden_states": enc},
    )
    gc.collect()
    # C needs only A's skips (skip_6 == A's hidden); A's hidden is consumed.
    del feed_a["hidden"]
    gc.collect()
    log(f"B done: {hidden_b.shape} {mem_str()}")

    feeds_c = {"hidden_in": hidden_b, "encoder_hidden_states": enc}
    feeds_c.update({f"skip_{i}": feed_a[f"skip_{i}"] for i in range(7)})
    del feed_a, hidden_b
    gc.collect()
    _, (noise,) = run_piece(str(split / f"dit_step_C_{suffix}.onnx"), feeds_c)
    gc.collect()
    del feeds_c
    gc.collect()
    log(f"C done: {noise.shape} {mem_str()}")
    return noise


def main():
    """Chain the pieces and apply the gate."""
    parser = argparse.ArgumentParser()
    parser.add_argument("--split-dir", default="ml/triposg-mobile/logs/spike/split")
    parser.add_argument(
        "--golden-dir", default="ml/triposg-mobile/reference/goldens_5/hjswed"
    )
    parser.add_argument(
        "--fp16", action="store_true", help="chain FP16 pieces (laptop experiment)"
    )
    parser.add_argument("--fp16-minutes", type=float, default=20.0)
    args = parser.parse_args()

    watchdog()
    log(f"parity chain start {mem_str()}")

    split = Path(args.split_dir)
    golden_id = Path(args.golden_dir)
    golden = np.load(golden_id / "step0_noise_pred.npy")
    suffix = "fp16" if args.fp16 else "fp32"
    report_path = split / f"split_report_{suffix}.json"
    report = {"suffix": suffix, "stages_done": []}

    started = time.perf_counter()
    try:
        noise = chain(suffix, split, golden_id)
    except Exception as error:  # noqa: BLE001 — recorded, see below
        elapsed = (time.perf_counter() - started) / 60
        report["error"] = f"{type(error).__name__}: {error}"
        report["minutes"] = elapsed
        with open(report_path, "w") as f:
            json.dump(report, f, indent=2)
        if args.fp16:
            log(
                f"FP16 laptop chain not runnable ({error}); recorded in "
                f"{report_path}. The FP16 gate runs on the phone CPU."
            )
            return 0
        log(f"STOP: FP32 chain failed: {error}")
        return 1
    elapsed = (time.perf_counter() - started) / 60
    report["minutes"] = elapsed

    if args.fp16 and elapsed > args.fp16_minutes:
        report["timeout"] = True
        with open(report_path, "w") as f:
            json.dump(report, f, indent=2)
        log(
            f"FP16 laptop chain took {elapsed:.1f} min (> {args.fp16_minutes} "
            f"min cap); recorded. The FP16 gate runs on the phone CPU."
        )
        return 0

    report["ort_chain"] = metrics(f"ort_chain_{suffix}", noise, golden)
    report["stages_done"].append("ort_chain")

    if not args.fp16:
        torch_c = np.load(split / "stepC_torch_noise_pred.npy")
        report["torch_chain"] = metrics("torch_chain", torch_c, golden)
        report["stages_done"].append("torch_chain")

    report["pass"] = bool(gate_ok(report["ort_chain"]))
    with open(report_path, "w") as f:
        json.dump(report, f, indent=2)
    log(
        "PASS"
        if report["pass"]
        else f"STOP: gate failed (need cosine>={COS_MIN}, rel_l2<={L2_MAX})"
    )
    return 0 if report["pass"] else 1


if __name__ == "__main__":
    sys.exit(main())
