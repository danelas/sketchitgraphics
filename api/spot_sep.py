"""
Spot-color separation (a.k.a. simulated process) for heat transfers /
screen printing.

Picks N inks that best represent the image, then unmixes every pixel as a
non-negative combination of those inks over the chosen base (white underbase
for dark garments, paper for light garments). Each ink is then independently
halftone-screened at its own angle so the printed dots reproduce the image.

This is what apps like UltraSeps, Spot Process Separation Studio, and
QuikSeps do for "simulated process" output.

Usage:
    python spot_sep.py pokemon.jpeg --out spot_seps --colors 6 --dark
    python spot_sep.py logo.png --out spot_seps --palette "#ff0000,#0044ff,#222222" --light
    python spot_sep.py art.png --out spot_seps --colors 8 --lpi 45 --dpi 300
"""

from __future__ import annotations

import argparse
import os
from dataclasses import dataclass

import numpy as np
from PIL import Image


# Six rotated screen angles, each 15 deg apart, offset 7.5 from CMYK convention.
# Extended progressively if the user asks for >6 colors.
DEFAULT_ANGLES = [7.5, 22.5, 37.5, 52.5, 67.5, 82.5, 0.0, 45.0, 30.0, 60.0]


@dataclass
class SpotConfig:
    n_colors: int = 6
    dpi: int = 300
    lpi: int = 55
    dark_garment: bool = True       # white underbase under everything
    underbase_choke: int = 1
    underbase_threshold: int = 8    # min ink coverage 0-255 to fire white
    sample_pixels: int = 20000      # k-means sample size for palette discovery
    kmeans_iters: int = 25
    unmix_iters: int = 120
    dot_gain_pct: float = 18.0
    ink_budget: float = 0.95        # max total ink coverage per pixel
    saturation: float = 0.7         # gamma applied to each ink channel (<1 lifts midtones / saturates dominant ink)
    winner_boost: float = 0.4       # 0..1: extra coverage given to each pixel's dominant ink
    suppress_below: float = 0.08    # zero-out any ink coverage below this threshold (kills color speckle)
    seed: int = 7


# ----- Color space helpers (sRGB <-> CIE Lab) -----------------------------

def _srgb_to_linear(c: np.ndarray) -> np.ndarray:
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def _linear_to_srgb(c: np.ndarray) -> np.ndarray:
    return np.where(c <= 0.0031308, 12.92 * c, 1.055 * np.power(np.maximum(c, 1e-9), 1 / 2.4) - 0.055)


_M_RGB2XYZ = np.array([
    [0.4124564, 0.3575761, 0.1804375],
    [0.2126729, 0.7151522, 0.0721750],
    [0.0193339, 0.1191920, 0.9503041],
], dtype=np.float32)

_M_XYZ2RGB = np.array([
    [ 3.2404542, -1.5371385, -0.4985314],
    [-0.9692660,  1.8760108,  0.0415560],
    [ 0.0556434, -0.2040259,  1.0572252],
], dtype=np.float32)

_D65 = np.array([0.95047, 1.0, 1.08883], dtype=np.float32)


def rgb_to_lab(rgb: np.ndarray) -> np.ndarray:
    """sRGB [0,1] -> CIE L*a*b* (perceptual)."""
    lin = _srgb_to_linear(np.clip(rgb, 0.0, 1.0))
    xyz = lin @ _M_RGB2XYZ.T / _D65
    eps = 0.008856
    kappa = 903.3 / 116.0
    f = np.where(xyz > eps, np.cbrt(np.maximum(xyz, 1e-12)), kappa * xyz + 16 / 116)
    L = 116 * f[..., 1] - 16
    a = 500 * (f[..., 0] - f[..., 1])
    b = 200 * (f[..., 1] - f[..., 2])
    return np.stack([L, a, b], axis=-1).astype(np.float32)


