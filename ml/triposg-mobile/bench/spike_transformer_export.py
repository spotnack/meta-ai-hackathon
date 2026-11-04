"""Export one FP16 TripoSG transformer step to ONNX with external data.

Low-RAM design for a 15 GB laptop: the 5.36 GiB FP32 safetensors file is
memory-mapped (never fully loaded as FP32); tensors are cast to FP16 one
at a time into a meta-initialized model. No CPU baseline forward: this
machine has no FP16 math. Parity comes from the Colab step0_*.npy goldens,
whose exact inputs the phone runs later.

Prerequisites (run in your own terminal):
  git clone https://github.com/VAST-AI-Research/TripoSG.git \
    ~/.cache/triposg/TripoSG
  cd ~/.cache/triposg/TripoSG && git checkout fc5c40990181e2a756c4e0b1c2f4d6b5202faf8c
  ~/anaconda3/envs/triposg-spike/bin/pip install diffusers==0.30.3 einops
Smoke test first (no checkpoint needed, random weights, tiny config):
  ~/anaconda3/envs/triposg-spike/bin/python
    ml/triposg-mobile/bench/spike_transformer_export.py --smoke
Full export from the repo root:
  ~/anaconda3/envs/triposg-spike/bin/python
    ml/triposg-mobile/bench/spike_transformer_export.py
"""

import hashlib
import resource
import sys
from pathlib import Path

import numpy as np
import torch

TRIPOSG_DIR = Path.home() / ".cache" / "triposg" / "TripoSG"
sys.path.insert(0, str(TRIPOSG_DIR))

ROOT = Path("ml/triposg-mobile")
TR_DIR = ROOT / "pretrained_weights" / "transformer"
SPIKE = ROOT / "logs" / "spike"
# Golden step-0 tensors (hjswed): the exact inputs the phone runs, and the
# noise_pred the phone output is checked against. Supersedes the random
# dit_spike_*.npy inputs (deleted).
GOLDEN_STEP0 = ROOT / "reference" / "goldens_5" / "hjswed"


def peak_gb() -> float:
    """Return process peak RSS in GiB (Linux ru_maxrss is KiB)."""
    return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024**2


def sha_of(array: np.ndarray) -> str:
    """Return the hex sha256 of an array's bytes."""
    return hashlib.sha256(np.ascontiguousarray(array).tobytes()).hexdigest()


def save_inputs(
    suffix: str, latents: torch.Tensor, timestep: torch.Tensor, enc: torch.Tensor
) -> None:
    """Save spike inputs as fp32 .npy files with their hashes."""
    for name, tensor in (
        ("latents", latents),
        ("timestep", timestep),
        ("encoder_hidden_states", enc),
    ):
        array = tensor.detach().float().numpy()
        path = SPIKE / f"dit_spike_{name}{suffix}.npy"
        np.save(path, array)
        print(f"{path} {array.shape} sha {sha_of(array)}")


def export_step(
    model: torch.nn.Module,
    latents: torch.Tensor,
    timestep: torch.Tensor,
    enc: torch.Tensor,
    out_name: str,
) -> None:
    """Trace one guided step and write ONNX with external data."""
    model.eval()

    class Step(torch.nn.Module):
        """Return the noise tensor (forward returns a tuple)."""

        def __init__(self, inner: torch.nn.Module) -> None:
            super().__init__()
            self.inner = inner

        def forward(
            self, hidden: torch.Tensor, time: torch.Tensor, cond: torch.Tensor
        ) -> torch.Tensor:
            """Run one transformer step without guidance split."""
            return self.inner(
                hidden, time, encoder_hidden_states=cond, return_dict=False
            )[0]

    step = Step(model)
    torch.onnx.export(
        step,
        (latents, timestep, enc),
        str(SPIKE / out_name),
        input_names=["hidden_states", "timestep", "encoder_hidden_states"],
        output_names=["noise_pred"],
        dynamic_axes={
            "hidden_states": {0: "batch"},
            "timestep": {0: "batch"},
            "encoder_hidden_states": {0: "batch"},
        },
        opset_version=17,
        external_data=True,
    )
    print(f"exported {out_name}, peak {peak_gb():.2f} GiB")


