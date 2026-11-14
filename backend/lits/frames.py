"""Build one viewer sequence: every epoch of one detector at one position,
co-added on one grid, rendered with one shared stretch, plus honest metadata.

The live API and the Featured build script both call build_sequence(), so the
judged demo and live search can never drift apart.
"""
from __future__ import annotations

import hashlib
import json
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

import numpy as np
from astropy.time import Time

from . import archive, coadd, config, render
from .resolve import Target

MAX_EXPOSURE_FRAMES = 80       # Exposures view cap (most recent kept)
SCHEMA_VERSION = 1

Progress = Callable[[str, int, int], None]


@dataclass
class Request:
    ra: float
    dec: float
    fov: float = 10.0
    det: int = 3
    view: str = "survey"           # "survey" or "exposures"
    target: Target | None = None   # named object -> moving centre + markers
    max_per_epoch: int = config.LIVE_MAX_EXPOSURES_PER_EPOCH  # sampled evenly in time

    def normalised(self) -> "Request":
        self.fov = float(min(max(self.fov, 1.0), config.FOV_MAX_ARCMIN))
        if self.det not in config.DETECTORS:
            raise ValueError("det must be 1-6")
        if self.view not in ("survey", "exposures"):
            raise ValueError("view must be 'survey' or 'exposures'")
        return self


def _even_sample(items: list, n: int) -> list:
    if len(items) <= n:
        return items
    idx = np.unique(np.round(np.linspace(0, len(items) - 1, n)).astype(int))
    return [items[i] for i in idx]


def plan(req: Request) -> dict:
    """Cheap step: query IRSA and decide centre, grid and epochs (no downloads)."""
    req.normalised()
    tgt = req.target
    now = Time.now()
    qra, qdec = tgt.position_at(now) if tgt else (req.ra, req.dec)
    exposures, meta = archive.find_exposures(qra, qdec)

    if tgt is not None and tgt.moves and exposures:
        t_lo = min(e.t_min for e in exposures)
        t_hi = max(e.t_max for e in exposures)
        t_mid = Time(0.5 * (t_lo + t_hi), format="mjd")
        cra, cdec = tgt.position_at(t_mid)
        centre_note = (f"{tgt.name} position propagated with its proper motion to "
                       f"{t_mid.isot[:10]}, the middle of the available SPHEREx dates")
    else:
        cra, cdec = (qra, qdec)
        centre_note = ("Typed coordinates, used as given" if tgt is None or tgt.kind == "coords"
                       else f"{tgt.name} catalogue position (no proper motion listed)")

    epochs = archive.group_epochs(exposures, req.det)
    if req.view == "exposures":
        exps = sorted((e for e in exposures if e.detector == req.det), key=lambda e: e.t_min)
        exps = exps[-MAX_EXPOSURE_FRAMES:]
        units = [[e] for e in exps]
        labels = [{"release": e.release, "survey": archive.nominal_survey(e.t_mid)} for e in exps]
    else:
        units = [_even_sample(ep.exposures, req.max_per_epoch) for ep in epochs]
        labels = [{"release": ep.release, "survey": ep.survey,
                   "n_available": len(ep.exposures)} for ep in epochs]

    ids = ",".join(e.obs_id for u in units for e in u)  # the exposure list is part of the key
    key = hashlib.sha1(f"{cra:.5f}|{cdec:.5f}|{req.fov}|{req.det}|{req.view}|{ids}".encode()).hexdigest()[:16]
    return {"req": req, "centre": (cra, cdec), "centre_note": centre_note,
            "units": units, "labels": labels, "exposures": exposures,
            "meta": meta, "key": key,
            "coverage": archive.coverage(exposures)}


