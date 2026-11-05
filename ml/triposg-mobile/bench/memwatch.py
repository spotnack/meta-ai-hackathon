"""Anonymous-RSS sampler + watchdog shared by the split-export/parity steps.

`ru_maxrss` counts file-backed mmap pages (the safetensors weights), so the
cap is on RssAnon from /proc/self/status instead. The watchdog tracks its own
running max of RssAnon and aborts above 8 GiB.
"""

import os
import threading
import time

# 8 GiB hard cap per process (explicit exception to the no-heavy-jobs rule).
RSS_CAP_GIB = 8.0

_PEAK_ANON_GIB = 0.0


def _sample_rss():
    """Sample RssAnon/RssFile in GiB, updating the tracked anon peak."""
    global _PEAK_ANON_GIB
    anon = 0.0
    file_ = 0.0
    try:
        with open("/proc/self/status") as fh:
            for line in fh:
                if line.startswith("RssAnon:"):
                    anon = int(line.split()[1]) / 1024**2
                elif line.startswith("RssFile:"):
                    file_ = int(line.split()[1]) / 1024**2
    except OSError:
        pass
    if anon > _PEAK_ANON_GIB:
        _PEAK_ANON_GIB = anon
    return anon, file_


def mem_str():
    """Current memory summary: tracked anon peak + current file-backed RSS."""
    _, file_ = _sample_rss()
    return f"peak_anon {_PEAK_ANON_GIB:.2f} GiB rss_file {file_:.2f} GiB"


def watchdog():
    """Abort the process if anonymous RSS passes the cap."""

    def watch():
        while True:
            time.sleep(0.5)
            anon, _ = _sample_rss()
            if anon > RSS_CAP_GIB:
                print(
                    f"WATCHDOG: anon {anon:.2f} GiB over "
                    f"{RSS_CAP_GIB:.0f} GiB cap — aborting "
                    f"({mem_str()})",
                    flush=True,
                )
                os._exit(2)

    threading.Thread(target=watch, daemon=True).start()
