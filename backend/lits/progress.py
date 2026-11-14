"""Progress for long builds: a one-line bar in the terminal with elapsed time
and an ETA, plus a JSON status file anyone (or Claude) can read meanwhile."""
from __future__ import annotations

import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path


def _fmt(sec: float) -> str:
    sec = int(max(sec, 0))
    h, rem = divmod(sec, 3600)
    m, s = divmod(rem, 60)
    return f"{h}h{m:02d}m" if h else f"{m}m{s:02d}s"


class BuildProgress:
    """Counts work in cutouts; cached cutouts are free, so the ETA uses the
    measured speed of real downloads only."""

    def __init__(self, total: int, already_cached: int, status_file: Path, title: str):
        self.total = max(total, 1)
        self.cached0 = already_cached
        self.done = already_cached
        self.failed = 0
        self.t0 = time.time()
        self.status_file = status_file
        self.title = title
        self.current = ""
        self.finished_jobs: list[dict] = []
        self._last_write = 0.0
        status_file.parent.mkdir(parents=True, exist_ok=True)

    def eta(self) -> float | None:
        fetched = self.done - self.cached0
        left = self.total - self.done
        if fetched < 3:
            return None
        return (time.time() - self.t0) / fetched * left

    def step(self, n: int = 1, failed: int = 0) -> None:
        self.done = min(self.total, self.done + n)
        self.failed += failed
        self.render()

    def set_current(self, text: str) -> None:
        self.current = text
        self.render(force=True)

    def job_done(self, info: dict) -> None:
        self.finished_jobs.append(info)
        self.render(force=True, newline=True, note=info.get("line", ""))

    def render(self, force: bool = False, newline: bool = False, note: str = "") -> None:
        frac = self.done / self.total
        width = 28
        bar = "#" * int(frac * width) + "-" * (width - int(frac * width))
        eta = self.eta()
        line = (f"[{bar}] {frac * 100:5.1f}%  {self.done}/{self.total} cutouts"
                f"  {_fmt(time.time() - self.t0)} elapsed"
                f"  {'~' + _fmt(eta) + ' left' if eta is not None else 'estimating...'}"
                f"  | {self.current}")
        if note:
            sys.stdout.write("\r" + " " * 140 + "\r" + note + "\n")
        sys.stdout.write("\r" + line[:140].ljust(140))
        if newline and not note:
            sys.stdout.write("\n")
        sys.stdout.flush()
        now = time.time()
        if force or now - self._last_write > 2:
            self._last_write = now
            self.status_file.write_text(json.dumps({
                "title": self.title, "updated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "percent": round(frac * 100, 1), "done": self.done, "total": self.total,
                "cached_at_start": self.cached0, "failed": self.failed,
                "elapsed_s": round(now - self.t0), "eta_s": round(eta) if eta is not None else None,
                "current": self.current, "finished": self.finished_jobs,
            }, indent=1))

    def close(self, summary: str) -> None:
        self.current = "finished"
        self.render(force=True)
        sys.stdout.write("\n" + summary + "\n")
        sys.stdout.flush()
