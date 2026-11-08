"""QDQ static quantization of the 23 DiT batch-1 units.

int8 weights, uint16 activations (w8a16 for the QNN HTP backend).


Recipe (ORT 1.22, the standard w8a16 path for the QNN HTP backend):
  qnn_preprocess_model  -> fuse Erf/ReduceL2 sequences (no-op here: the
                           opset-20 export already emits Gelu nodes)
  get_qnn_qdq_config    -> StaticQuantConfig with activation QUInt16 /
                           weight QInt8. Per-tensor symmetric int8 weights:
                           QNN does not support per-channel MatMul, and the
                           units are all MatMul + LayerNorm + Softmax + Gelu
                           (no Conv), so per_channel would only churn Conv
                           (absent) and is left off; LayerNorm raises on
                           per_channel anyway. Sigmoid/Tanh 16-bit scales are
                           forced to the QNN-required values by the compat
                           helper. Opset 20 < 21, so 16-bit Q/DQ uses the
                           com.microsoft contrib ops automatically.
  quantize              -> QDQ model, re-saved with single-file external
                           data as <out>/<stem>/model.onnx + model.onnx.data
                           (the layout bench/aihub_compile.py --variant w8a16
                           uploads).

Head and tail are quantized with the same script and settings: their bins
are tiny, so the memory win is all in the 21 blocks, but a uniform chain
keeps spike_chain / pipeline wiring unchanged. --stems selects a subset,
so head/tail can stay FP32 if the phone parity ever blames them.

Calibration inputs are the capture_calib.py .npz files (real 10-step
trajectories, 3 goldens x 10 steps x 2 rows = 60 samples per unit).
--calib-every 3 splits them into 20 calibration + 20 held-out check
samples; the CPU check runs both the FP32 and the QDQ model on the
held-out samples and stops on any clearly broken unit (non-finite or
rel_l2 > 0.1). VAE post/query stay FP32: ~0.8 GB DMA-BUF is acceptable.

Usage (triposg-spike env; quantization is CPU + light, no cap needed but
harmless to keep it):
  python -u bench/quantize_units.py [--stems blk07,blk08] [--calib-every 3]
"""

import argparse
import gc
import json
import sys
from pathlib import Path

import numpy as np

N_LAYERS = 21
STEMS = ["head"] + [f"blk{i:02d}" for i in range(N_LAYERS)] + ["tail"]
ROOT = Path("ml/triposg-mobile")
# Per-unit STOP gate for the CPU check: QDQ vs FP32 on held-out samples.
# A single w8a16 block typically lands rel_l2 ~1e-3..1e-2; above 0.1 (or
# non-finite) the unit is clearly broken, not just lossy.
STOP_REL_L2 = 0.1
WARN_REL_L2 = 0.02


def log(msg):
    """Print immediately (= python -u)."""
    print(msg, flush=True)


def _reader_base():
    """ORT's CalibrationDataReader (imported lazily: onnxruntime is heavy)."""
    from onnxruntime.quantization import CalibrationDataReader

    return CalibrationDataReader


class CalibReader(_reader_base()):
    """CalibrationDataReader over capture_calib.py .npz files."""

    def __init__(self, files):
        super().__init__()
        self.files = sorted(files)
        self.index = 0

    def get_next(self):
        """Return the next feed dict, or None at the end."""
        if self.index >= len(self.files):
            return None
        path = self.files[self.index]
        self.index += 1
        with np.load(path) as data:
            return {k: np.ascontiguousarray(data[k]) for k in data.files}

    def rewind(self):
        """Restart enumeration."""
        self.index = 0


def sample_files(calib_dir, stem, every, check):
    """Split one stem's .npz samples into calibration vs held-out check."""
    files = []
    for path in sorted(calib_dir.glob(f"*/{stem}_s??_r?.npz")):
        files.append(path)
    if not files:
        log(f"STOP: no calibration samples for {stem} in {calib_dir}")
        sys.exit(1)
    # Split by (golden, step), never by file index: files sort as
    # s00_r0, s00_r1, s01_r0, ... so an index split with every=2 put only
    # uncond rows (all-zero encoder states) in calibration, which gave
    # encoder_hidden_states a ~1e-9 scale and ~10% error on cond rows.
    # Both CFG rows of a step always land on the same side.
    want_check = 1 if check else 0
    steps = sorted({(p.parent.name, p.name.rsplit("_r", 1)[0]) for p in files})
    chosen = {k for i, k in enumerate(steps) if i % every == want_check}
    picked = [p for p in files if (p.parent.name, p.name.rsplit("_r", 1)[0]) in chosen]
    log(
        f"{stem}: {len(files)} samples -> {len(picked)} "
        f"{'check' if check else 'calibration'} (every={every})"
    )
    return picked


