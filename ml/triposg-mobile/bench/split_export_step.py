"""Split FP32 export of one guided TripoSG step: pieces A/B/C, one per process.

Wiring mirrors TripoSGDiTModel.forward at fc5c4099 exactly (verified by
reading triposg/models/transformers/triposg_transformer.py):

- temb path: time_embed (stateless Timesteps: NO checkpoint weights) ->
  time_proj -> unsqueeze(1); proj_in maps (2,2048,64) -> (2,2048,2048);
  cat([temb, hidden], dim=1) -> (2,2049,2048), temb as token 0.
  TripoSGDiTBlock.forward takes temb but never uses it (verified fc5c4099):
  the time embedding enters only as token 0 of hidden via piece A's concat.
- Skip logic with num_layers=21 (MID=10): layers 0-9 push their output,
  layer 10 is mid (no push, skip None), layers 11-20 pop 9..0 in order.
  Pop order for layers 14-20 is therefore skip_6..skip_0.
- Output tail: norm_out -> [:, -N:] (N=2048 tokens, temb token dropped) ->
  proj_out -> (2,2048,64).

Pieces (fixed shapes, no dynamic_axes, opset 20, TorchScript-trace exporter).
Opset 20 exports nn.GELU(approximate="none") as a single ONNX Gelu node
(torch 2.5.1 symbolic_opset20; ai.onnx:Gelu is in the ORT QNN EP supported
list), so whole blocks stay QNN-resident instead of splitting at Erf islands.

- A: time_embed/time_proj/proj_in/concat + blocks 0-6.
  In: hidden_states (2,2048,64), timestep (2,), encoder_hidden_states
  (2,257,1024). Out: hidden (2,2049,2048), temb (2,1,2048), skip_0..6.
  (temb output is saved but unused downstream — blocks ignore temb.)
- B: blocks 7-13. In: hidden, encoder_hidden_states. Out: hidden.
  Skips 7-9 are pushed and popped inside B (11 pops 9, 12 pops 8, 13 pops 7).
- C: blocks 14-20 (pop skip_6..skip_0) + norm_out/slice/proj_out.
  In: hidden, encoder_hidden_states, skip_0..skip_6. Out: noise_pred.

Usage (triposg-spike env, torch 2.5.1). One piece per process, 8 GiB
anon cap. Run every piece under systemd-run so the kernel kills only the
job on overflow (see plan doc, 2026-11-05 OOM):
  systemd-run --user --scope -p MemoryMax=9G -p MemorySwapMax=0 \
    python -u bench/split_export_step.py --piece A
  systemd-run --user --scope -p MemoryMax=9G -p MemorySwapMax=0 \
    python -u bench/split_export_step.py --piece B
  systemd-run --user --scope -p MemoryMax=9G -p MemorySwapMax=0 \
    python -u bench/split_export_step.py --piece C
  systemd-run --user --scope -p MemoryMax=9G -p MemorySwapMax=0 \
    python -u bench/split_export_step.py --piece A --fp16  # optional

Block ranges for QNN probing (same torch reference, ORT check, memwatch):
  systemd-run --user --scope -p MemoryMax=9G -p MemorySwapMax=0 \
    python -u bench/split_export_step.py --blocks 7:8
  systemd-run --user --scope -p MemoryMax=9G -p MemorySwapMax=0 \
    python -u bench/split_export_step.py --head --blocks 0:1
  systemd-run --user --scope -p MemoryMax=9G -p MemorySwapMax=0 \
    python -u bench/split_export_step.py --blocks 7:8 --fp16
--blocks START:END is half-open; --head adds the time_proj/proj_in/concat
front; --tail adds the norm_out/slice/proj_out end. A range consumes pops
for layers > 10 and produces pushes for layers < 10; push/pop inside the
range stays internal, the rest become explicit skip_<layer> inputs/outputs.
--piece A|B|C are aliases (A = --head --blocks 0:7, B = --blocks 7:14,
C = --blocks 14:21 --tail) keeping the original reference/output names.
--batch 1|2 (default 2; range mode only): batch-1 exports use row 0
(uncond: zero encoder states) of the golden inputs and gain a _b1 stem
suffix. Rows are independent through every block op (per-token
norms/linears, per-row SDPA, batch-aligned cross-attention), so slicing
row 0 off the saved batch-2 refs is exact — no recompute needed.
--all-b1 runs the whole batch-1 chain (both rows: r0 = uncond = golden
row 0, r1 = cond = golden row 1) as 23 one-unit exports into logs/spike/b1/:
head (time_proj/proj_in/concat, no blocks), blk00..blk20 (one block each),
tail (norm_out/slice/proj_out, no blocks, no encoder input). One unit's
weights are loaded at a time; per-unit input/output .npy for both rows
plus one FP32 opset-20 fixed-shape ONNX per unit. It also writes the chain
inputs logs/spike/b1/{latent,timestep,enc}_r{0,1}.npy that
bench/spike_adb_chain_npu.sh pushes to the phone.
  systemd-run --user --scope -p MemoryMax=9G -p MemorySwapMax=0 \
    python -u bench/split_export_step.py --all-b1

Each FP32 run: torch forward on the previous piece's saved outputs (goldens
for A) -> per-piece reference .npy in logs/spike/split/ -> ONNX export with
single-file external data -> ORT FP32 check vs the torch outputs.
"""

