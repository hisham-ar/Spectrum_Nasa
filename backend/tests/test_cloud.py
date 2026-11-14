"""Cloud reader: range requests on a full MEF must give the same frame as the full file."""
from __future__ import annotations

import re
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import httpx
import numpy as np
import pytest
from astropy.io import fits

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from lits import archive, cloud, coadd, config  # noqa: E402
import test_pipeline as tp  # noqa: E402

FILES: dict[str, bytes] = {}
SEEN: list[str] = []


class RangeHandler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        body = FILES.get(self.path)
        if body is None:
            self.send_response(404); self.end_headers(); return
        m = re.match(r"bytes=(\d+)-(\d+)", self.headers.get("Range", ""))
        if not m:
            self.send_response(200); self.send_header("Content-Length", str(len(body))); self.end_headers()
            self.wfile.write(body); return
        a, b = int(m.group(1)), min(int(m.group(2)), len(body) - 1)
        SEEN.append(self.headers["Range"])
        self.send_response(206)
        self.send_header("Content-Range", f"bytes {a}-{b}/{len(body)}")
        self.send_header("Content-Length", str(b - a + 1)); self.end_headers()
        self.wfile.write(body[a:b + 1])


def make_full(path: Path, n=600):
    w = tp.make_wcs(23.0, n)
    tp.STARS = [(tp.RA0 + 0.004, tp.DEC0 + 0.006, 50.0), (tp.RA0 - 0.007, tp.DEC0 - 0.002, 30.0)]
    tp.write_mef(path, w, n, (tp.RA0 + 0.001, tp.DEC0), saturate=True, seed=5)
    with fits.open(path) as h:
        hdus = [h[0].copy()]
        for name in ("IMAGE", "FLAGS", "VARIANCE", "ZODI"):
            x = h[name].copy()
            x.header["CRPIX1W"] = 10.0; x.header["CRPIX2W"] = 20.0
            hdus.append(x)
    flags = hdus[2].data.astype(np.uint32)
    hdus[2] = fits.ImageHDU(flags, header=hdus[2].header, name="FLAGS")   # BZERO=2**31 convention
    hdus.append(fits.ImageHDU(np.random.default_rng(0).normal(size=(121, 40, 40)).astype(np.float32), name="PSF"))
    col = fits.Column(name="VALUES", format="5E", array=np.arange(10, dtype=np.float32).reshape(2, 5))
    hdus.append(fits.BinTableHDU.from_columns([col], name="WCS-WAVE"))
    fits.HDUList(hdus).writeto(path, overwrite=True)


@pytest.fixture()
def server():
    srv = ThreadingHTTPServer(("127.0.0.1", 0), RangeHandler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_address[1]}"
    srv.shutdown()


def test_cloud_cutout_matches_full_file(tmp_path, server, monkeypatch):
    full = tmp_path / "full.fits"
    make_full(full)
    FILES["/bucket/dr1/level2/x/3/level2_X_2D3_spx.fits"] = full.read_bytes()
    monkeypatch.setattr(cloud, "s3_url", lambda access_url, key=None: f"{server}/bucket/dr1/level2/x/3/level2_X_2D3_spx.fits")
    SEEN.clear()
    mini = tmp_path / "mini.fits"
    with httpx.Client() as c:
        n = cloud.fetch("https://irsa.ipac.caltech.edu/ibe/data/spherex/dr1/level2/x/3/level2_X_2D3_spx.fits",
                        tp.RA0, tp.DEC0, 5.0 * 1.45 + 1, mini, client=c)
    assert n < full.stat().st_size / 3
    with fits.open(full) as h:
        ds = h["PSF"].fileinfo()["datLoc"]
        de = ds + 121 * 40 * 40 * 4
    starts = [int(re.match(r"bytes=(\d+)-", r).group(1)) for r in SEEN]
    assert not [s0 for s0 in starts if ds < s0 < de]   # no request starts inside the PSF data
    with fits.open(mini) as h:
        assert [x.name for x in h] == ["PRIMARY", "IMAGE", "FLAGS", "VARIANCE", "ZODI", "WCS-WAVE"]
        x0, y0, _, _ = map(int, h["IMAGE"].header["LITSBOX"].split(","))
        assert h["IMAGE"].header["CRPIX1W"] == 10.0 - x0 and h["IMAGE"].header["CRPIX2W"] == 20.0 - y0
        assert h["FLAGS"].data.dtype.kind == "u"
        assert h["IMAGE"].data.shape[0] < 600 and h["IMAGE"].data.shape[1] < 600
    a = coadd.load_exposure(full, tp.RA0, tp.DEC0)
    b = coadd.load_exposure(mini, tp.RA0, tp.DEC0)
    assert a.n_sat == b.n_sat >= 1
    wcs_out, shape = coadd.target_grid(tp.RA0, tp.DEC0, 5.0)
    fa, fb = coadd.coadd([a], wcs_out, shape), coadd.coadd([b], wcs_out, shape)
    assert np.array_equal(fa.pixclass, fb.pixclass)
    ok = np.isfinite(fa.data)
    assert np.allclose(fa.data[ok], fb.data[ok], atol=1e-6)


def test_ibe_path_maps_to_s3():
    u = "https://irsa.ipac.caltech.edu/ibe/data/spherex/dr1/level2/2026W12_1A/l2b-v27-2026-235/3/level2_2026W12_1A_0598_1D3_spx_l2b-v27-2026-235.fits"
    assert cloud.s3_url(u) == ("https://nasa-irsa-spherex.s3.us-east-1.amazonaws.com/dr1/level2/2026W12_1A/"
                               "l2b-v27-2026-235/3/level2_2026W12_1A_0598_1D3_spx_l2b-v27-2026-235.fits")
    assert cloud.s3_url(u, "nasa-irsa-spherex/qr3/k.fits").endswith("amazonaws.com/qr3/k.fits")
    assert archive._cloud_key('{"aws": {"bucket_name": "nasa-irsa-spherex", "key": "dr1/a.fits", "region": "us-east-1"}}') == "nasa-irsa-spherex/dr1/a.fits"
    assert archive._cloud_key("") is None
