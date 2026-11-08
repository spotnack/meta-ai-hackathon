"""Mesh parity vs a reference mesh: symmetric Chamfer + F-score + volume IoU.

Sampling/Chamfer/F-score match the Colab ablation cell (plan
docs/ai_pipeline_phase2_plan.md section 5, cell B). Nearest neighbours use
scipy cKDTree: the old dense N x N distance matrix peaked at ~3.2 GB for
N = 20000, the two trees peak at tens of MB.

Volume IoU is occupancy agreement on a fixed grid (default 64^3) over the
union bbox of both meshes:

- Primary (both meshes watertight): ray parity along +x. Triangles are
  filed by the y-z cells they cover (span<=2 inline over fixed offset
  passes, larger ones per column), then each column runs vectorized
  Moller-Trumbore over its own bin. Ray y/z sit at fixed sub-cell offsets
  (0.37 / 0.73 of a cell, inside the column) so axis-aligned rays do not
  land exactly on shared edges. Intersection distances are compared
  against cell centers in the same t-space (shifted by the ray origin).
  Pure numpy; no embree/rtree.
- Fallback (either mesh not watertight): dense surface raster
  (midpoint-subdivided to half-cell edges, centroid + vertex splat,
  1-voxel dilation) plus exterior flood fill from the grid border
  (scipy.ndimage). Slightly overestimates volume at the surface; larger
  openings leak, and the output flags the mesh non-watertight.

The output always names the IoU method plus both meshes' watertight flags.

Usage:
  python -u parity/mesh_parity.py CANDIDATE.glb REF.glb \
      [--samples 20000] [--tau 0.01] [--seed 0] [--seed-ref S] \
      [--grid 64] [--json OUT.json] [--render OUT.png]

tau is a fraction of the reference bbox diagonal (default 1%). Report-only:
exit 0 always (thresholds live in parity/thresholds.json).
Needs numpy + scipy + trimesh; --render additionally needs matplotlib.
"""

import argparse
import gc
import json

import numpy as np
import trimesh
from scipy.spatial import cKDTree

# Fixed sub-cell ray offsets (inside the column): keep axis-aligned rays
# off shared triangle edges/vertices.
RAY_OY = 0.37
RAY_OZ = 0.73
MT_EPS = 1e-12


def load_mesh(path: str) -> trimesh.Trimesh:
    """Load one mesh file as a Trimesh (single geometry, float64 verts)."""
    mesh = trimesh.load(path, force="mesh")
    if isinstance(mesh, trimesh.Scene):
        mesh = trimesh.util.concatenate(tuple(mesh.geometry.values()))
    mesh = trimesh.Trimesh(
        vertices=np.asarray(mesh.vertices, dtype=np.float64),
        faces=np.asarray(mesh.faces, dtype=np.int64),
        process=True,
    )
    if len(mesh.faces) == 0:
        raise ValueError(f"{path}: mesh has no faces")
    return mesh


def sample_points(mesh: trimesh.Trimesh, n: int, seed: int) -> np.ndarray:
    """Sample n surface points (seeded, deterministic)."""
    points, _ = trimesh.sample.sample_surface(mesh, n, seed=seed)
    return np.asarray(points, dtype=np.float64)


def chamfer_fscore(cand: np.ndarray, ref: np.ndarray, tau_frac: float) -> dict:
    """Symmetric Chamfer + F-score at tau_frac * ref bbox diagonal."""
    tree_cand = cKDTree(cand)
    tree_ref = cKDTree(ref)
    nearest_ref = tree_cand.query(ref, k=1)[0]  # per ref point -> cand
    nearest_cand = tree_ref.query(cand, k=1)[0]  # per cand point -> ref
    del tree_cand, tree_ref
    diag = float(np.linalg.norm(ref.max(0) - ref.min(0)))
    tau = tau_frac * diag
    precision = float((nearest_ref < tau).mean())
    recall = float((nearest_cand < tau).mean())
    chamfer = float((nearest_cand.mean() + nearest_ref.mean()) / 2)
    return {
        "chamfer": chamfer,
        "chamfer_over_diag": chamfer / diag if diag > 0 else 0.0,
        "precision": precision,
        "recall": recall,
        "f_score": float(2 * precision * recall / (precision + recall))
        if (precision + recall) > 0
        else 0.0,
        "tau": tau,
        "diag": diag,
    }


def union_bbox(
    verts_a: np.ndarray, verts_b: np.ndarray
) -> tuple[np.ndarray, np.ndarray]:
    """Union bbox, padded so no axis is degenerate."""
    lo = np.minimum(verts_a.min(0), verts_b.min(0)).astype(np.float64)
    hi = np.maximum(verts_a.max(0), verts_b.max(0)).astype(np.float64)
    span = hi - lo
    span[span == 0] = 1e-6 * max(float(span.max()), 1e-9)
    hi = lo + span
    return lo, hi


