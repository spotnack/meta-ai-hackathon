"""Capture per-unit calibration inputs for w8a16 quantization.

Runs the FP32 batch-1 units (logs/spike/b1/dit_<stem>_fp32.onnx, the
same 23-unit chain and hidden->hidden_in wiring as bench/ndk/chain.cpp
and modules/triposg/cpp/pipeline.cpp) on ORT CPU over real rectified-flow
trajectories with CFG 7, and saves every unit's inputs for both rows at
each step under logs/spike/calib/<golden>/<stem>_s<ii>_r<r>.npz.

Conditioning is real: golden step0_encoder_hidden_states (row 0 uncond =
zeros, row 1 cond). Both rows start from the golden step0 latent row 0,
exactly like spike_pipeline (latent_r0 for both rows, enc_r1 for cond).
Timesteps come from the app's scheduler port (sigma[i] = float32(1-i/steps),
timestep = sigma*1000), not from the golden step-0 file: a 10-step schedule
covers t in (0, 1] where the production 50-step schedule lives.

Memory: one FP32 unit session is resident at a time (~300 MB) plus the
chain state (hidden + up to 7 skips per row, ~270 MB), so the peak stays
far under the cap. Run time is ~460 unit forwards per golden (23 units x
10 steps x 2 rows); each block forward is ~1-3 s on 8 laptop cores, so
expect roughly 0.5-1.5 h per golden, printed as it goes.

Usage (triposg-spike env; run under the memory cap like the exports):
  systemd-run --user --scope -p MemoryMax=9G -p MemorySwapMax=0 \
    python -u bench/capture_calib.py [--goldens hjswed,iuvbww,qwvfsd] \
    [--steps 10] [--out-dir ml/triposg-mobile/logs/spike/calib]

Default goldens are 3 of the 5 eval ids; uegvsd + yuyyuw are held out so
the phone mesh parity stays an honest end-to-end check of the quantized
chain.
"""

import argparse
import ctypes
import gc
import sys
import time
from pathlib import Path

import numpy as np

from memwatch import mem_str, watchdog

ROOT = Path("ml/triposg-mobile")
B1_DEFAULT = ROOT / "logs" / "spike" / "b1"
GOLDENS = ROOT / "reference" / "goldens_5"
N_LAYERS = 21
MID = 10
STEMS = ["head"] + [f"blk{i:02d}" for i in range(N_LAYERS)] + ["tail"]
GUIDANCE = 7.0


def log(msg):
    """Print immediately (= python -u)."""
    print(msg, flush=True)


def unit_in_names(stem):
    """Original ONNX input names for one batch-1 unit.

    Mirror of split_export_step.unit_io_names (inputs only), duplicated
    here so capture needs no torch import.
    """
    if stem == "head":
        return ["hidden_states", "timestep"]
    if stem == "tail":
        return ["hidden_in"]
    layer = int(stem[3:])
    ins = ["hidden_in", "encoder_hidden_states"]
    if layer > MID:
        ins.append(f"skip_{2 * MID - layer}")
    return ins


