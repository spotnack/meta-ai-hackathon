"""Focused tests for bench/make_model_manifest.py --merged-dir layout.

Run from the repo root:
  ~/anaconda3/envs/triposg-spike/bin/python -m pytest \\
      ml/triposg-mobile/bench/test_make_model_manifest.py

No network, no weights: only the (source, rel) pair construction that
--merged-dir added. Fast (< 1 min, no data files).
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from make_model_manifest import CHAIN_STEMS  # noqa: E402
from make_model_manifest import collect_merged_pairs  # noqa: E402


def test_merged_pairs_cover_chain_bins_and_vae():
    """dit_chain.onnx + 23 bins + 4 VAE files, no per-unit .onnx."""
    merged = Path("/m")
    vae = {
        stem: {
            "compiled_onnx": f"/v/{stem}.onnx",
            "model_bin": f"/v/{stem}.bin",
        }
        for stem in ("vae_post", "vae_query")
    }
    pairs = collect_merged_pairs(merged, vae)
    rels = [rel for _, rel in pairs]
    assert rels[0] == "dit_chain.onnx"
    assert pairs[0][0] == merged / "dit_chain.onnx"
    for stem in CHAIN_STEMS:
        assert f"{stem}/model.bin" in rels
    assert "blk00/model.onnx" not in rels
    assert "head/model.onnx" not in rels
    for stem in ("vae_post", "vae_query"):
        assert f"{stem}/model.onnx" in rels
        assert f"{stem}/model.bin" in rels
    assert len(pairs) == 1 + len(CHAIN_STEMS) + 4
