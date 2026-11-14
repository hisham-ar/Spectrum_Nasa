"""Offline tests. Synthetic FITS files mimic the SPHEREx MEF layout so the
pipeline can be checked without the network. They are test fixtures only and
never reach the website."""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest
from astropy.io import fits
from astropy.time import Time
from astropy.wcs import WCS

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from lits import archive, coadd, config, render  # noqa: E402
from lits.resolve import ParseError, Target, parse_coordinates, parse_sesame  # noqa: E402

RA0, DEC0 = 150.0, 10.0
SCALE = config.PIXEL_SCALE_ARCSEC / 3600


def make_wcs(rot_deg: float, n: int, dra_px=0.0, ddec_px=0.0) -> WCS:
    w = WCS(naxis=2)
    w.wcs.ctype = ["RA---TAN", "DEC--TAN"]
    w.wcs.crval = [RA0 + dra_px * SCALE / np.cos(np.radians(DEC0)), DEC0 + ddec_px * SCALE]
    w.wcs.crpix = [(n + 1) / 2, (n + 1) / 2]
    th = np.radians(rot_deg)
    w.wcs.cd = SCALE * np.array([[-np.cos(th), np.sin(th)], [np.sin(th), np.cos(th)]])
    return w


STARS = [(RA0 + 0.004, DEC0 + 0.006, 50.0), (RA0 - 0.007, DEC0 - 0.002, 30.0),
         (RA0 + 0.009, DEC0 - 0.008, 40.0), (RA0 - 0.003, DEC0 + 0.010, 25.0),
         (RA0 - 0.011, DEC0 + 0.004, 35.0)]


def write_mef(path: Path, wcs: WCS, n: int, mover: tuple[float, float], saturate=False, seed=0):
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[:n, :n]
    img = np.full((n, n), 0.5) + rng.normal(0, 0.02, (n, n))
    for ra, dec, amp in STARS + [(mover[0], mover[1], 80.0)]:
        x, y = wcs.world_to_pixel_values(ra, dec)
        img += amp * np.exp(-((xx - x) ** 2 + (yy - y) ** 2) / (2 * 0.9 ** 2))
    zodi = np.full((n, n), 0.45)
    flags = np.zeros((n, n), np.int32)
    flags[5, 5] = 1 << config.FLAG_BITS["HOT"]
    if saturate:
        x, y = map(float, wcs.world_to_pixel_values(*mover))
        flags[int(round(y)), int(round(x))] |= 1 << config.FLAG_BITS["NONLINEAR"]
    hdr = wcs.to_header()
    hdus = [fits.PrimaryHDU(),
            fits.ImageHDU(img.astype(np.float32), header=hdr, name="IMAGE"),
            fits.ImageHDU(flags, header=hdr, name="FLAGS"),
            fits.ImageHDU(np.full((n, n), 0.02 ** 2, np.float32), header=hdr, name="VARIANCE"),
            fits.ImageHDU(zodi.astype(np.float32), header=hdr, name="ZODI"),
            fits.ImageHDU(np.zeros((4, 8, 8), np.float32), name="PSF")]
    fits.HDUList(hdus).writeto(path, overwrite=True)


def brightest_near(frame, wcs_out, ra, dec, r=1):
    x, y = map(float, wcs_out.world_to_pixel_values(ra, dec))
    xi, yi = int(round(x)), int(round(y))
    sub = np.nan_to_num(frame[yi - r: yi + r + 1, xi - r: xi + r + 1], nan=-1)
    j, i = np.unravel_index(np.argmax(sub), sub.shape)
    return xi - r + i, yi - r + j


