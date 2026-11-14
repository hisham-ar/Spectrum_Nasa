"""Read SPHEREx cutouts straight from IRSA's public AWS S3 copy
(bucket nasa-irsa-spherex, us-east-1, no credentials needed).

Why: IRSA's cutout service takes 12-15 s per cutout (Gate A), 90% of each
cutout is the PSF layer we do not use, and it can be unavailable (HTTP 503).
Here we use HTTP range requests on the full MEF to fetch only:
  * the HDU headers, and
  * the rows of IMAGE, FLAGS, VARIANCE and ZODI that cover our field,
plus the tiny WCS-WAVE table, and write a small local MEF with the same
extension names and a shifted WCS, so the rest of the pipeline is unchanged.
"""
from __future__ import annotations

import io
import math
import time
from pathlib import Path

import httpx
import numpy as np
from astropy.io import fits
from astropy.wcs import WCS

from . import config

BUCKET = "nasa-irsa-spherex"
S3_BASE = f"https://{BUCKET}.s3.us-east-1.amazonaws.com/"
IBE_PREFIX = "/ibe/data/spherex/"
WANT = ("IMAGE", "FLAGS", "VARIANCE", "ZODI")
BLOCK = 2880


class NotOnDetector(Exception):
    """The requested field does not fall on this exposure."""


def s3_url(access_url: str, cloud_key: str | None = None) -> str:
    if cloud_key:
        bucket, key = cloud_key.split("/", 1)
        return f"https://{bucket}.s3.us-east-1.amazonaws.com/{key}"
    base = access_url.split("?")[0]
    if IBE_PREFIX not in base:
        raise ValueError(f"cannot map {base} to the S3 copy")
    return S3_BASE + base.split(IBE_PREFIX, 1)[1]


class _Ranged:
    def __init__(self, url: str, client: httpx.Client):
        self.url, self.client = url, client
        self.t0 = time.time()
        self.bytes = 0
        self.requests = 0
        self._cache: list[tuple[int, bytes]] = []   # (start, data) of header-sized reads

    def get(self, start: int, length: int) -> bytes:
        for c0, data in self._cache:                # served from an earlier header read?
            if c0 <= start and start + length <= c0 + len(data):
                return data[start - c0:start - c0 + length]
        data = self._fetch(start, length)
        if length <= 64 * BLOCK:
            self._cache.append((start, data))
        return data

    def _fetch(self, start: int, length: int) -> bytes:
        self.requests += 1
        if time.time() - self.t0 > config.CUTOUT_DEADLINE:
            raise TimeoutError(f"cloud read still running after {config.CUTOUT_DEADLINE:.0f} s")
        r = self.client.get(self.url, headers={"Range": f"bytes={start}-{start + length - 1}"},
                            timeout=httpx.Timeout(config.CUTOUT_READ_TIMEOUT, connect=20.0, pool=None))
        if r.status_code == 200 and start == 0:
            data = r.content[:length]          # server ignored Range (tiny files only)
        elif r.status_code == 206:
            data = r.content
        else:
            r.raise_for_status()
            raise RuntimeError(f"unexpected HTTP {r.status_code}")
        self.bytes += len(data)
        return data