def lab_to_rgb(lab: np.ndarray) -> np.ndarray:
    """CIE L*a*b* -> sRGB [0,1] (clamped)."""
    L = lab[..., 0]
    fy = (L + 16) / 116
    fx = lab[..., 1] / 500 + fy
    fz = fy - lab[..., 2] / 200
    eps = 0.206897
    def _f_inv(t):
        return np.where(t > eps, t ** 3, (t - 16 / 116) / 7.787)
    xyz = np.stack([_f_inv(fx), _f_inv(fy), _f_inv(fz)], axis=-1) * _D65
    lin = xyz @ _M_XYZ2RGB.T
    return np.clip(_linear_to_srgb(lin), 0.0, 1.0).astype(np.float32)


# ----- Smart palette discovery (weighted Lab k-means) ---------------------

def smart_palette(
    rgb: np.ndarray,
    k: int,
    sample: int = 30000,
    n_iter: int = 30,
    sat_weight: float = 3.0,
    edge_weight: float = 1.8,
    collapse_dE: float = 6.0,
    seed: int = 7,
) -> np.ndarray:
    """Pick a perceptually-good palette of k inks.

    Improvements over plain k-means:
      - Operates in CIE Lab (perceptually uniform → clustering matches what the eye sees)
      - Samples weighted by per-pixel saturation + edge magnitude so subjects beat backgrounds
      - Weights the centroid update too, so a small but vivid region (e.g. a green
        accent) keeps its own plate instead of drifting into a duller neighbour
      - Collapses near-duplicate centroids (ΔE < collapse_dE) so we don't waste plates
    """
    H, W, _ = rgb.shape
    flat_rgb = rgb.reshape(-1, 3).astype(np.float32)
    N = flat_rgb.shape[0]

    cmax = flat_rgb.max(axis=-1)
    cmin = flat_rgb.min(axis=-1)
    sat = np.where(cmax > 1e-6, (cmax - cmin) / np.maximum(cmax, 1e-6), 0.0)

    from scipy.ndimage import sobel
    luma = 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]
    gx = sobel(luma.astype(np.float32), axis=1)
    gy = sobel(luma.astype(np.float32), axis=0)
    edge = np.hypot(gx, gy)
    edge = edge / max(edge.max(), 1e-6)
    edge_flat = edge.ravel()

    weight = 1.0 + sat_weight * sat + edge_weight * edge_flat
    weight = weight / weight.sum()

    # Per-pixel importance (vivid + edgy pixels matter more). Used BOTH to draw
    # the sample and — crucially — to weight the centroid update below.
    importance = (1.0 + sat_weight * sat + edge_weight * edge_flat).astype(np.float32)

    rng = np.random.default_rng(seed)
    if N > sample:
        idx = rng.choice(N, size=sample, replace=True, p=weight)
        flat_rgb = flat_rgb[idx]
        samp_w = importance[idx]
    else:
        samp_w = importance

    flat_lab = rgb_to_lab(flat_rgb)

    # k-means++ init in Lab
    centroids = np.empty((k, 3), dtype=np.float32)
    centroids[0] = flat_lab[rng.integers(0, flat_lab.shape[0])]
    for i in range(1, k):
        d2 = np.min(((flat_lab[:, None, :] - centroids[None, :i, :]) ** 2).sum(-1), axis=1)
        probs = d2 / (d2.sum() + 1e-12)
        centroids[i] = flat_lab[rng.choice(flat_lab.shape[0], p=probs)]

    for _ in range(n_iter):
        d = ((flat_lab[:, None, :] - centroids[None, :, :]) ** 2).sum(-1)
        labels = np.argmin(d, axis=1)
        new = centroids.copy()
        for j in range(k):
            mask = labels == j
            if mask.any():
                w = samp_w[mask]
                new[j] = (flat_lab[mask] * w[:, None]).sum(axis=0) / w.sum()
        if np.allclose(new, centroids, atol=1e-3):
            break
        centroids = new

    # Collapse near-duplicate centroids (CIE76 ΔE < threshold)
    keep = list(range(k))
    for i in range(k):
        if i not in keep:
            continue
        for j in range(i + 1, k):
            if j not in keep:
                continue
            dE = float(np.sqrt(((centroids[i] - centroids[j]) ** 2).sum()))
            if dE < collapse_dE:
                keep.remove(j)
    centroids = centroids[keep]

    rgb_palette = lab_to_rgb(centroids)
    luma_inks = 0.2126 * rgb_palette[:, 0] + 0.7152 * rgb_palette[:, 1] + 0.0722 * rgb_palette[:, 2]
    order = np.argsort(luma_inks)
    return rgb_palette[order].astype(np.float32)


