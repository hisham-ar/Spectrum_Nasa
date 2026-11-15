"""Find SPHEREx exposures (IRSA SIA2), group them into survey epochs, and
download cutouts with a disk cache."""
from __future__ import annotations

import hashlib
import io
import json
import os
import threading
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
    cloud_key: str | None = None   # "bucket/key" of the AWS S3 copy, from SIA2 cloud_access

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
    lower = {c.lower(): c for c in table.colnames}
    for n in names:
        if n in table.colnames:
            return table[n]
        if n.lower() in lower:
            return table[lower[n.lower()]]
    return None


class ArchiveUnavailable(RuntimeError):
    """IRSA didn't answer. Its message is written for visitors."""


RETRY_WAITS = (2.0, 5.0, 10.0)   # seconds before the 2nd, 3rd and 4th attempt
SIA_TIMEOUT = float(os.environ.get("LITS_SIA_TIMEOUT", "30"))     # one IRSA search normally takes a few s
SIA_DEADLINE = float(os.environ.get("LITS_SIA_DEADLINE", "70"))   # give up and say so after this long


def _retryable(e: Exception) -> bool:
    if isinstance(e, httpx.HTTPStatusError):
        return e.response.status_code >= 500 or e.response.status_code == 429
    return isinstance(e, httpx.TransportError)          # timeouts, dropped connections


def query_collection_retry(collection: str, ra: float, dec: float) -> list[Exposure]:
    """IRSA sometimes answers '502 Proxy Error' for a moment; ask again before giving up,
    but never keep a visitor on "Searching the archive" for more than about SIA_DEADLINE s."""
    t0 = time.monotonic()
    for attempt in range(len(RETRY_WAITS) + 1):
        try:
            return query_collection(collection, ra, dec)
        except Exception as e:  # noqa: BLE001
            wait = RETRY_WAITS[attempt] if attempt < len(RETRY_WAITS) else 0.0
            if (attempt == len(RETRY_WAITS) or not _retryable(e)
                    or time.monotonic() - t0 + wait + SIA_TIMEOUT > SIA_DEADLINE):
                raise
            time.sleep(wait)
    raise AssertionError("unreachable")


def _unavailable_text(errors: dict[str, Exception]) -> str:
    codes = sorted({e.response.status_code for e in errors.values() if isinstance(e, httpx.HTTPStatusError)})
    why = f"it answered with error {', '.join(map(str, codes))}" if codes else "it didn't respond in time"
    return (f"NASA's SPHEREx archive (IRSA) isn't answering right now: {why}. This is on IRSA's side "
            "and usually clears within a few minutes, so please try again shortly.")


def query_collection(collection: str, ra: float, dec: float, radius_deg: float = 1 / 3600) -> list[Exposure]:
    params = {"COLLECTION": collection, "POS": f"CIRCLE {ra:.7f} {dec:.7f} {radius_deg:.7f}"}
    r = client().get(config.SIA2_URL, params=params, timeout=SIA_TIMEOUT)
    r.raise_for_status()
    vot = parse_votable(io.BytesIO(r.content), verify="ignore")
    # FIELD names (ObsCore: access_url, t_min, ...), not their internal IDs
    table = vot.get_first_table().to_table(use_names_over_ids=True)
    out: list[Exposure] = []
    if len(table) == 0:
        return out
    urls = _col(table, "access_url")
    bands = _col(table, "energy_bandpassname")
    if urls is None or bands is None:
        raise RuntimeError(f"Unexpected SIA2 columns from {collection}: {table.colnames[:60]}")
    tmin = _col(table, "t_min")
    tmax = _col(table, "t_max")
    obs = _col(table, "obs_id", "obs_publisher_did")
    emin = _col(table, "em_min")
    emax = _col(table, "em_max")
    cloud = _col(table, "cloud_access")
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
            cloud_key=_cloud_key(cloud[i]) if cloud is not None else None,
        ))
    return out


def _cloud_key(value) -> str | None:
    try:
        aws = json.loads(str(value))["aws"]
        return f"{aws['bucket_name']}/{aws['key']}"
    except Exception:  # noqa: BLE001 - missing/empty: fall back to the IBE-path mapping
        return None


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
    failures: dict[str, Exception] = {}
    # Ask IRSA about every collection at once (one after another took 7-13 s).
    with ThreadPoolExecutor(max_workers=len(config.COLLECTIONS)) as pool:
        futures = {coll: pool.submit(query_collection_retry, coll, ra, dec) for coll in config.COLLECTIONS}
    for coll, fut in futures.items():               # keep the collection order stable
        try:
            rows = fut.result()
            per_collection[coll] = len(rows)
            found.extend(rows)
        except Exception as e:  # noqa: BLE001 - one dead collection must not kill the search
            errors[coll] = f"{type(e).__name__}: {e}"
            failures[coll] = e
    # A half answer must not look like a whole one: if a main collection (DR1, QR3) failed, or
    # nothing came back while something failed, "no data" would be a false statement.
    main_failed = [c for c in failures if not c.endswith("_deep")]
    if main_failed or (failures and not found):
        raise ArchiveUnavailable(_unavailable_text(failures))

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
    if not errors:   # an incomplete answer is used once but never cached, so the next search asks again
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


def cutout_path(url: str) -> Path:
    return config.CACHE_DIR / "cutouts" / f"{_key(url)}.fits"


def is_cached(access_url: str, ra: float, dec: float, size_arcmin: float) -> bool:
    p = cutout_path(cutout_url(access_url, ra, dec, size_arcmin))
    return p.exists() and p.stat().st_size > 0


