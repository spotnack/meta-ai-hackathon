"""Phase 1 parity driver: verify goldens, run mesh baselines, report.

Golden mode (default): for each id in eval/manifest_5.json, sha256-verify
every file listed in reference/goldens_5/report.json, run the two mesh
calibration baselines, gate them against parity/thresholds.json, and write
the report.

- Baseline (a): mesh.display.glb vs mesh.glb (decimation noise).
- Baseline (b): mesh.glb sampled with two seeds (sampling noise). Volume
  IoU of a mesh with itself is definitionally 1.0 (the occupancy is
  deterministic), so it is recorded, not recomputed.

Candidate mode (--candidate-dir DIR): DIR holds the same per-id layout
with any subset of files. Each file present is compared against its
golden: mapped tensors (DINOv2 hidden state, step-0 noise_pred, final
latents) via tensor_parity gates, step inputs / pixel values / PNGs by
bitwise identity, mesh*.glb via mesh_parity against the golden mesh.glb.

Usage (triposg-spike env; run from anywhere, e.g. the repo root):
  ~/anaconda3/envs/triposg-spike/bin/python -u \\
      ml/triposg-mobile/parity/run_phase1.py
  ~/anaconda3/envs/triposg-spike/bin/python -u \\
      ml/triposg-mobile/parity/run_phase1.py --candidate-dir <dir>

Writes <out-dir>/phase1_report.json + phase1_report.md (default out-dir
is ml/triposg-mobile/logs/phase1). Exit 0 = all gates pass, 1 = any fail.
Sequential, one id at a time, well under the 4 GB RSS cap (memwatch is
logged per id). Needs numpy + scipy + trimesh.
"""

import argparse
import gc
import hashlib
import json
import sys
from pathlib import Path

import numpy as np

PARITY_DIR = Path(__file__).resolve().parent
ROOT = PARITY_DIR.parent
sys.path.insert(0, str(PARITY_DIR))
from tensor_parity import compare_all  # noqa: E402
from tensor_parity import gate as tensor_gate  # noqa: E402
from mesh_parity import chamfer_fscore  # noqa: E402
from mesh_parity import compare_meshes  # noqa: E402
from mesh_parity import load_mesh  # noqa: E402
from mesh_parity import sample_points  # noqa: E402

try:
    sys.path.insert(0, str(ROOT / "bench"))
    from memwatch import mem_str  # noqa: E402
except ImportError:

    def mem_str() -> str:
        return "memwatch unavailable"


# Golden tensors with a gate entry in thresholds.json.
TENSOR_COMPONENTS = {
    "dinov2_last_hidden_state.npy": "dinov2_last_hidden_state",
    "step0_noise_pred.npy": "step0_noise_pred",
    "final_latents.npy": "final_latents",
}
# Step inputs (pixel values, step-0 latents/timestep/encoder states) have no
# gate entry: candidates must reproduce them bitwise (identity check).
DISPLAY_MESH = "mesh.display.glb"
GOLDEN_MESH = "mesh.glb"


def log(msg: str) -> None:
    """Print immediately (= python -u)."""
    print(msg, flush=True)


def sha256_file(path: Path) -> str:
    """Hex sha256 of one file, streamed."""
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def mesh_gate(result: dict, bounds: dict) -> dict:
    """Apply the thresholds.json mesh gate to a compare_meshes result."""
    reasons = []
    cod = result["chamfer_over_diag"]
    if cod > bounds["chamfer_over_diag_max"]:
        reasons.append(
            f"chamfer/diag={cod:.3e} above {bounds['chamfer_over_diag_max']}"
        )
    fscore = result["f_score"]
    if fscore < bounds["f_score_min"]:
        reasons.append(f"F={fscore:.3f} below {bounds['f_score_min']}")
    iou = result["volume"]["iou"]
    if iou < bounds["volume_iou_min"]:
        reasons.append(f"IoU={iou:.4f} below {bounds['volume_iou_min']}")
    return {"pass": not reasons, "reasons": reasons}


def verify_golden(golden_dir: Path, item: dict) -> dict:
    """Check presence + sha256 of every file in the report's hash map."""
    checked = {}
    for name, expected in item["sha256"].items():
        path = golden_dir / name
        if not path.is_file():
            checked[name] = {
                "ok": False,
                "missing": True,
                "expected": expected,
                "actual": None,
            }
            continue
        actual = sha256_file(path)
        checked[name] = {
            "ok": actual == expected,
            "missing": False,
            "expected": expected,
            "actual": actual,
        }
    return checked


