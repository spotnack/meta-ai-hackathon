"""Focused tests for bench/aihub_compile.py --variant path resolution.

Run from the repo root:
  ~/anaconda3/envs/triposg-spike/bin/python -m pytest \\
      ml/triposg-mobile/bench/test_aihub_compile.py

No network, no weights: only the pure source-dir/manifest-name logic that
--variant w8a16 changed. Fast (< 1 min, no data files).
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from aihub_compile import FP32_B1_DIR  # noqa: E402
from aihub_compile import FP32_OUT_DIR  # noqa: E402
from aihub_compile import W8A16_B1_DIR  # noqa: E402
from aihub_compile import W8A16_OUT_DIR  # noqa: E402
from aihub_compile import job_tag  # noqa: E402
from aihub_compile import resolve_dirs  # noqa: E402
from aihub_compile import unit_source  # noqa: E402


def test_fp32_transformer_source_is_flat():
    """fp32 units: dit_<stem>_fp32.onnx directly in the b1 dir."""
    src_dir, src_base, _ = unit_source("blk07", "fp32", FP32_B1_DIR)
    assert src_dir == Path(FP32_B1_DIR)
    assert src_base == "dit_blk07_fp32"


def test_w8a16_transformer_source_is_per_stem_model():
    """w8a16 units: <stem>/model.onnx + model.onnx.data per stem dir."""
    src_dir, src_base, _ = unit_source("blk07", "w8a16", W8A16_B1_DIR)
    assert src_dir == Path(W8A16_B1_DIR) / "blk07"
    assert src_base == "model"


def test_vae_source_ignores_variant():
    """VAE stems always come from export_vae.py, either variant."""
    for variant in ("fp32", "w8a16"):
        src_dir, src_base, _ = unit_source("vae_post", variant, "anything")
        assert src_base == "vae_post_fp32"
        assert src_dir.name == "vae"


def test_resolve_dirs_defaults_switch_with_variant():
    """Untouched paths follow the variant; explicit ones are kept."""
    b1, out, manifest = resolve_dirs("fp32", FP32_B1_DIR, FP32_OUT_DIR)
    assert (b1, out, manifest) == (FP32_B1_DIR, FP32_OUT_DIR, "manifest_b1.json")
    b1, out, manifest = resolve_dirs("w8a16", FP32_B1_DIR, FP32_OUT_DIR)
    assert (b1, out, manifest) == (W8A16_B1_DIR, W8A16_OUT_DIR, "manifest_w8a16.json")
    custom = resolve_dirs("w8a16", "/tmp/src", "/tmp/out")
    assert custom == ("/tmp/src", "/tmp/out", "manifest_w8a16.json")


def test_job_tag_keeps_historical_fp32_name():
    """fp32 jobs keep the 'b1' tag; w8a16 jobs are tagged w8a16."""
    assert job_tag("fp32") == "b1"
    assert job_tag("w8a16") == "w8a16"
