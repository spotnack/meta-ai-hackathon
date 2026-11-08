"""Rewrite com.microsoft Q/DQ nodes to standard ONNX opset 21 (in place).

ORT's QNN QDQ quantizer emits 16-bit QuantizeLinear/DequantizeLinear in the
com.microsoft domain when the model opset is < 21. Qualcomm AI Hub rejects
that domain; opset 21 standard Q/DQ supports uint16/int16 natively. Only
the graph proto is rewritten (external weight data is untouched).

Usage: python bench/qdq_to_opset21.py <unit_dir>...
"""
import sys
from pathlib import Path

import onnx


def convert(model_path):
    """Move Q/DQ to the default domain and bump ai.onnx to opset 21."""
    model = onnx.load(str(model_path), load_external_data=False)
    moved = 0
    for node in model.graph.node:
        if node.op_type in ("QuantizeLinear", "DequantizeLinear") and node.domain == "com.microsoft":
            node.domain = ""
            moved += 1
    for imp in model.opset_import:
        if imp.domain in ("", "ai.onnx") and imp.version < 21:
            imp.version = 21
    still_ms = [n.op_type for n in model.graph.node if n.domain == "com.microsoft"]
    if not any(imp.domain == "com.microsoft" for imp in model.opset_import) or still_ms:
        pass
    else:
        keep = [imp for imp in model.opset_import if imp.domain != "com.microsoft"]
        del model.opset_import[:]
        model.opset_import.extend(keep)
    onnx.save_model(model, str(model_path))
    return moved, still_ms


def main():
    for unit in sys.argv[1:]:
        path = Path(unit) / "model.onnx"
        moved, still = convert(path)
        print(f"{path}: moved {moved} Q/DQ nodes to opset 21; other com.microsoft ops: {sorted(set(still))}", flush=True)


if __name__ == "__main__":
    main()