def golden_shapes(golden_dir: Path, names: list) -> dict:
    """Record shape/dtype of each golden .npy (load errors recorded)."""
    shapes = {}
    for name in names:
        if not name.endswith(".npy"):
            continue
        try:
            array = np.load(golden_dir / name)
            shapes[name] = {
                "shape": list(array.shape),
                "dtype": str(array.dtype),
            }
            del array
        except (OSError, ValueError) as error:
            shapes[name] = {"error": f"{type(error).__name__}: {error}"}
    gc.collect()
    return shapes


def baseline_decimation(display: Path, mesh: Path, params: dict, bounds: dict) -> dict:
    """Baseline (a): display mesh vs full golden mesh, gated."""
    if not display.is_file():
        return {
            "missing": True,
            "gate": {"pass": False, "reasons": [f"{DISPLAY_MESH} absent"]},
        }
    result = compare_meshes(
        str(display),
        str(mesh),
        params["samples"],
        params["tau"],
        seed=0,
        grid=params["grid"],
    )
    result["gate"] = mesh_gate(result, bounds)
    gc.collect()
    return result


def baseline_sampling(mesh_path: Path, params: dict, bounds: dict) -> dict:
    """Baseline (b): same mesh, two sampling seeds, gated on Chamfer/F."""
    mesh = load_mesh(str(mesh_path))
    pts0 = sample_points(mesh, params["samples"], 0)
    pts1 = sample_points(mesh, params["samples"], 1)
    out = chamfer_fscore(pts0, pts1, params["tau"])
    out["tau_frac"] = params["tau"]
    out["samples"] = params["samples"]
    out["seed"] = 0
    out["seed_ref"] = 1
    watertight = bool(mesh.is_watertight)
    out["volume"] = {
        "iou": 1.0,
        "method": "identical (not recomputed)",
        "watertight": {"candidate": watertight, "ref": watertight},
        "grid": params["grid"],
        "intersection_voxels": None,
        "union_voxels": None,
    }
    out["verts_faces"] = {
        "candidate": [len(mesh.vertices), len(mesh.faces)],
        "ref": [len(mesh.vertices), len(mesh.faces)],
    }
    out["gate"] = mesh_gate(out, bounds)
    del mesh, pts0, pts1
    gc.collect()
    return out


def candidate_file(
    name: str,
    cand: Path,
    golden_dir: Path,
    thresholds: dict,
    params: dict,
    bounds: dict,
) -> dict:
    """Compare one candidate file against its golden; never raises."""
    ref = golden_dir / name
    if not ref.is_file():
        return {
            "check": "no-golden",
            "pass": False,
            "detail": f"golden {name} absent",
        }
    if name.endswith(".png"):
        same = sha256_file(cand) == sha256_file(ref)
        return {
            "check": "sha256-identical",
            "pass": same,
            "detail": "identical" if same else "DIFFERS",
        }
    if name.endswith(".npy"):
        if name in TENSOR_COMPONENTS:
            component = TENSOR_COMPONENTS[name]
            try:
                result = compare_all(np.load(cand), np.load(ref))
            except (OSError, ValueError) as error:
                return {
                    "check": f"tensor:{component}",
                    "pass": False,
                    "detail": f"{type(error).__name__}: {error}",
                }
            verdict = tensor_gate(component, result, thresholds)
            whole = result["whole"]
            detail = f"rel_l2={whole['rel_l2']:.3e} " f"cosine={whole['cosine']:.7f}"
            if not verdict["pass"]:
                detail += " (" + "; ".join(verdict["reasons"]) + ")"
            # Report-only components (e.g. final_latents) are evaluated
            # and shown but never gate: the mesh is the end-to-end gate.
            advisory = thresholds.get(component, {}).get("report_only", False)
            return {
                "check": f"tensor:{component}",
                "pass": verdict["pass"],
                "report_only": advisory,
                "detail": detail,
                "result": result,
            }
        got, want = sha256_file(cand), sha256_file(ref)
        same = got == want
        detail = "identical"
        if not same:
            try:
                left = np.load(cand).astype(np.float64)
                right = np.load(ref).astype(np.float64)
                diff = float(np.abs(left - right).max())
                detail = f"DIFFERS max_abs={diff:.3e}"
            except (OSError, ValueError) as error:
                detail = f"DIFFERS ({type(error).__name__})"
        return {"check": "sha256-identical", "pass": same, "detail": detail}
    if name.endswith(".glb"):
        golden_mesh = golden_dir / GOLDEN_MESH
        if not golden_mesh.is_file():
            return {
                "check": "mesh",
                "pass": False,
                "detail": f"golden {GOLDEN_MESH} absent",
            }
        result = compare_meshes(
            str(cand),
            str(golden_mesh),
            params["samples"],
            params["tau"],
            seed=0,
            grid=params["grid"],
        )
        verdict = mesh_gate(result, bounds)
        vol = result["volume"]
        detail = (
            f"chamfer/diag={result['chamfer_over_diag']:.3e} "
            f"F={result['f_score']:.3f} IoU={vol['iou']:.4f}"
        )
        if not verdict["pass"]:
            detail += " (" + "; ".join(verdict["reasons"]) + ")"
        gc.collect()
        return {
            "check": "mesh",
            "pass": verdict["pass"],
            "detail": detail,
            "result": result,
        }
    return {
        "check": "skipped",
        "pass": True,
        "detail": "unknown suffix, not compared",
    }