def rel_l2_cos(a, b):
    """(rel_l2, cosine) of two float arrays."""
    a = np.asarray(a, dtype=np.float64).ravel()
    b = np.asarray(b, dtype=np.float64).ravel()
    diff = a - b
    rel = float(np.linalg.norm(diff) / np.linalg.norm(b))
    cos = float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b)))
    return rel, cos


def fold_weight_transposes(src_onnx, dst_onnx):
    """Fold Transpose(initializer) into a pre-transposed initializer.

    The export feeds every Linear weight through a Transpose (W.T) before
    its MatMul, so the quantizer sees the weight as an activation and keeps
    it float (output stays 240 MB). Folding makes each MatMul's B a plain
    initializer that QDQ stores as int8. Returns the number folded.
    """
    import onnx
    from onnx import numpy_helper

    model = onnx.load(str(src_onnx))
    inits = {i.name: i for i in model.graph.initializer}
    users = {}
    for node in model.graph.node:
        for name in node.input:
            users[name] = users.get(name, 0) + 1
    keep, folded = [], 0
    for node in model.graph.node:
        src = node.input[0] if node.input else None
        if node.op_type == "Transpose" and src in inits:
            perm = next((list(a.ints) for a in node.attribute if a.name == "perm"), None)
            arr = numpy_helper.to_array(inits[src])
            arr = np.ascontiguousarray(arr.transpose(perm) if perm else arr.T)
            model.graph.initializer.append(numpy_helper.from_array(arr, node.output[0]))
            users[src] -= 1
            folded += 1
            continue
        keep.append(node)
    del model.graph.node[:]
    model.graph.node.extend(keep)
    dead = [i for i in model.graph.initializer if users.get(i.name, 1) == 0]
    for i in dead:
        model.graph.initializer.remove(i)
    onnx.save_model(
        model,
        str(dst_onnx),
        save_as_external_data=True,
        all_tensors_to_one_file=True,
        location=Path(dst_onnx).name + ".data",
    )
    return folded


def quantize_unit(stem, src_onnx, calib, check, unit_dir):
    """Preprocess, QDQ-quantize, re-save single-file, CPU-check one unit."""
    import onnx

    from onnxruntime.quantization import quantize
    from onnxruntime.quantization.calibrate import CalibrationMethod
    from onnxruntime.quantization.quantize import QuantType
    from onnxruntime.quantization.execution_providers.qnn import (
        get_qnn_qdq_config,
        qnn_preprocess_model,
    )

    unit_dir.mkdir(parents=True, exist_ok=True)
    folded_onnx = unit_dir / "folded.onnx"
    n_folded = fold_weight_transposes(src_onnx, folded_onnx)
    log(f"{stem}: folded {n_folded} weight transposes")
    pre = unit_dir / "pre.onnx"
    if qnn_preprocess_model(
        str(folded_onnx),
        str(pre),
        save_as_external_data=True,
        all_tensors_to_one_file=True,
        external_data_location="pre.onnx.data",
    ):
        log(f"{stem}: preprocessed (fused)")
    else:
        pre = folded_onnx
        log(f"{stem}: preprocess no-op, quantizing the folded source")
    reader = CalibReader(calib)
    config = get_qnn_qdq_config(
        str(pre),
        reader,
        calibrate_method=CalibrationMethod.MinMax,
        activation_type=QuantType.QUInt16,
        weight_type=QuantType.QInt8,
    )
    config.use_external_data_format = True
    raw = unit_dir / "qraw.onnx"
    quantize(str(pre), str(raw), config)
    log(f"{stem}: quantized {raw.stat().st_size >> 20} MB, re-saving single-file")
    model = onnx.load(str(raw))
    final = unit_dir / "model.onnx"
    for stale in (final, str(final) + ".data"):
        try:
            Path(stale).unlink()
        except OSError:
            pass
    onnx.save_model(
        model,
        str(final),
        save_as_external_data=True,
        all_tensors_to_one_file=True,
        location="model.onnx.data",
    )
    del model
    gc.collect()
    for junk in (unit_dir / "pre.onnx", unit_dir / "pre.onnx.data", raw,
                 folded_onnx, unit_dir / "folded.onnx.data"):
        try:
            junk.unlink()
        except OSError:
            pass
    for leftover in unit_dir.glob("qraw.onnx*"):
        try:
            leftover.unlink()
        except OSError:
            pass
    log(
        f"{stem}: wrote {final} + model.onnx.data "
        f"({(unit_dir / 'model.onnx.data').stat().st_size >> 20} MB)"
    )
    return final