def _axis_bins(values: np.ndarray, origin: float, dx: float, n: int) -> np.ndarray:
    """Bin indices of axis coords, clamped to [0, n - 1]."""
    return np.clip(np.floor((values - origin) / dx).astype(np.int64), 0, n - 1)


def _column_hits(
    tris: np.ndarray, oy: float, oz: float, x0: float, extent: float
) -> np.ndarray:
    """Moller-Trumbore x-intersections of +x rays at (oy, oz); one t each."""
    t0 = tris[:, 0]
    edge1 = tris[:, 1] - t0
    edge2 = tris[:, 2] - t0
    # p = dir x edge2 for dir = (1, 0, 0).
    pvec = np.stack(
        [
            np.zeros(len(tris)),
            -edge2[:, 2],
            edge2[:, 1],
        ],
        axis=1,
    )
    det = (edge1 * pvec).sum(1)
    ok = np.abs(det) > MT_EPS
    tvec = np.stack(
        [
            np.full(len(tris), x0) - t0[:, 0],
            np.full(len(tris), oy) - t0[:, 1],
            np.full(len(tris), oz) - t0[:, 2],
        ],
        axis=1,
    )
    inv = np.zeros(len(tris))
    inv[ok] = 1.0 / det[ok]
    uvec = (tvec * pvec).sum(1) * inv
    qvec = np.cross(tvec, edge1)
    vvec = qvec[:, 0] * inv
    tvec_t = (edge2 * qvec).sum(1) * inv
    hit = (
        ok
        & (uvec >= 0.0)
        & (uvec <= 1.0)
        & (vvec >= 0.0)
        & (uvec + vvec <= 1.0)
        & (tvec_t > 0.0)
        & (tvec_t <= extent)
    )
    return tvec_t[hit]


def ray_parity_occupancy(
    verts: np.ndarray, faces: np.ndarray, lo: np.ndarray, hi: np.ndarray, n: int
) -> np.ndarray:
    """Inside/outside occupancy via +x ray parity (see module docstring)."""
    cell = (hi - lo) / n
    tris = verts[faces]
    yzb = tris[:, :, 1:]
    mn = yzb.min(1)
    mx = yzb.max(1)
    iy0 = _axis_bins(mn[:, 0], lo[1], cell[1], n)
    iy1 = _axis_bins(mx[:, 0], lo[1], cell[1], n)
    iz0 = _axis_bins(mn[:, 1], lo[2], cell[2], n)
    iz1 = _axis_bins(mx[:, 1], lo[2], cell[2], n)
    small = ((iy1 - iy0) <= 2) & ((iz1 - iz0) <= 2)
    large_idx = np.nonzero(~small)[0]
    del mn, mx

    # Every small triangle is filed under each y-z cell it covers (at most
    # 3 x 3 cells for span<=2 over 9 fixed offset passes), so a column
    # reads exactly its own bin. Centroid-only filing would miss skewed
    # span-2 triangles whose centroid sits outside a covered column's
    # neighbourhood.
    x0 = lo[0] - cell[0]
    extent = (hi[0] - lo[0]) + cell[0]
    bin_tri = []
    bin_id = []
    for dy in range(3):
        for dz in range(3):
            hit = small & ((iy0 + dy) <= iy1) & ((iz0 + dz) <= iz1)
            idx = np.nonzero(hit)[0]
            bin_tri.append(idx)
            bin_id.append((iy0[idx] + dy) * n + (iz0[idx] + dz))
    tri_all = np.concatenate(bin_tri)
    id_all = np.concatenate(bin_id)
    ordered = tri_all[np.argsort(id_all, kind="stable")]
    counts = np.bincount(id_all, minlength=n * n)
    starts = np.zeros(n * n + 1, dtype=np.int64)
    np.cumsum(counts, out=starts[1:])
    del bin_tri, bin_id, tri_all, id_all, counts

    large_ts: dict[tuple[int, int], list] = {}
    for k in large_idx:
        for jy in range(int(iy0[k]), int(iy1[k]) + 1):
            for jz in range(int(iz0[k]), int(iz1[k]) + 1):
                oy = lo[1] + (jy + RAY_OY) * cell[1]
                oz = lo[2] + (jz + RAY_OZ) * cell[2]
                hits = _column_hits(tris[k : k + 1], oy, oz, x0, extent)
                if len(hits):
                    large_ts.setdefault((jy, jz), []).append(hits)
    del iy0, iy1, iz0, iz1

    occ = np.zeros((n, n, n), dtype=bool)
    # ts are distances from the ray origin x0: compare against the cell
    # centers expressed in the same t-space (x-space centers minus x0).
    centers = lo[0] + (np.arange(n) + 0.5) * cell[0] - x0
    for jy in range(n):
        oy = lo[1] + (jy + RAY_OY) * cell[1]
        for jz in range(n):
            oz = lo[2] + (jz + RAY_OZ) * cell[2]
            b = jy * n + jz
            nb = ordered[starts[b] : starts[b + 1]]
            if len(nb):
                parts = [_column_hits(tris[nb], oy, oz, x0, extent)]
            else:
                parts = []
            if (jy, jz) in large_ts:
                parts.extend(large_ts[(jy, jz)])
            if not parts:
                continue
            ts = np.sort(np.concatenate(parts))
            occ[:, jy, jz] = (np.searchsorted(ts, centers) % 2) == 1
    return occ