import argparse
import gc
import os
import sys
from pathlib import Path

import numpy as np
import torch
from torch import nn

from memwatch import mem_str, watchdog

TRIPOSG_DIR = Path.home() / ".cache" / "triposg" / "TripoSG"
sys.path.insert(0, str(TRIPOSG_DIR))

ROOT = Path("ml/triposg-mobile")
TR_DIR = ROOT / "pretrained_weights" / "transformer"
SPLIT = ROOT / "logs" / "spike" / "split"
GOLDEN = ROOT / "reference" / "goldens_5" / "hjswed"

PIECES = ("A", "B", "C")
# State-dict prefixes materialised per piece. time_embed is stateless
# (Timesteps) and needs no weights.
PREFIXES = {
    "A": ["time_proj.", "proj_in."] + [f"blocks.{i}." for i in range(0, 7)],
    "B": [f"blocks.{i}." for i in range(7, 14)],
    "C": [f"blocks.{i}." for i in range(14, 21)] + ["norm_out.", "proj_out."],
}

OPSET = 20
N_LAYERS = 21
MID = 10


def pop_keys(start, end):
    """External skip inputs for [start, end): pops whose push is outside."""
    return [
        2 * MID - layer
        for layer in range(start, end)
        if layer > MID and (2 * MID - layer) not in range(start, end)
    ]


def push_layers(start, end):
    """External skip outputs for [start, end): pushes whose pop is outside."""
    return [
        layer
        for layer in range(start, end)
        if layer < MID and (2 * MID - layer) not in range(start, end)
    ]


def range_names(head, start, end, tail):
    """ONNX input/output names for a range spec, in forward order."""
    ins = (
        ["hidden_states", "timestep", "encoder_hidden_states"]
        if head
        else ["hidden_in", "encoder_hidden_states"]
    )
    ins += [f"skip_{key}" for key in pop_keys(start, end)]
    outs = ["noise_pred" if tail else "hidden"]
    if head:
        outs.append("temb")
    outs += [f"skip_{layer}" for layer in push_layers(start, end)]
    return ins, outs


def range_stem(head, start, end, tail):
    """Artifact stem for a range spec, e.g. dit_blk07, dit_head_blk00."""
    rng = f"blk{start:02d}" if end == start + 1 else f"blk{start:02d}_{end:02d}"
    return "dit_" + ("head_" if head else "") + rng + ("_tail" if tail else "")


def saved_tensor(name):
    """Load a saved reference .npy as a torch tensor, or None if absent."""
    path = SPLIT / f"{name}.npy"
    if path.is_file():
        return torch.from_numpy(np.load(path))
    return None


def log(msg):
    """Print immediately (= python -u)."""
    print(msg, flush=True)


def save(name, tensor, out_dir=SPLIT):
    """Save a torch tensor as an FP32 .npy reference."""
    array = tensor.detach().float().cpu().numpy()
    path = out_dir / f"{name}.npy"
    np.save(path, array)
    log(f"saved {path} {array.shape} {mem_str()}")


def ort_check(path, feeds, refs):
    """Run one ONNX file and compare every output vs torch references."""
    import onnxruntime as ort

    sess = ort.InferenceSession(path, providers=["CPUExecutionProvider"])
    expected = [i.name for i in sess.get_inputs()]
    if set(feeds) != set(expected):
        log(
            f"STOP: feed/session input mismatch: feeds={sorted(feeds)} "
            f"session={expected}"
        )
        sys.exit(1)
    got = sess.run(None, feeds)
    names = [i.name for i in sess.get_outputs()]
    assert len(got) == len(refs) == len(names), (len(got), len(refs))
    for name, array, ref in zip(names, got, refs):
        array = np.asarray(array, dtype=np.float64)
        ref = np.asarray(ref, dtype=np.float64)
        assert array.shape == ref.shape, (name, array.shape, ref.shape)
        assert np.isfinite(array).all(), name
        diff = array - ref
        rel = float(np.linalg.norm(diff.ravel()) / np.linalg.norm(ref.ravel()))
        log(f"  {name}: rel_l2={rel:.3e} {mem_str()}")
        if rel > 1e-4:
            log(f"STOP: ORT output {name} drifts from torch (rel_l2={rel:.3e})")
            sys.exit(1)
    del sess
    gc.collect()