def cpu_check(stem, src_onnx, q_onnx, check):
    """QDQ vs FP32 on held-out samples; stop on a clearly broken unit."""
    import onnxruntime as ort

    opts = ort.SessionOptions()
    opts.intra_op_num_threads = 8
    fp32 = ort.InferenceSession(str(src_onnx), sess_options=opts)
    qdq = ort.InferenceSession(str(q_onnx), sess_options=opts)
    assert [i.name for i in fp32.get_inputs()] == [
        i.name for i in qdq.get_inputs()
    ], f"{stem}: input names changed by quantization"
    assert [o.name for o in fp32.get_outputs()] == [
        o.name for o in qdq.get_outputs()
    ], f"{stem}: output names changed by quantization"
    metrics = {}
    for path in check:
        with np.load(path) as data:
            feeds = {k: np.ascontiguousarray(data[k]) for k in data.files}
        if not np.isfinite(np.concatenate([v.ravel() for v in feeds.values()])).all():
            log(f"STOP: {stem}: non-finite calibration input {path.name}")
            sys.exit(1)
        ref = fp32.run(None, feeds)
        got = qdq.run(None, feeds)
        for out, r, g in zip(fp32.get_outputs(), ref, got):
            rel, cos = rel_l2_cos(g, r)
            m = metrics.setdefault(out.name, {"rel_l2": 0.0, "cosine": 1.0})
            m["rel_l2"] = max(m["rel_l2"], rel)
            m["cosine"] = min(m["cosine"], cos)
            if not (np.isfinite(rel) and np.isfinite(cos)):
                log(f"STOP: {stem}: non-finite {out.name} on {path.name}")
                sys.exit(1)
            if rel > STOP_REL_L2:
                log(f"STOP: {stem}: {out.name} rel_l2={rel:.3e} on {path.name}")
                sys.exit(1)
    for name, m in metrics.items():
        flag = " WARN" if m["rel_l2"] > WARN_REL_L2 else ""
        log(
            f"  {stem} {name}: worst rel_l2={m['rel_l2']:.3e} "
            f"cosine={m['cosine']:.6f}{flag}"
        )
    del fp32, qdq
    gc.collect()
    return metrics


def main():
    """Quantize + CPU-check every selected stem, write the report."""
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--stems", default="", help="comma-separated subset (default: all 23)"
    )
    parser.add_argument("--src-dir", default=str(ROOT / "logs/spike/b1"))
    parser.add_argument("--calib-dir", default=str(ROOT / "logs/spike/calib"))
    parser.add_argument("--out-dir", default=str(ROOT / "logs/spike/w8a16"))
    parser.add_argument(
        "--calib-every",
        type=int,
        default=3,
        help="1 in N samples calibrates, another 1 in N checks",
    )
    args = parser.parse_args()

    stems = STEMS
    if args.stems:
        stems = [s.strip() for s in args.stems.split(",") if s.strip()]
        unknown = [s for s in stems if s not in STEMS]
        if unknown:
            log(f"STOP: unknown stems {unknown}")
            sys.exit(1)
    if args.calib_every < 2:
        log("STOP: --calib-every must be >= 2 (need held-out check samples)")
        sys.exit(1)
    src_dir = Path(args.src_dir)
    calib_dir = Path(args.calib_dir)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    report = {}
    for stem in stems:
        src = src_dir / f"dit_{stem}_fp32.onnx"
        if not src.is_file() or not Path(str(src) + ".data").is_file():
            log(f"STOP: missing {src}(+.data)")
            sys.exit(1)
        calib = sample_files(calib_dir, stem, args.calib_every, check=False)
        check = sample_files(calib_dir, stem, args.calib_every, check=True)
        final = quantize_unit(stem, src, calib, check, out_dir / stem)
        report[stem] = {
            "model": str(final),
            "bytes": (out_dir / stem / "model.onnx.data").stat().st_size,
            "outputs": cpu_check(stem, src, final, check),
        }
        gc.collect()
    path = out_dir / "quant_report.json"
    with open(path, "w") as f:
        json.dump(report, f, indent=2)
    log(f"report {path}: {len(report)} units quantized + CPU-checked")
    return 0


if __name__ == "__main__":
    sys.exit(main())
