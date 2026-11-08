"""One guided TripoSG transformer step: FP32 ONNX export on CPU, then FP16.

No FP16 tracing on CPU: export FP32 first, convert with
onnxconverter-common's convert_float_to_float16_model_path
(disk-backed shape inference, works above 2 GB; keep_io_types=True).
Keep both files; FP32 is the CPU fallback if ORT CPU lacks FP16 kernels.

Host commands (repo root; exact list is given in chat):
  ~/.venvs/modal/bin/modal setup
  ~/.venvs/modal/bin/modal volume put triposg-step <goldens>/step0_*.npy \\
      goldens/hjswed/ (4 files)
  ~/.venvs/modal/bin/modal run ml/triposg-mobile/bench/modal_export_step.py
  ~/.venvs/modal/bin/modal volume get triposg-step <artifact> \\
      ml/triposg-mobile/logs/spike/<name>

Container: 4 CPU, 64 GB RAM, no GPU. All prints use flush=True (= python -u).
Peak RSS is logged at every stage; export_report.json is rewritten and
committed to the volume after each stage.
"""

import sys

import modal

APP_NAME = "triposg-step-export"
VOLUME_NAME = "triposg-step"
TRIPOSG_COMMIT = "fc5c40990181e2a756c4e0b1c2f4d6b5202faf8c"
WEIGHTS_REPO = "VAST-AI/TripoSG"
# Pinned to the revision the 50-step goldens were generated from
# (goldens_5/report.json). The torch-FP32-forward check doubles as drift
# detection: if weights ever change, stage (a) stops the job.
WEIGHTS_REVISION = "2c1c516d22d58db486a058d98d31bb6177344e06"
GOLDEN_ID = "hjswed"

# Fixed guided-step shapes (batch 2 baked in). No dynamic_axes (QNN static).
SHAPES = {
    "hidden_states": (2, 2048, 64),
    "timestep": (2,),
    "encoder_hidden_states": (2, 257, 1024),
}

# FP16 gate vs step0_noise_pred.npy: fail = save nothing, exit nonzero.
COS_MIN = 0.999
L2_MAX = 1e-2
# Torch FP32 forward vs goldens: revision/drift tripwire (CPU vs T4 numerics).
TORCH_L2_MAX = 1e-2

app = modal.App(APP_NAME)

image = (
    modal.Image.debian_slim(python_version="3.11")
    .run_commands(
        "pip install --quiet torch==2.5.1 --index-url "
        "https://download.pytorch.org/whl/cpu"
    )
    .pip_install(
        "diffusers==0.30.3",
        "huggingface_hub==0.36.2",
        "onnx==1.23.2",
        "onnxruntime==1.22.0",
        "onnxconverter-common==1.16.0",
        "numpy==2.2.6",
        "einops==0.8.2",
        "safetensors==0.8.0",
    )
)

vol = modal.Volume.from_name(VOLUME_NAME, create_if_missing=True)


def log(msg):
    """Print immediately (Modal streams stdout; flush = python -u)."""
    print(msg, flush=True)