def export_onnx(piece, args, in_names, out_names, stem, out_dir=SPLIT):
    """Trace-export with single-file external data under its final name."""
    import shutil

    import onnx

    raw_dir = out_dir / f"_raw_{stem}"
    raw_dir.mkdir(parents=True, exist_ok=True)
    raw = str(raw_dir / f"{stem}_raw.onnx")
    final = str(out_dir / f"{stem}.onnx")
    log(f"exporting {stem}, {mem_str()}")
    with torch.no_grad():
        torch.onnx.export(
            piece,
            args,
            raw,
            input_names=in_names,
            output_names=out_names,
            opset_version=OPSET,
            external_data=True,
            do_constant_folding=False,
        )
    log(f"exported raw {stem}, {mem_str()}")
    model = onnx.load(raw)
    # onnx.save_model appends to an existing .data file — a re-export would
    # silently double it. Delete the stale finals first.
    for stale in (final, final + ".data"):
        try:
            os.remove(stale)
        except OSError:
            pass
    onnx.save_model(
        model,
        final,
        save_as_external_data=True,
        all_tensors_to_one_file=True,
        location=f"{stem}.onnx.data",
    )
    del model
    shutil.rmtree(raw_dir, ignore_errors=True)
    log(f"re-saved {stem}.onnx + single .data, {mem_str()}")
    return final


def build_piece_model(piece):
    """Meta-build the full model, materialise only this piece's weights."""
    from safetensors import safe_open

    from triposg.models.transformers.triposg_transformer import (
        TripoSGDiTModel,
    )

    conf = TripoSGDiTModel.load_config(TR_DIR)
    assert int(conf["num_layers"]) == 21, conf["num_layers"]
    with torch.device("meta"):
        model = TripoSGDiTModel.from_config(conf)
    log(f"meta model built, {mem_str()}")

    prefixes = PREFIXES[piece]
    weight = TR_DIR / "diffusion_pytorch_model.safetensors"
    state = {}
    with safe_open(weight, framework="pt", device="cpu") as archive:
        names = archive.keys()
        for key in names:
            if any(key.startswith(p) for p in prefixes):
                state[key] = archive.get_slice(key)[:]
    log(f"materialised {len(state)} tensors for piece {piece}, " f"{mem_str()}")
    missing, unexpected = model.load_state_dict(state, strict=False, assign=True)
    del state
    model.requires_grad_(False)
    log(
        f"assigned piece {piece} "
        f"(missing={len(missing)} unexpected={len(unexpected)}), "
        f"{mem_str()}"
    )
    return model


class PieceA(torch.nn.Module):
    """time_embed/time_proj/proj_in + concat + blocks 0-6 (push skip_0..6)."""

    def __init__(self, model):
        super().__init__()
        self.time_embed = model.time_embed
        self.time_proj = model.time_proj
        self.proj_in = model.proj_in
        self.blocks = torch.nn.ModuleList(model.blocks[i] for i in range(0, 7))

    def forward(self, hidden_states, timestep, encoder_hidden_states):
        """Run embed + concat + blocks 0-6, returning hidden/temb/skips."""
        temb = self.time_embed(timestep).to(torch.float32)
        temb = self.time_proj(temb)
        temb = temb.unsqueeze(dim=1)
        hidden = torch.cat([temb, self.proj_in(hidden_states)], dim=1)
        skips = []
        for block in self.blocks:
            hidden = block(
                hidden,
                encoder_hidden_states=encoder_hidden_states,
                encoder_hidden_states_2=None,
                temb=temb,
                image_rotary_emb=None,
                skip=None,
                attention_kwargs=None,
            )
            skips.append(hidden)
        return (hidden, temb, *skips)


class PieceB(torch.nn.Module):
    """Blocks 7-13 (push 7-9, mid 10, pop 9/8/7). Blocks ignore temb."""

    def __init__(self, model):
        super().__init__()
        self.blocks = torch.nn.ModuleList(model.blocks[i] for i in range(7, 14))

    def forward(self, hidden, encoder_hidden_states):
        """Run blocks 7-13 with internal skip push/pop."""
        skips = []
        for layer, block in zip(range(7, 14), self.blocks):
            skip = None if layer <= 10 else skips.pop()
            hidden = block(
                hidden,
                encoder_hidden_states=encoder_hidden_states,
                encoder_hidden_states_2=None,
                temb=None,
                image_rotary_emb=None,
                skip=skip,
                attention_kwargs=None,
            )
            if layer < 10:
                skips.append(hidden)
        return hidden


class PieceC(torch.nn.Module):
    """Blocks 14-20 (pop skip_6..skip_0) + norm_out/slice/proj_out."""

    def __init__(self, model, n_tokens):
        super().__init__()
        self.blocks = torch.nn.ModuleList(model.blocks[i] for i in range(14, 21))
        self.norm_out = model.norm_out
        self.proj_out = model.proj_out
        self.n_tokens = n_tokens

    def forward(
        self,
        hidden,
        encoder_hidden_states,
        skip_0,
        skip_1,
        skip_2,
        skip_3,
        skip_4,
        skip_5,
        skip_6,
    ):
        """Run blocks 14-20 then the exact output tail of forward."""
        skips = [skip_0, skip_1, skip_2, skip_3, skip_4, skip_5, skip_6]
        for layer, block in zip(range(14, 21), self.blocks):
            hidden = block(
                hidden,
                encoder_hidden_states=encoder_hidden_states,
                encoder_hidden_states_2=None,
                temb=None,
                image_rotary_emb=None,
                skip=skips.pop(),
                attention_kwargs=None,
            )
        hidden = self.norm_out(hidden)
        hidden = hidden[:, -self.n_tokens :]
        return self.proj_out(hidden)


