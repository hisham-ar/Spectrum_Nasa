# Lost in the Spectrum

A public SPHEREx sky explorer for NASA Space Apps Challenge 2026 (Planet X and SPHEREx).
Type a name or coordinates and step through real near-infrared SPHEREx images of that
patch, one survey at a time, to spot motion.

No AI or machine learning runs in the website. Every frame is real SPHEREx data,
labelled with its true dates, detector, wavelengths and data release.

## Hosting

The site runs on Render's free plan from `render.yaml`: the website and Featured frames as a static
site, live search as a small Python service. See [DEPLOY.md](DEPLOY.md), which also covers running
the whole thing as one Docker container.

## Quick start (Windows, VS Code terminal / PowerShell)

Needs Python 3.10 or newer.

```powershell
git clone https://github.com/hisham-ar/Spectrum_Nasa.git
cd Spectrum_Nasa
py -m venv .venv
.venv\Scripts\Activate.ps1          # if blocked: Set-ExecutionPolicy -Scope Process Bypass
pip install -r backend\requirements.txt
python -m pytest -q backend\tests   # offline checks, ~2 s
python backend\scripts\gate_a.py    # Gate A on real IRSA data
```

Gate A writes `backend\scripts\out\gate_a\side_by_side.png`, `blink.gif` and `report.json`.
Pass = Barnard's Star (circled) moves between the two frames and the background stars stay put.

### Pre-compute the Featured targets, then run the site

```powershell
python backend\scripts\build_featured.py --only barnard   # lead demo, all 6 detectors (~15 min cold)
python backend\scripts\build_featured.py --default-only    # every card, its default detector
cd backend
uvicorn lits.api:app --port 8000                           # then open http://localhost:8000
```

The backend serves the built site from `frontend\dist`, so Node is only needed to change the frontend
(`cd frontend; npm install; npm run build`).

### Gate A result (2026-11-14)

Barnard's Star, detector 3, 10′ field: 3 epochs per detector (Survey 1 DR1 Aug 2025, Survey 2 DR1 Mar–May 2026,
Survey 3 QR3 Aug 2026). Background-star offset between the first and last co-add 0.01 px; the saturated core moved
1.73 px north against a predicted 1.68 px. Cutouts take 12–15 s and 4.4 MB each (3.9 MB of that is the PSF layer),
so live searches sample up to 8 exposures per survey and Featured builds up to 24.

### Where the pixels come from

By default (`LITS_CUTOUT_SOURCE=auto`) cutouts are read from IRSA's public AWS S3 copy of SPHEREx
(bucket `nasa-irsa-spherex`) with HTTP range requests: only the headers and the rows of IMAGE, FLAGS,
VARIANCE and ZODI that cover the field are fetched, never the PSF layer. IRSA's cutout service is the
fallback (on 2026-11-14 it returned HTTP 503 for hours). Force one with `LITS_CUTOUT_SOURCE=cloud` or `irsa`.

Downloaded cutouts are cached in `%LOCALAPPDATA%\lits-cache` (outside OneDrive).
Set `LITS_CACHE_DIR` to put them elsewhere.

## Layout

```
backend/
  lits/config.py    collections, flag bits, detectors, survey windows (edit here for new releases)
  lits/resolve.py   names (CDS Sesame/SIMBAD), coordinates, proper-motion propagation
  lits/archive.py   IRSA SIA2 search, epoch grouping, cached cutout downloads
  lits/coadd.py     zodi subtraction, flag masking, reprojection, inverse-variance co-add
  lits/render.py    one shared asinh stretch per sequence, PNG output
  lits/frames.py    builds a viewer sequence (used by the API and the Featured build)
  scripts/gate_a.py Milestone 1 test
  tests/            offline tests on synthetic SPHEREx-layout files (test fixtures only)
frontend/           React + TypeScript viewer
```

## Data and credits

SPHEREx spectral images: NASA/IPAC Infrared Science Archive (IRSA), collections set in
`backend/lits/config.py`. Name resolution: CDS Sesame / SIMBAD. Full citations are on the
site's About & Data page.