@app.function(image=image, cpu=4, memory=65536, timeout=7200, volumes={"/data": vol})
def export():
    """Run the full export + parity job. All artifacts land on the volume."""
    import hashlib
    import json
    import os
    import resource
    import subprocess

    import numpy as np

    def peak_gb():
        """Return process peak RSS in GiB (ru_maxrss is KiB on Linux)."""
        return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024**2

    work = "/data"
    triposg_dir = os.path.join(work, "TripoSG")
    weights_dir = os.path.join(work, "weights")
    goldens = os.path.join(work, "goldens", GOLDEN_ID)
    report_path = os.path.join(work, "export_report.json")

    report = {
        "triposg_commit": TRIPOSG_COMMIT,
        "weights_repo": WEIGHTS_REPO,
        "weights_revision": WEIGHTS_REVISION,
        "shapes": {k: list(v) for k, v in SHAPES.items()},
        "stages_done": [],
    }

    def save_report(stage):
        """Write the report and commit the volume so progress survives."""
        report["stages_done"].append(stage)
        report["peak_gib"] = peak_gb()
        with open(report_path, "w") as f:
            json.dump(report, f, indent=2)
        vol.commit()
        log(f"stage done: {stage} (peak {peak_gb():.2f} GiB)")

    for name in (
        "step0_latent_model_input",
        "step0_timestep",
        "step0_encoder_hidden_states",
        "step0_noise_pred",
    ):
        path = os.path.join(goldens, f"{name}.npy")
        if not os.path.isfile(path):
            log(
                f"MISSING golden: {path} — upload with "
                f"`modal volume put {VOLUME_NAME} <local> "
                f"goldens/{GOLDEN_ID}/{name}.npy` then re-run."
            )
            sys.exit(1)

    if not os.path.isdir(triposg_dir):
        log("cloning TripoSG ...")
        subprocess.run(
            [
                "git",
                "clone",
                "https://github.com/VAST-AI-Research/TripoSG.git",
                triposg_dir,
            ],
            check=True,
        )
    subprocess.run(
        ["git", "-C", triposg_dir, "fetch", "--quiet", "origin", TRIPOSG_COMMIT],
        check=True,
    )
    subprocess.run(
        ["git", "-C", triposg_dir, "checkout", "--quiet", TRIPOSG_COMMIT], check=True
    )
    log(f"triposg {TRIPOSG_COMMIT}, peak {peak_gb():.2f} GiB")

    sys.path.insert(0, triposg_dir)
    import torch
    from huggingface_hub import snapshot_download

    snapshot_download(
        repo_id=WEIGHTS_REPO,
        revision=WEIGHTS_REVISION,
        allow_patterns=["transformer/*"],
        local_dir=weights_dir,
    )
    log(f"weights {WEIGHTS_REVISION} (transformer/*), " f"peak {peak_gb():.2f} GiB")

    from triposg.models.transformers.triposg_transformer import (
        TripoSGDiTModel,
    )

    conf = TripoSGDiTModel.load_config(os.path.join(weights_dir, "transformer"))
    with torch.device("meta"):
        model = TripoSGDiTModel.from_config(conf)
    log(f"meta model built, peak {peak_gb():.2f} GiB")

    from safetensors import safe_open

    weight = os.path.join(
        weights_dir, "transformer", "diffusion_pytorch_model.safetensors"
    )
    with safe_open(weight, framework="pt", device="cpu") as archive:
        fp32_state = {key: archive.get_slice(key)[:] for key in archive.keys()}
    log(f"weights loaded FP32, peak {peak_gb():.2f} GiB")
    model.load_state_dict(fp32_state, strict=True, assign=True)
    del fp32_state
    model.eval()
    log(f"state assigned, peak {peak_gb():.2f} GiB")

    latents = torch.from_numpy(
        np.load(os.path.join(goldens, "step0_latent_model_input.npy"))
    )
    timestep = torch.from_numpy(np.load(os.path.join(goldens, "step0_timestep.npy")))
    enc = torch.from_numpy(
        np.load(os.path.join(goldens, "step0_encoder_hidden_states.npy"))
    )
    golden = np.load(os.path.join(goldens, "step0_noise_pred.npy"))
    assert tuple(latents.shape) == SHAPES["hidden_states"], latents.shape
    assert tuple(timestep.shape) == SHAPES["timestep"], timestep.shape
    assert tuple(enc.shape) == SHAPES["encoder_hidden_states"], enc.shape
    log(
        f"golden inputs {tuple(latents.shape)} {tuple(timestep.shape)} "
        f"{tuple(enc.shape)}"
    )

    def metrics(name, got):
        """Report parity numbers of an array vs the golden noise_pred."""
        got = np.asarray(got, dtype=np.float64)
        ref = np.asarray(golden, dtype=np.float64)
        diff = got - ref
        out = {
            "max_abs": float(np.abs(diff).max()),
            "mean_abs": float(np.abs(diff).mean()),
            "rel_l2": float(np.linalg.norm(diff.ravel()) / np.linalg.norm(ref.ravel())),
            "cosine": float(
                got.ravel().dot(ref.ravel())
                / np.linalg.norm(got.ravel())
                / np.linalg.norm(ref.ravel())
            ),
            "sha256": hashlib.sha256(
                np.ascontiguousarray(got.astype(np.float32)).tobytes()
            ).hexdigest(),
        }
        log(
            f"{name}: max_abs={out['max_abs']:.3e} "
            f"mean_abs={out['mean_abs']:.3e} rel_l2={out['rel_l2']:.3e} "
            f"cosine={out['cosine']:.7f} sha {out['sha256'][:16]}… "
            f"peak {peak_gb():.2f} GiB"
        )
        return out

    # (a) Torch FP32 forward vs goldens: validates inputs + weights revision.
    with torch.no_grad():
        torch_out = (
            model(latents, timestep, encoder_hidden_states=enc, return_dict=False)[0]
            .float()
            .numpy()
        )
    report["torch_fp32"] = metrics("torch_fp32", torch_out)
    save_report("torch_fp32")
    if (
        not np.isfinite(torch_out).all()
        or report["torch_fp32"]["rel_l2"] > TORCH_L2_MAX
    ):
        log(
            "STOP: torch FP32 forward disagrees with goldens "
            "(wrong inputs or weights revision). No export written."
        )
        sys.exit(1)
    del torch_out

    # (b) FP32 ONNX export (static shapes), re-saved with a single external
    # data file under its exact final name, then ORT validity check.
    class Step(torch.nn.Module):
        """Return the noise tensor (forward returns a tuple)."""

        def __init__(self, inner):
            super().__init__()
            self.inner = inner

        def forward(self, hidden, time, cond):
            """Run one transformer step without guidance split."""
            return self.inner(
                hidden, time, encoder_hidden_states=cond, return_dict=False
            )[0]

    raw_path = os.path.join(work, "dit_step_fp32_raw.onnx")
    fp32_path = os.path.join(work, "dit_step_fp32.onnx")
    fp32_data = "dit_step_fp32.onnx.data"
    torch.onnx.export(
        Step(model),
        (latents, timestep, enc),
        raw_path,
        input_names=["hidden_states", "timestep", "encoder_hidden_states"],
        output_names=["noise_pred"],
        opset_version=17,
        external_data=True,
    )
    log(f"exported FP32 raw, peak {peak_gb():.2f} GiB")
    del model

    import onnx
    import onnxruntime as ort

    raw_model = onnx.load(raw_path)
    onnx.save_model(
        raw_model,
        fp32_path,
        save_as_external_data=True,
        all_tensors_to_one_file=True,
        location=fp32_data,
    )
    del raw_model
    for suffix in ("", ".data"):
        try:
            os.remove(raw_path + suffix)
        except OSError:
            pass
    log(f"re-saved FP32 single-file external data, " f"peak {peak_gb():.2f} GiB")

    sess = ort.InferenceSession(fp32_path, providers=["CPUExecutionProvider"])
    fp32_out = sess.run(
        None,
        {
            "hidden_states": latents.numpy(),
            "timestep": timestep.numpy(),
            "encoder_hidden_states": enc.numpy(),
        },
    )[0]
    report["ort_fp32"] = metrics("ort_fp32", fp32_out)
    del fp32_out
    del sess
    save_report("ort_fp32")

    # (c) FP16 conversion (disk-backed shape inference, keep I/O FP32).
    # An ORT CPU failure here (missing x86 FP16 kernels) is recorded, not
    # fatal: the FP32 outputs stay and the job exits cleanly.
    from onnxconverter_common import float16

    fp16_path = os.path.join(work, "dit_step_fp16.onnx")
    try:
        fp16_model = float16.convert_float_to_float16_model_path(
            fp32_path, keep_io_types=True
        )
        onnx.save_model(
            fp16_model,
            fp16_path,
            save_as_external_data=True,
            all_tensors_to_one_file=True,
            location="dit_step_fp16.onnx.data",
        )
        del fp16_model
        log(f"converted FP16, peak {peak_gb():.2f} GiB")
        save_report("convert_fp16")

        sess16 = ort.InferenceSession(fp16_path, providers=["CPUExecutionProvider"])
        fp16_out = sess16.run(
            None,
            {
                "hidden_states": latents.numpy(),
                "timestep": timestep.numpy(),
                "encoder_hidden_states": enc.numpy(),
            },
        )[0]
        report["ort_fp16"] = metrics("ort_fp16", fp16_out)
        del fp16_out
        del sess16
    except Exception as error:  # noqa: BLE001 — recorded, job stays green
        report["ort_fp16"] = {"error": f"{type(error).__name__}: {error}"}
        save_report("ort_fp16_error")
        log(
            f"FP16 ORT CPU unavailable ({error}); FP32 outputs kept, "
            "exiting cleanly."
        )
        subprocess.run(["ls", "-la", work], check=True)
        return

    gate = (
        report["ort_fp16"]["cosine"] >= COS_MIN
        and report["ort_fp16"]["rel_l2"] <= L2_MAX
    )
    report["gate"] = {"cos_min": COS_MIN, "l2_max": L2_MAX, "pass": bool(gate)}
    save_report("gate")
    if not gate:
        for suffix in ("", ".data"):
            try:
                os.remove(fp16_path + suffix)
            except OSError:
                pass
        vol.commit()
        log("STOP: FP16 gate failed — artifact removed, report kept.")
        sys.exit(1)
    log("PASS: both ONNX files + report on volume " f"(peak {peak_gb():.2f} GiB).")
    subprocess.run(["ls", "-la", work], check=True)


@app.local_entrypoint()
def main():
    """Entry point for `modal run`. Blocks until the job finishes."""
    export.remote()