class RangeBlocks(nn.Module):
    """Run blocks [start, end) with internal push/pop, external skip wiring.

    External pops arrive in `pops` keyed by skip index; external pushes are
    returned in `produced` keyed by layer. Blocks ignore temb.
    """

    def __init__(self, blocks, start):
        super().__init__()
        self.blocks = blocks
        self.start = start
        self.end = start + len(blocks)

    @property
    def pop_key_list(self):
        """External skip indices consumed, in use order."""
        return pop_keys(self.start, self.end)

    @property
    def push_layer_list(self):
        """Block layers produced as external skips, ascending."""
        return push_layers(self.start, self.end)

    def run(self, hidden, enc, pops):
        """Run the range over hidden/enc with the external skip dict."""
        span = range(self.start, self.end)
        stack = []
        produced = {}
        for layer, block in zip(span, self.blocks):
            if layer > MID:
                key = 2 * MID - layer
                skip = stack.pop() if key in span else pops[key]
            else:
                skip = None
            hidden = block(
                hidden,
                encoder_hidden_states=enc,
                encoder_hidden_states_2=None,
                temb=None,
                image_rotary_emb=None,
                skip=skip,
                attention_kwargs=None,
            )
            if layer < MID:
                if (2 * MID - layer) in span:
                    stack.append(hidden)
                else:
                    produced[layer] = hidden
        return hidden, produced


class PieceRangeHead(nn.Module):
    """--head + blocks [start, end) [+ --tail]."""

    def __init__(self, model, start, end, tail, n_tokens):
        super().__init__()
        self.time_embed = model.time_embed
        self.time_proj = model.time_proj
        self.proj_in = model.proj_in
        self.runner = RangeBlocks(
            torch.nn.ModuleList(model.blocks[i] for i in range(start, end)), start
        )
        self.tail = tail
        if tail:
            self.norm_out = model.norm_out
            self.proj_out = model.proj_out
            self.n_tokens = n_tokens

    def forward(self, hidden_states, timestep, encoder_hidden_states, *skips):
        """Run embed + concat + range, returning main/temb/pushes."""
        temb = self.time_embed(timestep).to(torch.float32)
        temb = self.time_proj(temb)
        temb = temb.unsqueeze(dim=1)
        hidden = torch.cat([temb, self.proj_in(hidden_states)], dim=1)
        pops = dict(zip(self.runner.pop_key_list, skips))
        hidden, produced = self.runner.run(hidden, encoder_hidden_states, pops)
        main = [hidden]
        if self.tail:
            hidden = self.norm_out(hidden)
            hidden = hidden[:, -self.n_tokens :]
            main = [self.proj_out(hidden)]
        return (
            *main,
            temb,
            *(produced[layer] for layer in self.runner.push_layer_list),
        )


class PieceRange(nn.Module):
    """blocks [start, end) [+ --tail], no head."""

    def __init__(self, model, start, end, tail, n_tokens):
        super().__init__()
        self.runner = RangeBlocks(
            torch.nn.ModuleList(model.blocks[i] for i in range(start, end)), start
        )
        self.tail = tail
        if tail:
            self.norm_out = model.norm_out
            self.proj_out = model.proj_out
            self.n_tokens = n_tokens

    def forward(self, hidden_in, encoder_hidden_states, *skips):
        """Run the range, returning main (+ pushes)."""
        pops = dict(zip(self.runner.pop_key_list, skips))
        hidden, produced = self.runner.run(hidden_in, encoder_hidden_states, pops)
        main = [hidden]
        if self.tail:
            hidden = self.norm_out(hidden)
            hidden = hidden[:, -self.n_tokens :]
            main = [self.proj_out(hidden)]
        return (*main, *(produced[layer] for layer in self.runner.push_layer_list))