def test_coadd_aligns_background_and_shows_motion(tmp_path):
    n = 220
    mover_a = (RA0 + 0.0010, DEC0 + 0.0000)
    mover_b = (RA0 + 0.0010, DEC0 + 0.0030)   # moves ~1.75 px north
    a = []
    for k, rot in enumerate((0.0, 37.0, -61.0)):
        p = tmp_path / f"a{k}.fits"
        write_mef(p, make_wcs(rot, n, dra_px=3 * k, ddec_px=-2 * k), n, mover_a, seed=k)
        a.append(coadd.load_exposure(p, RA0, DEC0))
    b = []
    for k, rot in enumerate((112.0, 200.0)):
        p = tmp_path / f"b{k}.fits"
        write_mef(p, make_wcs(rot, n, dra_px=-4 * k, ddec_px=5 * k), n, mover_b, seed=10 + k)
        b.append(coadd.load_exposure(p, RA0, DEC0))
    wcs_out, shape = coadd.target_grid(RA0, DEC0, 5.0)
    fa, fb = coadd.coadd(a, wcs_out, shape), coadd.coadd(b, wcs_out, shape)
    assert fa.n_inputs == 3 and fb.n_inputs == 2
    # zodi removed: sky 0.5 minus zodi model 0.45 leaves 0.05, not 0.5
    assert abs(np.nanmedian(fa.data) - 0.05) < 0.01
    # background stars land on the same pixel in both epochs
    for ra, dec, _ in STARS:
        assert brightest_near(fa.data, wcs_out, ra, dec) == brightest_near(fb.data, wcs_out, ra, dec)
    # the mover lands where predicted in each epoch
    for f, m in ((fa, mover_a), (fb, mover_b)):
        x, y = map(float, wcs_out.world_to_pixel_values(*m))
        bx, by = brightest_near(f.data, wcs_out, *m)
        assert abs(bx - x) <= 1 and abs(by - y) <= 1


def test_saturated_pixels_are_masked_not_averaged(tmp_path):
    n = 160
    mover = (RA0, DEC0)
    exps = []
    for k, rot in enumerate((0.0, 45.0)):
        p = tmp_path / f"s{k}.fits"
        write_mef(p, make_wcs(rot, n), n, mover, saturate=(k == 0), seed=k)
        exps.append(coadd.load_exposure(p, RA0, DEC0))
    assert exps[0].n_sat >= 1 and exps[1].n_sat == 0
    wcs_out, shape = coadd.target_grid(RA0, DEC0, 5.0)
    f = coadd.coadd(exps, wcs_out, shape)
    x, y = map(float, wcs_out.world_to_pixel_values(*mover))
    near = f.pixclass[int(round(y)) - 2:int(round(y)) + 3, int(round(x)) - 2:int(round(x)) + 3]
    assert (near == coadd.SATURATED).any()
    assert np.isnan(f.data[f.pixclass == coadd.SATURATED]).all()


def test_render_shared_stretch(tmp_path):
    a = np.linspace(0, 10, 100).reshape(10, 10)
    lo, hi = render.shared_limits([a, a * 2])
    assert lo < hi
    render.write_gray(tmp_path / "x.png", a, lo, hi)
    render.write_mask(tmp_path / "m.png", np.zeros((10, 10), np.uint8))
    assert (tmp_path / "x.png").stat().st_size > 0


def _exp(det, mjd, rel="QR3", n=0):
    return archive.Exposure(obs_id=f"{det}-{mjd}-{n}", access_url=f"https://x/level2_W_{mjd}_{n}_2D{det}_spx.fits",
                            collection="spherex_qr3", release=rel, detector=det, t_min=mjd, t_max=mjd + 0.002)


def test_group_epochs_by_visit_and_survey():
    s1 = Time("2025-06-10").mjd
    s2 = Time("2025-12-12").mjd
    s3 = Time("2026-06-11").mjd
    exps = [_exp(3, s1 + i * 0.5, n=i) for i in range(6)] + \
           [_exp(3, s2 + i * 0.4, n=i) for i in range(5)] + \
           [_exp(3, s3 + i, "DR1", n=i) for i in range(3)] + [_exp(6, s1, n=99)]
    eps = archive.group_epochs(exps, 3)
    assert [len(e.exposures) for e in eps] == [6, 5, 3]
    assert [e.survey for e in eps] == [1, 2, 3]
    assert eps[2].release == "DR1"
    # a deep field visited every orbit for a year splits at survey boundaries
    deep = [_exp(1, s1 + d, n=d) for d in range(0, 360, 2)]
    eps = archive.group_epochs(deep, 1)
    assert len(eps) >= 2 and all(e.t_end - e.t_start <= config.SURVEY_LENGTH_DAYS + 1 for e in eps)


