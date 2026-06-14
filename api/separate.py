"""
Serverless color-separation endpoint  (POST /api/separate)

Wraps the headless Spot Color Studio engine (spot_sep.py, vendored from
~/Downloads/color-sep) to produce an INSTANT, downscaled preview:
  - real k-means palette detection  -> the actual spot inks in the art
  - linear unmix                    -> per-ink coverage
  - continuous-tone composite       -> a print-simulation preview image

This preview path is pure numpy + Pillow (no scipy) so it stays a lean,
fast serverless bundle. The heavier full-resolution print files (white
underbase, trapping/choke, halftone bitmaps) need scipy and live in a
separate job — see api/README for the "files after" pipeline.

Request  JSON: { "image": "data:image/png;base64,...", "colors": 4|"process"|null, "garment": "dark"|"light" }
Response JSON: { "count": int, "colors": ["#rrggbb", ...], "preview": "data:image/png;base64,...", "recommend": "plastisol"|"dtf" }
"""
from __future__ import annotations

import base64
import io
import json
import os
import sys
from http.server import BaseHTTPRequestHandler

import numpy as np
from PIL import Image

# Import the vendored engine sitting next to this file.
sys.path.insert(0, os.path.dirname(__file__))
from spot_sep import kmeans_palette, unmix  # noqa: E402

PREVIEW_MAX = 480          # px on the long edge — keeps cold separation < ~2s
PREVIEW_ITERS = 80         # unmix iterations (engine default is 120 for full res)
DETECT_K = 8               # over-cluster, then merge near-duplicate inks
MERGE_DIST = 0.14          # RGB euclidean distance below which inks are "the same"
INK_BUDGET = 0.95
WHITE = np.array([1.0, 1.0, 1.0], dtype=np.float32)
LUMA = np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)


def _load_rgb(image_bytes: bytes, max_dim: int = PREVIEW_MAX):
    img = Image.open(io.BytesIO(image_bytes))
    has_alpha = img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info)
    img = img.convert("RGBA") if has_alpha else img.convert("RGB")
    w, h = img.size
    scale = min(max_dim / max(w, h), 1.0)
    if scale < 1.0:
        img = img.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.LANCZOS)
    arr = np.asarray(img, dtype=np.float32) / 255.0
    if has_alpha:
        return arr[..., :3], arr[..., 3]
    return arr[..., :3], None


def _merge_inks(inks: np.ndarray, dist: float = MERGE_DIST) -> np.ndarray:
    """Greedy dedup of near-identical centroids (keeps dark->light order)."""
    kept: list[np.ndarray] = []
    for ink in inks:
        if all(np.linalg.norm(ink - k) > dist for k in kept):
            kept.append(ink)
    return np.asarray(kept, dtype=np.float32)


def _composite(coverages: np.ndarray, inks: np.ndarray, dark: bool) -> np.ndarray:
    h, w, _ = coverages.shape
    bg = np.array([30, 30, 30] if dark else [245, 245, 245], dtype=np.float32)
    canvas = np.broadcast_to(bg, (h, w, 3)).astype(np.float32).copy()
    order = np.argsort(-(inks @ LUMA))          # layer darkest first
    for i in order:
        cov = coverages[..., i:i + 1]
        canvas = canvas * (1.0 - cov) + (inks[i] * 255.0) * cov
    return np.clip(canvas, 0, 255).astype(np.uint8)


def _hex(ink: np.ndarray) -> str:
    r, g, b = (np.clip(ink, 0, 1) * 255).round().astype(int)
    return f"#{r:02x}{g:02x}{b:02x}"


def run_separation(image_bytes: bytes, colors=None, dark: bool = True) -> dict:
    rgb, alpha = _load_rgb(image_bytes)

    # 1. Detect the real palette: over-cluster then merge duplicates.
    detected = _merge_inks(kmeans_palette(rgb, DETECT_K, 25, 20000, 7))
    count = int(detected.shape[0])

    # 2. Decide how many inks to actually separate into for the preview.
    if isinstance(colors, str) and colors.isdigit():
        colors = int(colors)
    if isinstance(colors, int) and 1 <= colors <= 6:
        k = colors
    elif colors == "process":
        k = min(max(count, 4), 6)
    else:
        k = min(count, 6)
    inks = kmeans_palette(rgb, k, 25, 20000, 7)

    # 3. Separate + composite a print-simulation preview.
    coverages = unmix(rgb, inks, WHITE, PREVIEW_ITERS, INK_BUDGET)
    if alpha is not None:
        coverages = coverages * alpha[..., None]
    coverages = np.where(coverages < 0.08, 0.0, coverages)   # kill speckle (engine default)

    preview = _composite(coverages, inks, dark)
    buf = io.BytesIO()
    Image.fromarray(preview, mode="RGB").save(buf, format="PNG")
    data_url = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()

    return {
        "count": count,
        "colors": [_hex(c) for c in inks],
        "preview": data_url,
        "recommend": "dtf" if count >= 7 else "plastisol",
    }


class handler(BaseHTTPRequestHandler):
    def do_POST(self):  # noqa: N802  (Vercel/BaseHTTPRequestHandler contract)
        try:
            length = int(self.headers.get("Content-Length", 0))
            payload = json.loads(self.rfile.read(length) or b"{}") if length else {}
            data_url = payload.get("image", "")
            b64 = data_url.split(",", 1)[1] if "," in data_url else data_url
            if not b64:
                return self._send(400, {"error": "no image provided"})
            image_bytes = base64.b64decode(b64)
            result = run_separation(
                image_bytes,
                colors=payload.get("colors"),
                dark=payload.get("garment", "dark") != "light",
            )
            self._send(200, result)
        except Exception as exc:  # surface the message to the client, never 500-hang
            self._send(500, {"error": str(exc)})

    def do_OPTIONS(self):  # noqa: N802  (CORS preflight)
        self._send(204, None)

    def _send(self, code: int, obj):
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        if obj is not None:
            self.wfile.write(json.dumps(obj).encode())
