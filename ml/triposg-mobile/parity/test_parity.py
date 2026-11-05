"""Focused regression tests for the parity harness (synthetic, no goldens).

Run from the repo root:
  ~/anaconda3/envs/triposg-spike/bin/python -m pytest \\
      ml/triposg-mobile/parity/test_parity.py

Covers the Phase 1 bug fix (scipy cKDTree replacing the dense 20000x20000
distance matrix) plus the tensor comparator math, the ray-parity IoU on
known boxes, and the non-watertight fallback path. Fast (< 1 min, MBs).
"""

import sys
from pathlib import Path

import numpy as np
import pytest
import trimesh
from scipy.spatial import cKDTree

sys.path.insert(0, str(Path(__file__).resolve().parent))
from tensor_parity import compare  # noqa: E402
from tensor_parity import compare_all  # noqa: E402
from tensor_parity import gate  # noqa: E402
from tensor_parity import load_thresholds  # noqa: E402
from mesh_parity import chamfer_fscore  # noqa: E402
from mesh_parity import ray_parity_occupancy  # noqa: E402
from mesh_parity import surface_fill_occupancy  # noqa: E402
from mesh_parity import union_bbox  # noqa: E402
from mesh_parity import volume_iou  # noqa: E402

BOUNDS = {"cosine_min": 0.999, "rel_l2_max": 1e-2}


def test_compare_identical_passes():
    """Identical arrays: zero error, cosine 1, gate passes."""
    ref = np.random.default_rng(0).normal(size=(2, 8))
    out = compare(ref, ref.copy())
    assert out["max_abs"] == 0.0
    assert out["rel_l2"] == 0.0
    assert abs(out["cosine"] - 1.0) < 1e-9
    assert out["finite"] is True
    assert gate("any", {"whole": out}, {"any": BOUNDS})["pass"] is True


def test_compare_scaled_gives_known_rel_l2():
    """got = 1.01 * ref: rel_l2 is exactly 0.01, cosine stays 1."""
    ref = np.random.default_rng(1).normal(size=(2, 8)) + 2.0
    out = compare(1.01 * ref, ref)
    assert abs(out["rel_l2"] - 0.01) < 1e-12
    assert abs(out["cosine"] - 1.0) < 1e-12


def test_compare_zero_reference_is_safe():
    """Zero reference: 0/0 -> rel_l2 0 and cosine 1; x/0 -> inf and 0."""
    zeros = np.zeros((2, 4))
    out = compare(zeros, zeros.copy())
    assert out["rel_l2"] == 0.0
    assert out["cosine"] == 1.0
    out = compare(np.ones((2, 4)), zeros)
    assert out["rel_l2"] == float("inf")
    assert out["cosine"] == 0.0


def test_compare_all_reports_per_row_order():
    """Per-row metrics match direct row compares, uncond row first."""
    rng = np.random.default_rng(2)
    ref = rng.normal(size=(2, 6))
    got = ref + 0.001
    got[1] += 0.01
    out = compare_all(got, ref)
    assert len(out["rows"]) == 2
    assert out["rows"][0]["max_abs"] < out["rows"][1]["max_abs"]
    for i in (0, 1):
        assert out["rows"][i] == compare(got[i], ref[i])


def test_compare_all_rejects_shape_mismatch():
    """Mismatched shapes raise before any metric is computed."""
    with pytest.raises(ValueError):
        compare_all(np.zeros((2, 4)), np.zeros((2, 5)))


def test_gate_names_violations_and_unknown_component():
    """Failing gates explain themselves; unknown components fail closed."""
    ref = np.random.default_rng(3).normal(size=(2, 8))
    out = compare(ref * 2.0, ref)
    verdict = gate("c", {"whole": out}, {"c": BOUNDS})
    assert verdict["pass"] is False
    assert verdict["reasons"]
    verdict = gate("missing", {"whole": out}, {"c": BOUNDS})
    assert verdict["pass"] is False


def test_step0_gate_accepts_perfect_match():
    """The shipped thresholds.json gates a perfect step-0 match as PASS."""
    here = Path(__file__).resolve().parent
    thresholds = load_thresholds(here / "thresholds.json")
    ref = np.random.default_rng(4).normal(size=(2, 16, 4))
    result = compare_all(ref, ref.copy())
    verdict = gate("step0_noise_pred", result, thresholds)
    assert verdict["pass"] is True