def run_trajectory(golden_id, steps, b1_dir, out_dir):
    """Run one golden's short trajectory, saving every unit's inputs."""
    import onnxruntime as ort

    golden = GOLDENS / golden_id
    latents = np.load(golden / "step0_latent_model_input.npy")
    timestep0 = np.load(golden / "step0_timestep.npy")
    enc = np.load(golden / "step0_encoder_hidden_states.npy")
    assert latents.shape == (2, 2048, 64), latents.shape
    assert timestep0.shape == (2,), timestep0.shape
    assert enc.shape == (2, 257, 1024), enc.shape
    # Any schedule starts at sigma=1 -> t=1000; the golden step-0 file is
    # the 50-step schedule's first step, so it must agree.
    assert np.all(timestep0 == np.float32(1000.0)), timestep0
    assert np.all(enc[0] == 0.0), "golden row 0 must be the zero uncond"

    dest = out_dir / golden_id
    dest.mkdir(parents=True, exist_ok=True)
    sigmas = np.array(
        [np.float32(1.0 - i / steps) for i in range(steps + 1)], dtype=np.float32
    )
    times = (sigmas[:-1] * np.float32(1000.0)).astype(np.float32)

    latent = {0: latents[0:1].copy(), 1: latents[0:1].copy()}
    enc_rows = {0: enc[0:1].copy(), 1: enc[1:2].copy()}
    opts = ort.SessionOptions()
    opts.intra_op_num_threads = 8
    # Each unit is loaded and freed once per step; ORT's arena plus glibc
    # fragmentation grew anon past 8 GiB within one step, so no arena and
    # an explicit malloc_trim after every unit.
    opts.enable_cpu_mem_arena = False
    opts.enable_mem_pattern = False
    libc = ctypes.CDLL("libc.so.6")
    t_traj = time.time()
    for i in range(steps):
        ts = np.array([times[i]], dtype=np.float32)
        hidden = {r: latent[r] for r in (0, 1)}
        skips = {}
        noises = {}
        for stem in STEMS:
            model_path = str(b1_dir / f"dit_{stem}_fp32.onnx")
            sess = ort.InferenceSession(model_path, sess_options=opts)
            for r in (0, 1):
                if stem == "head":
                    feeds = {"hidden_states": hidden[r], "timestep": ts}
                elif stem == "tail":
                    feeds = {"hidden_in": hidden[r]}
                else:
                    layer = int(stem[3:])
                    feeds = {
                        "hidden_in": hidden[r],
                        "encoder_hidden_states": enc_rows[r],
                    }
                    if layer > MID:
                        feeds[f"skip_{2 * MID - layer}"] = skips[(r, 2 * MID - layer)]
                    push_name = f"skip_{layer}"
                assert set(feeds) == set(unit_in_names(stem)), (stem, sorted(feeds))
                path = dest / f"{stem}_s{i:02d}_r{r}.npz"
                np.savez(path, **{k: np.ascontiguousarray(v) for k, v in feeds.items()})
                outs = sess.run(None, feeds)
                names = [o.name for o in sess.get_outputs()]
                if stem == "tail":
                    noises[r] = outs[0]
                else:
                    hidden[r] = outs[names.index("hidden")]
                    if stem.startswith("blk") and int(stem[3:]) < MID:
                        skips[(r, int(stem[3:]))] = outs[names.index(push_name)]
            del sess
            gc.collect()
            libc.malloc_trim(0)
        dt = np.float32(sigmas[i] - sigmas[i + 1])
        for r in (0, 1):
            guided = noises[0] + np.float32(GUIDANCE) * (noises[1] - noises[0])
            latent[r] = (latent[r] + dt * guided).astype(np.float32)
        log(f"{golden_id} step {i + 1}/{steps} t={times[i]:.1f} {mem_str()}")
    log(f"{golden_id} trajectory done in {(time.time() - t_traj) / 60:.1f} min")


def main():
    """Parse args and capture one trajectory per golden."""
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--goldens",
        default="hjswed,iuvbww,qwvfsd",
        help="comma-separated golden ids (default holds out uegvsd,yuyyuw)",
    )
    parser.add_argument("--steps", type=int, default=10)
    parser.add_argument("--b1-dir", default=str(B1_DEFAULT))
    parser.add_argument("--out-dir", default=str(ROOT / "logs" / "spike" / "calib"))
    args = parser.parse_args()

    watchdog()
    goldens = [g.strip() for g in args.goldens.split(",") if g.strip()]
    b1_dir = Path(args.b1_dir)
    for stem in STEMS:
        path = b1_dir / f"dit_{stem}_fp32.onnx"
        if not path.is_file():
            log(f"STOP: missing {path} (run split_export_step.py --all-b1)")
            sys.exit(1)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    total_forwards = len(goldens) * args.steps * len(STEMS) * 2
    log(
        f"capturing {len(goldens)} goldens x {args.steps} steps = "
        f"{total_forwards} unit forwards"
    )
    for golden_id in goldens:
        run_trajectory(golden_id, args.steps, b1_dir, out_dir)
    log(f"capture done -> {out_dir}, {mem_str()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
