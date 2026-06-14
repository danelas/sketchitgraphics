"""
Local dev server — serves the static site AND the /api/separate function on one
port, so you can test the live color separation exactly as it'll behave on Vercel
(same-origin, no CORS) WITHOUT needing the Vercel CLI.

    python api/dev_server.py            # http://localhost:8751
    python api/dev_server.py 9000       # custom port

On Vercel itself you don't run this — Vercel serves the static files and runs
api/separate.py as a serverless function automatically. This is dev-only.
"""
import base64
import json
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

API_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(API_DIR)
sys.path.insert(0, API_DIR)
import separate as sep  # noqa: E402


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def do_POST(self):  # noqa: N802
        if self.path.rstrip("/") == "/api/separate":
            try:
                n = int(self.headers.get("Content-Length", 0))
                payload = json.loads(self.rfile.read(n) or b"{}") if n else {}
                durl = payload.get("image", "")
                b64 = durl.split(",", 1)[1] if "," in durl else durl
                res = sep.run_separation(
                    base64.b64decode(b64),
                    colors=payload.get("colors"),
                    dark=payload.get("garment", "dark") != "light",
                )
                self._json(200, res)
            except Exception as exc:
                self._json(500, {"error": str(exc)})
        else:
            self.send_error(404)

    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass  # quiet


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8751
    print(f"Dev server (static + /api/separate) -> http://localhost:{port}")
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
