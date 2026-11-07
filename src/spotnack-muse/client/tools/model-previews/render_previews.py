"""Pre-render a still image of each bundled food model for the Explore cards.

Explore cards show these stills when they cannot hold a live 3D view (GL
lease cap, or a conversion running). Run after adding or changing a model
in src/features/explore/infrastructure/mock-category-items/food/:

    python tools/model-previews/render_previews.py

Needs Google Chrome (or Chromium) and the workspace node_modules (three.js).
Standard library only. Writes <model>.png next to each .glb the data source requires.
"""

import argparse
import json
import re
import shutil
import subprocess
import sys
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

CLIENT = Path(__file__).resolve().parents[2]
WORKSPACE = CLIENT.parent  # holds node_modules/three
FOOD_DIR = CLIENT / "src/features/explore/infrastructure/mock-category-items/food"
DATA_SOURCE = (
    CLIENT / "src/features/explore/infrastructure/mock-category-items.data-source.js"
)
PAGE = Path(__file__).resolve().parent / "render.html"


def find_chrome():
    for name in ("google-chrome", "chromium", "chromium-browser"):
        path = shutil.which(name)
        if path:
            return path
    sys.exit("Chrome or Chromium is required.")


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--width", type=int, default=600)
    parser.add_argument("--height", type=int, default=420)
    parser.add_argument("--spin", type=float, default=0.6, help="y rotation in radians")
    parser.add_argument("--timeout", type=int, default=300, help="seconds")
    parser.add_argument("--verbose", action="store_true", help="show Chrome's log")
    args = parser.parse_args()

    # Only the models the app bundles (the data source's require() list).
    pattern = r'require\("\./mock-category-items/food/([^"]+\.glb)"\)'
    used = re.findall(pattern, DATA_SOURCE.read_text())
    glbs = sorted(FOOD_DIR / name for name in set(used))
    jobs = [
        {
            "glb": "/" + str(g.relative_to(WORKSPACE)),
            "out": str(g.with_suffix(".png").relative_to(WORKSPACE)),
        }
        for g in glbs
    ]
    finished = threading.Event()
    failures = []

    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *a, **kw):
            super().__init__(*a, directory=str(WORKSPACE), **kw)

        def log_message(self, *_):
            pass

        def do_GET(self):
            url = urlparse(self.path)
            if url.path == "/jobs":
                body = json.dumps(jobs).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(body)
                return
            if url.path == "/render.html":
                body = PAGE.read_bytes()
                self.send_response(200)
                self.send_header("Content-Type", "text/html")
                self.end_headers()
                self.wfile.write(body)
                return
            super().do_GET()

        def do_POST(self):
            url = urlparse(self.path)
            query = parse_qs(url.query)
            data = self.rfile.read(int(self.headers.get("Content-Length", 0)))
            if url.path == "/save":
                out = (WORKSPACE / query["out"][0]).resolve()
                if FOOD_DIR not in out.parents or out.suffix != ".png":
                    self.send_error(400)
                    return
                out.write_bytes(data)
                print(f"wrote {out.relative_to(CLIENT)} ({len(data) // 1024} KB)")
            elif url.path == "/fail":
                failures.append((query["glb"][0], query["error"][0]))
            elif url.path == "/done":
                finished.set()
            self.send_response(204)
            self.end_headers()

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    port = server.server_address[1]
    url = (
        f"http://127.0.0.1:{port}/render.html"
        f"?w={args.width}&h={args.height}&spin={args.spin}"
    )
    chrome = subprocess.Popen(
        [
            find_chrome(),
            "--headless=new",
            "--use-angle=swiftshader",
            "--enable-unsafe-swiftshader",
            "--no-first-run",
            "--user-data-dir=" + str(Path("/tmp") / f"model-previews-{port}"),
            "--enable-logging=stderr",
            url,
        ],
        stdout=subprocess.DEVNULL,
        stderr=None if args.verbose else subprocess.DEVNULL,
    )
    try:
        if not finished.wait(timeout=args.timeout):
            sys.exit("Timed out waiting for the renders.")
    finally:
        chrome.terminate()
        server.shutdown()
    for glb, error in failures:
        print(f"FAILED {glb}: {error}", file=sys.stderr)
    print(f"{len(jobs) - len(failures)} of {len(jobs)} previews rendered.")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
