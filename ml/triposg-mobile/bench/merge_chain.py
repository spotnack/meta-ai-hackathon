"""Merge the 23 per-unit EPContext models into ONE ONNX model.

Why: every QNN HTP context pins its own spill-fill scratch buffer in
DMA-BUF memory (75 MB per FP32 block, 310-358 MB per w8a16 block). ORT's
QNN EP shares one spill-fill buffer across all contexts of the SAME session
(QNN_HTP_CONTEXT_CONFIG_OPTION_REGISTER_MULTI_CONTEXTS), sized by the
EPContext node attribute `max_size`. AI Hub writes no `max_size`, and the
app used 23 separate sessions, so nothing was shared.

ORT binds EPContext node inputs/outputs to the QNN graph tensors BY NAME,
and AI Hub gives every unit the same names (hidden_in, output_0, ...), so
the units cannot sit in one graph as compiled. The context binary header is
a flatbuffer whose I/O names are length-prefixed, NUL-terminated and padded
to 4 bytes; this script rewrites those header names in a COPY of each
model.bin (only the first occurrence, inside the first 2 KB, and only to a
name that fits the existing slot) so every tensor gets a unique name:
  head:  hidden_states, timestep -> hd (hidden), temb
  blkNN: h<NN-1> (hd for blk00), encoder_hidden_states, s<20-NN> (NN>10)
         -> h<NN>, s<NN> (NN<10)
  tail:  h20 -> noise_pred
The HTP graph blob refers to tensors by id, so it is left untouched.

Usage:
  python bench/merge_chain.py <chain_dir> <out_dir> [--max-size-mb 380]
<chain_dir> holds <stem>/device/model.{onnx,bin} (aihub, aihub_w8a16 or a
mixed dir of symlinks). Writes <out_dir>/<stem>/model.bin (patched copies)
and <out_dir>/dit_chain.onnx, whose nodes reference "<stem>/model.bin".
Graph inputs, in order: hidden_states [1,2048,64], timestep [1],
encoder_hidden_states [1,257,1024]; outputs: noise_pred [1,2048,64] and
temb [1,1,2048] (unused; only there so ORT keeps the head graph's output).
"""
import argparse
import hashlib
import json
from pathlib import Path

import onnx
from onnx import helper

STEMS = ["head"] + [f"blk{i:02d}" for i in range(21)] + ["tail"]
HEADER_LIMIT = 2048
SHARED_INPUTS = ("hidden_states", "timestep", "encoder_hidden_states")


def numel(vi):
    n = 1
    for d in vi.type.tensor_type.shape.dim:
        n *= d.dim_value
    return n


def new_names(stem, g):
    """{compiled tensor name: unique merged name} for one unit."""
    ren = {}
    outs = list(g.output)
    if stem == "head":
        hi = 0 if numel(outs[0]) > numel(outs[1]) else 1
        ren[outs[hi].name] = "hd"
        ren[outs[1 - hi].name] = "temb"
    elif stem == "tail":
        ren["hidden_in"] = "h20"
        ren[outs[0].name] = "noise_pred"
    else:
        layer = int(stem[3:])
        ren["hidden_in"] = "hd" if layer == 0 else f"h{layer - 1:02d}"
        # Same rule as the app's RunUnit: first output = hidden, second = skip.
        ren[outs[0].name] = f"h{layer:02d}"
        if len(outs) == 2:
            ren[outs[1].name] = f"s{layer:02d}"
        for vi in g.input:
            if vi.name.startswith("skip_"):
                ren[vi.name] = f"s{int(vi.name[5:]):02d}"
    for vi in list(g.input) + outs:
        ren.setdefault(vi.name, vi.name)
        assert vi.name in SHARED_INPUTS or ren[vi.name] != vi.name or \
            vi.name == "noise_pred", (stem, vi.name)
    return ren


