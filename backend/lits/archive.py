"""Find SPHEREx exposures (IRSA SIA2), group them into survey epochs, and
download cutouts with a disk cache."""
from __future__ import annotations

import hashlib
import io
import json
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

import httpx
import numpy as np
from astropy.io.votable import parse as parse_votable
from astropy.time import Time

from . import config


@dataclass
class Exposure:
    obs_id: str
    access_url: str
    collection: str
    release: str
    detector: int
    t_min: float        # MJD
    t_max: float        # MJD
    em_min_um: float | None = None
    em_max_um: float | None = None

    @property
    def t_mid(self) -> float:
        return 0.5 * (self.t_min + self.t_max)

    def iso(self) -> str:
        return Time(self.t_mid, format="mjd").isot[:19] + "Z"


@dataclass
class Epoch:
    detector: int
    release: str
    survey: int
    exposures: list[Exposure] = field(default_factory=list)

    @property
    def t_start(self) -> float:
        return min(e.t_min for e in self.exposures)

    @property
    def t_end(self) -> float:
        return max(e.t_max for e in self.exposures)

    @property
    def t_mid(self) -> float:
        return float(np.median([e.t_mid for e in self.exposures]))

    def summary(self) -> dict:
        return {
            "detector": self.detector, "release": self.release, "survey": self.survey,
            "date_start": Time(self.t_start, format="mjd").isot[:10],
            "date_end": Time(self.t_end, format="mjd").isot[:10],
            "n_exposures": len(self.exposures),
        }


# --- HTTP ----------------------------------------------------------------------

_client: httpx.Client | None = None


def client() -> httpx.Client:
    global _client
    if _client is None:
        _client = httpx.Client(timeout=config.HTTP_TIMEOUT, follow_redirects=True,
                               headers={"User-Agent": config.USER_AGENT},
                               limits=httpx.Limits(max_connections=config.MAX_PARALLEL_DOWNLOADS * 2))
    return _client


def _key(*parts) -> str:
    return hashlib.sha1("|".join(str(p) for p in parts).encode()).hexdigest()[:20]


# --- SIA2 ----------------------------------------------------------------------

def _col(table, *names):
    for n in names:
        if n in table.colnames:
            return table[n]
    return None


def query_collection(collection: str, ra: float, dec: float, radius_deg: float = 1 / 3600) -> list[Exposure]:
    params = {"COLLECTION": collection, "POS": f"CIRCLE {ra:.7f} {dec:.7f} {radius_deg:.7f}"}
    r = client().get(config.SIA2_URL, params=params)
    r.raise_for_status()
    vot = parse_votable(io.BytesIO(r.content), verify="ignore")
    table = vot.get_first_table().to_table()
    out: list[Exposure] = []
    if len(table) == 0:
        return out
    urls = _col(table, "access_url")
    bands = _col(table, "energy_bandpassname")
    tmin = _col(table, "t_min")
    tmax = _col(table, "t_max")
    obs = _col(table, "obs_id", "obs_publisher_did")
    emin = _col(table, "em_min")
    emax = _col(table, "em_max")
    for i in range(len(table)):
        url = str(urls[i])
        band = str(bands[i]) if bands is not None else ""
        if not url.lower().split("?")[0].endswith(".fits") or "SPHEREx-D" not in band:
            continue
        try:
            det = int(band.split("SPHEREx-D")[1][:1])
        except (IndexError, ValueError):
            continue
        t0 = float(tmin[i]) if tmin is not None else float("nan")
        t1 = float(tmax[i]) if tmax is not None else t0
        out.append(Exposure(
            obs_id=str(obs[i]) if obs is not None else Path(url).stem,
            access_url=url, collection=collection,
            release=config.release_label(collection), detector=det,
            t_min=t0, t_max=t1,
            em_min_um=float(emin[i]) * 1e6 if emin is not None and np.isfinite(emin[i]) else None,
            em_max_um=float(emax[i]) * 1e6 if emax is not None and np.isfinite(emax[i]) else None,
        ))
    return out


def find_exposures(ra: float, dec: float, use_cache: bool = True) -> tuple[list[Exposure], dict]:
    """All current SPHEREx exposures covering (ra, dec), every collection in
    config.COLLECTIONS, de-duplicated. Cached for config.QUERY_CACHE_SECONDS."""
    key = _key("sia2", round(ra, 5), round(dec, 5), ",".join(config.COLLECTIONS))
    path = config.CACHE_DIR / "queries" / f"{key}.json"
    if use_cache and path.exists() and time.time() - path.stat().st_mtime < config.QUERY_CACHE_SECONDS:
        blob = json.loads(path.read_text())
        return [Exposure(**e) for e in blob["exposures"]], blob["meta"]

    t0 = time.time()
    found: list[Exposure] = []
    per_collection: dict[str, int] = {}
    errors: dict[str, str] = {}
    for coll in config.COLLECTIONS:
        try:
            rows = query_collection(coll, ra, dec)
            per_collection[coll] = len(rows)
            found.extend(rows)
        except Exception as e:  # noqa: BLE001 - one dead collection must not kill the search
            errors[coll] = f"{type(e).__name__}: {e}"
    if errors and not found:
        raise RuntimeError(f"IRSA search failed: {errors}")

    # De-duplicate the same exposure appearing in two releases.
    rank = {r: i for i, r in enumerate(config.RELEASE_PREFERENCE)}
    best: dict[tuple[int, str], Exposure] = {}
    for e in found:
        k = (e.detector, _exposure_key(e))
        if k not in best or rank.get(e.release, 99) < rank.get(best[k].release, 99):
            best[k] = e
    exposures = sorted(best.values(), key=lambda e: (e.detector, e.t_min))
    meta = {
        "queried_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "seconds": round(time.time() - t0, 2),
        "per_collection": per_collection, "errors": errors,
        "collections": config.COLLECTIONS,
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"exposures": [asdict(e) for e in exposures], "meta": meta}))
    return exposures, meta