def run_fp32(piece):
    """Torch reference + export + ORT check for one piece."""
    SPLIT.mkdir(parents=True, exist_ok=True)
    latents = torch.from_numpy(np.load(GOLDEN / "step0_latent_model_input.npy"))
    timestep = torch.from_numpy(np.load(GOLDEN / "step0_timestep.npy"))
    enc = torch.from_numpy(np.load(GOLDEN / "step0_encoder_hidden_states.npy"))
    n_tokens = int(latents.shape[1])
    assert (tuple(latents.shape), tuple(timestep.shape), tuple(enc.shape)) == (
        (2, 2048, 64),
        (2,),
        (2, 257, 1024),
    ), "golden shapes changed"

    model = build_piece_model(piece)
    model.eval()

    if piece == "A":
        part = PieceA(model)
        del model
        gc.collect()
        with torch.no_grad():
            hidden, temb, *skips = part(latents, timestep, enc)
        assert len(skips) == 7
        save("stepA_torch_hidden", hidden)
        save("stepA_torch_temb", temb)
        refs = [hidden, temb]
        for i, skip in enumerate(skips):
            save(f"stepA_torch_skip_{i}", skip)
            refs.append(skip)
        args = (latents, timestep, enc)
        in_names = ["hidden_states", "timestep", "encoder_hidden_states"]
        out_names = ["hidden", "temb"] + [f"skip_{i}" for i in range(7)]
        feeds = {
            "hidden_states": latents.numpy(),
            "timestep": timestep.numpy(),
            "encoder_hidden_states": enc.numpy(),
        }
        stem = "dit_step_A_fp32"
    elif piece == "B":
        hidden_in = torch.from_numpy(np.load(SPLIT / "stepA_torch_hidden.npy"))
        part = PieceB(model)
        del model
        gc.collect()
        with torch.no_grad():
            hidden = part(hidden_in, enc)
        save("stepB_torch_hidden", hidden)
        refs = [hidden]
        args = (hidden_in, enc)
        in_names = ["hidden_in", "encoder_hidden_states"]
        out_names = ["hidden"]
        feeds = {"hidden_in": hidden_in.numpy(), "encoder_hidden_states": enc.numpy()}
        stem = "dit_step_B_fp32"
    else:
        hidden_in = torch.from_numpy(np.load(SPLIT / "stepB_torch_hidden.npy"))
        skip_ins = [
            torch.from_numpy(np.load(SPLIT / f"stepA_torch_skip_{i}.npy"))
            for i in range(7)
        ]
        part = PieceC(model, n_tokens)
        del model
        gc.collect()
        with torch.no_grad():
            noise = part(hidden_in, enc, *skip_ins)
        save("stepC_torch_noise_pred", noise)
        refs = [noise]
        args = (hidden_in, enc, *skip_ins)
        in_names = ["hidden_in", "encoder_hidden_states"] + [
            f"skip_{i}" for i in range(7)
        ]
        out_names = ["noise_pred"]
        feeds = {
            "hidden_in": hidden_in.numpy(),
            "encoder_hidden_states": enc.numpy(),
        } | {f"skip_{i}": skip_ins[i].numpy() for i in range(7)}
        stem = "dit_step_C_fp32"

    torch_refs = [t.detach().float().cpu().numpy() for t in refs]
    del refs
    if piece == "A":
        del hidden, temb, skips
    elif piece == "B":
        del hidden
    else:
        del noise
    gc.collect()
    onnx_path = export_onnx(part, args, in_names, out_names, stem)
    del part
    gc.collect()
    ort_check(onnx_path, feeds, torch_refs)
    del torch_refs, feeds
    gc.collect()
    log(f"piece {piece} FP32 done, {mem_str()}")


def build_range_model(end, need_head):
    """Meta-build the full model, materialise blocks [0, end) + head."""
    from safetensors import safe_open

    from triposg.models.transformers.triposg_transformer import (
        TripoSGDiTModel,
    )

    conf = TripoSGDiTModel.load_config(TR_DIR)
    assert int(conf["num_layers"]) == N_LAYERS, conf["num_layers"]
    with torch.device("meta"):
        model = TripoSGDiTModel.from_config(conf)
    log(f"meta model built, {mem_str()}")

    prefixes = [f"blocks.{i}." for i in range(0, end)]
    if need_head:
        prefixes += ["time_proj.", "proj_in."]
    weight = TR_DIR / "diffusion_pytorch_model.safetensors"
    state = {}
    with safe_open(weight, framework="pt", device="cpu") as archive:
        names = archive.keys()
        for key in names:
            if any(key.startswith(p) for p in prefixes):
                state[key] = archive.get_slice(key)[:]
    log(f"materialised {len(state)} tensors for blocks [0, {end}), " f"{mem_str()}")
    missing, unexpected = model.load_state_dict(state, strict=False, assign=True)
    del state
    model.requires_grad_(False)
    log(
        f"assigned range "
        f"(missing={len(missing)} unexpected={len(unexpected)}), "
        f"{mem_str()}"
    )
    return model