# ----- Highlight white pass -----------------------------------------------

def build_highlight_white(
    rgb: np.ndarray,
    alpha: np.ndarray | None,
    brightness_threshold: float = 0.85,
    max_saturation: float = 0.18,
    choke_px: int = 2,
) -> np.ndarray:
    """Find pixels that should print white ink ON TOP of the colors.

    A pixel needs highlight white when it's close to true white in the source —
    bright AND desaturated. Saturated bright colors (e.g. Pikachu's yellow)
    are correctly excluded; they're handled by their own ink plate.

    Choked more aggressively than the underbase since it's the LAST pass and
    registration error compounds across all preceding screens.
    """
    brightness = rgb.max(axis=-1)
    cmin = rgb.min(axis=-1)
    saturation = np.where(brightness > 1e-6, (brightness - cmin) / np.maximum(brightness, 1e-6), 0.0)
    mask = ((brightness > brightness_threshold) & (saturation < max_saturation)).astype(np.float32)
    if alpha is not None:
        mask = mask * (alpha > 0.5).astype(np.float32)
    if choke_px > 0:
        from scipy.ndimage import minimum_filter
        mask = minimum_filter(mask, size=2 * choke_px + 1, mode="constant", cval=0.0)
    return mask


# ----- Per-ink trapping (choke / spread) ----------------------------------

def auto_trap_values(inks: np.ndarray, strength_px: int) -> list[tuple[int, int]]:
    """Compute (choke, spread) in pixels for each ink based on its luminosity.

    Rule of thumb: darker inks spread into neighbors (so a registration miss
    overlaps invisibly), lighter inks choke (so they stay tucked inside the
    darker outline). Returns one (choke_px, spread_px) tuple per ink.
    """
    if strength_px <= 0:
        return [(0, 0)] * len(inks)
    luma = 0.2126 * inks[:, 0] + 0.7152 * inks[:, 1] + 0.0722 * inks[:, 2]
    out: list[tuple[int, int]] = []
    for L in luma:
        spread = int(round(strength_px * (1.0 - float(L))))
        choke = int(round(strength_px * float(L) * 0.5))
        out.append((choke, spread))
    return out


def apply_trap(channel: np.ndarray, choke_px: int, spread_px: int) -> np.ndarray:
    """Erode (choke) then dilate (spread) a continuous-tone coverage channel."""
    if choke_px == 0 and spread_px == 0:
        return channel
    from scipy.ndimage import minimum_filter, maximum_filter
    out = channel
    if spread_px > 0:
        out = maximum_filter(out, size=2 * spread_px + 1, mode="constant", cval=0.0)
    if choke_px > 0:
        out = minimum_filter(out, size=2 * choke_px + 1, mode="constant", cval=0.0)
    return out


# ----- Palette discovery (k-means in RGB — legacy) ------------------------

