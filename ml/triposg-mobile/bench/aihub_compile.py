"""Bundle batch-1 units, compile on Qualcomm AI Hub, profile, write manifest.

Offline compilation for the S25 NPU: on-device QNN compile
(QnnGraph_finalize) dies at 8.5-9.4 GB even for one block, so every unit
is compiled on AI Hub with --target_runtime precompiled_qnn_onnx and run
on the phone as an EPContext model + model.bin.

One command does all phases; reruns resume from the manifest:
  1. bundle: copy each unit's FP32 .onnx + .onnx.data into
     <out>/<stem>/<srcbase>.onnx/ (the directory layout AI Hub uploads).
  2. submit all pending compile jobs at once, then wait for each.
  3. download each compiled target model (zip), unzip, normalise to
     <out>/<stem>/device/{model.onnx,model.bin} so every unit has stable
     on-device names (the EPContext node references ./model.bin).
  4. submit all pending profile jobs at once, then download each profile.
  5. write manifest_b1.json + chain_remote.txt ("<remote path> <stem>"
     per line in chain order, for spike_chain + spike_adb_chain_npu.sh).

Usage (triposg-spike env; needs the QAI_HUB API token configured):
  python -u bench/aihub_compile.py [--stems head,blk00,blk01] [...]
  python -u bench/aihub_compile.py --stems vae_post,vae_query

VAE stems (export_vae.py outputs in logs/spike/vae/) compile/profile the
same way without touching the 23 transformer units; chain_remote.txt keeps
the transformer chain only.

Per-unit manifest record: source paths, compile/profile job ids, QAIRT
version, bin size + sha256, estimated inference/warm/first-load times and
memory ranges, NPU/CPU layer counts from the profile's execution_detail.
"""

import argparse
import gc
import hashlib
import json
import shutil
import sys
import zipfile
from pathlib import Path

N_LAYERS = 21
B1_STEMS = ["head"] + [f"blk{i:02d}" for i in range(N_LAYERS)] + ["tail"]
VAE_STEMS = ["vae_post", "vae_query"]
ALL_STEMS = B1_STEMS + VAE_STEMS
VAE_ONNX_DIR = Path("ml/triposg-mobile/logs/spike/vae")


def log(msg):
    """Print immediately (= python -u)."""
    print(msg, flush=True)


def sha256_of(path):
    """Hex sha256 of a file, streamed."""
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_manifest(path):
    """Load the manifest, or an empty units dict."""
    if path.is_file():
        with open(path) as f:
            data = json.load(f)
        assert isinstance(data.get("units"), dict), path
        return data
    return {"units": {}}


def save_manifest(path, meta, units):
    """Write the manifest atomically."""
    tmp = path.with_suffix(".tmp")
    with open(tmp, "w") as f:
        json.dump({"meta": meta, "units": units}, f, indent=2)
    tmp.replace(path)


def onnx_io(path):
    """(inputs, outputs) as [{name, shape, dtype}] for an ONNX file."""
    import onnx

    model = onnx.load(str(path))
    graph = model.graph

    def describe(value):
        tensor = value.type.tensor_type
        dims = [d.dim_value for d in tensor.shape.dim]
        dtype = onnx.TensorProto.DataType.Name(tensor.elem_type)
        return {"name": value.name, "shape": dims, "dtype": dtype}

    ins = [describe(i) for i in graph.input]
    outs = [describe(o) for o in graph.output]
    ep_nodes = sum(1 for n in graph.node if n.op_type == "EPContext")
    del model
    gc.collect()
    return ins, outs, ep_nodes