def run_range_fp32(head, start, end, tail, stem, batch):
    """Torch reference + export + ORT check for an arbitrary block range."""
    SPLIT.mkdir(parents=True, exist_ok=True)
    latents = torch.from_numpy(np.load(GOLDEN / "step0_latent_model_input.npy"))
    timestep = torch.from_numpy(np.load(GOLDEN / "step0_timestep.npy"))
    enc = torch.from_numpy(np.load(GOLDEN / "step0_encoder_hidden_states.npy"))
    n_tokens = int(latents.shape[1])
    assert (tuple(latents.shape), tuple(timestep.shape), tuple(enc.shape)) == (
        (2, 2048, 64),
        (2,),
        (2, 257, 1024),
    ), "golden shapes changed"
    if batch == 1:
        latents = latents[0:1]
        timestep = timestep[0:1]
        enc = enc[0:1]

    # Resolve external inputs: saved per-piece references first (stepA holds
    # hidden-after-6 and skips 0-6, stepB holds hidden-after-13), one torch
    # prefix run for the rest. External skips always precede start, so the
    # prefix (head + blocks below start) covers them.
    keys = pop_keys(start, end)
    hidden_in = None
    skips = {}
    if not head:
        if start == 0:
            log(
                "STOP: range starts at 0 without --head "
                "(block 0 needs the head concat output)"
            )
            sys.exit(1)
        if start == 7:
            hidden_in = saved_tensor("stepA_torch_hidden")
        elif start == 14:
            hidden_in = saved_tensor("stepB_torch_hidden")
    for key in keys:
        if key < 7:
            tensor = saved_tensor(f"stepA_torch_skip_{key}")
            if tensor is not None:
                skips[key] = tensor
    missing = [key for key in keys if key not in skips]
    if batch == 1:
        if hidden_in is not None:
            hidden_in = hidden_in[0:1]
        for key in skips:
            skips[key] = skips[key][0:1]
    fallback = (hidden_in is None and not head) or missing

    model = build_range_model(end, need_head=head or fallback)
    model.eval()
    if fallback:
        need = ([start - 1] if hidden_in is None and not head else []) + missing
        top = max(need) + 1
        log(f"prefix run for hidden/skips through block {top - 1}, " f"{mem_str()}")
        pre = PieceRangeHead(model, 0, top, tail=False, n_tokens=n_tokens)
        with torch.no_grad():
            out = pre(latents, timestep, enc)
        # out = (hidden, temb, *pushes); hidden is after block top - 1.
        pre_layers = push_layers(0, top)
        if hidden_in is None and not head:
            hidden_in = out[0].detach()
        for key in missing:
            skips[key] = out[2 + pre_layers.index(key)].detach()
        del out, pre
        gc.collect()

    if head:
        part = PieceRangeHead(model, start, end, tail, n_tokens)
        args = (latents, timestep, enc, *[skips[key] for key in keys])
    else:
        part = PieceRange(model, start, end, tail, n_tokens)
        args = (hidden_in, enc, *[skips[key] for key in keys])
    in_names, out_names = range_names(head, start, end, tail)
    assert len(args) == len(in_names), (len(args), in_names)
    del model
    gc.collect()
    with torch.no_grad():
        torch_outs = part(*args)
    for name, tensor in zip(out_names, torch_outs):
        save(f"{stem}_torch_{name}", tensor)
    torch_refs = [t.detach().float().cpu().numpy() for t in torch_outs]
    feeds = {
        name: arg.detach().numpy() if torch.is_tensor(arg) else arg
        for name, arg in zip(in_names, args)
    }
    del torch_outs
    gc.collect()
    onnx_path = export_onnx(part, args, in_names, out_names, f"{stem}_fp32")
    del part
    gc.collect()
    ort_check(onnx_path, feeds, torch_refs)
    del torch_refs, feeds, args
    gc.collect()
    log(f"range {stem} FP32 done, {mem_str()}")


B1 = ROOT / "logs" / "spike" / "b1"
# Batch-1 unit stems in chain order: head, one block each, tail.
B1_STEMS = ["head"] + [f"blk{i:02d}" for i in range(N_LAYERS)] + ["tail"]
# Golden batch rows: r0 = uncond (zero encoder states), r1 = cond.
B1_ROWS = (0, 1)


def unit_io_names(stem):
    """Original ONNX input/output names for one --all-b1 unit."""
    if stem == "head":
        # No encoder input: the head has no blocks, so enc would be pruned
        # by the exporter anyway. HeadOnly takes (hidden_states, timestep).
        return (["hidden_states", "timestep"], ["hidden", "temb"])
    if stem == "tail":
        return (["hidden_in"], ["noise_pred"])
    layer = int(stem[3:])
    ins = ["hidden_in", "encoder_hidden_states"]
    if layer > MID:
        ins.append(f"skip_{2 * MID - layer}")
    outs = ["hidden"]
    if layer < MID:
        outs.append(f"skip_{layer}")
    return ins, outs


def unit_prefixes(stem):
    """State-dict prefixes materialised for one --all-b1 unit."""
    if stem == "head":
        return ["time_proj.", "proj_in."]
    if stem == "tail":
        return ["norm_out.", "proj_out."]
    return [f"blocks.{int(stem[3:])}."]


class HeadOnly(nn.Module):
    """time_proj/proj_in + concat, no blocks, no encoder input."""

    def __init__(self, model):
        super().__init__()
        self.time_embed = model.time_embed
        self.time_proj = model.time_proj
        self.proj_in = model.proj_in

    def forward(self, hidden_states, timestep):
        """Run embed + concat, returning hidden/temb."""
        temb = self.time_embed(timestep).to(torch.float32)
        temb = self.time_proj(temb)
        temb = temb.unsqueeze(dim=1)
        hidden = torch.cat([temb, self.proj_in(hidden_states)], dim=1)
        return hidden, temb


class TailOnly(nn.Module):
    """norm_out/slice/proj_out with no blocks and no encoder input."""

    def __init__(self, model, n_tokens):
        super().__init__()
        self.norm_out = model.norm_out
        self.proj_out = model.proj_out
        self.n_tokens = n_tokens

    def forward(self, hidden_in):
        """Run the exact output tail of forward."""
        hidden = self.norm_out(hidden_in)
        hidden = hidden[:, -self.n_tokens :]
        return self.proj_out(hidden)