def kmeans_palette(rgb: np.ndarray, k: int, n_iter: int, sample: int, seed: int) -> np.ndarray:
    """
    rgb: (H, W, 3) float32 in [0,1]
    Returns (k, 3) float32 ink colors in [0,1], roughly sorted dark -> light.
    """
    flat = rgb.reshape(-1, 3)
    rng = np.random.default_rng(seed)
    if flat.shape[0] > sample:
        idx = rng.choice(flat.shape[0], size=sample, replace=False)
        flat = flat[idx]

    # k-means++ init
    centroids = np.empty((k, 3), dtype=np.float32)
    first = rng.integers(0, flat.shape[0])
    centroids[0] = flat[first]
    for i in range(1, k):
        d2 = np.min(((flat[:, None, :] - centroids[None, :i, :]) ** 2).sum(-1), axis=1)
        total = float(d2.sum())
        if total <= 0.0 or not np.isfinite(total):
            # Remaining points coincide with chosen centroids (flat / few-color
            # art). k-means++ has nothing left to weight by — pick uniformly.
            choice = int(rng.integers(0, flat.shape[0]))
        else:
            probs = (d2 / total).astype(np.float64)
            probs /= probs.sum()              # kill float32 rounding drift
            choice = int(rng.choice(flat.shape[0], p=probs))
        centroids[i] = flat[choice]

    for _ in range(n_iter):
        # Assign
        d = ((flat[:, None, :] - centroids[None, :, :]) ** 2).sum(-1)  # (N, k)
        labels = np.argmin(d, axis=1)
        # Update
        new = centroids.copy()
        for j in range(k):
            mask = labels == j
            if mask.any():
                new[j] = flat[mask].mean(axis=0)
        if np.allclose(new, centroids, atol=1e-4):
            break
        centroids = new

    # Sort by luminance (dark first — prints in that order)
    luma = 0.2126 * centroids[:, 0] + 0.7152 * centroids[:, 1] + 0.0722 * centroids[:, 2]
    order = np.argsort(luma)
    return centroids[order]


def parse_palette(spec: str) -> np.ndarray:
    """Accepts '#rrggbb,#rrggbb,...' or 'r,g,b,r,g,b,...' (0-255)."""
    spec = spec.strip()
    if "#" in spec:
        parts = [p.strip().lstrip("#") for p in spec.split(",") if p.strip()]
        rgbs = []
        for hx in parts:
            if len(hx) == 3:
                hx = "".join(c * 2 for c in hx)
            r, g, b = int(hx[0:2], 16), int(hx[2:4], 16), int(hx[4:6], 16)
            rgbs.append([r / 255.0, g / 255.0, b / 255.0])
        return np.asarray(rgbs, dtype=np.float32)
    nums = [float(x) for x in spec.replace(";", ",").split(",") if x.strip()]
    arr = np.asarray(nums, dtype=np.float32).reshape(-1, 3) / 255.0
    return arr


# ----- Solid (spot) assignment -------------------------------------------

def solid_separation(
    rgb: np.ndarray,
    inks: np.ndarray,
    alpha: np.ndarray | None = None,
) -> np.ndarray:
    """Hard nearest-ink assignment in CIE Lab.

    Every pixel is mapped to the single closest ink at 100% coverage (one-hot),
    so each plate prints SOLID — no halftone dots, crisp edges. This is true
    "spot color" separation, the right choice for logos / flat vector art where
    a black background must stay solid black rather than screening into a dot
    field. Gradients posterize into steps (add inks for finer steps).

    Returns (H, W, K) coverages in {0, 1}.
    """
    H, W, _ = rgb.shape
    lab = rgb_to_lab(rgb).reshape(-1, 3)
    ink_lab = rgb_to_lab(inks)                               # (K, 3)
    N, K = lab.shape[0], inks.shape[0]
    # Assign the nearest ink in chunks. The full (N, K, 3) distance array is
    # N*K*3*4 bytes — over 1 GiB on large / AI-upscaled art — so do it in
    # blocks to keep peak memory to a few hundred MB regardless of image size.
    labels = np.empty(N, dtype=np.intp)
    CHUNK = 1_000_000
    for s in range(0, N, CHUNK):
        e = min(s + CHUNK, N)
        d = ((lab[s:e, None, :] - ink_lab[None, :, :]) ** 2).sum(-1)  # (chunk, K)
        labels[s:e] = np.argmin(d, axis=1)
    cov = np.zeros((N, K), dtype=np.float32)
    cov[np.arange(N), labels] = 1.0
    cov = cov.reshape(H, W, K)
    if alpha is not None:
        cov = cov * alpha[..., None]
    return cov


