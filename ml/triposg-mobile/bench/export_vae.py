"""VAE decoder export: vae_post (latents -> kv, once per mesh) + vae_query.

Math mirrors TripoSGVAEModel._decode at fc5c4099 exactly, using the DEFAULT
(non-flash) attention path:

- The goldens ran use_flash_decoder=True, BUT flash_extract_geometry calls
  geo_decoder.set_topk(False) before every decode, and with topk=False the
  flash processor is plain scaled_dot_product_attention — identical to the
  default TripoSGAttnProcessor2_0. --check-flash proves it numerically on
  the laptop CPU (default-vs-flash torch decode, STOP above rel-L2 1e-6),
  and both units export the default path.
- vae_post: post_quant + decoder.blocks[0..15] (self-attention) maps
  final_latents (1, 2048, 64) -> kv (1, 2048, 1024). Run once per mesh.
- vae_query: frequency embedding (stateless constants reimplemented here;
  the checkpoint holds no embedder weights) + proj_query +
  decoder.blocks[16] (cross-attention) + norm_out + proj_out + negate,
  mapping (queries (1, N, 3), kv) -> SDF (1, N, 1), matching
  query_geometry with grad off (the trailing *-1 included).

N (--chunk, default 8192) is fixed at export: cross-attention scores are
(8 heads, N, 2048) FP32, i.e. N*64 KiB total transient — 512 MiB at 8192,
2 GiB at 32768, likely over HTP limits, so start at 8192 and move only on
profile evidence (aihub_compile.py reports per-call ms/memory; N is a
re-export knob, no code change). Per query point the math is independent,
so chunking never changes values.

Usage (triposg-spike env). One unit per process, 8 GiB anon cap — run
under systemd-run so the kernel kills only the job on overflow:
  systemd-run --user --scope -p MemoryMax=9G -p MemorySwapMax=0 \
    python -u bench/export_vae.py --unit post
  systemd-run --user --scope -p MemoryMax=9G -p MemorySwapMax=0 \
    python -u bench/export_vae.py --unit query [--chunk 8192]
  systemd-run --user --scope -p MemoryMax=9G -p MemorySwapMax=0 \
    python -u bench/export_vae.py --unit flash-check

Saves into logs/spike/vae/: vae_post_fp32.onnx (+ .data), torch kv ref
for golden id hjswed; vae_query_fp32.onnx (+ .data), torch refs for a
fixed random point set and a coarse-grid slice (points + logits).
Each unit is ORT-checked FP32 vs its torch outputs (rel-L2 <= 1e-4).
"""

import argparse
import gc
import sys
from pathlib import Path

import numpy as np
import torch
from torch import nn

from memwatch import mem_str, watchdog
from split_export_step import export_onnx, log, ort_check

TRIPOSG_DIR = Path.home() / ".cache" / "triposg" / "TripoSG"
sys.path.insert(0, str(TRIPOSG_DIR))

ROOT = Path("ml/triposg-mobile")
VAE_DIR = ROOT / "pretrained_weights" / "vae"
VAELOG = ROOT / "logs" / "spike" / "vae"
GOLDEN = ROOT / "reference" / "goldens_5" / "hjswed"

N_SELF_BLOCKS = 16
CROSS_BLOCK = 16
FLASH_GATE = 1e-6

POST_PREFIXES = ["post_quant."] + [f"decoder.blocks.{i}." for i in range(N_SELF_BLOCKS)]
QUERY_PREFIXES = [f"decoder.blocks.{CROSS_BLOCK}."] + [
    "decoder.proj_query.",
    "decoder.norm_out.",
    "decoder.proj_out.",
]


def build_vae_model(prefixes):
    """Meta-build the VAE, materialise one unit's weights (FP32)."""
    from safetensors import safe_open

    from triposg.models.autoencoders.autoencoder_kl_triposg import (
        TripoSGVAEModel,
    )

    conf = TripoSGVAEModel.load_config(VAE_DIR)
    # config counts the 16 self-attn layers; the model adds 1 cross-attn block
    assert int(conf["num_layers_decoder"]) == 16, conf["num_layers_decoder"]
    assert int(conf["width_decoder"]) == 1024, conf["width_decoder"]
    with torch.device("meta"):
        model = TripoSGVAEModel.from_config(conf)
    log(f"meta VAE built, {mem_str()}")

    weight = VAE_DIR / "diffusion_pytorch_model.safetensors"
    state = {}
    matched = {p: 0 for p in prefixes}
    with safe_open(weight, framework="pt", device="cpu") as archive:
        for key in archive.keys():
            for prefix in prefixes:
                if key.startswith(prefix):
                    state[key] = archive.get_slice(key)[:]
                    matched[prefix] += 1
                    break
    missing = [p for p, n in matched.items() if n == 0]
    if missing:
        log(
            f"STOP: prefixes matched no keys: {missing} "
            f"(checkpoint layout changed?)"
        )
        sys.exit(1)
    log(f"materialised {len(state)} tensors, {mem_str()}")
    missing, unexpected = model.load_state_dict(state, strict=False, assign=True)
    del state
    model.requires_grad_(False)
    log(
        f"assigned (missing={len(missing)} unexpected={len(unexpected)}), "
        f"{mem_str()}"
    )
    return model, conf