def _read_header(rr: _Ranged, offset: int) -> tuple[fits.Header, int]:
    buf = b""
    pos = offset
    while True:
        chunk = rr.get(pos, BLOCK * 10)
        if not chunk:
            raise EOFError("end of file while reading a FITS header")
        start = len(buf) - len(buf) % 80
        buf += chunk
        pos += len(chunk)
        for i in range(start, len(buf) - 79, 80):
            if buf[i:i + 8] == b"END     ":
                hlen = ((i + 80 + BLOCK - 1) // BLOCK) * BLOCK
                return fits.Header.fromstring(buf[:i + 80].decode("ascii", "replace")), hlen
        if len(chunk) < BLOCK * 10:
            raise EOFError("no END card found")


def _data_bytes(h: fits.Header) -> int:
    naxis = h.get("NAXIS", 0)
    if naxis == 0:
        return 0
    n = 1
    for k in range(1, naxis + 1):
        n *= h[f"NAXIS{k}"]
    n = abs(h["BITPIX"]) // 8 * h.get("GCOUNT", 1) * (h.get("PCOUNT", 0) + n)
    return ((n + BLOCK - 1) // BLOCK) * BLOCK


_DT = {8: ">u1", 16: ">i2", 32: ">i4", 64: ">i8", -32: ">f4", -64: ">f8"}


def _rows(rr: _Ranged, h: fits.Header, data_off: int, y0: int, y1: int, x0: int, x1: int) -> np.ndarray:
    nx = h["NAXIS1"]
    bpp = abs(h["BITPIX"]) // 8
    raw = rr.get(data_off + y0 * nx * bpp, (y1 - y0 + 1) * nx * bpp)
    a = np.frombuffer(raw, dtype=_DT[h["BITPIX"]]).reshape(y1 - y0 + 1, nx)[:, x0:x1 + 1]
    bscale, bzero = h.get("BSCALE", 1), h.get("BZERO", 0)
    if h["BITPIX"] > 0:
        if bscale == 1 and bzero == 2 ** (8 * bpp - 1):      # unsigned-integer convention
            return (a.astype(np.int64) + bzero).astype(f"<u{bpp}")
        if bscale != 1 or bzero != 0:
            return a * bscale + bzero
        return a.astype(f"<i{bpp}") if bpp > 1 else a.astype(np.uint8)
    out = a.astype(f"<f{bpp}")
    return out * bscale + bzero if (bscale != 1 or bzero != 0) else out


def _is_compressed(h: fits.Header) -> bool:
    return str(h.get("XTENSION", "")).strip() == "BINTABLE" and bool(h.get("ZIMAGE", False))


def _decompressed(rr: _Ranged, hdr_off: int, data_off: int, h: fits.Header) -> tuple[np.ndarray, fits.Header]:
    """Tile-compressed HDU (the S3 copy stores FLAGS this way): fetch the whole
    compressed HDU and let astropy decompress it."""
    raw = rr.get(hdr_off, data_off - hdr_off) + rr.get(data_off, _data_bytes(h))
    buf = io.BytesIO(fits.PrimaryHDU().header.tostring().encode("ascii") + raw)
    with fits.open(buf) as hl:
        return np.array(hl[1].data), hl[1].header.copy()


def _shift_wcs(h: fits.Header, x0: int, y0: int) -> fits.Header:
    """Same sky, cut-out pixel origin: shift CRPIX of every WCS (incl. alt
    keys such as 'W' and 'A'). SIP and -TAB terms are relative to CRPIX."""
    h = h.copy()
    for k in list(h.keys()):
        if k.startswith("CRPIX1"):
            h[k] = h[k] - x0
        elif k.startswith("CRPIX2"):
            h[k] = h[k] - y0
    for k in ("NAXIS1", "NAXIS2", "BZERO", "BSCALE"):
        h.remove(k, ignore_missing=True)
    return h


def fetch(access_url: str, ra: float, dec: float, size_arcmin: float, path: Path,
          cloud_key: str | None = None, client: httpx.Client | None = None) -> int:
    """Write a small MEF (IMAGE, FLAGS, VARIANCE, ZODI, WCS-WAVE) covering a
    box of size_arcmin around (ra, dec) to `path`. Returns bytes fetched."""
    own = client is None
    client = client or httpx.Client(follow_redirects=True, headers={"User-Agent": config.USER_AGENT})
    rr = _Ranged(s3_url(access_url, cloud_key), client)
    try:
        # walk the HDUs: headers only, skipping data we do not need (e.g. the PSF)
        hdus: dict[str, tuple[fits.Header, int, int]] = {}   # name -> (header, header start, data start)
        rr.get(0, BLOCK * 20)                       # primary + IMAGE headers in one request
        primary, hlen = _read_header(rr, 0)
        off = hlen + _data_bytes(primary)
        for _ in range(12):
            try:
                h, hlen = _read_header(rr, off)
            except EOFError:
                break
            name = str(h.get("EXTNAME", "")).strip().upper()
            hdus[name] = (h, off, off + hlen)
            off += hlen + _data_bytes(h)
            if all(n in hdus for n in WANT) and "WCS-WAVE" in hdus:
                break
        missing = [n for n in WANT if n not in hdus]
        if missing:
            raise RuntimeError(f"S3 file has no {missing} extension(s): {sorted(hdus)}")

        img_h = hdus["IMAGE"][0]
        nx = img_h.get("ZNAXIS1", img_h["NAXIS1"]) if _is_compressed(img_h) else img_h["NAXIS1"]
        ny = img_h.get("ZNAXIS2", img_h["NAXIS2"]) if _is_compressed(img_h) else img_h["NAXIS2"]
        w = WCS(img_h, naxis=2)
        r = size_arcmin / 2 / 60
        ang = np.linspace(0, 2 * math.pi, 48, endpoint=False)
        cosd = max(math.cos(math.radians(dec)), 1e-3)
        ras = np.r_[ra, ra + r * np.cos(ang) / cosd]
        decs = np.r_[dec, dec + r * np.sin(ang)]
        px, py = w.world_to_pixel_values(ras, decs)
        x0 = max(int(math.floor(np.nanmin(px))) - 3, 0)
        x1 = min(int(math.ceil(np.nanmax(px))) + 3, nx - 1)
        y0 = max(int(math.floor(np.nanmin(py))) - 3, 0)
        y1 = min(int(math.ceil(np.nanmax(py))) + 3, ny - 1)
        if x1 <= x0 or y1 <= y0:
            raise NotOnDetector("field is off this exposure")

        out = [fits.PrimaryHDU(header=primary)]
        for name in WANT:
            h, hoff, doff = hdus[name]
            if _is_compressed(h):
                full, h = _decompressed(rr, hoff, doff, h)
                a = full[y0:y1 + 1, x0:x1 + 1]
            else:
                a = _rows(rr, h, doff, y0, y1, x0, x1)
            hh = _shift_wcs(h, x0, y0)
            for k in ("XTENSION", "PCOUNT", "GCOUNT", "EXTNAME"):
                hh.remove(k, ignore_missing=True)
            out.append(fits.ImageHDU(np.ascontiguousarray(a), header=hh, name=name))
        if "WCS-WAVE" in hdus:
            h, _, doff = hdus["WCS-WAVE"]
            raw = rr.get(doff, _data_bytes(h))
            tab = fits.BinTableHDU.fromstring(h.tostring().encode("ascii") + raw)
            tab.name = "WCS-WAVE"
            out.append(tab)
        out[1].header["LITSSRC"] = ("S3", "read from IRSA AWS S3 copy")
        out[1].header["LITSBOX"] = (f"{x0},{y0},{x1},{y1}", "parent pixel box x0,y0,x1,y1 (0-based)")
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".cloud.part")
        fits.HDUList(out).writeto(tmp, overwrite=True)
        tmp.replace(path)
        return rr.bytes
    finally:
        if own:
            client.close()