# ----- Linear unmixing ---------------------------------------------------

def unmix(
    rgb: np.ndarray,
    inks: np.ndarray,
    base: np.ndarray,
    iters: int,
    ink_budget: float,
) -> np.ndarray:
    """
    Solve per pixel:  min || sum_k c_k * (ink_k - base) - (pixel - base) ||^2
                      s.t.  c_k >= 0,  sum c_k <= ink_budget
    via projected gradient descent, vectorized over all pixels.

    rgb:  (H, W, 3) in [0,1]
    inks: (K, 3)    in [0,1]
    base: (3,)      in [0,1]   — color the paper / white underbase appears as
    Returns (H, W, K) coverages in [0,1].
    """
    H, W, _ = rgb.shape
    K = inks.shape[0]
    flat = rgb.reshape(-1, 3).astype(np.float32)
    N = flat.shape[0]

    A = (inks - base[None, :]).astype(np.float32)   # (K, 3)
    t = (flat - base[None, :]).astype(np.float32)   # (N, 3)

    # Lipschitz estimate for stable step size: L = 2 * largest eigval of A A^T.
    eig = np.linalg.eigvalsh(A @ A.T).max()
    step = 1.0 / max(eig, 1e-6)

    c = np.full((N, K), 1.0 / (K + 1), dtype=np.float32)

    for _ in range(iters):
        residual = c @ A - t                # (N, 3)
        grad = residual @ A.T               # (N, K)
        c = c - step * grad
        np.maximum(c, 0.0, out=c)
        s = c.sum(axis=1, keepdims=True)
        over = s > ink_budget
        if over.any():
            scale = np.where(over, ink_budget / np.maximum(s, 1e-9), 1.0)
            c = c * scale

    return c.reshape(H, W, K)


# ----- Halftone ----------------------------------------------------------

def halftone(channel: np.ndarray, angle_deg: float, dpi: int, lpi: int) -> np.ndarray:
    """Analytical Euclidean-dot screen. Returns uint8 in {0, 255} (255 = ink)."""
    h, w = channel.shape
    cell_px = dpi / lpi
    if cell_px < 2.0:
        raise ValueError(f"DPI/LPI ratio too low ({cell_px:.1f})")
    theta = np.deg2rad(angle_deg)
    ct, st = np.cos(theta), np.sin(theta)
    ys, xs = np.indices((h, w), dtype=np.float32)
    u = (xs * ct + ys * st) / cell_px
    v = (-xs * st + ys * ct) / cell_px
    spot = 0.5 * (np.cos(2.0 * np.pi * u) + np.cos(2.0 * np.pi * v))
    thresh = 1.0 - 2.0 * np.clip(channel, 0.0, 1.0)
    return ((spot >= thresh).astype(np.uint8)) * 255


def compensate_dot_gain(channel: np.ndarray, gain_pct: float) -> np.ndarray:
    if gain_pct <= 0:
        return channel
    g = gain_pct / 100.0
    bump = g * 4.0 * channel * (1.0 - channel)
    return np.clip(channel - bump, 0.0, 1.0)


# ----- White underbase ---------------------------------------------------

def build_underbase(coverages: np.ndarray, alpha: np.ndarray | None, thresh255: int, choke_px: int) -> np.ndarray:
    coverage = coverages.max(axis=-1)
    t = thresh255 / 255.0
    mask = (coverage > t).astype(np.float32)
    if alpha is not None:
        mask = mask * (alpha > t).astype(np.float32)
    if choke_px > 0:
        from scipy.ndimage import minimum_filter
        mask = minimum_filter(mask, size=2 * choke_px + 1, mode="constant", cval=0.0)
    return mask


