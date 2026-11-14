"""Turn SPHEREx exposure cutouts into one frame per epoch on a fixed grid.

Recipe (blueprint section 6): IMAGE - ZODI -> drop FLAGS-marked pixels ->
reproject onto one TAN grid -> inverse-variance weighted mean (or median).
Every step is conventional and deterministic; nothing is inferred or filled in.
"""
from __future__ import annotations

import math
import warnings
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from astropy.io import fits
from astropy.utils.exceptions import AstropyWarning
from astropy.wcs import WCS, FITSFixedWarning
from reproject import reproject_interp

from . import config

warnings.simplefilter("ignore", FITSFixedWarning)
warnings.simplefilter("ignore", AstropyWarning)
# SPHEREx headers carry SIP terms without "-SIP" in CTYPE; astropy applies them
# (which is what we want: Gate A measured 0.01 px background alignment) and
# logs an INFO note for every file. Keep the log readable.
from astropy import log as _astropy_log  # noqa: E402
_astropy_log.setLevel("WARNING")

# Output pixel classes (sent to the browser as a small mask PNG)
GOOD, SATURATED, FLAGGED, OUTSIDE, NEAR_SATURATED = 0, 1, 2, 3, 4


def target_grid(ra: float, dec: float, fov_arcmin: float) -> tuple[WCS, tuple[int, int]]:
    """North-up, east-left TAN grid at SPHEREx's native 6.15"/px."""
    scale = config.PIXEL_SCALE_ARCSEC / 3600.0
    n = int(math.ceil(fov_arcmin * 60.0 / config.PIXEL_SCALE_ARCSEC))
    n += (n + 1) % 2  # odd size so the centre is a pixel centre
    w = WCS(naxis=2)
    w.wcs.ctype = ["RA---TAN", "DEC--TAN"]
    w.wcs.crval = [ra, dec]
    w.wcs.crpix = [(n + 1) / 2.0, (n + 1) / 2.0]
    w.wcs.cdelt = [-scale, scale]
    w.wcs.cunit = ["deg", "deg"]
    w.wcs.radesys = "ICRS"
    return w, (n, n)


def cutout_size_arcmin(fov_arcmin: float) -> float:
    """Exposures arrive at any rotation; ask for enough to cover the square."""
    return fov_arcmin * 1.45 + 1.0


@dataclass
class LoadedExposure:
    path: Path
    data: np.ndarray          # IMAGE - ZODI, MJy/sr, bad pixels = NaN
    variance: np.ndarray
    saturated: np.ndarray     # bool
    flagged: np.ndarray       # bool (non-saturation bad pixels)
    near_sat: np.ndarray      # bool (OVERFLOW: kept, but tinted)
    wcs: WCS
    wavelength_um: float | None
    bandwidth_um: float | None
    n_sat: int
    n_flagged: int
    n_near: int
    header: dict = field(default_factory=dict)


def _hdu(hdul, name: str, index: int):
    try:
        return hdul[name]
    except KeyError:
        return hdul[index]


def load_exposure(path: Path, ra: float, dec: float) -> LoadedExposure:
    with fits.open(path, memmap=False) as hdul:
        img_h = _hdu(hdul, "IMAGE", 1)
        image = np.asarray(img_h.data, dtype=np.float64)
        flags = np.asarray(_hdu(hdul, "FLAGS", 2).data).astype(np.int64)
        var = np.asarray(_hdu(hdul, "VARIANCE", 3).data, dtype=np.float64)
        zodi = np.asarray(_hdu(hdul, "ZODI", 4).data, dtype=np.float64)
        header = img_h.header
        wcs = WCS(header, naxis=2)  # primary key: celestial WCS incl. SIP
        wl = bw = None
        try:
            x, y = wcs.world_to_pixel_values(ra, dec)
            swcs = WCS(header, fobj=hdul, key="W")
            swcs.sip = None
            wq, bq = swcs.pixel_to_world(x, y)
            wl = float(wq.to_value("um"))
            bw = float(bq.to_value("um"))
        except Exception:  # noqa: BLE001 - wavelength is metadata, not required for the image
            pass
        hdr = {k: header.get(k) for k in ("MJD-AVG", "MJD-OBS", "DATE-OBS", "DETECTOR", "VERSION") if k in header}

    sat = (flags & config.SATURATION_MASK) != 0
    bad = ((flags & config.BAD_MASK) != 0) & ~sat
    near = ((flags & config.NEAR_SATURATION_MASK) != 0) & ~sat & ~bad
    data = image - zodi
    unusable = sat | bad | ~np.isfinite(data) | ~np.isfinite(var) | (var <= 0)
    data[unusable] = np.nan
    var[unusable] = np.nan
    return LoadedExposure(path, data, var, sat, bad, near, wcs, wl, bw,
                          int(sat.sum()), int(bad.sum()), int(near.sum()), hdr)