def bundle_unit(stem, b1_dir, unit_dir):
    """Copy the unit's .onnx + .data into the AI Hub upload directory."""
    if stem in VAE_STEMS:
        src_dir, src_base = VAE_ONNX_DIR, f"{stem}_fp32"
        hint = "run export_vae.py --unit post/query first"
    else:
        src_dir, src_base = b1_dir, f"dit_{stem}_fp32"
        hint = "run split_export_step.py --all-b1"
    src_onnx = src_dir / f"{src_base}.onnx"
    src_data = src_dir / f"{src_base}.onnx.data"
    for path in (src_onnx, src_data):
        if not path.is_file():
            log(f"STOP: missing {path} — {hint}")
            sys.exit(1)
    bundle = unit_dir / f"{src_base}.onnx"
    bundle.mkdir(parents=True, exist_ok=True)
    for src in (src_onnx, src_data):
        dst = bundle / src.name
        if not dst.is_file() or dst.stat().st_size != src.stat().st_size:
            shutil.copy2(src, dst)
            log(f"bundled {dst} ({dst.stat().st_size} bytes)")
    return bundle, src_onnx


def submit_compiles(client, device, options, units, pending):
    """Submit one compile job per pending stem; record job ids."""
    import qai_hub as hub  # noqa: F401 (keeps hub.Device attribute style)

    jobs = {}
    for stem in pending:
        bundle = Path(units[stem]["bundle_dir"])
        job = client.submit_compile_job(
            str(bundle), device=device, name=f"triposg-b1-{stem}-fp32", options=options
        )
        units[stem]["compile_job_id"] = job.job_id
        units[stem]["compile_status"] = "SUBMITTED"
        log(f"{stem}: compile job {job.job_id} {job.url}")
        jobs[stem] = job
    return jobs


def fetch_compiled(job, unit_dir):
    """Wait for one compile job; unzip + normalise its target model."""
    status = job.wait()
    if not status.success:
        return (f"{status.code}: {status.message}", None)
    zip_path = unit_dir / f"{job.job_id}_qnn.onnx.zip"
    got = job.download_target_model(str(zip_path))
    if got is None:
        return ("download_target_model returned None", None)
    got = Path(got)
    raw_dir = unit_dir / "raw"
    if raw_dir.exists():
        shutil.rmtree(raw_dir)
    raw_dir.mkdir(parents=True, exist_ok=True)
    if got.is_dir():
        for item in got.iterdir():
            dest = raw_dir / item.name
            if item.is_dir():
                shutil.copytree(item, dest)
            else:
                shutil.copy2(item, dest)
    elif zipfile.is_zipfile(got):
        with zipfile.ZipFile(got) as zf:
            zf.extractall(raw_dir)
    else:
        return (f"unexpected download layout: {got}", None)
    onnx_files = sorted(raw_dir.rglob("*.onnx"))
    bin_files = sorted(raw_dir.rglob("*.bin"))
    if len(onnx_files) != 1 or len(bin_files) != 1:
        return (
            f"want 1 .onnx + 1 .bin, got "
            f"{[str(p) for p in onnx_files]} + "
            f"{[str(p) for p in bin_files]}",
            None,
        )
    device_dir = unit_dir / "device"
    device_dir.mkdir(parents=True, exist_ok=True)
    model_onnx = device_dir / "model.onnx"
    model_bin = device_dir / "model.bin"
    shutil.copy2(onnx_files[0], model_onnx)
    shutil.copy2(bin_files[0], model_bin)
    info = {
        "compiled_onnx": str(model_onnx),
        "model_bin": str(model_bin),
        "bin_bytes": model_bin.stat().st_size,
        "bin_sha256": sha256_of(model_bin),
    }
    ins, outs, ep_nodes = onnx_io(model_onnx)
    info["compiled_inputs"] = ins
    info["compiled_outputs"] = outs
    info["ep_nodes"] = ep_nodes
    return (None, info)


def profile_counts(detail):
    """(npu, cpu) layer counts from a profile's execution_detail."""
    npu = sum(1 for e in detail if e.get("compute_unit") == "NPU")
    cpu = sum(1 for e in detail if e.get("compute_unit") == "CPU")
    return npu, cpu