def test_chamfer_matches_brute_force():
    """cKDTree Chamfer/F-score equal the old dense-matrix math (small N)."""
    rng = np.random.default_rng(5)
    cand = rng.normal(size=(500, 3))
    ref = rng.normal(size=(300, 3)) + 0.5
    got = chamfer_fscore(cand, ref, 0.05)
    dist2 = ((cand[:, None, :] - ref[None, :, :]) ** 2).sum(-1)
    nearest_cand = np.sqrt(dist2.min(1))
    nearest_ref = np.sqrt(dist2.min(0))
    diag = float(np.linalg.norm(ref.max(0) - ref.min(0)))
    expect = (nearest_cand.mean() + nearest_ref.mean()) / 2
    assert abs(got["chamfer"] - expect) < 1e-9
    assert abs(got["diag"] - diag) < 1e-12
    tau = 0.05 * diag
    prec = float((nearest_ref < tau).mean())
    rec = float((nearest_cand < tau).mean())
    assert abs(got["f_score"] - 2 * prec * rec / (prec + rec)) < 1e-9
    assert got["chamfer_over_diag"] == got["chamfer"] / diag


def test_chamfer_identical_point_sets():
    """Identical samples: Chamfer 0, F-score 1."""
    pts = np.random.default_rng(6).normal(size=(1000, 3))
    got = chamfer_fscore(pts, pts.copy(), 0.01)
    assert got["chamfer"] == 0.0
    assert got["f_score"] == 1.0
    assert got["precision"] == 1.0
    assert got["recall"] == 1.0


def test_ckdtree_agrees_with_brute_force():
    """Sanity anchor: cKDTree distances equal dense distances here."""
    rng = np.random.default_rng(7)
    cand = rng.normal(size=(200, 3))
    ref = rng.normal(size=(150, 3))
    tree = cKDTree(cand)
    dense = np.sqrt(((ref[:, None, :] - cand[None, :, :]) ** 2).sum(-1))
    assert np.abs(tree.query(ref, k=1)[0] - dense.min(1)).max() < 1e-9


def _box(extents=(1.0, 1.0, 1.0)):
    """Watertight unit box mesh."""
    return trimesh.creation.box(extents=extents)


def test_iou_identical_box_is_one():
    """A watertight mesh against itself: IoU 1.0 via ray parity."""
    mesh = _box()
    assert mesh.is_watertight
    out = volume_iou(mesh, mesh, 32)
    assert out["method"] == "ray_parity"
    assert out["watertight"] == {"candidate": True, "ref": True}
    assert out["iou"] == 1.0


def test_iou_shifted_box_matches_known_value():
    """Box shifted +0.25 x: IoU is 0.75/1.25 = 0.6, modulo voxels."""
    box = _box()
    moved = _box()
    moved.vertices = moved.vertices + np.array([0.25, 0.0, 0.0])
    out = volume_iou(box, moved, 64)
    assert out["method"] == "ray_parity"
    assert abs(out["iou"] - 0.6) < 0.05


def test_iou_open_box_takes_documented_fallback():
    """A non-watertight mesh reports flags and uses surface_fill."""
    closed = _box()
    faces = np.asarray(closed.faces)
    open_box = trimesh.Trimesh(
        vertices=np.asarray(closed.vertices), faces=faces[1:], process=True
    )
    assert not open_box.is_watertight
    out = volume_iou(open_box, closed, 16)
    assert out["method"] == "surface_fill"
    assert out["watertight"] == {"candidate": False, "ref": True}
    assert 0.0 <= out["iou"] <= 1.0


def test_surface_fill_agrees_with_ray_parity_on_box():
    """Fallback occupancy roughly matches ray parity on watertight input."""
    mesh = _box()
    verts = np.asarray(mesh.vertices, dtype=np.float64)
    faces = np.asarray(mesh.faces, dtype=np.int64)
    lo, hi = union_bbox(verts, verts)
    ray = ray_parity_occupancy(verts, faces, lo, hi, 32)
    fill = surface_fill_occupancy(verts, faces, lo, hi, 32)
    agree = (ray == fill).mean()
    assert agree > 0.8


def test_union_bbox_pads_degenerate_axis():
    """A flat point set still yields a usable (nonzero-span) grid."""
    pts = np.random.default_rng(8).normal(size=(100, 3))
    pts[:, 2] = 1.5
    lo, hi = union_bbox(pts, pts.copy())
    assert ((hi - lo) > 0).all()
    occ = ray_parity_occupancy(pts[:3], np.array([[0, 1, 2]]), lo, hi, 8)
    assert occ.shape == (8, 8, 8)