def _exposure_key(e: Exposure) -> str:
    # level2_2025W19_2B_0073_2D3_spx_l2b-v11-2025-163.fits -> 2025W19_2B_0073_2D3
    stem = Path(e.access_url.split("?")[0]).name
    parts = stem.split("_")
    if len(parts) >= 5 and parts[0] == "level2":
        return "_".join(parts[1:5])
    return f"{e.t_min:.6f}"


# --- epochs --------------------------------------------------------------------

def nominal_survey(mjd: float) -> int:
    t0 = Time(config.SURVEY_START).mjd
    return int((mjd - t0) // config.SURVEY_LENGTH_DAYS) + 1


def group_epochs(exposures: list[Exposure], detector: int) -> list[Epoch]:
    """One epoch = one detector, one release, one visit to this position.
    Visits are split where exposures are more than EPOCH_GAP_DAYS apart; a
    visit longer than EPOCH_MAX_SPAN_DAYS (deep fields) is split along the
    nominal 6-month survey windows."""
    exps = sorted((e for e in exposures if e.detector == detector), key=lambda e: e.t_min)
    clusters: list[list[Exposure]] = []
    for e in exps:
        if clusters and e.t_min - clusters[-1][-1].t_max <= config.EPOCH_GAP_DAYS:
            clusters[-1].append(e)
        else:
            clusters.append([e])
    groups: list[list[Exposure]] = []
    for c in clusters:
        if c[-1].t_max - c[0].t_min > config.EPOCH_MAX_SPAN_DAYS:
            by_survey: dict[int, list[Exposure]] = {}
            for e in c:
                by_survey.setdefault(nominal_survey(e.t_mid), []).append(e)
            groups.extend(by_survey[k] for k in sorted(by_survey))
        else:
            groups.append(c)
    epochs: list[Epoch] = []
    for g in groups:
        by_rel: dict[str, list[Exposure]] = {}
        for e in g:
            by_rel.setdefault(e.release, []).append(e)
        for rel, es in by_rel.items():
            ep = Epoch(detector=detector, release=rel, survey=0, exposures=es)
            ep.survey = nominal_survey(ep.t_mid)
            epochs.append(ep)
    epochs.sort(key=lambda ep: ep.t_mid)
    return epochs


def coverage(exposures: list[Exposure]) -> dict[int, list[dict]]:
    return {d: [ep.summary() for ep in group_epochs(exposures, d)] for d in config.DETECTORS}


# --- cutouts -------------------------------------------------------------------

@dataclass
class CutoutStats:
    url: str
    seconds: float
    bytes: int
    cached: bool


def cutout_url(access_url: str, ra: float, dec: float, size_arcmin: float) -> str:
    base = access_url.split("?")[0]
    return f"{base}?center={ra:.7f},{dec:.7f}&size={size_arcmin:.3f}arcmin"


def fetch_cutout(access_url: str, ra: float, dec: float, size_arcmin: float) -> tuple[Path, CutoutStats]:
    url = cutout_url(access_url, ra, dec, size_arcmin)
    path = config.CACHE_DIR / "cutouts" / f"{_key(url)}.fits"
    if path.exists() and path.stat().st_size > 0:
        return path, CutoutStats(url, 0.0, path.stat().st_size, True)
    t0 = time.time()
    last: Exception | None = None
    for attempt in range(3):
        try:
            r = client().get(url)
            r.raise_for_status()
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp = path.with_suffix(".part")
            tmp.write_bytes(r.content)
            tmp.replace(path)
            return path, CutoutStats(url, round(time.time() - t0, 2), len(r.content), False)
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"Cutout failed after 3 tries: {url}: {last}")


def fetch_many(exposures: list[Exposure], ra: float, dec: float, size_arcmin: float,
               progress: Callable[[int, int], None] | None = None) -> list[tuple[Exposure, Path, CutoutStats]]:
    out: list[tuple[Exposure, Path, CutoutStats]] = []
    done = 0
    with ThreadPoolExecutor(max_workers=config.MAX_PARALLEL_DOWNLOADS) as pool:
        futs = {pool.submit(fetch_cutout, e.access_url, ra, dec, size_arcmin): e for e in exposures}
        for fut in futs:
            e = futs[fut]
            try:
                p, s = fut.result()
                out.append((e, p, s))
            except Exception as ex:  # noqa: BLE001 - a missing exposure is reported, not fatal
                out.append((e, None, CutoutStats(str(ex), 0.0, 0, False)))  # type: ignore[arg-type]
            done += 1
            if progress:
                progress(done, len(exposures))
    return out
