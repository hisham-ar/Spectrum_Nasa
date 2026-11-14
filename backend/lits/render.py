"""Fixed-stretch PNG rendering. One set of limits per detector per sequence,
so brightness differences in playback are in the data, not the display."""
from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image

from . import config


def shared_limits(frames: list[np.ndarray]) -> tuple[float, float]:
    vals = np.concatenate([f[np.isfinite(f)].ravel() for f in frames if f is not None and np.isfinite(f).any()]) \
        if any(f is not None and np.isfinite(f).any() for f in frames) else np.array([0.0, 1.0])
    lo = float(np.percentile(vals, config.STRETCH_LOW_PCT))
    hi = float(np.percentile(vals, config.STRETCH_HIGH_PCT))
    if not np.isfinite(lo) or not np.isfinite(hi) or hi <= lo:
        hi = lo + 1.0
    return lo, hi


def asinh_u8(data: np.ndarray, lo: float, hi: float, a: float = config.ASINH_SOFTENING) -> np.ndarray:
    x = np.clip((np.nan_to_num(data, nan=lo) - lo) / (hi - lo), 0.0, 1.0)
    y = np.arcsinh(x / a) / np.arcsinh(1.0 / a)
    return np.round(y * 255.0).astype(np.uint8)


def write_gray(path: Path, data: np.ndarray, lo: float, hi: float) -> None:
    """FITS rows go bottom-up; PNG rows go top-down (north up, east left)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.flipud(asinh_u8(data, lo, hi)), mode="L").save(path, optimize=True)


def write_mask(path: Path, pixclass: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.flipud(pixclass.astype(np.uint8)), mode="L").save(path, optimize=True)


# Blue-orange diverging scale (colour-blind safe; never red-green)
_NEG = np.array([33, 102, 172], float)
_MID = np.array([247, 247, 247], float)
_POS = np.array([230, 97, 1], float)


def write_difference(path: Path, a: np.ndarray, b: np.ndarray, scale: float) -> None:
    d = b - a
    t = np.clip(np.nan_to_num(d) / max(scale, 1e-12), -1.0, 1.0)[..., None]
    rgb = np.where(t < 0, _MID + (-t) * (_NEG - _MID), _MID + t * (_POS - _MID))
    rgb[~np.isfinite(d)] = (0, 0, 0)
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.flipud(rgb.astype(np.uint8)), mode="RGB").save(path, optimize=True)


def write_rgb(path: Path, r: np.ndarray, g: np.ndarray, b: np.ndarray,
              lims: list[tuple[float, float]]) -> None:
    chans = [asinh_u8(c, lo, hi) for c, (lo, hi) in zip((r, g, b), lims)]
    rgb = np.stack(chans, axis=-1)
    bad = ~(np.isfinite(r) & np.isfinite(g) & np.isfinite(b))
    rgb[bad] = 0
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.flipud(rgb), mode="RGB").save(path, optimize=True)
