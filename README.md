# Lost in the Spectrum

A public SPHEREx sky explorer for NASA Space Apps Challenge 2026 (Planet X and SPHEREx).
Type a name or coordinates and step through real near-infrared SPHEREx images of that
patch, one survey at a time, to spot motion.

No AI or machine learning runs in the website. Every frame is real SPHEREx data,
labelled with its true dates, detector, wavelengths and data release.

## Quick start (Windows, VS Code terminal / PowerShell)

Needs Python 3.10 or newer.

```powershell
cd "C:\Users\Hrafi\OneDrive\Desktop\VScode\coding stuffs\PutMyCodeProperly\ANasaSpaceApps\lost-in-the-spectrum"
py -m venv .venv
.venv\Scripts\Activate.ps1          # if blocked: Set-ExecutionPolicy -Scope Process Bypass
pip install -r backend\requirements.txt
python -m pytest -q backend\tests   # offline checks, ~2 s
python backend\scripts\gate_a.py    # Gate A on real IRSA data
```

Gate A writes `backend\scripts\out\gate_a\side_by_side.png`, `blink.gif` and `report.json`.
Pass = Barnard's Star (circled) moves between the two frames and the background stars stay put.

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
