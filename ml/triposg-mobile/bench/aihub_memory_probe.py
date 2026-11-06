"""Probe two ways to cut NPU (DMA-BUF) memory on 3 DiT blocks.

Each EPContext session on the phone pins its weights plus ~130-150 MB of
its own scratch / I/O buffers; 23 DiT units come to ~9 GB. This compiles
blk07-09 (re-using the source models of the existing b1 compile jobs, so
nothing is re-uploaded) two ways and downloads the results:

  fp16/<stem>/  precompiled_qnn_onnx with default_graph_htp_precision=FLOAT16
  link3/        qnn_dlc per block -> one linked context binary (3 graphs,
                shared context resources) -> precompiled_qnn_onnx wrapper

Usage: python bench/aihub_memory_probe.py [out_dir]
"""
import json
import sys
import zipfile
from pathlib import Path

import qai_hub as hub

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "logs/spike/aihub/manifest_b1.json"
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "logs/spike/memprobe"
DEVICE = "Samsung Galaxy S25 (Family)"
BASE = "--target_runtime precompiled_qnn_onnx --qairt_version 2.50"
STEMS = ["blk07", "blk08", "blk09"]


def log(msg):
    print(msg, flush=True)


def fetch(job, dest):
    status = job.wait()
    if not status.success:
        log(f"{job.job_id} FAILED {status.code}: {status.message}")
        return None
    dest.mkdir(parents=True, exist_ok=True)
    got = Path(job.download_target_model(str(dest / "target")))
    if zipfile.is_zipfile(got):
        with zipfile.ZipFile(got) as zf:
            zf.extractall(dest / "raw")
    sizes = {str(p.relative_to(dest)): p.stat().st_size
             for p in dest.rglob("*") if p.is_file()}
    log(f"{job.job_id} -> {dest}: {json.dumps(sizes)}")
    return sizes


def resume(client, link_id, fp16_ids):
    """Finish a probe whose link job already succeeded."""
    device = hub.Device(DEVICE)
    report = {}
    wrap = client.submit_compile_job(
        client.get_job(link_id).get_target_model(), device=device,
        name="memprobe-link3-onnx")
    log(f"wrap: {wrap.job_id}")
    report["link3"] = fetch(wrap, OUT / "link3")
    for s, jid in zip(STEMS, fp16_ids):
        report[f"fp16_{s}"] = fetch(client.get_job(jid), OUT / "fp16" / s)
    (OUT / "report.json").write_text(json.dumps(report, indent=2))
    log("done")


def main():
    client = hub.Client()
    if len(sys.argv) > 3 and sys.argv[2] == "--resume":
        resume(client, sys.argv[3], sys.argv[4].split(","))
        return
    device = hub.Device(DEVICE)
    units = json.loads(MANIFEST.read_text())["units"]
    src = {s: client.get_job(units[s]["compile_job_id"]).model for s in STEMS}
    report = {}

    fp16 = {s: client.submit_compile_job(
                src[s], device=device, name=f"memprobe-fp16-{s}",
                options=BASE + " --qnn_options default_graph_htp_precision=FLOAT16")
            for s in STEMS}
    dlc = {s: client.submit_compile_job(
               src[s], device=device, name=f"memprobe-dlc-{s}",
               options="--target_runtime qnn_dlc --qairt_version 2.50")
           for s in STEMS}
    for s, j in fp16.items():
        log(f"fp16 {s}: {j.job_id}")
    for s, j in dlc.items():
        log(f"dlc {s}: {j.job_id}")

    dlc_models = []
    for s in STEMS:
        st = dlc[s].wait()
        if not st.success:
            log(f"dlc {s} FAILED {st.code}: {st.message}")
            break
        dlc_models.append(dlc[s].get_target_model())
    if len(dlc_models) == len(STEMS):
        link = client.submit_link_job(dlc_models, device=device,
                                      name="memprobe-link3",
                                      options="--qairt_version 2.50")
        log(f"link: {link.job_id}")
        if link.wait().success:
            wrap = client.submit_compile_job(
                link.get_target_model(), device=device,
                name="memprobe-link3-onnx")  # options not allowed here
            log(f"wrap: {wrap.job_id}")
            report["link3"] = fetch(wrap, OUT / "link3")
        else:
            st = link.get_status()
            log(f"link FAILED {st.code}: {st.message}")
    for s in STEMS:
        report[f"fp16_{s}"] = fetch(fp16[s], OUT / "fp16" / s)
    (OUT / "report.json").write_text(json.dumps(report, indent=2))
    log("done")


if __name__ == "__main__":
    main()