def _subdivide_to_grid(tris: np.ndarray, tol: float) -> np.ndarray:
    """Midpoint-subdivide triangles until every edge is <= tol.

    Vectorized per round; only triangles still above tol are split, so
    dense meshes (edges already << tol) pass through nearly untouched.
    Stops after 12 rounds or past a memory cap, returning what it has.
    """
    cur = tris
    for _ in range(12):
        e01 = cur[:, 1] - cur[:, 0]
        e12 = cur[:, 2] - cur[:, 1]
        e20 = cur[:, 0] - cur[:, 2]
        edges = np.stack([e01, e12, e20], axis=1)
        longest = np.sqrt((edges * edges).sum(-1)).max(-1)
        del edges, e01, e12, e20
        need = longest > tol
        if not bool(need.any()):
            break
        if len(cur) > 12_000_000:
            break
        keep = cur[~need]
        split = cur[need]
        v0, v1, v2 = split[:, 0], split[:, 1], split[:, 2]
        m01 = (v0 + v1) * 0.5
        m12 = (v1 + v2) * 0.5
        m20 = (v2 + v0) * 0.5
        kids = np.stack(
            [
                np.stack([v0, m01, m20], axis=1),
                np.stack([v1, m12, m01], axis=1),
                np.stack([v2, m20, m12], axis=1),
                np.stack([m01, m12, m20], axis=1),
            ],
            axis=1,
        ).reshape(-1, 3, 3)
        cur = np.concatenate([keep, kids], axis=0) if len(keep) else kids
        del split, keep, kids
    return cur


def surface_fill_occupancy(
    verts: np.ndarray, faces: np.ndarray, lo: np.ndarray, hi: np.ndarray, n: int
) -> np.ndarray:
    """Fallback occupancy: dense surface raster + exterior flood fill.

    Triangles are midpoint-subdivided to half-cell edges so sub-triangle
    centroids tile the surface densely at grid resolution; those centroids
    (plus the vertices) are splatted, dilated by one voxel to seal
    sub-cell cracks, and the exterior is flood-filled from the grid border
    (scipy.ndimage). Occupancy is everything the exterior cannot reach.
    Pinholes up to ~1 cell are sealed by the dilation; larger openings
    leak, so the IoU then measures the sealed shell — and the output flags
    the mesh non-watertight.
    """
    from scipy.ndimage import binary_dilation, binary_propagation

    cell = (hi - lo) / n
    tris = _subdivide_to_grid(verts[faces], 0.5 * float(cell.min()))
    surf = np.zeros((n, n, n), dtype=bool)
    cidx = _axis_bins(tris.mean(1), lo, cell, n)
    surf[cidx[:, 0], cidx[:, 1], cidx[:, 2]] = True
    del tris, cidx
    vidx = _axis_bins(verts, lo, cell, n)
    surf[vidx[:, 0], vidx[:, 1], vidx[:, 2]] = True
    del vidx
    grown = binary_dilation(surf, structure=np.ones((3, 3, 3)))
    del surf
    seed = np.zeros((n, n, n), dtype=bool)
    seed[0, :, :] = seed[-1, :, :] = True
    seed[:, 0, :] = seed[:, -1, :] = True
    seed[:, :, 0] = seed[:, :, -1] = True
    seed &= ~grown
    outside = binary_propagation(seed, mask=~grown)
    return ~outside


def volume_iou(
    cand_mesh: trimesh.Trimesh, ref_mesh: trimesh.Trimesh, grid: int
) -> dict:
    """Volume IoU on a grid^3 occupancy over the union bbox."""
    cand_verts = np.asarray(cand_mesh.vertices, dtype=np.float64)
    cand_faces = np.asarray(cand_mesh.faces, dtype=np.int64)
    ref_verts = np.asarray(ref_mesh.vertices, dtype=np.float64)
    ref_faces = np.asarray(ref_mesh.faces, dtype=np.int64)
    lo, hi = union_bbox(cand_verts, ref_verts)
    watertight = {
        "candidate": bool(cand_mesh.is_watertight),
        "ref": bool(ref_mesh.is_watertight),
    }
    if all(watertight.values()):
        method = "ray_parity"
        filler = ray_parity_occupancy
    else:
        method = "surface_fill"
        filler = surface_fill_occupancy
    occ_c = filler(cand_verts, cand_faces, lo, hi, grid)
    gc.collect()
    occ_r = filler(ref_verts, ref_faces, lo, hi, grid)
    inter = int((occ_c & occ_r).sum())
    union = int((occ_c | occ_r).sum())
    iou = inter / union if union > 0 else 1.0
    return {
        "iou": float(iou),
        "method": method,
        "watertight": watertight,
        "grid": grid,
        "intersection_voxels": inter,
        "union_voxels": union,
    }


