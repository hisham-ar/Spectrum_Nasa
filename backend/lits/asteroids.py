"""Known asteroids and comets in a frame, from the JPL Small-Body
Identification API (https://ssd-api.jpl.nasa.gov/doc/sb_ident.html).

SPHEREx is in low Earth orbit; we ask JPL for a geocentric observer (xobs of
zeros) because the API refuses mpc-code=500. The difference from SPHEREx's
true position is ~1 SPHEREx pixel for main-belt asteroids and more for
near-Earth objects, so every marker is labelled "predicted position".
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import httpx
from astropy import units as u
from astropy.coordinates import SkyCoord
from astropy.time import Time

from . import config

SB_IDENT_URL = "https://ssd-api.jpl.nasa.gov/sb_ident.api"
# Geocentric observer as a state vector (km, km/s). Override with a
# 3-character topocentric MPC code via LITS_SB_MPC_CODE if JPL rejects it.
import os
_MPC_CODE = os.environ.get("LITS_SB_MPC_CODE")


def _sexa(value_deg: float, hours: bool) -> str:
    v = value_deg / 15.0 if hours else value_deg
    sign = "M" if v < 0 else ""
    total = round(abs(v) * 3600, 2)
    if hours and total >= 24 * 3600:
        total -= 24 * 3600
    d = int(total // 3600)
    m = int((total - d * 3600) // 60)
    s = total - d * 3600 - m * 60
    return f"{sign}{d:02d}-{m:02d}-{s:05.2f}"


def query(ra: float, dec: float, fov_arcmin: float, mjd: float, vmag_lim: float = 21.0,
          client: httpx.Client | None = None) -> list[dict]:
    half_dec = fov_arcmin / 2 / 60
    half_ra = min(half_dec / max(math.cos(math.radians(dec)), 0.05), 10.0)
    params = {
        "obs-time": f"{Time(mjd, format='mjd').jd:.6f}",
        "fov-ra-center": _sexa(ra, hours=True),
        "fov-dec-center": _sexa(dec, hours=False),
        "fov-ra-hwidth": f"{half_ra:.5f}",
        "fov-dec-hwidth": f"{half_dec:.5f}",
        "two-pass": "true", "suppress-first-pass": "true", "req-elem": "false",
        "mag-required": "false", "vmag-lim": f"{vmag_lim}",
    }
    if _MPC_CODE:
        params["mpc-code"] = _MPC_CODE
    else:
        params["xobs"] = "0,0,0,0,0,0"
    own = client is None
    client = client or httpx.Client(timeout=config.HTTP_TIMEOUT, headers={"User-Agent": config.USER_AGENT})
    try:
        r = client.get(SB_IDENT_URL, params=params)
        r.raise_for_status()
        blob = r.json()
    finally:
        if own:
            client.close()
    return parse(blob)


def parse(blob: dict) -> list[dict]:
    fields = blob.get("fields_second") or []
    rows = blob.get("data_second_pass") or []
    out = []
    for row in rows:
        rec = dict(zip(fields, row))
        name = rec.get("Object name") or row[0]
        ra_s = next((v for k, v in rec.items() if k.startswith("Astrometric RA")), row[1])
        dec_s = next((v for k, v in rec.items() if k.startswith("Astrometric Dec")), row[2])
        try:
            dec_clean = str(dec_s).replace("'", " ").replace('"', " ").strip()
            c = SkyCoord(f"{ra_s} {dec_clean}", unit=(u.hourangle, u.deg))
        except Exception:  # noqa: BLE001
            continue
        vmag = next((v for k, v in rec.items() if k.startswith("Visual magnitude")), None)
        out.append({"name": str(name).strip(), "ra": float(c.ra.deg), "dec": float(c.dec.deg),
                    "vmag": _num(vmag)})
    return out


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def for_sequence_frame(seq: dict, frame_index: int, cache_dir: Path) -> dict:
    """Known small bodies for one frame of a built sequence, with pixel
    positions on the sequence grid (PNG coordinates, origin top-left)."""
    from .coadd import target_grid

    f = seq["frames"][frame_index]
    cache = cache_dir / f"asteroids_{frame_index}.json"
    if cache.exists():
        return json.loads(cache.read_text())
    mjd = Time(f["time_mid"].rstrip("Z"), format="isot", scale="utc").mjd
    cra, cdec = seq["centre"]["ra"], seq["centre"]["dec"]
    bodies = query(cra, cdec, seq["request"]["fov"], mjd)
    wcs, (ny, nx) = target_grid(cra, cdec, seq["request"]["fov"])
    for b in bodies:
        x, y = wcs.world_to_pixel_values(b["ra"], b["dec"])
        b["x"], b["y"] = float(x), float(ny - 1 - y)
    res = {"frame": frame_index, "time": f["time_mid"],
           "observer": f"MPC code {_MPC_CODE}" if _MPC_CODE else "geocentre",
           "note": "Predicted positions from JPL; SPHEREx orbits Earth, so expect about 1 pixel of offset (more for near-Earth objects).",
           "bodies": [b for b in bodies if -2 <= b["x"] <= nx + 1 and -2 <= b["y"] <= ny + 1]}
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(res))
    return res