# ----- Preview composite -------------------------------------------------

def composite_preview(
    halftones: list[np.ndarray],
    inks: np.ndarray,
    underbase: np.ndarray | None,
    dark_garment: bool,
) -> Image.Image:
    h, w = halftones[0].shape
    bg = np.array([30, 30, 30], dtype=np.float32) if dark_garment else np.array([245, 245, 245], dtype=np.float32)
    canvas = np.broadcast_to(bg, (h, w, 3)).astype(np.float32).copy()

    if underbase is not None:
        wm = (underbase > 0).astype(np.float32)[..., None]
        canvas = canvas * (1.0 - wm) + 255.0 * wm

    # Light inks last so highlights aren't buried — but for spot prints
    # actual print order is dark->light. Either way, layer by luminance.
    luma = 0.2126 * inks[:, 0] + 0.7152 * inks[:, 1] + 0.0722 * inks[:, 2]
    order = np.argsort(-luma)  # darkest first when layering -> light dots on top
    for i in order:
        dots = (halftones[i] > 0).astype(np.float32)[..., None]
        col = (inks[i] * 255.0).astype(np.float32)
        canvas = canvas * (1.0 - dots) + col * dots

    return Image.fromarray(np.clip(canvas, 0, 255).astype(np.uint8), mode="RGB")


def save_swatch(path: str, inks: np.ndarray) -> None:
    """Write a horizontal swatch strip showing the chosen palette."""
    n = inks.shape[0]
    cell = 120
    img = np.zeros((cell, cell * n, 3), dtype=np.uint8)
    for i, ink in enumerate(inks):
        img[:, i * cell:(i + 1) * cell, :] = (ink * 255.0).astype(np.uint8)
    Image.fromarray(img, mode="RGB").save(path)


# ----- I/O ---------------------------------------------------------------

def load_image(path: str) -> tuple[np.ndarray, np.ndarray | None]:
    img = Image.open(path)
    if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
        img = img.convert("RGBA")
        arr = np.asarray(img, dtype=np.float32) / 255.0
        return arr[..., :3], arr[..., 3]
    img = img.convert("RGB")
    return np.asarray(img, dtype=np.float32) / 255.0, None


def save_bitmap(path: str, bits: np.ndarray, dpi: int = 600) -> None:
    """Save 1-bit halftone as black-on-white film positive with DPI metadata
    embedded so Illustrator / Photoshop open it at the right physical size."""
    Image.fromarray(255 - bits, mode="L").convert("1").save(path, dpi=(dpi, dpi))


def save_contone(path: str, ch: np.ndarray, dpi: int = 600) -> None:
    out = ((1.0 - np.clip(ch, 0.0, 1.0)) * 255.0).astype(np.uint8)
    Image.fromarray(out, mode="L").save(path, dpi=(dpi, dpi))


def save_illustrator_pdf(
    path: str,
    halftones: list[np.ndarray],
    inks: np.ndarray,
    underbase: np.ndarray | None,
    highlight: np.ndarray | None,
    dpi: int,
    lpi: int,
    base_name: str = "artwork",
) -> None:
    """Write a multi-page PDF — one page per separation plate — that
    Adobe Illustrator can open with each page as a separate artboard.

    Page order matches the print order: underbase first, ink plates, then
    highlight white last. Each page is rendered at print-size physical
    dimensions (8.5 x 11 max — auto-scales if needed) so AI opens it at
    actual size.
    """
    pages: list[Image.Image] = []
    titles: list[str] = []

    def _make_page(bits: np.ndarray, title: str) -> Image.Image:
        # Film positive: black = ink fires, white = no ink.
        img = Image.fromarray(255 - bits, mode="L").convert("RGB")
        return img

    if underbase is not None:
        pages.append(_make_page(underbase, "White Underbase (prints FIRST)"))
        titles.append(f"{base_name} — White Underbase")

    for i, bits in enumerate(halftones):
        r, g, b = (inks[i] * 255).astype(int)
        angle = DEFAULT_ANGLES[i % len(DEFAULT_ANGLES)]
        pages.append(_make_page(bits, f"Ink {i+1}  #{r:02X}{g:02X}{b:02X}  ({angle:.1f}°  @ {lpi} LPI)"))
        titles.append(f"{base_name} — Ink {i+1} #{r:02X}{g:02X}{b:02X}")

    if highlight is not None:
        pages.append(_make_page(highlight, "Highlight White (prints LAST, on top)"))
        titles.append(f"{base_name} — Highlight White")

    if not pages:
        return

    pages[0].save(
        path,
        format="PDF",
        save_all=True,
        append_images=pages[1:],
        resolution=float(dpi),
        title=f"{base_name} separations",
        producer="Spot Color Separation Studio",
    )