def test_parse_coordinates():
    assert parse_coordinates("133.759 -7.242") == (133.759, -7.242)
    assert parse_coordinates("133.759, -7.242") == (133.759, -7.242)
    ra, dec = parse_coordinates("08h55m02.3s -07d14m32s")
    assert abs(ra - 133.7596) < 1e-3 and abs(dec + 7.2422) < 1e-3
    ra, dec = parse_coordinates("17:57:47.1 +04:46:04")
    assert abs(ra - 269.4463) < 1e-3 and abs(dec - 4.7678) < 1e-3
    ra, dec = parse_coordinates("22 04 23 -56 48 02")
    assert abs(ra - 331.0958) < 1e-3
    assert parse_coordinates("Barnard's Star") is None
    assert parse_coordinates("WISE 0855-0714") is None
    assert parse_coordinates("eps Ind B") is None
    with pytest.raises(ParseError):
        parse_coordinates("400 10")
    with pytest.raises(ParseError):
        parse_coordinates("10 -95")


SESAME_SAMPLE = """<?xml version="1.0" encoding="UTF-8"?>
<Sesame><Target option="SNV"><name>Barnard</name>
<Resolver name="S=Simbad (CDS, via client/server)">
<otype>BY*</otype><jpos>17:57:48.49 +04:41:36.1</jpos>
<jradeg>269.45207696</jradeg><jdedeg>4.69339089</jdedeg>
<pm><v>10393.3</v><pmRA>-801.551</pmRA><pmDE>10362.394</pmDE></pm>
<plx><v>546.9759</v><e>0.0401</e></plx><Vel><v>-110.11</v></Vel>
<oname>Barnard's star</oname></Resolver></Target></Sesame>"""


def test_sesame_and_proper_motion():
    t = parse_sesame(SESAME_SAMPLE, "Barnard")
    assert t is not None and t.moves and t.label == "Star"
    assert t.name == "Barnard's star"
    from lits.resolve import clean_name
    assert clean_name("NAME Barnard's star") == "Barnard's star" and clean_name("V* RW Aur") == "RW Aur"
    ra, dec = t.position_at(Time("2026-01-01"))
    # ~26 years of ~10.4"/yr, mostly north: ~4.5' north of J2000
    assert 4.3 < (dec - t.dec) * 60 < 4.7
    assert (ra - t.ra) * 3600 * np.cos(np.radians(dec)) < 0  # drifts west
    c = Target(kind="coords", query="1 2", ra=1.0, dec=2.0)
    assert c.position_at(Time("2030-01-01")) == (1.0, 2.0)


def test_overflow_pixels_kept_but_marked(tmp_path):
    n = 160
    p = tmp_path / "o.fits"
    write_mef(p, make_wcs(0.0, n), n, (RA0, DEC0), seed=3)
    with fits.open(p, mode="update") as h:
        x, y = map(float, make_wcs(0.0, n).world_to_pixel_values(RA0, DEC0))
        h["FLAGS"].data[int(round(y)), int(round(x))] |= 1 << config.FLAG_BITS["OVERFLOW"]
    ex = coadd.load_exposure(p, RA0, DEC0)
    assert ex.n_near >= 1 and ex.n_sat == 0
    wcs_out, shape = coadd.target_grid(RA0, DEC0, 5.0)
    f = coadd.coadd([ex], wcs_out, shape)
    near = f.pixclass == coadd.NEAR_SATURATED
    assert near.any()
    assert np.isfinite(f.data[near]).all()   # used, not blanked
