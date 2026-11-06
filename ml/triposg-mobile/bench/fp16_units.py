"""Convert the FP32 batch-1 units to true FP16 (weights AND I/O).

Why: AI Hub keeps an FP32 ONNX's weights as FP32 in the context binary even
with --quantize_full_type float16 / default_graph_htp_precision=FLOAT16
(blk07 stays a 247 MB bin, 266 MB of pinned NPU weights). An ONNX whose
initializers are already float16 should compile to FP16 static tensors:
half the weights, half the I/O buffers, same FP16 HTP math as today.

Every Transpose(initializer) is folded first (same helper as the w8a16
path) so the converter sees plain FP16 weights. I/O becomes float16 too
(keep_io_types=False); the merged chain (bench/merge_chain.py) casts its
fp32 graph inputs/outputs on the CPU.

Usage (triposg-spike env):
  python -u bench/fp16_units.py [--stems head,blk00,...]
Reads logs/spike/b1/dit_<stem>_fp32.onnx(+.data), writes
logs/spike/fp16/<stem>/model.onnx + model.onnx.data, the per-stem layout
bench/aihub_compile.py --variant fp16 uploads.
"""
import argparse
import gc
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from quantize_units import fold_weight_transposes  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
B1 = ROOT / "logs/spike/b1"
OUT = ROOT / "logs/spike/fp16"
STEMS = ["head"] + [f"blk{i:02d}" for i in range(21)] + ["tail"]


def convert(stem):
    import onnx
    from onnxconverter_common import float16

    src = B1 / f"dit_{stem}_fp32.onnx"
    unit = OUT / stem
    unit.mkdir(parents=True, exist_ok=True)
    folded = unit / "folded.onnx"
    n = fold_weight_transposes(src, folded)
    model = onnx.load(str(folded))
    # Stale fp32 value_info (e.g. on folded Transpose outputs) would pin
    # float types into the converted graph; let shape inference redo them.
    del model.graph.value_info[:]
    model = float16.convert_float_to_float16(
        model, keep_io_types=False, disable_shape_infer=False,
        op_block_list=[])
    # The export's explicit Cast(to=float32) nodes (e.g. around the norms)
    # are left alone by the converter; in an all-fp16 graph they must
    # produce float16. Drop the inferred value_info so nothing stale stays.
    for node in model.graph.node:
        if node.op_type == "Cast":
            for attr in node.attribute:
                if attr.name == "to" and attr.i == onnx.TensorProto.FLOAT:
                    attr.i = onnx.TensorProto.FLOAT16
    del model.graph.value_info[:]
    dst = unit / "model.onnx"
    for p in (dst, Path(str(dst) + ".data")):
        p.unlink(missing_ok=True)
    onnx.save_model(model, str(dst), save_as_external_data=True,
                    all_tensors_to_one_file=True, location="model.onnx.data")
    del model
    gc.collect()
    folded.unlink()
    Path(str(folded) + ".data").unlink()
    size = Path(str(dst) + ".data").stat().st_size
    print(f"{stem}: folded {n} transposes, fp16 data {size / 2**20:.0f} MB",
          flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stems", default="")
    a = ap.parse_args()
    stems = [s for s in a.stems.split(",") if s] or STEMS
    for stem in stems:
        convert(stem)


if __name__ == "__main__":
    main()
