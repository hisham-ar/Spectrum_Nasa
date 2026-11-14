"""Single place for every value that changes when SPHEREx releases new data.

Edit this file (not the code) when IRSA adds a release, retires a collection,
or when the team decides to mask a different set of flags.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone
from pathlib import Path

# --- IRSA -------------------------------------------------------------------

SIA2_URL = "https://irsa.ipac.caltech.edu/SIA"

# Current SPHEREx spectral-image collections. DR1 + QR3 together supersede QR2
# (QR2 is no longer searchable). The next release adds new names here.
COLLECTIONS: list[str] = os.environ.get(
    "LITS_COLLECTIONS",
    "spherex_dr1,spherex_dr1_deep,spherex_qr3,spherex_qr3_deep",
).split(",")

# Human label for a collection name, shown on every frame.
def release_label(collection: str) -> str:
    c = collection.lower()
    if c.startswith("spherex_dr1"):
        return "DR1"
    if c.startswith("spherex_qr3"):
        return "QR3"
    return c.replace("spherex_", "").upper()

# When the same exposure is in two collections, keep the first in this order.
RELEASE_PREFERENCE = ["DR1", "QR3"]

# --- Mission facts (IRSA data-products page; blueprint section 2) -------------

PIXEL_SCALE_ARCSEC = 6.15

DETECTORS: dict[int, dict] = {
    1: {"band": (0.75, 1.09), "label": "Just past red"},
    2: {"band": (1.10, 1.62), "label": "Near infrared"},
    3: {"band": (1.63, 2.41), "label": "Warm-star infrared"},
    4: {"band": (2.42, 3.82), "label": "Ices and dust"},
    5: {"band": (3.83, 4.41), "label": "CO₂ and cold objects"},
    6: {"band": (4.42, 5.00), "label": "Coldest objects"},
}

def bandpass_name(det: int) -> str:
    return f"SPHEREx-D{det}"

# All-sky survey operations began 2025-05-01; one all-sky survey per ~6 months.
# Survey numbers shown on screen are nominal (calendar windows from this date);
# the real date span of the exposures is always printed next to them.
SURVEY_START = datetime(2025, 5, 1, tzinfo=timezone.utc)
SURVEY_LENGTH_DAYS = 182.625

# Exposures of one position separated by more than this start a new epoch.
EPOCH_GAP_DAYS = 30.0
# An epoch longer than this (deep fields near the ecliptic poles are visited
# every orbit) is split along the nominal survey windows instead.
EPOCH_MAX_SPAN_DAYS = 90.0

# --- FLAGS bits (IRSA Spectrophotometry Tool help / Explanatory Supplement) ---

FLAG_BITS: dict[str, int] = {
    "TRANSIENT": 0, "OVERFLOW": 1, "SUR_ERROR": 2, "PHANTOM": 4,
    "REFERENCE": 5, "NONFUNC": 6, "DICHROIC": 7, "MISSING_DATA": 9,
    "HOT": 10, "COLD": 11, "FULLSAMPLE": 12, "PHANMISS": 14,
    "NONLINEAR": 15, "PERSIST": 17, "OUTLIER": 19, "CROSSTALK": 20,
    "SOURCE": 21, "GHOST": 22, "STREAK": 25, "BLOOM": 26, "SNOWBALL": 27,
    "HALO": 28, "SATELLITE_HALO": 29,
}

# Saturation class: excluded from the co-add and tinted as "saturated".
SATURATION_FLAGS = ["NONLINEAR", "BLOOM"]
# Near-saturation: OVERFLOW pixels stopped integrating early but still carry a
# valid, nonlinearity-corrected estimate, and IRSA's own Spectrophotometry Tool
# keeps them. We keep them too, count them, and tint them separately so they
# are never used silently. Move "OVERFLOW" to SATURATION_FLAGS to exclude them.
NEAR_SATURATION_FLAGS = ["OVERFLOW"]
# Other bad pixels: excluded from the co-add and tinted as "flagged".
BAD_FLAGS = [
    "TRANSIENT", "SUR_ERROR", "NONFUNC", "DICHROIC", "MISSING_DATA", "HOT",
    "COLD", "PHANMISS", "PERSIST", "OUTLIER", "STREAK", "SNOWBALL", "HALO",
    "SATELLITE_HALO",
]
# Never masked: SOURCE marks known stars (masking it would erase the sky);
# FULLSAMPLE is informational. GHOST and CROSSTALK are counted, not masked.

def flag_mask(names: list[str]) -> int:
    m = 0
    for n in names:
        m |= 1 << FLAG_BITS[n]
    return m

SATURATION_MASK = flag_mask(SATURATION_FLAGS)
NEAR_SATURATION_MASK = flag_mask(NEAR_SATURATION_FLAGS)
BAD_MASK = flag_mask(BAD_FLAGS)

# --- Viewer ------------------------------------------------------------------

FOV_PRESETS_ARCMIN = {"small": 5.0, "medium": 10.0, "large": 20.0}
FOV_MAX_ARCMIN = float(os.environ.get("LITS_FOV_MAX_ARCMIN", "20"))

# Shared display stretch: percentiles over all frames of one sequence.
STRETCH_LOW_PCT = 1.0
STRETCH_HIGH_PCT = 99.5
ASINH_SOFTENING = 0.1  # astropy AsinhStretch "a"

# --- Cache -------------------------------------------------------------------

ROOT = Path(__file__).resolve().parents[1]


def _default_cache() -> Path:
    # On Windows keep hundreds of MB of FITS cutouts out of OneDrive-synced folders.
    local = os.environ.get("LOCALAPPDATA")
    if os.name == "nt" and local:
        return Path(local) / "lits-cache"
    return ROOT / "cache"


CACHE_DIR = Path(os.environ.get("LITS_CACHE_DIR", _default_cache()))
QUERY_CACHE_SECONDS = 24 * 3600  # IRSA ingests weekly; SIA2 lags ~1 day
FEATURED_DIR = Path(os.environ.get("LITS_FEATURED_DIR", ROOT.parent / "frontend" / "public" / "featured"))

HTTP_TIMEOUT = float(os.environ.get("LITS_HTTP_TIMEOUT", "120"))
# Gate A: IRSA cutouts take ~12-15 s each (4.4 MB, 90% of it the PSF layer).
# Live searches sample fewer exposures per survey; Featured builds use more.
LIVE_MAX_EXPOSURES_PER_EPOCH = int(os.environ.get("LITS_LIVE_MAX_PER_EPOCH", "8"))
FEATURED_MAX_EXPOSURES_PER_EPOCH = int(os.environ.get("LITS_FEATURED_MAX_PER_EPOCH", "24"))
MAX_PARALLEL_DOWNLOADS = int(os.environ.get("LITS_MAX_PARALLEL", "6"))
# A cutout that sends nothing for READ_TIMEOUT s, or takes longer than
# CUTOUT_DEADLINE s in total, is abandoned and retried (never hang forever).
CUTOUT_READ_TIMEOUT = float(os.environ.get("LITS_CUTOUT_READ_TIMEOUT", "60"))
CUTOUT_DEADLINE = float(os.environ.get("LITS_CUTOUT_DEADLINE", "180"))
USER_AGENT = "LostInTheSpectrum/0.1 (NASA Space Apps 2026)"