# ----- CLI ---------------------------------------------------------------

def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("input")
    p.add_argument("--out", default="spot_seps")
    p.add_argument("--colors", type=int, default=6, help="number of spot inks")
    p.add_argument("--palette", default=None, help="explicit palette, e.g. '#ff0000,#0044ff,#222'")
    p.add_argument("--dpi", type=int, default=300)
    p.add_argument("--lpi", type=int, default=55)
    p.add_argument("--dark", action="store_true", help="dark garment: print white underbase first")
    p.add_argument("--light", action="store_true", help="light garment: no underbase, paper is white")
    p.add_argument("--choke", type=int, default=1)
    p.add_argument("--ub-threshold", type=int, default=8)
    p.add_argument("--ink-budget", type=float, default=0.95, help="max total ink coverage per pixel [0..1]")
    p.add_argument("--unmix-iters", type=int, default=120)
    p.add_argument("--dot-gain", type=float, default=18.0)
    p.add_argument("--saturation", type=float, default=0.7,
                   help="gamma on each ink channel after unmix (<1 saturates dominant inks; 1.0 disables)")
    p.add_argument("--winner-boost", type=float, default=0.4,
                   help="0..1 — push each pixel's dominant ink toward full coverage (set 0 for pure linear unmix)")
    p.add_argument("--suppress-below", type=float, default=0.08,
                   help="zero-out any per-ink coverage below this fraction (kills background speckle)")
    args = p.parse_args()

    if not (args.dark or args.light):
        args.dark = True  # default
    dark = args.dark and not args.light

    cfg = SpotConfig(
        n_colors=args.colors,
        dpi=args.dpi, lpi=args.lpi,
        dark_garment=dark,
        underbase_choke=args.choke,
        underbase_threshold=args.ub_threshold,
        unmix_iters=args.unmix_iters,
        dot_gain_pct=args.dot_gain,
        ink_budget=args.ink_budget,
        saturation=args.saturation,
        winner_boost=args.winner_boost,
        suppress_below=args.suppress_below,
    )

    os.makedirs(args.out, exist_ok=True)
    rgb, alpha = load_image(args.input)

    if args.palette:
        inks = parse_palette(args.palette)
        cfg.n_colors = inks.shape[0]
    else:
        inks = kmeans_palette(rgb, cfg.n_colors, cfg.kmeans_iters, cfg.sample_pixels, cfg.seed)

    # The base color is what shows through where no ink fires.
    # On dark garments after a solid white underbase: base = white.
    # On light garments (no underbase): base = paper white.
    base = np.array([1.0, 1.0, 1.0], dtype=np.float32)

    print(f"Unmixing {rgb.shape[1]}x{rgb.shape[0]} into {cfg.n_colors} inks...")
    coverages = unmix(rgb, inks, base, cfg.unmix_iters, cfg.ink_budget)

    if alpha is not None:
        coverages = coverages * alpha[..., None]

    # Suppress sub-threshold coverages first: linear unmix tends to spread
    # small amounts of every ink across every pixel (noise). Zeroing those
    # before boosting/gamma stops backgrounds from getting yellow speckle.
    if cfg.suppress_below > 0:
        coverages = np.where(coverages < cfg.suppress_below, 0.0, coverages)

    # Winner-take-most boost: opaque inks on a white underbase behave more
    # like assignment than additive blending. Bump each pixel's dominant ink
    # toward full coverage, then re-cap total ink.
    if cfg.winner_boost > 0:
        flat = coverages.reshape(-1, cfg.n_colors)
        dominant = np.argmax(flat, axis=1)
        rows = np.arange(flat.shape[0])
        max_vals = flat[rows, dominant]
        # Only boost where there's a clear winner (>0).
        boost_amt = cfg.winner_boost * (1.0 - max_vals)
        flat[rows, dominant] = np.minimum(1.0, max_vals + boost_amt)
        coverages = flat.reshape(coverages.shape)

    # Saturation gamma: lift midtones so dominant inks print solid.
    if cfg.saturation > 0 and cfg.saturation != 1.0:
        coverages = np.power(np.clip(coverages, 0.0, 1.0), cfg.saturation)

    # Re-cap total ink coverage after boosting.
    s = coverages.sum(axis=-1, keepdims=True)
    over = s > cfg.ink_budget
    if over.any():
        scale = np.where(over, cfg.ink_budget / np.maximum(s, 1e-9), 1.0)
        coverages = coverages * scale

    # Dot gain compensation per channel.
    coverages = np.stack([compensate_dot_gain(coverages[..., k], cfg.dot_gain_pct) for k in range(cfg.n_colors)], axis=-1)

    # White underbase (dark garments only).
    underbase = None
    if cfg.dark_garment:
        underbase = build_underbase(coverages, alpha, cfg.underbase_threshold, cfg.underbase_choke)

    base_name = os.path.splitext(os.path.basename(args.input))[0]

    # Palette swatch.
    save_swatch(os.path.join(args.out, f"{base_name}_palette.png"), inks)
    with open(os.path.join(args.out, f"{base_name}_palette.txt"), "w", encoding="utf-8") as f:
        for i, ink in enumerate(inks):
            r, g, b = (ink * 255).astype(int)
            f.write(f"ink{i+1}: rgb({r},{g},{b})  #{r:02x}{g:02x}{b:02x}  angle={DEFAULT_ANGLES[i % len(DEFAULT_ANGLES)]:.1f}\n")

    halftones = []
    for k in range(cfg.n_colors):
        ch = coverages[..., k]
        angle = DEFAULT_ANGLES[k % len(DEFAULT_ANGLES)]
        save_contone(os.path.join(args.out, f"{base_name}_ink{k+1}_contone.png"), ch)
        bits = halftone(ch, angle, cfg.dpi, cfg.lpi)
        halftones.append(bits)
        save_bitmap(os.path.join(args.out, f"{base_name}_ink{k+1}_halftone.png"), bits)

    if underbase is not None:
        save_contone(os.path.join(args.out, f"{base_name}_W_contone.png"), underbase)
        save_bitmap(os.path.join(args.out, f"{base_name}_W_solid.png"), (underbase > 0).astype(np.uint8) * 255)

    preview = composite_preview(halftones, inks, underbase, cfg.dark_garment)
    preview.save(os.path.join(args.out, f"{base_name}_preview.png"))

    print(f"Wrote {cfg.n_colors} ink plates + preview to {args.out}/")
    print("Palette (dark -> light):")
    for i, ink in enumerate(inks):
        r, g, b = (ink * 255).astype(int)
        ang = DEFAULT_ANGLES[i % len(DEFAULT_ANGLES)]
        print(f"  ink{i+1}: #{r:02x}{g:02x}{b:02x}   angle={ang:>5.1f} deg")
    print(f"DPI: {cfg.dpi}   LPI: {cfg.lpi}   garment: {'dark+underbase' if cfg.dark_garment else 'light'}")


if __name__ == "__main__":
    main()