def build_sequence(req: Request, out_dir: Path | None = None, progress: Progress | None = None,
                   planned: dict | None = None) -> dict:
    t0 = time.time()
    p = planned or plan(req)
    req = p["req"]
    cra, cdec = p["centre"]
    out_dir = out_dir or (config.CACHE_DIR / "seq" / p["key"])
    seq_path = out_dir / "sequence.json"
    if seq_path.exists():
        return json.loads(seq_path.read_text())

    wcs_out, shape = coadd.target_grid(cra, cdec, req.fov)
    ny, nx = shape
    size = coadd.cutout_size_arcmin(req.fov)
    all_exps = [e for u in p["units"] for e in u]

    # 1. download (parallel, cached)
    stats: dict[str, archive.CutoutStats] = {}
    paths: dict[str, Path | None] = {}
    def _dl(done, total):
        if progress:
            progress("downloading", done, total)
    for e, path, st in archive.fetch_many(all_exps, cra, cdec, size, _dl):
        paths[e.obs_id] = path
        stats[e.obs_id] = st
    t_dl = time.time() - t0

    # 2. co-add each unit on the shared grid
    frames: list[coadd.Frame] = []
    used: list[list[archive.Exposure]] = []
    loaded_meta: list[list[dict]] = []
    for i, unit in enumerate(p["units"]):
        if progress:
            progress("combining", i, len(p["units"]))
        loaded, um, ul = [], [], []
        for e in unit:
            path = paths.get(e.obs_id)
            if path is None:
                ul.append({"obs_id": e.obs_id, "time": e.iso(), "error": f"download failed: {stats[e.obs_id].url[:200]}"})
                continue
            try:
                ex = coadd.load_exposure(path, cra, cdec)
            except Exception as err:  # noqa: BLE001 - a corrupt cutout is skipped and reported
                ul.append({"obs_id": e.obs_id, "error": str(err)})
                continue
            loaded.append(ex)
            um.append(e)
            ul.append({"obs_id": e.obs_id, "time": e.iso(), "wavelength_um": ex.wavelength_um,
                       "bandwidth_um": ex.bandwidth_um, "saturated_px": ex.n_sat,
                       "flagged_px": ex.n_flagged, "near_saturated_px": ex.n_near})
        frames.append(coadd.coadd(loaded, wcs_out, shape))
        used.append(um)
        loaded_meta.append(ul)

    keep = [i for i, f in enumerate(frames) if f.n_inputs > 0]
    if p["units"] and not keep:
        errs = [x.get("error") for ul in loaded_meta for x in ul if x.get("error")]
        raise RuntimeError(f"none of the {len(all_exps)} exposures could be used; first problem: {errs[0] if errs else 'unknown'}")
    lo, hi = render.shared_limits([frames[i].data for i in keep]) if keep else (0.0, 1.0)

    # 3. render + metadata
    det = req.det
    band = config.DETECTORS[det]["band"]
    out_frames = []
    tgt = req.target
    for j, i in enumerate(keep):
        f, unit, lab = frames[i], used[i], p["labels"][i]
        render.write_gray(out_dir / f"frame_{j}.png", f.data, lo, hi)
        render.write_mask(out_dir / f"mask_{j}.png", f.pixclass)
        np.save(out_dir / f"frame_{j}.npy", f.data)  # for difference / spectra tiers
        t_start = min(e.t_min for e in unit)
        t_end = max(e.t_max for e in unit)
        t_mid = float(np.median([e.t_mid for e in unit]))
        marker = None
        if tgt is not None and tgt.moves:
            mra, mdec = tgt.position_at(Time(t_mid, format="mjd"))
            x, y = wcs_out.world_to_pixel_values(mra, mdec)
            marker = {"x": float(x), "y": float(ny - 1 - y), "ra": mra, "dec": mdec}
        wls = [w for w in f.wavelengths_um if w is not None]
        d0 = Time(t_start, format="mjd").isot[:10]
        d1 = Time(t_end, format="mjd").isot[:10]
        if req.view == "exposures":
            when = Time(t_mid, format="mjd").isot[:16].replace("T", " ") + " UTC"
            wl_txt = f"{wls[0]:.2f} µm at the centre" if wls else f"{band[0]:.2f}–{band[1]:.2f} µm"
            summary = f"Exposure {when}, detector {det}, {wl_txt}, {lab['release']}"
        else:
            summary = (f"Survey {lab['survey']}, detector {det}, {band[0]:.2f}–{band[1]:.2f} µm, "
                       f"{len(unit)} exposure{'s' if len(unit) != 1 else ''}, {d0} to {d1}, {lab['release']}")
        out_frames.append({
            "index": j, "png": f"frame_{j}.png", "mask": f"mask_{j}.png",
            "release": lab["release"], "survey": lab["survey"],
            "date_start": d0, "date_end": d1,
            "time_mid": Time(t_mid, format="mjd").isot[:19] + "Z",
            "n_exposures": len(unit), "n_available": lab.get("n_available", len(unit)),
            "n_failed": sum(1 for x in loaded_meta[i] if "error" in x),
            "exposures": loaded_meta[i],
            "wavelength_range_um": [round(min(wls), 4), round(max(wls), 4)] if wls else None,
            "saturated_px": int((f.pixclass == coadd.SATURATED).sum()),
            "near_saturated_px": int((f.pixclass == coadd.NEAR_SATURATED).sum()),
            "flagged_px": int((f.pixclass == coadd.FLAGGED).sum()),
            "outside_px": int((f.pixclass == coadd.OUTSIDE).sum()),
            "marker": marker, "summary": summary,
        })

    comparability = _comparability(out_frames, band)
    seq = {
        "schema": SCHEMA_VERSION, "key": p["key"], "status": "ready",
        "request": {"ra": req.ra, "dec": req.dec, "fov": req.fov, "det": det, "view": req.view},
        "target": tgt.to_dict() if tgt else None,
        "centre": {"ra": cra, "dec": cdec, "note": p["centre_note"]},
        "grid": {"nx": nx, "ny": ny, "pixel_scale_arcsec": config.PIXEL_SCALE_ARCSEC,
                 "crval": [cra, cdec], "crpix": list(map(float, wcs_out.wcs.crpix)),
                 "cdelt": list(map(float, wcs_out.wcs.cdelt)), "orientation": "north up, east left"},
        "detector": {"id": det, "band_um": list(band), "label": config.DETECTORS[det]["label"]},
        "stretch": {"kind": "asinh", "a": config.ASINH_SOFTENING, "lo": lo, "hi": hi,
                    "percentiles": [config.STRETCH_LOW_PCT, config.STRETCH_HIGH_PCT],
                    "unit": "MJy/sr", "shared": True},
        "frames": out_frames,
        "coverage": p["coverage"],
        "comparability": comparability,
        "provenance": {
            "zodi_subtracted": True,
            "combine": "inverse-variance weighted mean" if req.view == "survey" else "single exposure",
            "saturation_flags": config.SATURATION_FLAGS, "masked_flags": config.BAD_FLAGS,
            "near_saturation_flags": config.NEAR_SATURATION_FLAGS,
            "reprojection": "bilinear onto a TAN grid at 6.15\"/px (astropy + reproject)",
            "collections": p["meta"].get("collections"), "queried_at": p["meta"].get("queried_at"),
            "built_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "source": "NASA/IPAC Infrared Science Archive (IRSA), SPHEREx spectral images",
        },
        "timings": {
            "query_s": p["meta"].get("seconds"), "download_s": round(t_dl, 2),
            "total_s": round(time.time() - t0, 2),
            "cutouts": len(stats),
            "cutout_mb": round(sum(s.bytes for s in stats.values()) / 1e6, 2),
            "cutouts_cached": sum(1 for s in stats.values() if s.cached),
        },
    }
    out_dir.mkdir(parents=True, exist_ok=True)
    seq_path.write_text(json.dumps(seq, indent=1, default=_json_default))
    return seq


def _json_default(o):
    if isinstance(o, np.generic):
        return o.item()
    if isinstance(o, np.ndarray):
        return o.tolist()
    raise TypeError(f"Object of type {type(o).__name__} is not JSON serializable")


def _comparability(frames: list[dict], band: tuple[float, float]) -> dict:
    notes = []
    releases = sorted({f["release"] for f in frames})
    mixed = len(releases) > 1
    if mixed:
        notes.append(f"Frames come from different releases ({', '.join(releases)}), which may use "
                     "different calibrations. Compare positions freely; treat brightness differences "
                     "between releases with caution.")
    mids = [np.mean(f["wavelength_range_um"]) for f in frames if f["wavelength_range_um"]]
    differs = bool(mids) and bool((max(mids) - min(mids)) > 0.25 * (band[1] - band[0]))
    if differs:
        notes.append("These frames mix noticeably different wavelengths within the detector band, "
                     "so they are not directly comparable for brightness.")
    if len(frames) == 1:
        notes.append("Only one usable epoch so far: Play and Compare are switched off.")
    if not frames:
        notes.append("No SPHEREx coverage here yet in the current releases.")
    return {"mixed_releases": mixed, "channel_mix_differs": differs, "notes": notes}
