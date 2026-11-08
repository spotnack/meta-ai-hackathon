"""Slice one batch row out of a .npy file, keeping the batch dim.

Usage: python -u parity/slice_batch.py IN OUT ROW
Writes OUT as IN[ROW:ROW+1]. Used to make batch-1 probe inputs from the
saved batch-2 references (rows are independent through every block op).
"""

import sys

import numpy as np


def log(msg):
    """Print immediately (= python -u)."""
    print(msg, flush=True)


def main():
    """Slice the row and save it."""
    if len(sys.argv) != 4:
        log("usage: slice_batch.py IN OUT ROW")
        return 1
    src, dst, row = sys.argv[1], sys.argv[2], int(sys.argv[3])
    array = np.load(src)
    if not 0 <= row < array.shape[0]:
        log(f"STOP: row {row} outside batch dim {array.shape[0]} of {src}")
        return 1
    out = np.ascontiguousarray(array[row : row + 1])
    np.save(dst, out)
    log(f"sliced {src} {array.shape} row {row} -> {dst} {out.shape}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