def build_unit_model(stem):
    """Meta-build the full model, materialise one unit's weights."""
    from safetensors import safe_open

    from triposg.models.transformers.triposg_transformer import (
        TripoSGDiTModel,
    )

    conf = TripoSGDiTModel.load_config(TR_DIR)
    assert int(conf["num_layers"]) == N_LAYERS, conf["num_layers"]
    with torch.device("meta"):
        model = TripoSGDiTModel.from_config(conf)
    log(f"meta model built, {mem_str()}")

    prefixes = unit_prefixes(stem)
    weight = TR_DIR / "diffusion_pytorch_model.safetensors"
    state = {}
    with safe_open(weight, framework="pt", device="cpu") as archive:
        for key in archive.keys():
            if any(key.startswith(p) for p in prefixes):
                state[key] = archive.get_slice(key)[:]
    log(f"materialised {len(state)} tensors for unit {stem}, " f"{mem_str()}")
    missing, unexpected = model.load_state_dict(state, strict=False, assign=True)
    del state
    model.requires_grad_(False)
    log(
        f"assigned unit {stem} "
        f"(missing={len(missing)} unexpected={len(unexpected)}), "
        f"{mem_str()}"
    )
    return model


def run_all_b1():
    """Batch-1 torch pass per row through all units; export + ORT-check each.

    Golden row 0 is uncond, row 1 is cond. One unit's weights are resident
    at a time; the chain state (current hidden per row, pushed skips) is
    small at batch 1. Every unit is exported FP32 opset 20 fixed-shape and
    ORT-checked against both rows' torch outputs before its module is freed.
    """
    B1.mkdir(parents=True, exist_ok=True)
    latents = torch.from_numpy(np.load(GOLDEN / "step0_latent_model_input.npy"))
    timestep = torch.from_numpy(np.load(GOLDEN / "step0_timestep.npy"))
    enc = torch.from_numpy(np.load(GOLDEN / "step0_encoder_hidden_states.npy"))
    n_tokens = int(latents.shape[1])
    assert (tuple(latents.shape), tuple(timestep.shape), tuple(enc.shape)) == (
        (2, 2048, 64),
        (2,),
        (2, 257, 1024),
    ), "golden shapes changed"

    rows = {}
    for r in B1_ROWS:
        rows[r] = {
            "hidden_states": latents[r : r + 1],
            "timestep": timestep[r : r + 1],
            "encoder_hidden_states": enc[r : r + 1],
        }
        for name, tensor in rows[r].items():
            np.save(B1 / f"{name}_r{r}.npy", tensor.numpy())
        # Chain inputs under the names spike_adb_chain_npu.sh expects:
        # latent (= head hidden_states in), timestep (same name), enc
        # (= blk00 encoder_hidden_states in). Contents equal
        # dit_head_in_hidden_states_r* /
        # dit_blk00_in_encoder_hidden_states_r* written per unit below.
        np.save(B1 / f"latent_r{r}.npy", rows[r]["hidden_states"].numpy())
        np.save(B1 / f"enc_r{r}.npy", rows[r]["encoder_hidden_states"].numpy())
    log(f"sliced golden rows to {B1}, {mem_str()}")
    del latents, timestep, enc
    gc.collect()

    hidden = {}
    skips = {}
    for stem in B1_STEMS:
        in_names, out_names = unit_io_names(stem)
        model = build_unit_model(stem)
        model.eval()
        if stem == "head":
            part = HeadOnly(model)
        elif stem == "tail":
            part = TailOnly(model, n_tokens)
        else:
            layer = int(stem[3:])
            part = PieceRange(model, layer, layer + 1, False, n_tokens)
        del model
        gc.collect()

        row_args = {}
        torch_outs = {}
        for r in B1_ROWS:
            if stem == "head":
                args = (rows[r]["hidden_states"], rows[r]["timestep"])
            elif stem == "tail":
                args = (hidden[r],)
            else:
                layer = int(stem[3:])
                extra = [skips[(r, 2 * MID - layer)]] if layer > MID else []
                args = (hidden[r], rows[r]["encoder_hidden_states"], *extra)
            assert len(args) == len(in_names), (stem, len(args), in_names)
            row_args[r] = args
            with torch.no_grad():
                outs = part(*args)
            if not isinstance(outs, tuple):
                outs = (outs,)
            assert len(outs) == len(out_names), (stem, len(outs), out_names)
            torch_outs[r] = outs
            for name, tensor in zip(out_names, outs):
                save(f"dit_{stem}_out_{name}_r{r}", tensor, B1)
            for name, tensor in zip(in_names, args):
                np.save(B1 / f"dit_{stem}_in_{name}_r{r}.npy", tensor.detach().numpy())
        onnx_path = export_onnx(
            part, row_args[0], in_names, out_names, f"dit_{stem}_fp32", B1
        )
        del part
        gc.collect()
        for r in B1_ROWS:
            feeds = {
                name: tensor.detach().numpy()
                for name, tensor in zip(in_names, row_args[r])
            }
            refs = [tensor.detach().float().cpu().numpy() for tensor in torch_outs[r]]
            ort_check(onnx_path, feeds, refs)
            del feeds, refs
        del row_args
        gc.collect()

        for r in B1_ROWS:
            outs = torch_outs[r]
            if stem != "tail":
                hidden[r] = outs[0].detach()
            if stem.startswith("blk"):
                layer = int(stem[3:])
                if layer < MID:
                    skips[(r, layer)] = outs[1].detach()
            del outs
        del torch_outs
        gc.collect()
        log(f"unit {stem} done, {mem_str()}")
    log(f"all-b1 done, {mem_str()}")


