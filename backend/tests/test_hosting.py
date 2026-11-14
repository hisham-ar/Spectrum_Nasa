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
