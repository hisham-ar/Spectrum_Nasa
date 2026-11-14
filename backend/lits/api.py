"""FastAPI backend. Run:  uvicorn lits.api:app --reload  (from backend/)

The browser never touches FITS: it gets finished PNG frames + JSON metadata.
"""
from __future__ import annotations

import hashlib
import threading
import time
import traceback
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from astropy.time import Time
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

import json

from . import archive, asteroids, config, frames
from .resolve import NotFoundError, ParseError, Target, resolve

app = FastAPI(title="Lost in the Spectrum API", version="0.1")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET"], allow_headers=["*"])

_targets: dict[str, tuple[float, Target]] = {}
_jobs: dict[str, dict] = {}
_lock = threading.Lock()
_pool = ThreadPoolExecutor(max_workers=2)
_last_query: dict = {}


def _resolve_cached(q: str) -> Target:
    k = q.strip().lower()
    hit = _targets.get(k)
    if hit and time.time() - hit[0] < 24 * 3600:
        return hit[1]
    t = resolve(q)
    _targets[k] = (time.time(), t)
    return t


@app.get("/api/health")
def health():
    return {"ok": True}


@app.get("/api/status")
def status():
    return {"collections": config.COLLECTIONS,
            "releases": sorted({config.release_label(c) for c in config.COLLECTIONS}),
            "last_query": _last_query or None,
            "fov_max_arcmin": config.FOV_MAX_ARCMIN,
            "detectors": {d: {"band_um": v["band"], "label": v["label"]} for d, v in config.DETECTORS.items()}}


@app.get("/api/resolve")
def api_resolve(q: str = Query(..., min_length=1, max_length=200)):
    try:
        t = _resolve_cached(q)
    except NotFoundError as e:
        raise HTTPException(404, str(e)) from e
    except ParseError as e:
        raise HTTPException(400, str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"Name service unavailable: {e}") from e
    d = t.to_dict()
    ra, dec = t.position_at(Time.now())
    d["position_now"] = {"ra": ra, "dec": dec, "date": Time.now().isot[:10]}
    return d


def _target_from(q: str | None, ra: float | None, dec: float | None) -> tuple[float, float, Target | None]:
    if q:
        try:
            t = _resolve_cached(q)
        except NotFoundError as e:
            raise HTTPException(404, str(e)) from e
        except ParseError as e:
            raise HTTPException(400, str(e)) from e
        except Exception as e:  # noqa: BLE001
            raise HTTPException(502, f"Name service unavailable: {e}") from e
        if t.kind == "coords":
            return t.ra, t.dec, None
        return t.ra, t.dec, t
    if ra is None or dec is None:
        raise HTTPException(400, "Give q (name or coordinates) or ra and dec")
    if not (0 <= ra < 360 and -90 <= dec <= 90):
        raise HTTPException(400, "RA must be in [0, 360) and Dec in [-90, +90]")
    return ra, dec, None


@app.get("/api/coverage")
def api_coverage(q: str | None = None, ra: float | None = None, dec: float | None = None):
    ra0, dec0, t = _target_from(q, ra, dec)
    if t is not None:
        ra0, dec0 = t.position_at(Time.now())
    try:
        exps, meta = archive.find_exposures(ra0, dec0)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"IRSA search failed: {e}") from e
    _last_query.update({"queried_at": meta.get("queried_at")})
    return {"ra": ra0, "dec": dec0, "coverage": archive.coverage(exps), "meta": meta,
            "latest_date": Time(max(e.t_max for e in exps), format="mjd").isot[:10] if exps else None}


def _run_job(jk: str, req: frames.Request):
    job = _jobs[jk]
    def progress(stage: str, done: int, total: int):
        job.update(stage=stage, done=done, total=total)
    try:
        job.update(stage="searching", done=0, total=0)
        planned = frames.plan(req)
        n = sum(len(u) for u in planned["units"])
        job.update(stage="downloading", done=0, total=n, key=planned["key"])
        seq = frames.build_sequence(req, progress=progress, planned=planned)
        job.update(status="ready", stage="ready", key=seq["key"])
    except Exception as e:  # noqa: BLE001
        job.update(status="error", error=f"{type(e).__name__}: {e}", trace=traceback.format_exc()[-2000:])


@app.get("/api/sequence")
def api_sequence(q: str | None = None, ra: float | None = None, dec: float | None = None,
                 fov: float = 10.0, det: int = 3, view: str = "survey"):
    ra0, dec0, t = _target_from(q, ra, dec)
    req = frames.Request(ra=ra0, dec=dec0, fov=fov, det=det, view=view, target=t)
    try:
        req.normalised()
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    jk = hashlib.sha1(f"{q}|{ra0:.6f}|{dec0:.6f}|{req.fov}|{det}|{view}".encode()).hexdigest()[:16]
    with _lock:
        job = _jobs.get(jk)
        if job and job["status"] == "error" and time.time() - job["started"] > 30:
            job = None  # allow a retry
        if job is None:
            job = {"status": "building", "stage": "queued", "done": 0, "total": 0, "started": time.time()}
            _jobs[jk] = job
            _pool.submit(_run_job, jk, req)
    if job["status"] == "ready":
        seq_path = config.CACHE_DIR / "seq" / job["key"] / "sequence.json"
        if seq_path.exists():
            return FileResponse(seq_path, media_type="application/json",
                                headers={"X-Base": f"/api/seq/{job['key']}/"})
    out = {k: v for k, v in job.items() if k != "trace"}
    out["elapsed_s"] = round(time.time() - job["started"], 1)
    return JSONResponse(out, status_code=202 if job["status"] == "building" else 502)


@app.get("/api/asteroids")
def api_asteroids(key: str, frame: int):
    if not key.isalnum():
        raise HTTPException(400, "bad key")
    d = config.CACHE_DIR / "seq" / key
    p = d / "sequence.json"
    if not p.exists():
        raise HTTPException(404, "unknown sequence")
    seq = json.loads(p.read_text())
    if not 0 <= frame < len(seq["frames"]):
        raise HTTPException(400, "bad frame")
    try:
        return asteroids.for_sequence_frame(seq, frame, d)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"JPL Small-Body Identification API unavailable: {e}") from e


@app.get("/api/seq/{key}/{name}")
def api_seq_file(key: str, name: str):
    if not key.isalnum() or "/" in name or ".." in name or not name.endswith((".png", ".json", ".f32")):
        raise HTTPException(400, "bad path")
    p = config.CACHE_DIR / "seq" / key / name
    if not p.exists():
        raise HTTPException(404, "not found")
    mt = "application/octet-stream" if name.endswith(".f32") else None
    return FileResponse(p, media_type=mt, headers={"Cache-Control": "public, max-age=86400"})


# --- built frontend (same origin, one deploy) -------------------------------------

_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if _DIST.exists():
    app.mount("/assets", StaticFiles(directory=_DIST / "assets"), name="assets")
    if (_DIST / "featured").exists():
        app.mount("/featured", StaticFiles(directory=_DIST / "featured"), name="featured")

    @app.get("/{path:path}")
    def spa(path: str):
        f = _DIST / path
        if path and f.is_file() and _DIST in f.resolve().parents:
            return FileResponse(f)
        return FileResponse(_DIST / "index.html")
