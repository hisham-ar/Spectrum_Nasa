"""Keep the download cache from growing without limit on a hosted server.

On a PC the cache can grow freely (it is what makes repeat views instant). On a cloud
server the disk is small, and on Google Cloud Run it is held in memory, so a size cap is
set with environment variables:

    LITS_CUTOUT_CACHE_MB   raw SPHEREx cutouts (the big part, ~85 MB per new search)
    LITS_SEQ_CACHE_MB      finished frame sequences (~0.5 MB each)

0 or unset means no limit. The oldest files go first.
"""
from __future__ import annotations

import os
import shutil
import threading
from pathlib import Path

from . import config

CUTOUT_CACHE_MB = float(os.environ.get("LITS_CUTOUT_CACHE_MB", "0"))
SEQ_CACHE_MB = float(os.environ.get("LITS_SEQ_CACHE_MB", "0"))

_lock = threading.Lock()


def _prune_files(folder: Path, max_bytes: float) -> int:
    """Delete the oldest files in *folder* until it holds at most *max_bytes*."""
    if max_bytes <= 0 or not folder.exists():
        return 0
    files = []
    for p in folder.iterdir():
        try:
            if p.is_file():
                st = p.stat()
                files.append((st.st_mtime, st.st_size, p))
        except OSError:
            continue
    total = sum(s for _, s, _ in files)
    removed = 0
    for _, size, p in sorted(files):
        if total <= max_bytes:
            break
        try:
            p.unlink()
            total -= size
            removed += 1
        except OSError:
            pass
    return removed


def _dir_size(d: Path) -> int:
    n = 0
    for p in d.rglob("*"):
        try:
            if p.is_file():
                n += p.stat().st_size
        except OSError:
            pass
    return n


def _prune_sequences(folder: Path, max_bytes: float, keep: set[str]) -> int:
    """Delete whole sequence folders, oldest first, skipping any in *keep*."""
    if max_bytes <= 0 or not folder.exists():
        return 0
    dirs = []
    for d in folder.iterdir():
        if d.is_dir():
            try:
                dirs.append((d.stat().st_mtime, _dir_size(d), d))
            except OSError:
                continue
    total = sum(s for _, s, _ in dirs)
    removed = 0
    for _, size, d in sorted(dirs):
        if total <= max_bytes:
            break
        if d.name in keep:
            continue
        shutil.rmtree(d, ignore_errors=True)
        total -= size
        removed += 1
    return removed


def prune_cache(keep_sequences: set[str] | None = None) -> dict:
    """Apply the size caps. Safe to call after every search."""
    with _lock:
        return {
            "cutouts_removed": _prune_files(config.CACHE_DIR / "cutouts", CUTOUT_CACHE_MB * 1e6),
            "sequences_removed": _prune_sequences(config.CACHE_DIR / "seq", SEQ_CACHE_MB * 1e6,
                                                  keep_sequences or set()),
        }
