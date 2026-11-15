"""Hosting safeguards: cache size caps and the busy guard (offline)."""
from __future__ import annotations

import os
import time

from fastapi.testclient import TestClient


def _touch(p, size, age):
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(b"\0" * size)
    t = time.time() - age
    os.utime(p, (t, t))


def test_prune_keeps_newest_cutouts(tmp_path, monkeypatch):
    from lits import config, housekeeping
    monkeypatch.setattr(config, "CACHE_DIR", tmp_path)
    for i in range(5):  # 5 files of 1 MB, file 0 oldest
        _touch(tmp_path / "cutouts" / f"c{i}.fits", 1_000_000, age=100 - i)
    monkeypatch.setattr(housekeeping, "CUTOUT_CACHE_MB", 2.5)
    r = housekeeping.prune_cache()
    left = sorted(p.name for p in (tmp_path / "cutouts").iterdir())
    assert r["cutouts_removed"] == 3
    assert left == ["c3.fits", "c4.fits"]


def test_prune_sequences_skips_active(tmp_path, monkeypatch):
    from lits import config, housekeeping
    monkeypatch.setattr(config, "CACHE_DIR", tmp_path)
    for i, name in enumerate(["busy", "old", "new"]):  # "busy" is the oldest
        _touch(tmp_path / "seq" / name / "frame_0.f32", 1_000_000, age=100 - i)
        os.utime(tmp_path / "seq" / name, (time.time() - (100 - i),) * 2)
    monkeypatch.setattr(housekeeping, "SEQ_CACHE_MB", 2.5)
    housekeeping.prune_cache(keep_sequences={"busy"})
    assert sorted(p.name for p in (tmp_path / "seq").iterdir()) == ["busy", "new"]


def test_no_limit_by_default(tmp_path, monkeypatch):
    from lits import config, housekeeping
    monkeypatch.setattr(config, "CACHE_DIR", tmp_path)
    _touch(tmp_path / "cutouts" / "a.fits", 3_000_000, age=10)
    monkeypatch.setattr(housekeeping, "CUTOUT_CACHE_MB", 0.0)
    assert housekeeping.prune_cache()["cutouts_removed"] == 0


def test_busy_guard_turns_new_searches_away(monkeypatch):
    from lits import api
    monkeypatch.setattr(api, "MAX_ACTIVE_JOBS", 1)
    monkeypatch.setattr(api, "_jobs", {"x": {"status": "building", "started": time.time()}})
    r = TestClient(api.app).get("/api/sequence", params={"ra": 10.0, "dec": 20.0})
    assert r.status_code == 503
    assert "busy" in r.json()["detail"]


def _http_error(code):
    import httpx
    req = httpx.Request("GET", "https://irsa.ipac.caltech.edu/SIA")
    return httpx.HTTPStatusError(f"{code}", request=req, response=httpx.Response(code, request=req))


def test_irsa_hiccup_is_retried(tmp_path, monkeypatch):
    from lits import archive, config
    monkeypatch.setattr(config, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(archive, "RETRY_WAITS", (0.0, 0.0))
    calls = {}
    def flaky(coll, ra, dec):
        calls[coll] = calls.get(coll, 0) + 1
        if calls[coll] == 1:
            raise _http_error(502)
        return []
    monkeypatch.setattr(archive, "query_collection", flaky)
    exps, meta = archive.find_exposures(10.0, 20.0, use_cache=False)
    assert meta["errors"] == {} and all(n == 2 for n in calls.values())


def test_irsa_down_gives_a_readable_message(tmp_path, monkeypatch):
    import pytest
    from lits import archive, config
    monkeypatch.setattr(config, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(archive, "RETRY_WAITS", (0.0, 0.0))
    def down(coll, ra, dec):
        raise _http_error(502)
    monkeypatch.setattr(archive, "query_collection", down)
    with pytest.raises(archive.ArchiveUnavailable) as ei:
        archive.find_exposures(10.0, 20.0, use_cache=False)
    msg = str(ei.value)
    assert "502" in msg and "IRSA" in msg and "{" not in msg


def test_main_collection_failure_is_not_shown_as_no_data(tmp_path, monkeypatch):
    """RR Lyrae: QR3 answered, DR1 failed. Detectors only DR1 covers must not read 'no data'."""
    import pytest
    from lits import archive, config
    monkeypatch.setattr(config, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(archive, "RETRY_WAITS", (0.0,))
    def dr1_down(coll, ra, dec):
        if coll == "spherex_dr1":
            raise _http_error(502)
        return []
    monkeypatch.setattr(archive, "query_collection", dr1_down)
    with pytest.raises(archive.ArchiveUnavailable):
        archive.find_exposures(10.0, 20.0, use_cache=False)


def test_deep_collection_failure_is_tolerated_but_not_cached(tmp_path, monkeypatch):
    from lits import archive, config
    monkeypatch.setattr(config, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(archive, "RETRY_WAITS", (0.0,))
    monkeypatch.setattr(archive, "_exposure_key", lambda e: "k")

    class E:  # stand-in with only what de-duplication and sorting read
        detector, release, t_min = 1, "QR3", 0.0

    def deep_down(coll, ra, dec):
        if coll.endswith("_deep"):
            raise _http_error(503)
        return [E()] if coll == "spherex_qr3" else []
    monkeypatch.setattr(archive, "query_collection", deep_down)
    exps, meta = archive.find_exposures(10.0, 20.0, use_cache=False)
    assert len(exps) == 1 and any(c.endswith("_deep") for c in meta["errors"])
    assert not (tmp_path / "queries").exists() or not any((tmp_path / "queries").iterdir())


def test_irsa_search_gives_up_within_deadline(tmp_path, monkeypatch):
    """A hanging IRSA must not keep visitors on 'Searching the archive' for minutes."""
    import httpx
    import pytest
    from lits import archive, config
    monkeypatch.setattr(config, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(archive, "RETRY_WAITS", (0.0, 0.0, 0.0))
    monkeypatch.setattr(archive, "SIA_TIMEOUT", 0.2)
    monkeypatch.setattr(archive, "SIA_DEADLINE", 0.5)
    calls = []
    def hang(coll, ra, dec):
        calls.append(coll)
        time.sleep(0.2)
        raise httpx.ReadTimeout("timed out")
    monkeypatch.setattr(archive, "query_collection", hang)
    t0 = time.time()
    with pytest.raises(archive.ArchiveUnavailable) as ei:
        archive.find_exposures(10.0, 20.0, use_cache=False)
    assert time.time() - t0 < 1.5
    assert "didn't respond in time" in str(ei.value)