@dataclass
class Frame:
    data: np.ndarray       # float32 on the target grid, NaN where unusable
    pixclass: np.ndarray   # uint8 GOOD/SATURATED/FLAGGED/OUTSIDE
    nexp: np.ndarray       # exposures contributing per pixel
    n_inputs: int
    wavelengths_um: list[float]


def coadd(exposures: list[LoadedExposure], wcs_out: WCS, shape: tuple[int, int],
          method: str = "ivar") -> Frame:
    ny, nx = shape
    stack_d, stack_w = [], []
    sat_any = np.zeros(shape, bool)
    near_any = np.zeros(shape, bool)
    covered = np.zeros(shape, bool)
    for ex in exposures:
        d, _ = reproject_interp((ex.data, ex.wcs), wcs_out, shape_out=shape, order="bilinear")
        v, _ = reproject_interp((ex.variance, ex.wcs), wcs_out, shape_out=shape, order="bilinear")
        # The mask has no NaNs, so its footprint is the true coverage (the data
        # footprint drops masked pixels, which would hide them as "outside").
        s, fp = reproject_interp((ex.saturated.astype(np.float32), ex.wcs), wcs_out,
                                 shape_out=shape, order="nearest-neighbor")
        inside = fp > 0
        covered |= inside
        sat_any |= inside & (np.nan_to_num(s) > 0.5)
        if ex.n_near:
            q, _ = reproject_interp((ex.near_sat.astype(np.float32), ex.wcs), wcs_out,
                                    shape_out=shape, order="nearest-neighbor")
            near_any |= inside & (np.nan_to_num(q) > 0.5)
        good = inside & np.isfinite(d) & np.isfinite(v) & (v > 0)
        stack_d.append(np.where(good, d, np.nan))
        stack_w.append(np.where(good, 1.0 / np.where(v > 0, v, np.inf), 0.0))
    if not stack_d:
        empty = np.full(shape, np.nan, np.float32)
        return Frame(empty, np.full(shape, OUTSIDE, np.uint8), np.zeros(shape, np.int16), 0, [])
    D = np.stack(stack_d)
    W = np.stack(stack_w)
    nexp = np.isfinite(D).sum(axis=0).astype(np.int16)
    with np.errstate(invalid="ignore", divide="ignore"):
        if method == "median":
            out = np.nanmedian(D, axis=0) if D.shape[0] > 0 else np.full(shape, np.nan)
        else:
            out = np.nansum(np.nan_to_num(D) * W, axis=0) / W.sum(axis=0)
    out = np.where(nexp > 0, out, np.nan)
    # A pixel saturated in any input is shown as saturated, never averaged in.
    out[sat_any] = np.nan
    cls = np.full(shape, GOOD, np.uint8)
    cls[~covered] = OUTSIDE
    cls[covered & (nexp == 0)] = FLAGGED
    cls[near_any & (nexp > 0)] = NEAR_SATURATED
    cls[sat_any] = SATURATED
    wls = [ex.wavelength_um for ex in exposures if ex.wavelength_um is not None]
    return Frame(out.astype(np.float32), cls, nexp, len(exposures), wls)


def single(ex: LoadedExposure, wcs_out: WCS, shape: tuple[int, int]) -> Frame:
    """One raw exposure on the shared grid (Exposures view)."""
    return coadd([ex], wcs_out, shape)