def fetch_profile(infer_job, unit_dir):
    """Wait for one profile job; save profile.json and summarise it."""
    status = infer_job.wait()
    if not status.success:
        return (f"{status.code}: {status.message}", None)
    profile_path = unit_dir / "profile.json"
    infer_job.download_profile(str(profile_path))
    with open(profile_path) as f:
        profile = json.load(f)
    summary = profile.get("execution_summary", {})
    npu, cpu = profile_counts(profile.get("execution_detail", []))
    return (
        None,
        {
            "profile_job_id": infer_job.job_id,
            "profile_json": str(profile_path),
            "estimated_inference_time_us": summary.get("estimated_inference_time"),
            "warm_load_time_us": summary.get("warm_load_time"),
            "first_load_time_us": summary.get("first_load_time"),
            "inference_memory_increase_range": summary.get(
                "inference_memory_increase_range"
            ),
            "inference_memory_peak_range": summary.get("inference_memory_peak_range"),
            "first_load_memory_increase_range": summary.get(
                "first_load_memory_increase_range"
            ),
            "first_load_memory_peak_range": summary.get("first_load_memory_peak_range"),
            "warm_load_memory_increase_range": summary.get(
                "warm_load_memory_increase_range"
            ),
            "warm_load_memory_peak_range": summary.get("warm_load_memory_peak_range"),
            "npu_layers": npu,
            "cpu_layers": cpu,
        },
    )