def _download(url: str, path: Path) -> int:
    """Stream to disk with a read timeout and an overall deadline."""
    t0 = time.time()
    timeout = httpx.Timeout(config.CUTOUT_READ_TIMEOUT, connect=20.0, pool=None)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(f".{threading.get_ident()}.part")
    n = 0
    try:
        with client().stream("GET", url, timeout=timeout) as r:
            r.raise_for_status()
            with open(tmp, "wb") as fh:
                for chunk in r.iter_bytes():  # yields as data arrives, so the deadline is checked
                    fh.write(chunk)
                    n += len(chunk)
                    if time.time() - t0 > config.CUTOUT_DEADLINE:
                        raise TimeoutError(f"cutout still downloading after {config.CUTOUT_DEADLINE:.0f} s")
        if n == 0:
            raise RuntimeError("empty response")
        tmp.replace(path)
        return n
    finally:
        if tmp.exists():
            tmp.unlink()


def fetch_cutout(access_url: str, ra: float, dec: float, size_arcmin: float,
                 attempts: int = 3) -> tuple[Path, CutoutStats]:
    url = cutout_url(access_url, ra, dec, size_arcmin)
    path = cutout_path(url)
    if path.exists() and path.stat().st_size > 0:
        return path, CutoutStats(url, 0.0, path.stat().st_size, True)
    t0 = time.time()
    last: Exception | None = None
    for attempt in range(attempts):
        try:
            n = _download(url, path)
            return path, CutoutStats(url, round(time.time() - t0, 2), n, False)
        except Exception as e:  # noqa: BLE001
            last = e
            if attempt < attempts - 1:
                time.sleep(3.0 * (attempt + 1))
    raise RuntimeError(f"{type(last).__name__}: {last}")


def cloud_cache_path(e: Exposure, ra: float, dec: float, size_arcmin: float) -> Path:
    # "v2": files written before FLAGS decompression was handled are ignored
    return config.CACHE_DIR / "cutouts" / f"s3v2_{_key('v2', e.access_url.split('?')[0], round(ra, 7), round(dec, 7), round(size_arcmin, 3))}.fits"


def is_cached_exposure(e: Exposure, ra: float, dec: float, size_arcmin: float) -> bool:
    if is_cached(e.access_url, ra, dec, size_arcmin):
        return True
    p = cloud_cache_path(e, ra, dec, size_arcmin)
    return p.exists() and p.stat().st_size > 0


def fetch_exposure(e: Exposure, ra: float, dec: float, size_arcmin: float,
                   attempts: int = 3) -> tuple[Path, CutoutStats]:
    """Cutout for one exposure from the cache, the AWS S3 copy, or IRSA's
    cutout service (config.CUTOUT_SOURCE decides the order)."""
    from . import cloud  # local import keeps archive importable without it

    ibe = cutout_path(cutout_url(e.access_url, ra, dec, size_arcmin))
    if ibe.exists() and ibe.stat().st_size > 0:
        return ibe, CutoutStats(str(ibe), 0.0, ibe.stat().st_size, True)
    cp = cloud_cache_path(e, ra, dec, size_arcmin)
    if cp.exists() and cp.stat().st_size > 0:
        return cp, CutoutStats(str(cp), 0.0, cp.stat().st_size, True)
    errors = []
    if config.CUTOUT_SOURCE in ("auto", "cloud"):
        t0 = time.time()
        for attempt in range(attempts):
            try:
                n = cloud.fetch(e.access_url, ra, dec, size_arcmin, cp, e.cloud_key, client())
                return cp, CutoutStats("s3:" + e.access_url, round(time.time() - t0, 2), n, False)
            except cloud.NotOnDetector:
                raise
            except Exception as ex:  # noqa: BLE001
                errors.append(f"S3: {type(ex).__name__}: {ex}")
                if attempt < attempts - 1:
                    time.sleep(2.0 * (attempt + 1))
    if config.CUTOUT_SOURCE in ("auto", "irsa"):
        try:
            return fetch_cutout(e.access_url, ra, dec, size_arcmin, attempts=attempts if config.CUTOUT_SOURCE == "irsa" else 1)
        except Exception as ex:  # noqa: BLE001
            errors.append(f"IRSA cutout: {ex}")
    raise RuntimeError(" | ".join(errors)[:400])


def fetch_many(exposures: list[Exposure], ra: float, dec: float, size_arcmin: float,
               progress: Callable[[int, int], None] | None = None) -> list[tuple[Exposure, Path, CutoutStats]]:
    out: list[tuple[Exposure, Path, CutoutStats]] = []
    done = 0
    failed: list[Exposure] = []
    with ThreadPoolExecutor(max_workers=config.MAX_PARALLEL_DOWNLOADS) as pool:
        futs = {pool.submit(fetch_exposure, e, ra, dec, size_arcmin): e for e in exposures}
        for fut in futs:
            e = futs[fut]
            try:
                p, s = fut.result()
                out.append((e, p, s))
                done += 1
                if progress:
                    progress(done, len(exposures))
            except Exception:  # noqa: BLE001 - retried below, one at a time
                failed.append(e)
    # Second pass, one at a time: Gate A lost 6 of 35 cutouts in parallel.
    for e in failed:
        try:
            p, s = fetch_exposure(e, ra, dec, size_arcmin, attempts=2)
            out.append((e, p, s))
        except Exception as ex:  # noqa: BLE001 - a missing exposure is reported, not fatal
            out.append((e, None, CutoutStats(f"{type(ex).__name__}: {ex}", 0.0, 0, False)))  # type: ignore[arg-type]
        done += 1
        if progress:
            progress(done, len(exposures))
    return out