def patch_header(buf, old, new):
    """Rewrite one length-prefixed flatbuffer string in the header."""
    o, n = old.encode(), new.encode()
    hits = []
    i = buf.find(o)
    while i != -1 and i < HEADER_LIMIT:
        if int.from_bytes(buf[i - 4:i], "little") == len(o) and buf[i + len(o)] == 0:
            hits.append(i)
        i = buf.find(o, i + 1)
    if len(hits) != 1:
        raise SystemExit(f"want 1 header slot for {old!r}, got {hits}")
    at = hits[0]
    slot = (len(o) + 1 + 3) // 4 * 4  # string bytes + NUL, padded to 4
    if len(n) + 1 > slot:
        raise SystemExit(f"{new!r} does not fit the {slot}-byte slot of {old!r}")
    buf[at - 4:at] = len(n).to_bytes(4, "little")
    buf[at:at + slot] = n + b"\0" * (slot - len(n))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("chain_dir")
    ap.add_argument("out_dir")
    ap.add_argument("--max-size-mb", type=int, default=380)
    a = ap.parse_args()
    root, out = Path(a.chain_dir), Path(a.out_dir)
    max_size = a.max_size_mb * 1024 * 1024

    nodes, value_infos, graph_inputs, report = [], {}, {}, {}
    for stem in STEMS:
        m = onnx.load(str(root / stem / "device" / "model.onnx"))
        g = m.graph
        assert len(g.node) == 1 and g.node[0].op_type == "EPContext", stem
        src = g.node[0]
        ren = new_names(stem, g)

        buf = bytearray((root / stem / "device" / "model.bin").read_bytes())
        for old, new in ren.items():
            if old != new:
                patch_header(buf, old, new)
        (out / stem).mkdir(parents=True, exist_ok=True)
        (out / stem / "model.bin").write_bytes(buf)
        report[stem] = {"rename": {k: v for k, v in ren.items() if k != v},
                        "bin_bytes": len(buf),
                        "bin_sha256": hashlib.sha256(buf).hexdigest()}
        del buf

        for vi in g.input:
            if vi.name in SHARED_INPUTS:
                graph_inputs.setdefault(vi.name, vi)
        for vi in g.output:
            v = onnx.ValueInfoProto()
            v.CopyFrom(vi)
            v.name = ren[vi.name]
            value_infos[v.name] = v
        node = helper.make_node(
            "EPContext",
            [ren[vi.name] for vi in g.input],
            [ren[vi.name] for vi in g.output],
            name=f"QNNContext_{stem}",
            domain="com.microsoft",
        )
        for attr in src.attribute:
            if attr.name not in ("ep_cache_context", "max_size"):
                node.attribute.append(attr)
        node.attribute.append(
            helper.make_attribute("ep_cache_context", f"{stem}/model.bin"))
        node.attribute.append(helper.make_attribute("max_size", max_size))
        nodes.append(node)
        print(stem, report[stem]["rename"], flush=True)

    graph = helper.make_graph(
        nodes, "triposg_dit_chain",
        [graph_inputs[n] for n in SHARED_INPUTS],
        # temb (head's second output) feeds nothing, but ORT drops unused
        # fused-node outputs and the QNN graph still has it, so expose it.
        [value_infos["noise_pred"], value_infos["temb"]],
        value_info=[v for k, v in value_infos.items()
                    if k not in ("noise_pred", "temb")])
    model = helper.make_model(graph, opset_imports=[
        helper.make_opsetid("", 13), helper.make_opsetid("com.microsoft", 1)])
    model.ir_version = 8
    onnx.checker.check_model(model)
    onnx.save(model, str(out / "dit_chain.onnx"))
    (out / "merge_report.json").write_text(json.dumps(
        {"source": str(root), "max_size_mb": a.max_size_mb, "units": report},
        indent=1))
    print(f"wrote {out}/dit_chain.onnx: {len(nodes)} EPContext nodes, "
          f"max_size={a.max_size_mb} MB")


if __name__ == "__main__":
    main()
