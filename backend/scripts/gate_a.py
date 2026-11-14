"""Gate A / Milestone 1 (blueprint section 13).

    python backend/scripts/gate_a.py            # Barnard's Star, detector 3, 10'
    python backend/scripts/gate_a.py --det 6 --fov 10

Does: SIA2 on every current collection around Barnard's Star's propagated
position -> group by survey and detector -> fetch detector-3 cutouts for the
earliest and latest epoch (timed, MB recorded) -> zodi-subtract, mask flags,
reproject, co-add -> one shared asinh stretch -> side-by-side PNG + blink GIF.

Pass = the star visibly shifts and the background stars do not. The script
also measures the background-star offset between the two co-adds numerically.
Paste the printed report back into the chat.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np  # noqa: E402
from astropy.io import fits  # noqa: E402
from astropy.time import Time  # noqa: E402
from PIL import Image, ImageDraw  # noqa: E402

from lits import archive, coadd, config, render  # noqa: E402
from lits.resolve import Target, resolve  # noqa: E402

# Used only if CDS Sesame cannot be reached (SIMBAD values, ICRS, epoch J2000).
BARNARD_FALLBACK = Target(kind="name", query="Barnard's Star", name="Barnard's Star",
                          ra=269.45207696, dec=4.69339089, pmra=-801.551, pmdec=10362.394,
                          plx=546.9759, rv=-110.11, otype="BY*", label="Star")


def background_offset(a: np.ndarray, b: np.ndarray, centre_mask_px: float) -> tuple[float, float, float]:
    """Sub-pixel shift between two frames from FFT cross-correlation, with the
    target area masked out. Returns (dx, dy, peak_significance)."""
    ny, nx = a.shape
    yy, xx = np.mgrid[:ny, :nx]
    r = np.hypot(xx - (nx - 1) / 2, yy - (ny - 1) / 2)
    def prep(z):
        z = np.where(np.isfinite(z), z, np.nanmedian(z))
        z = z - np.median(z)
        z[r < centre_mask_px] = 0.0
        z = np.clip(z, None, np.percentile(z, 99.7))
        return z * np.hanning(ny)[:, None] * np.hanning(nx)[None, :]
    A, B = np.fft.fft2(prep(a)), np.fft.fft2(prep(b))
    cc = np.fft.fftshift(np.real(np.fft.ifft2(A * np.conj(B))))
    py, px = np.unravel_index(np.argmax(cc), cc.shape)
    def sub(c, i, axis):
        if 0 < i < cc.shape[axis] - 1:
            if axis == 0:
                m, z, p = cc[i - 1, px], cc[i, px], cc[i + 1, px]
            else:
                m, z, p = cc[py, i - 1], cc[py, i], cc[py, i + 1]
            d = m - 2 * z + p
            return i + (0.5 * (m - p) / d if d != 0 else 0.0)
        return float(i)
    dy = sub(cc, py, 0) - ny // 2
    dx = sub(cc, px, 1) - nx // 2
    sig = float((cc.max() - np.median(cc)) / (np.std(cc) + 1e-12))
    return -dx, -dy, sig


def hdu_sizes(path: Path) -> dict[str, float]:
    out = {}
    with fits.open(path) as hdul:
        for h in hdul:
            n = h.size if hasattr(h, "size") else 0
            out[h.name or "PRIMARY"] = round(n * abs(h.header.get("BITPIX", 8)) / 8 / 1e6, 3)
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--target", default="Barnard's Star")
    ap.add_argument("--det", type=int, default=3)
    ap.add_argument("--fov", type=float, default=10.0)
    ap.add_argument("--out", default=str(Path(__file__).resolve().parent / "out" / "gate_a"))
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    report: dict = {"target": args.target, "detector": args.det, "fov_arcmin": args.fov,
                    "collections": config.COLLECTIONS, "cache_dir": str(config.CACHE_DIR)}
    T0 = time.time()

    # 1. resolve + propagate
    try:
        tgt = resolve(args.target)
        report["resolver"] = "CDS Sesame"
    except Exception as e:  # noqa: BLE001
        print(f"! Sesame failed ({e}); using built-in SIMBAD values")
        tgt = BARNARD_FALLBACK
        report["resolver"] = "fallback"
    print(f"Target: {tgt.name}  pm=({tgt.pmra}, {tgt.pmdec}) mas/yr  plx={tgt.plx}")
    qra, qdec = tgt.position_at(Time.now())

    # 2. SIA2
    t = time.time()
    exposures, meta = archive.find_exposures(qra, qdec, use_cache=False)
    report["sia2_seconds"] = round(time.time() - t, 2)
    report["sia2_per_collection"] = meta["per_collection"]
    report["sia2_errors"] = meta["errors"]
    print(f"\nSIA2: {len(exposures)} exposures in {report['sia2_seconds']} s  {meta['per_collection']}")
    if meta["errors"]:
        print(f"  errors: {meta['errors']}")
    report["epochs"] = {}
    for d in config.DETECTORS:
        eps = archive.group_epochs(exposures, d)
        report["epochs"][d] = [ep.summary() for ep in eps]
        line = "  ".join(f"S{ep.survey}/{ep.release}:{len(ep.exposures)} ({ep.summary()['date_start']})" for ep in eps)
        print(f"  D{d}: {len(eps)} epochs  {line}")

    eps = archive.group_epochs(exposures, args.det)
    if len(eps) < 2:
        print(f"\nFAIL (coverage): detector {args.det} has {len(eps)} epoch(s); need 2.")
        (out / "report.json").write_text(json.dumps(report, indent=1, default=str))
        return 2
    first, last = eps[0], eps[-1]

    # centre = propagated position at the middle of all available dates
    t_mid = Time(0.5 * (min(e.t_min for e in exposures) + max(e.t_max for e in exposures)), format="mjd")
    cra, cdec = tgt.position_at(t_mid)
    report["centre"] = {"ra": cra, "dec": cdec, "epoch": t_mid.isot[:10]}
    wcs_out, shape = coadd.target_grid(cra, cdec, args.fov)
    size = coadd.cutout_size_arcmin(args.fov)
    print(f"\nCentre {cra:.5f} {cdec:+.5f} (propagated to {t_mid.isot[:10]}); grid {shape[1]}x{shape[0]} px; cutout {size:.1f}'")

    # 3. cutouts, timed
    results = {}
    for name, ep in (("first", first), ("last", last)):
        exps = ep.exposures[:frames_cap()]
        t = time.time()
        got = archive.fetch_many(exps, cra, cdec, size)
        wall = time.time() - t
        st = [s for _, p, s in got if p is not None]
        fails = [s.url for _, p, s in got if p is None]
        per = [s.seconds for s in st if not s.cached]
        mb = [s.bytes / 1e6 for s in st]
        results[name] = (ep, got)
        report[f"cutouts_{name}"] = {
            "survey": ep.survey, "release": ep.release, "dates": [ep.summary()["date_start"], ep.summary()["date_end"]],
            "n": len(exps), "failed": len(fails), "wall_seconds": round(wall, 1),
            "seconds_per_cutout_median": round(float(np.median(per)), 2) if per else None,
            "mb_per_cutout_median": round(float(np.median(mb)), 2) if mb else None,
            "mb_total": round(sum(mb), 1),
        }
        print(f"Cutouts {name} (S{ep.survey}, {ep.release}, {len(exps)} exp): {wall:.1f} s wall, "
              f"median {report[f'cutouts_{name}']['seconds_per_cutout_median']} s and "
              f"{report[f'cutouts_{name}']['mb_per_cutout_median']} MB each, {len(fails)} failed")
        if fails:
            print(f"  first failure: {fails[0]}")

    sample = next((p for _, p, _ in results["first"][1] if p is not None), None)
    if sample is not None:
        report["hdu_mb"] = hdu_sizes(sample)
        print(f"HDU sizes (MB) of one cutout: {report['hdu_mb']}")

    # 4. co-add
    frames = {}
    for name, (ep, got) in results.items():
        t = time.time()
        loaded = [coadd.load_exposure(p, cra, cdec) for _, p, _ in got if p is not None]
        frames[name] = coadd.coadd(loaded, wcs_out, shape)
        wl = frames[name].wavelengths_um
        report[f"coadd_{name}"] = {
            "seconds": round(time.time() - t, 2), "inputs": frames[name].n_inputs,
            "wavelength_um": [round(min(wl), 3), round(max(wl), 3)] if wl else None,
            "saturated_px": int((frames[name].pixclass == coadd.SATURATED).sum()),
            "flagged_px": int((frames[name].pixclass == coadd.FLAGGED).sum()),
        }
    lo, hi = render.shared_limits([frames["first"].data, frames["last"].data])
    report["stretch"] = {"lo": lo, "hi": hi}

    # 5. alignment check + predicted motion
    t_first = Time(first.t_mid, format="mjd")
    t_last = Time(last.t_mid, format="mjd")
    p1 = wcs_out.world_to_pixel_values(*tgt.position_at(t_first))
    p2 = wcs_out.world_to_pixel_values(*tgt.position_at(t_last))
    pred = float(np.hypot(p2[0] - p1[0], p2[1] - p1[1]))
    dx, dy, sig = background_offset(frames["first"].data, frames["last"].data, centre_mask_px=12)
    report["predicted_target_shift_px"] = round(pred, 2)
    report["background_offset_px"] = {"dx": round(dx, 2), "dy": round(dy, 2), "significance": round(sig, 1)}
    print(f"\nPredicted {tgt.name} shift between epochs: {pred:.2f} px ({pred * config.PIXEL_SCALE_ARCSEC:.1f}\")")
    print(f"Background-star offset between co-adds: dx={dx:+.2f} dy={dy:+.2f} px (peak {sig:.0f} sigma)")

    # 6. images
    ims = []
    for name in ("first", "last"):
        p = out / f"{name}.png"
        render.write_gray(p, frames[name].data, lo, hi)
        ims.append(Image.open(p).convert("RGB"))
    scale = max(1, 480 // shape[0])
    big = [im.resize((im.width * scale, im.height * scale), Image.NEAREST) for im in ims]
    ny = shape[0]
    for im, pp, ep in zip(big, (p1, p2), (first, last)):
        dr = ImageDraw.Draw(im)
        x, y = pp[0] * scale + scale / 2, (ny - 1 - pp[1]) * scale + scale / 2
        dr.ellipse([x - 2.2 * scale, y - 2.2 * scale, x + 2.2 * scale, y + 2.2 * scale], outline=(0, 200, 255), width=2)
        s = ep.summary()
        dr.text((6, 6), f"S{ep.survey} {ep.release} D{args.det}  {s['date_start']}..{s['date_end']}  n={s['n_exposures']}",
                fill=(255, 220, 0))
    w, h = big[0].size
    sbs = Image.new("RGB", (w * 2 + 8, h), (40, 40, 40))
    sbs.paste(big[0], (0, 0))
    sbs.paste(big[1], (w + 8, 0))
    sbs.save(out / "side_by_side.png")
    big[0].save(out / "blink.gif", save_all=True, append_images=[big[1]], duration=1000, loop=0)

    report["total_seconds"] = round(time.time() - T0, 1)
    n_all = sum(len(ep.exposures) for ep in eps)
    per = report["cutouts_first"]["seconds_per_cutout_median"] or 0
    report["estimate_full_survey_view_s"] = round(n_all * per / config.MAX_PARALLEL_DOWNLOADS, 1)
    (out / "report.json").write_text(json.dumps(report, indent=1, default=str))

    aligned = abs(dx) < 0.5 and abs(dy) < 0.5 and sig > 5
    print(f"\nEstimated cold build of a full survey view (D{args.det}, {n_all} exposures): "
          f"~{report['estimate_full_survey_view_s']} s with {config.MAX_PARALLEL_DOWNLOADS} parallel downloads")
    print(f"Total {report['total_seconds']} s.  Output: {out}")
    print("\nNumeric alignment check:", "PASS (background offset < 0.5 px)" if aligned else
          "CHECK BY EYE (background offset >= 0.5 px or weak correlation)")
    print("Now open side_by_side.png and blink.gif: the circled star should move, background stars should not.")
    print("\n=== paste everything below into the chat ===")
    print(json.dumps(report, default=str))
    return 0


def frames_cap() -> int:
    return 24


if __name__ == "__main__":
    raise SystemExit(main())