def compare_meshes(
    candidate: str,
    ref: str,
    samples: int = 20000,
    tau_frac: float = 0.01,
    seed: int = 0,
    seed_ref: int | None = None,
    grid: int = 64,
) -> dict:
    """Full mesh comparison; one id at a time (caller frees between ids)."""
    cand_mesh = load_mesh(candidate)
    ref_mesh = load_mesh(ref)
    ref_seed = seed if seed_ref is None else seed_ref
    cand_pts = sample_points(cand_mesh, samples, seed)
    ref_pts = sample_points(ref_mesh, samples, ref_seed)
    out = chamfer_fscore(cand_pts, ref_pts, tau_frac)
    out["tau_frac"] = tau_frac
    out["samples"] = samples
    out["seed"] = seed
    out["seed_ref"] = ref_seed
    out["volume"] = volume_iou(cand_mesh, ref_mesh, grid)
    out["verts_faces"] = {
        "candidate": [len(cand_mesh.vertices), len(cand_mesh.faces)],
        "ref": [len(ref_mesh.vertices), len(ref_mesh.faces)],
    }
    return out


def render_views(
    cand_pts: np.ndarray, ref_pts: np.ndarray, out_path: str, title: str
) -> None:
    """3 orthographic scatter views (ref gray, candidate red)."""
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    views = [
        (0, 1, "front (XY)"),
        (0, 2, "top (XZ)"),
        (1, 2, "side (YZ)"),
    ]
    fig, axes = plt.subplots(1, 3, figsize=(12, 4))
    for ax, (a, b, name) in zip(axes, views):
        ax.scatter(
            ref_pts[:, a],
            ref_pts[:, b],
            s=1,
            c="0.7",
            label="ref",
            rasterized=True,
        )
        ax.scatter(
            cand_pts[:, a],
            cand_pts[:, b],
            s=1,
            c="tab:red",
            label="candidate",
            rasterized=True,
        )
        ax.set_title(name)
        ax.set_aspect("equal")
        ax.tick_params(labelsize=7)
    axes[0].legend(markerscale=5, fontsize=8)
    fig.suptitle(title, fontsize=9)
    fig.tight_layout()
    fig.savefig(out_path, dpi=100)
    plt.close(fig)


def main() -> None:
    """Compare two meshes and print the summary line."""
    parser = argparse.ArgumentParser()
    parser.add_argument("candidate")
    parser.add_argument("ref")
    parser.add_argument("--samples", type=int, default=20000)
    parser.add_argument("--tau", type=float, default=0.01)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--seed-ref", type=int, default=None)
    parser.add_argument("--grid", type=int, default=64)
    parser.add_argument("--json", default=None)
    parser.add_argument("--render", default=None)
    args = parser.parse_args()

    out = compare_meshes(
        args.candidate,
        args.ref,
        args.samples,
        args.tau,
        args.seed,
        args.seed_ref,
        args.grid,
    )
    vol = out["volume"]
    print(
        f"chamfer={out['chamfer']:.4f} "
        f"chamfer/diag={out['chamfer_over_diag']:.4e} "
        f"F@{args.tau * 100:.0f}%={out['f_score']:.3f} "
        f"IoU={vol['iou']:.4f}({vol['method']}) "
        f"watertight=cand:{vol['watertight']['candidate']} "
        f"ref:{vol['watertight']['ref']}"
    )
    if args.json:
        with open(args.json, "w") as handle:
            report = {**out, "candidate": args.candidate, "ref": args.ref}
            json.dump(report, handle, indent=2)
    if args.render:
        try:
            cand_mesh = load_mesh(args.candidate)
            ref_mesh = load_mesh(args.ref)
        except ValueError as error:
            print(f"render skipped: {error}")
            return
        ref_seed = args.seed if args.seed_ref is None else args.seed_ref
        cand_pts = sample_points(cand_mesh, args.samples, args.seed)
        ref_pts = sample_points(ref_mesh, args.samples, ref_seed)
        title = f"{args.candidate} vs {args.ref}"
        render_views(cand_pts, ref_pts, args.render, title)
        print(f"rendered {args.render}")


if __name__ == "__main__":
    main()