class VaePost(nn.Module):
    """post_quant + 16 self-attention decoder blocks -> kv cache."""

    def __init__(self, model):
        super().__init__()
        self.post_quant = model.post_quant
        self.blocks = torch.nn.ModuleList(
            model.decoder.blocks[i] for i in range(N_SELF_BLOCKS)
        )

    def forward(self, latents):
        """Map (1, 2048, 64) latents to the (1, 2048, 1024) kv cache."""
        hidden = self.post_quant(latents)
        for block in self.blocks:
            hidden = block(hidden)
        return hidden


class VaeQuery(nn.Module):
    """Frequency embed + cross-attention query -> negated SDF logits."""

    def __init__(self, model, num_freqs):
        super().__init__()
        self.proj_query = model.decoder.proj_query
        self.cross = model.decoder.blocks[CROSS_BLOCK]
        self.norm_out = model.decoder.norm_out
        self.proj_out = model.decoder.proj_out
        self.num_freqs = num_freqs
        self.frequencies = 2.0 ** torch.arange(num_freqs)
        embed = model.decoder.proj_query
        assert embed.in_features == 3 * (num_freqs * 2 + 1), (
            embed.in_features,
            num_freqs,
        )

    def embed(self, queries):
        """Stateless frequency embedding (matches FrequencyPositionalEmbedding
        with include_input=True, include_pi=False)."""
        feat = (queries[..., None].contiguous() * self.frequencies).view(
            *queries.shape[:-1], -1
        )
        return torch.cat((queries, feat.sin(), feat.cos()), dim=-1)

    def forward(self, queries, kv):
        """Map (1, N, 3) queries + kv to (1, N, 1) SDF (negated, golden)."""
        hidden = self.cross(
            self.proj_query(self.embed(queries)), encoder_hidden_states=kv
        )
        return self.proj_out(self.norm_out(hidden)) * -1


def golden_latents():
    """hjswed final_latents as a torch tensor, shape-checked."""
    latents = torch.from_numpy(np.load(GOLDEN / "final_latents.npy"))
    assert tuple(latents.shape) == (1, 2048, 64), latents.shape
    return latents


def save(name, tensor):
    """Save a torch tensor as an FP32 .npy reference under VAELOG."""
    array = tensor.detach().float().cpu().numpy()
    path = VAELOG / f"{name}.npy"
    np.save(path, array)
    log(f"saved {path} {array.shape} {mem_str()}")


def run_post():
    """Torch reference + export + ORT check for vae_post."""
    VAELOG.mkdir(parents=True, exist_ok=True)
    latents = golden_latents()
    model, _ = build_vae_model(POST_PREFIXES)
    model.eval()
    part = VaePost(model)
    del model
    gc.collect()
    with torch.no_grad():
        kv = part(latents)
    assert tuple(kv.shape) == (1, 2048, 1024), kv.shape
    save("vae_post_torch_kv", kv)
    torch_ref = kv.detach().float().cpu().numpy()
    feeds = {"latents": latents.numpy()}
    onnx_path = export_onnx(
        part, (latents,), ["latents"], ["kv"], "vae_post_fp32", VAELOG
    )
    del part, kv
    gc.collect()
    ort_check(onnx_path, feeds, [torch_ref])
    del torch_ref, feeds
    gc.collect()
    log(f"vae_post FP32 done, {mem_str()}")


def query_points():
    """Fixed reference inputs: 4096 seeded random points + a 64^2 slice."""
    bound = 1.005
    rng = np.random.default_rng(7)
    random_pts = rng.uniform(-bound, bound, size=(1, 4096, 3))
    axis = np.linspace(-bound, bound, 64).astype(np.float64)
    xs, ys = np.meshgrid(axis, axis, indexing="ij")
    plane = np.stack([xs.ravel(), ys.ravel(), np.full(4096, axis[32])], axis=1)
    slice_pts = plane[None].astype(np.float64)
    return (torch.from_numpy(random_pts).float(), torch.from_numpy(slice_pts).float())