def smoke() -> None:
    """Validate construction and trace on a tiny random config."""
    from triposg.models.transformers.triposg_transformer import (
        TripoSGDiTModel,
    )

    SPIKE.mkdir(parents=True, exist_ok=True)
    conf = dict(TripoSGDiTModel.load_config(TR_DIR))
    conf.update(
        {
            "num_layers": 2,
            "width": 256,
            "num_attention_heads": 4,
            "cross_attention_dim": 64,
            "in_channels": 32,
        }
    )
    with torch.device("meta"):
        model = TripoSGDiTModel.from_config(conf)
    print(f"smoke meta model built, peak {peak_gb():.2f} GiB")
    torch.manual_seed(0)
    tiny = 16
    latents = torch.randn(2, tiny, 32)
    timestep = torch.full((2,), 1000.0)
    enc = torch.randn(2, 8, 64)
    # Random weights live on CPU for the smoke trace.
    model.to_empty(device="cpu")
    with torch.no_grad():
        out = model(latents, timestep, encoder_hidden_states=enc, return_dict=False)[0]
    print(f"smoke forward {tuple(out.shape)}, peak {peak_gb():.2f} GiB")
    export_step(model, latents, timestep, enc, "dit_smoke.onnx")
    import onnxruntime as ort

    sess = ort.InferenceSession(
        str(SPIKE / "dit_smoke.onnx"), providers=["CPUExecutionProvider"]
    )
    got = sess.run(
        None,
        {
            "hidden_states": latents.numpy(),
            "timestep": timestep.numpy(),
            "encoder_hidden_states": enc.numpy(),
        },
    )[0]
    print(f"smoke ort {got.shape}, peak {peak_gb():.2f} GiB")


def main() -> None:
    """Load transformer FP16 via mmap and export one guided step."""
    from safetensors import safe_open

    from triposg.models.transformers.triposg_transformer import (
        TripoSGDiTModel,
    )

    SPIKE.mkdir(parents=True, exist_ok=True)
    conf = TripoSGDiTModel.load_config(TR_DIR)
    with torch.device("meta"):
        model = TripoSGDiTModel.from_config(conf)
    print(f"meta model built, peak {peak_gb():.2f} GiB")

    weight = TR_DIR / "diffusion_pytorch_model.safetensors"
    with safe_open(weight, framework="pt", device="cpu") as archive:
        fp16_state = {}
        for key in archive.keys():
            fp16_state[key] = archive.get_slice(key)[:].half()
            if len(fp16_state) % 50 == 0:
                print(f"  cast {len(fp16_state)} tensors, " f"peak {peak_gb():.2f} GiB")
    print(f"cast done, peak {peak_gb():.2f} GiB")
    model.load_state_dict(fp16_state, strict=True, assign=True)
    del fp16_state
    print(f"assigned FP16, peak {peak_gb():.2f} GiB")

    latents = torch.from_numpy(
        np.load(GOLDEN_STEP0 / "step0_latent_model_input.npy")
    ).half()
    timestep = torch.from_numpy(np.load(GOLDEN_STEP0 / "step0_timestep.npy"))
    enc = torch.from_numpy(
        np.load(GOLDEN_STEP0 / "step0_encoder_hidden_states.npy")
    ).half()
    print(
        f"golden inputs {tuple(latents.shape)} {tuple(timestep.shape)} "
        f"{tuple(enc.shape)}"
    )
    export_step(model, latents, timestep, enc, "dit_step_fp16.onnx")


if __name__ == "__main__":
    if "--smoke" in sys.argv:
        smoke()
    else:
        main()