def md_table(headers: list, rows: list) -> str:
    """Minimal Markdown table."""
    lines = ["| " + " | ".join(headers) + " |"]
    lines.append("| " + " | ".join("---" for _ in headers) + " |")
    lines.extend("| " + " | ".join(row) + " |" for row in rows)
    return "\n".join(lines)


def main() -> int:
    """Verify goldens, run baselines, optionally grade candidates."""
    parser = argparse.ArgumentParser()
    parser.add_argument("--goldens", default=str(ROOT / "reference/goldens_5"))
    parser.add_argument("--manifest", default=str(ROOT / "eval/manifest_5.json"))
    parser.add_argument("--thresholds", default=str(PARITY_DIR / "thresholds.json"))
    parser.add_argument("--out-dir", default=str(ROOT / "logs" / "phase1"))
    parser.add_argument("--candidate-dir", default=None)
    parser.add_argument("--samples", type=int, default=None)
    parser.add_argument("--tau", type=float, default=None)
    parser.add_argument("--grid", type=int, default=None)
    args = parser.parse_args()

    goldens = Path(args.goldens)
    with open(args.manifest) as handle:
        manifest = json.load(handle)
    with open(args.thresholds) as handle:
        thresholds = json.load(handle)["components"]
    with open(goldens / "report.json") as handle:
        report_doc = json.load(handle)
    bounds = thresholds["mesh"]
    params = {
        "samples": args.samples or bounds["samples"],
        "tau": args.tau or bounds["tau_frac"],
        "grid": args.grid or bounds["grid"],
    }

    manifest_ids = [img["id"] for img in manifest["images"]]
    report_ids = [item["id"] for item in report_doc["items"]]
    items = {item["id"]: item for item in report_doc["items"]}
    ids_match = manifest_ids == report_ids

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    full = {
        "params": params,
        "thresholds": thresholds,
        "manifest_ids": manifest_ids,
        "report_ids": report_ids,
        "ids_match": ids_match,
        "ids": {},
        "candidate_dir": args.candidate_dir,
        "candidates": {},
    }
    ok_all = ids_match
    if not ids_match:
        log(f"STOP: manifest ids {manifest_ids} != report ids {report_ids}")

    for image_id in manifest_ids:
        item = items.get(image_id)
        if item is None:
            log(f"{image_id}: MISSING from report.json")
            full["ids"][image_id] = {
                "missing_from_report": True,
                "pass": False,
            }
            ok_all = False
            continue
        golden_dir = goldens / image_id
        sha = verify_golden(golden_dir, item)
        sha_ok = sum(v["ok"] for v in sha.values())
        entry = {
            "sha256": sha,
            "sha_ok": [sha_ok, len(sha)],
            "shapes": golden_shapes(golden_dir, list(sha)),
            "display_present": (golden_dir / DISPLAY_MESH).is_file(),
            "display_hashed": DISPLAY_MESH in sha,
        }
        entry["baseline_decimation"] = baseline_decimation(
            golden_dir / DISPLAY_MESH,
            golden_dir / GOLDEN_MESH,
            params,
            bounds,
        )
        entry["baseline_sampling"] = baseline_sampling(
            golden_dir / GOLDEN_MESH, params, bounds
        )
        gates = [
            entry["baseline_decimation"].get("gate", {}).get("pass", False),
            entry["baseline_sampling"].get("gate", {}).get("pass", False),
        ]
        entry["pass"] = all(v["ok"] for v in sha.values()) and all(gates)
        ok_all = ok_all and entry["pass"]
        full["ids"][image_id] = entry
        log(
            f"{image_id}: sha {sha_ok}/{len(sha)} "
            f"{mem_str()} "
            f"decim_gate={gates[0]} sample_gate={gates[1]} "
            f"-> {'PASS' if entry['pass'] else 'FAIL'}"
        )
        gc.collect()

    if args.candidate_dir:
        cand_root = Path(args.candidate_dir)
        for image_id in manifest_ids:
            cand_dir = cand_root / image_id
            if not cand_dir.is_dir():
                continue
            golden_dir = goldens / image_id
            per_file = {}
            for path in sorted(cand_dir.iterdir()):
                if not path.is_file():
                    continue
                per_file[path.name] = candidate_file(
                    path.name,
                    path,
                    golden_dir,
                    thresholds,
                    params,
                    bounds,
                )
                verdict = per_file[path.name]
                shown = (
                    "report"
                    if verdict.get("report_only")
                    else ("PASS" if verdict["pass"] else "FAIL")
                )
                log(
                    f"cand {image_id}/{path.name}: "
                    f"{verdict['check']} {verdict['detail']} -> {shown}"
                )
                gc.collect()
            full["candidates"][image_id] = per_file
            gating = [v for v in per_file.values() if not v.get("report_only")]
            ok_all = ok_all and all(v["pass"] for v in gating)

    full["pass"] = bool(ok_all)
    with open(out_dir / "phase1_report.json", "w") as handle:
        json.dump(full, handle, indent=2)

    lines = ["# Phase 1 parity report", ""]
    lines.append(
        f"params: samples={params['samples']} tau={params['tau']} "
        f"grid={params['grid']}; ids_match={ids_match}"
    )
    lines.append(
        f"thresholds: chamfer/diag<={bounds['chamfer_over_diag_max']} "
        f"F>={bounds['f_score_min']} "
        f"IoU>={bounds['volume_iou_min']}"
    )
    lines.append(f"note: {DISPLAY_MESH} has no hash in report.json " "(presence only).")
    lines.append(
        "note: final_latents is report-only (diagnostic): shown as "
        "'report', excluded from OVERALL; the mesh is the acceptance gate."
    )
    lines.append("")
    rows = []
    for image_id in manifest_ids:
        entry = full["ids"][image_id]
        if entry.get("missing_from_report"):
            rows.append([image_id, "missing", "-", "-", "-", "-", "-", "FAIL"])
            continue
        dec = entry["baseline_decimation"]
        smp = entry["baseline_sampling"]
        if dec.get("missing"):
            dec_cells = ["missing", "-", "-", "FAIL"]
        else:
            dec_cells = [
                f"{dec['chamfer_over_diag']:.3e}",
                f"{dec['f_score']:.3f}",
                f"{dec['volume']['iou']:.4f}",
                "PASS" if dec["gate"]["pass"] else "FAIL",
            ]
        smp_cells = [
            f"{smp['chamfer_over_diag']:.3e}",
            f"{smp['f_score']:.3f}",
            "PASS" if smp["gate"]["pass"] else "FAIL",
        ]
        row = (
            [image_id, f"{entry['sha_ok'][0]}/{entry['sha_ok'][1]}"]
            + dec_cells
            + smp_cells
            + ["PASS" if entry["pass"] else "FAIL"]
        )
        rows.append(row)
    headers = [
        "id",
        "sha",
        "(a) chamfer/diag",
        "(a) F@1%",
        "(a) IoU",
        "(a) gate",
        "(b) chamfer/diag",
        "(b) F@1%",
        "(b) gate",
        "gate",
    ]
    lines.append(md_table(headers, rows))
    if full["candidates"]:
        lines += ["", "## Candidates", ""]
        rows = []
        for image_id, per_file in full["candidates"].items():
            for name, verdict in per_file.items():
                shown = (
                    "report"
                    if verdict.get("report_only")
                    else ("PASS" if verdict["pass"] else "FAIL")
                )
                rows.append(
                    [
                        image_id,
                        name,
                        verdict["check"],
                        verdict["detail"],
                        shown,
                    ]
                )
        cand_headers = ["id", "file", "check", "detail", "gate"]
        lines.append(md_table(cand_headers, rows))
    lines += ["", f"overall: {'PASS' if full['pass'] else 'FAIL'}", ""]
    with open(out_dir / "phase1_report.md", "w") as handle:
        handle.write("\n".join(lines))
    log(f"wrote {out_dir / 'phase1_report.json'} and phase1_report.md")
    log("OVERALL " + ("PASS" if full["pass"] else "FAIL"))
    return 0 if full["pass"] else 1


if __name__ == "__main__":
    sys.exit(main())
