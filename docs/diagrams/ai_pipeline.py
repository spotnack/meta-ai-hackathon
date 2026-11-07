"""Pipeline diagram for the README (assets/ai_pipeline.png).

Two lanes: on-phone offline inference (top) and build-time model
production (bottom). Dark-on-light, large type, no external assets.

Regenerate (from the repo root, you run this):
    ~/anaconda3/envs/triposg-spike/bin/python docs/diagrams/ai_pipeline.py
"""

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402 (backend must be set first)
from matplotlib.patches import FancyArrowPatch, FancyBboxPatch  # noqa: E402

OUT = "assets/ai_pipeline.png"

# Lane geometry in axes coordinates (0-100 x, 0-100 y; TOP > BOT).
PHONE_TOP, PHONE_BOT = 86, 54
BUILD_TOP, BUILD_BOT = 34, 6

PHONE_BOXES = [
    ("gallery\nphoto", "input", "#E8E8E8"),
    ("u2net\ncut-out\n+ crop / pad", "CPU", "#DCE9F7"),
    ("DINOv2\nimage\nencoder", "CPU", "#DCE9F7"),
    ("DiT sampling\n50 steps\nCFG 7\n1 merged session\n(23 units)", "NPU", "#F7E3C8"),
    ("VAE\nlatent pass", "NPU", "#F7E3C8"),
    ("octree SDF\nqueries +\nmarching\ntetrahedra", "NPU + CPU", "#EFE3F2"),
    ("decimate\n100k / 200k\nGLB saved\nto library", "CPU", "#DCE9F7"),
]

# Phone boxes that load a downloaded model (u2net .. SDF queries).
MODEL_BOXES = (1, 5)

BUILD_BOXES = [
    ("TripoSG PyTorch\n1.5B DiT + VAE", "", "#E8E8E8"),
    ("per-block ONNX export\nbatch 1, FP32", "laptop", "#DCE9F7"),
    ("AI Hub compile\nSM8750 EPContext", "QNN HTP", "#F7E3C8"),
    ("merge_chain.py\none merged session\n+ model manifest", "laptop", "#DDEBD3"),
]


def draw_lane(ax, boxes, top, bot, title):
    """Draws one lane of boxes with arrows; returns box centers."""
    ax.text(
        1,
        (top + bot) / 2,
        title,
        fontsize=13,
        fontweight="bold",
        va="center",
        ha="left",
        color="#222222",
    )
    left, right = 15, 99
    gap = 1.6
    width = (right - left - gap * (len(boxes) - 1)) / len(boxes)
    centers = []
    for i, (label, tag, color) in enumerate(boxes):
        x0 = left + i * (width + gap)
        box = FancyBboxPatch(
            (x0, bot),
            width,
            top - bot,
            boxstyle="round,pad=0.4",
            facecolor=color,
            edgecolor="#444444",
            linewidth=1.2,
        )
        ax.add_patch(box)
        text = label if not tag else f"{label}\n[{tag}]"
        ax.text(
            x0 + width / 2,
            (top + bot) / 2,
            text,
            fontsize=9.5,
            va="center",
            ha="center",
            color="#111111",
            linespacing=1.35,
        )
        centers.append(x0 + width / 2)
        if i > 0:
            prev = left + (i - 1) * (width + gap) + width
            ax.add_patch(
                FancyArrowPatch(
                    (prev + 0.2, (top + bot) / 2),
                    (x0 - 0.2, (top + bot) / 2),
                    arrowstyle="-|>",
                    mutation_scale=14,
                    color="#333333",
                    linewidth=1.4,
                    shrinkA=0,
                    shrinkB=0,
                )
            )
    return centers, width


def main():
    fig, ax = plt.subplots(figsize=(15, 8), dpi=140)
    ax.set_xlim(0, 100)
    ax.set_ylim(0, 100)
    ax.axis("off")
    fig.patch.set_facecolor("white")

    ax.text(
        50,
        99,
        "On-device TripoSG image-to-3D (Xiaomi 15 Ultra, SM8750)",
        fontsize=15,
        fontweight="bold",
        ha="center",
        va="top",
        color="#111111",
    )
    phone_centers, phone_w = draw_lane(
        ax, PHONE_BOXES, PHONE_TOP, PHONE_BOT, "On the phone\n(offline)"
    )
    build_centers, _ = draw_lane(
        ax, BUILD_BOXES, BUILD_TOP, BUILD_BOT, "Build time\n(laptop + AI Hub)"
    )

    # The downloaded models feed every model-loading phone box: a green
    # bracket under those boxes, fed by one dashed arrow from the build
    # lane's last box (no arrow crosses box text).
    a, b = MODEL_BOXES
    br_y = PHONE_BOT - 4
    x_a = phone_centers[a] - phone_w / 2
    x_b = phone_centers[b] + phone_w / 2
    green = "#2a7a2a"
    # The bracket runs on to the feed arrow so the two visibly join.
    x_end = max(x_b, build_centers[-1])
    ax.plot([x_a, x_end], [br_y, br_y], color=green, linewidth=2)
    for x in (x_a, x_b):
        ax.plot([x, x], [br_y, PHONE_BOT - 1], color=green, linewidth=2)
    ax.add_patch(
        FancyArrowPatch(
            (build_centers[-1], BUILD_TOP + 1),
            (build_centers[-1], br_y),
            arrowstyle="-|>",
            mutation_scale=14,
            color=green,
            linewidth=1.6,
            linestyle=(0, (5, 4)),
        )
    )
    ax.text(
        build_centers[-1] - 1.2,
        (BUILD_TOP + br_y) / 2,
        "model download\n(6.9 GB, Hugging Face)",
        fontsize=10,
        color=green,
        va="center",
        ha="right",
    )

    fig.tight_layout()
    fig.savefig(OUT, facecolor="white")
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