def main():
    """Parse args and run one range/piece (FP32 export or FP16 conversion)."""
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--all-b1",
        action="store_true",
        help="export all 23 batch-1 units into logs/spike/b1/",
    )
    parser.add_argument(
        "--piece",
        choices=PIECES,
        help="A|B|C alias; cannot combine with " "--blocks/--head/--tail",
    )
    parser.add_argument(
        "--blocks", default=None, help="half-open START:END block range, e.g. 7:8"
    )
    parser.add_argument(
        "--head", action="store_true", help="prepend time_proj/proj_in/concat"
    )
    parser.add_argument(
        "--tail", action="store_true", help="append norm_out/slice/proj_out"
    )
    parser.add_argument(
        "--batch",
        type=int,
        choices=[1, 2],
        default=2,
        help="batch size (range mode only; 1 = row 0)",
    )
    parser.add_argument(
        "--fp16", action="store_true", help="convert this spec's FP32 ONNX to FP16"
    )
    args = parser.parse_args()

    watchdog()
    if args.all_b1:
        if (
            args.piece is not None
            or args.blocks is not None
            or args.head
            or args.tail
            or args.batch != 2
            or args.fp16
        ):
            log(
                "STOP: --all-b1 cannot be combined with --piece/--blocks/"
                "--head/--tail/--batch/--fp16"
            )
            sys.exit(1)
        log(f"all-b1 {mem_str()}")
        run_all_b1()
        return
    if args.piece is not None:
        if args.blocks is not None or args.head or args.tail:
            log("STOP: --piece cannot be combined with " "--blocks/--head/--tail")
            sys.exit(1)
        if args.batch != 2:
            log("STOP: --batch 1 is range-mode only")
            sys.exit(1)
        log(f"piece {args.piece} fp16={args.fp16} {mem_str()}")
        if args.fp16:
            run_fp16(f"dit_step_{args.piece}")
        else:
            run_fp32(args.piece)
        return
    if args.blocks is None:
        log("STOP: need --piece or --blocks START:END")
        sys.exit(1)
    try:
        start, end = (int(x) for x in args.blocks.split(":"))
    except ValueError:
        log(f"STOP: bad --blocks {args.blocks!r}, want START:END")
        sys.exit(1)
    if not (0 <= start < end <= N_LAYERS):
        log(f"STOP: blocks [{start}, {end}) outside [0, {N_LAYERS}]")
        sys.exit(1)
    stem = range_stem(args.head, start, end, args.tail)
    if args.batch == 1:
        stem += "_b1"
    log(f"range {stem} fp16={args.fp16} {mem_str()}")
    if args.fp16:
        run_fp16(stem)
    else:
        run_range_fp32(args.head, start, end, args.tail, stem, args.batch)


def run_fp16(stem):
    """Convert one spec's FP32 ONNX ({stem}_fp32) to FP16 (keep I/O FP32).

    Uses onnxruntime's own converter. onnxconverter-common 1.16.0 crashes
    on these graphs (its Cast fan-out pass assumes every downstream input
    has an `.input` attribute); disk-backed shape inference first, then
    convert with shapes already inferred.
    """
    import onnx

    from onnxruntime.transformers.float16 import convert_float_to_float16

    fp32 = str(SPLIT / f"{stem}_fp32.onnx")
    fp16 = str(SPLIT / f"{stem}_fp16.onnx")
    if not os.path.isfile(fp32):
        log(f"MISSING {fp32} — run the FP32 export first")
        sys.exit(1)
    inferred = str(SPLIT / f"_inferred_{stem}.onnx")
    try:
        onnx.shape_inference.infer_shapes_path(fp32, inferred)
        log(f"shape-inferred {inferred}, {mem_str()}")
        model = onnx.load(inferred)
        log(f"loaded inferred model, {mem_str()}")
        fp16_model = convert_float_to_float16(
            model, keep_io_types=True, disable_shape_infer=True
        )
        del model
        gc.collect()
        log(f"converted to FP16 in memory, {mem_str()}")
        for stale in (fp16, fp16 + ".data"):
            try:
                os.remove(stale)
            except OSError:
                pass
        onnx.save_model(
            fp16_model,
            fp16,
            save_as_external_data=True,
            all_tensors_to_one_file=True,
            location=f"{stem}_fp16.onnx.data",
        )
        del fp16_model
        gc.collect()
    finally:
        for tmp in (inferred, inferred + ".data"):
            try:
                os.remove(tmp)
            except OSError:
                pass
    size = os.path.getsize(fp16) + os.path.getsize(fp16 + ".data")
    log(f"converted {fp16} ({size / 1e9:.2f} GB total), " f"{mem_str()}")


if __name__ == "__main__":
    main()