def main():
    """Bundle, compile, profile and manifest the batch-1 units."""
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--stems", default="", help="comma-separated subset (default: all 23 units)"
    )
    parser.add_argument("--b1-dir", default="ml/triposg-mobile/logs/spike/b1")
    parser.add_argument("--out-dir", default="ml/triposg-mobile/logs/spike/aihub")
    parser.add_argument(
        "--manifest", default="", help="default <out-dir>/manifest_b1.json"
    )
    parser.add_argument("--device", default="Samsung Galaxy S25 (Family)")
    parser.add_argument("--target-runtime", default="precompiled_qnn_onnx")
    parser.add_argument("--qairt-version", default="2.50")
    parser.add_argument("--remote-dir", default="/data/local/tmp/triposg-chain")
    args = parser.parse_args()

    import qai_hub as hub

    stems = B1_STEMS
    if args.stems:
        stems = [s.strip() for s in args.stems.split(",") if s.strip()]
        unknown = [s for s in stems if s not in ALL_STEMS]
        if unknown:
            log(f"STOP: unknown stems {unknown} (want subset of {ALL_STEMS})")
            sys.exit(1)
    b1_dir = Path(args.b1_dir)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = (
        Path(args.manifest) if args.manifest else out_dir / "manifest_b1.json"
    )

    meta = {
        "device": args.device,
        "target_runtime": args.target_runtime,
        "qairt_version": args.qairt_version,
        "compile_options": (
            f"--target_runtime {args.target_runtime} "
            f"--qairt_version {args.qairt_version}"
        ),
    }
    manifest = load_manifest(manifest_path)
    units = manifest["units"]
    for stem in stems:
        entry = units.get(stem, {})
        entry["stem"] = stem
        units[stem] = entry

    client = hub.Client()
    device = hub.Device(args.device)
    log(f"device={args.device} options='{meta['compile_options']}'")

    # Phase 1: bundle every stem (cheap, always re-checked).
    for stem in stems:
        unit_dir = out_dir / stem
        bundle, src_onnx = bundle_unit(stem, b1_dir, unit_dir)
        entry = units[stem]
        entry["source_onnx"] = str(src_onnx)
        entry["source_data_bytes"] = Path(str(src_onnx) + ".data").stat().st_size
        entry["bundle_dir"] = str(bundle)
        entry.setdefault("compile_status", "PENDING")
    save_manifest(manifest_path, meta, units)

    # Phase 2: submit all pending compiles at once, then wait.
    pending = [s for s in stems if units[s].get("compile_status") != "SUCCESS"]
    jobs = {}
    if pending:
        log(f"submitting {len(pending)} compile jobs: {pending}")
        jobs = submit_compiles(client, device, meta["compile_options"], units, pending)
        save_manifest(manifest_path, meta, units)
    else:
        for stem in stems:
            jobs[stem] = client.get_job(units[stem]["compile_job_id"])
    for stem in stems:
        entry = units[stem]
        if entry.get("compile_status") == "SUCCESS":
            continue
        error, info = fetch_compiled(jobs[stem], out_dir / stem)
        if error is not None:
            entry["compile_status"] = "FAILED"
            entry["compile_error"] = error
            log(f"{stem}: compile FAILED: {error}")
        else:
            entry.pop("compile_error", None)
            entry.update(info)
            entry["compile_status"] = "SUCCESS"
            entry["qairt_version"] = args.qairt_version
            entry["device"] = args.device
            log(
                f"{stem}: compiled bin={info['bin_bytes']} bytes "
                f"sha256={info['bin_sha256'][:16]}... "
                f"ep_nodes={info['ep_nodes']}"
            )
        save_manifest(manifest_path, meta, units)

    # Phase 3: submit all pending profiles at once, then wait.
    need_profile = [
        s
        for s in stems
        if units[s].get("compile_status") == "SUCCESS"
        and units[s].get("profile_job_id") is None
    ]
    infer_jobs = {}
    for stem in need_profile:
        job = (
            jobs[stem]
            if stem in jobs
            else client.get_job(units[stem]["compile_job_id"])
        )
        target = job.get_target_model()
        if target is None:
            units[stem]["profile_error"] = "no target model on compile job"
            log(f"{stem}: profile SKIPPED (no target model)")
            continue
        infer = client.submit_inference_job(
            target, device=device, name=f"triposg-b1-{stem}-profile", profile=True
        )
        units[stem]["profile_job_id"] = infer.job_id
        log(f"{stem}: profile job {infer.job_id} {infer.url}")
        infer_jobs[stem] = infer
    save_manifest(manifest_path, meta, units)
    for stem, infer in infer_jobs.items():
        error, info = fetch_profile(infer, out_dir / stem)
        if error is not None:
            units[stem]["profile_error"] = error
            log(f"{stem}: profile FAILED: {error}")
        else:
            units[stem].pop("profile_error", None)
            units[stem].update(info)
            log(
                f"{stem}: infer={info['estimated_inference_time_us']}us "
                f"npu={info['npu_layers']} cpu={info['cpu_layers']}"
            )
        save_manifest(manifest_path, meta, units)

    # Phase 4: remote model list for spike_chain + the adb script. Each
    # line is "<remote model path> <stem>": every on-device model file is
    # named model.onnx (its unit dir holds model.bin), so the stem column
    # tells spike_chain which original input/output names to wire.
    chain_lines = []
    for stem in B1_STEMS:
        entry = units.get(stem, {})
        if entry.get("compile_status") == "SUCCESS":
            chain_lines.append(f"{args.remote_dir}/{stem}/model.onnx {stem}")
    chain_path = out_dir / "chain_remote.txt"
    with open(chain_path, "w") as f:
        f.write("\n".join(chain_lines) + "\n")
    log(f"wrote {chain_path} ({len(chain_lines)} models)")

    failed = [s for s in stems if units.get(s, {}).get("compile_status") != "SUCCESS"]
    save_manifest(manifest_path, meta, units)
    if failed:
        log(f"STOP: {len(failed)} units without a successful compile: " f"{failed}")
        return 1
    unprofiled = [s for s in stems if units[s].get("profile_job_id") is None]
    if unprofiled:
        log(f"STOP: {len(unprofiled)} units without a profile: {unprofiled}")
        return 1
    log(f"manifest {manifest_path}: {len(stems)} units compiled + profiled")
    return 0


if __name__ == "__main__":
    sys.exit(main())
