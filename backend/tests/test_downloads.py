"""Downloads must never hang: local server that answers, stalls, or trickles."""
from __future__ import annotations

import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from lits import archive, config  # noqa: E402


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        if self.path.startswith("/ok"):
            body = b"x" * 5000
            self.send_response(200); self.send_header("Content-Length", str(len(body))); self.end_headers()
            self.wfile.write(body)
        elif self.path.startswith("/stall"):
            time.sleep(5)
        elif self.path.startswith("/trickle"):
            self.send_response(200); self.send_header("Content-Length", "100000"); self.end_headers()
            for _ in range(100):
                try:
                    self.wfile.write(b"x" * 10); self.wfile.flush()
                except OSError:
                    return
                time.sleep(0.2)


@pytest.fixture()
def server(tmp_path, monkeypatch):
    srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    monkeypatch.setattr(config, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(config, "CUTOUT_READ_TIMEOUT", 1.0)
    monkeypatch.setattr(config, "CUTOUT_DEADLINE", 1.5)
    monkeypatch.setattr(archive, "_client", None)
    yield f"http://127.0.0.1:{srv.server_address[1]}"
    srv.shutdown()


def test_ok_is_cached(server):
    p, st = archive.fetch_cutout(f"{server}/ok/a.fits", 1, 2, 3)
    assert p.stat().st_size == 5000 and not st.cached
    p2, st2 = archive.fetch_cutout(f"{server}/ok/a.fits", 1, 2, 3)
    assert st2.cached and p2 == p


def test_stall_times_out(server):
    t0 = time.time()
    with pytest.raises(RuntimeError, match="ReadTimeout"):
        archive.fetch_cutout(f"{server}/stall/b.fits", 1, 2, 3, attempts=1)
    assert time.time() - t0 < 4


def test_trickle_hits_deadline(server):
    t0 = time.time()
    with pytest.raises(RuntimeError, match="still downloading"):
        archive.fetch_cutout(f"{server}/trickle/c.fits", 1, 2, 3, attempts=1)
    assert time.time() - t0 < 4
    assert not list(Path(config.CACHE_DIR, "cutouts").glob("*.fits"))  # nothing half-written kept