def tile_queries(points, n):
    """Tile (1, M, 3) points to exactly (1, n, 3) for fixed-shape trace."""
    reps = (n + points.shape[1] - 1) // points.shape[1]
    tiled = points.repeat(1, reps, 1)[:, :n, :].contiguous()
    return tiled


def run_query(chunk):
    """Torch references + export + ORT check for vae_query at fixed N."""
    VAELOG.mkdir(parents=True, exist_ok=True)
    latents = golden_latents()
    random_pts, slice_pts = query_points()
    np.save(VAELOG / "vae_query_points_random.npy", random_pts.numpy())
    np.save(VAELOG / "vae_query_points_slice.npy", slice_pts.numpy())

    # kv needs the post blocks; VaeQuery needs the cross block + heads.
    model, conf = build_vae_model(POST_PREFIXES + QUERY_PREFIXES)
    model.eval()
    post = VaePost(model)
    with torch.no_grad():
        kv = post(latents)
    del post
    gc.collect()

    part = VaeQuery(model, int(conf["embed_frequency"]))
    assert model.embedder.include_input, "embedder include_input changed"
    # VaeQuery uses freqs 2^k; valid only while the config keeps include_pi off
    assert not conf.get("embed_include_pi", True), "embed_include_pi changed"
    del model
    gc.collect()
    with torch.no_grad():
        logits_random = part(random_pts, kv)
        logits_slice = part(slice_pts, kv)
    save("vae_query_torch_random", logits_random)
    save("vae_query_torch_slice", logits_slice)

    trace_q = tile_queries(torch.cat([random_pts, slice_pts], dim=1), chunk)
    with torch.no_grad():
        torch_outs = part(trace_q, kv)
    torch_refs = [torch_outs.detach().float().cpu().numpy()]
    feeds = {"queries": trace_q.numpy(), "kv": kv.detach().numpy()}
    del torch_outs
    gc.collect()
    onnx_path = export_onnx(
        part, (trace_q, kv), ["queries", "kv"], ["sdf"], "vae_query_fp32", VAELOG
    )
    del part, kv
    gc.collect()
    ort_check(onnx_path, feeds, torch_refs)
    del torch_refs, feeds
    gc.collect()
    log(f"vae_query FP32 (N={chunk}) done, {mem_str()}")


def run_flash_check():
    """Prove default-path == flash-path numerics (goldens used flash)."""
    latents = golden_latents()
    random_pts, _ = query_points()
    small = random_pts[:, :256, :].contiguous()
    model, conf = build_vae_model(POST_PREFIXES + QUERY_PREFIXES)
    model.eval()
    post = VaePost(model)
    part = VaeQuery(model, int(conf["embed_frequency"]))
    with torch.no_grad():
        kv = post(latents)
        logits_default = part(small, kv)
    del post
    gc.collect()

    # Golden path: flash processor installed, topk disabled per decode.
    model.set_flash_decoder()
    model.decoder.set_topk(False)
    with torch.no_grad():
        logits_flash = part(small, kv)
    del part, model, kv
    gc.collect()

    a = logits_default.detach().float().cpu().numpy().astype(np.float64)
    b = logits_flash.detach().float().cpu().numpy().astype(np.float64)
    diff = a - b
    rel = float(np.linalg.norm(diff.ravel()) / np.linalg.norm(a.ravel()))
    log(
        f"flash-vs-default: rel_l2={rel:.3e} max_abs={np.abs(diff).max():.3e} "
        f"{mem_str()}"
    )
    if rel > FLASH_GATE:
        log(
            f"STOP: flash path differs from default (rel_l2={rel:.3e}); "
            f"export must follow the flash math instead"
        )
        sys.exit(1)
    log("flash-vs-default MATCH: exporting the default path is golden-exact")


def main():
    """Parse args and run one VAE export unit."""
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--unit", choices=["post", "query", "flash-check"], required=True
    )
    parser.add_argument(
        "--chunk", type=int, default=8192, help="fixed query count N for vae_query"
    )
    args = parser.parse_args()

    watchdog()
    log(f"vae {args.unit} chunk={args.chunk} {mem_str()}")
    if args.unit == "post":
        run_post()
    elif args.unit == "query":
        run_query(args.chunk)
    else:
        run_flash_check()


if __name__ == "__main__":
    main()
