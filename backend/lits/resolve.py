"""Turn what a visitor types into a sky position.

Names go through CDS Sesame (SIMBAD first). Named objects carry their proper
motion so the cutout centre can be placed where the object is *now*.
Typed coordinates are a sky position and are never propagated.
"""
from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from dataclasses import asdict, dataclass, field
from urllib.parse import quote

import astropy.units as u
import httpx
import numpy as np
from astropy.coordinates import Distance, SkyCoord
from astropy.time import Time

from . import config

SESAME_URL = "https://cds.unistra.fr/cgi-bin/nph-sesame/-oxp/SNV?{q}"

# SIMBAD object-type codes -> plain label for the typeahead.
_OTYPE_LABELS = {
    "BD*": "Brown dwarf", "BD?": "Brown dwarf (candidate)",
    "Mi*": "Variable star (Mira)", "LP*": "Variable star",
    "Or*": "Young variable star", "TT*": "Young star (T Tauri)",
    "V*": "Variable star", "BY*": "Star", "PM*": "Star (high proper motion)",
    "*": "Star", "**": "Double star", "WD*": "White dwarf",
    "G": "Galaxy", "GiG": "Galaxy", "AGN": "Active galaxy", "QSO": "Quasar",
    "HII": "Star-forming region", "SFR": "Star-forming region",
    "MoC": "Molecular cloud", "RNe": "Nebula", "PN": "Planetary nebula",
    "SNR": "Supernova remnant", "Cl*": "Star cluster", "OpC": "Open cluster",
    "GlC": "Globular cluster", "ISM": "Interstellar matter",
}


def otype_label(otype: str | None) -> str:
    if not otype:
        return "Object"
    if otype in _OTYPE_LABELS:
        return _OTYPE_LABELS[otype]
    if otype.endswith("*"):
        return "Star"
    return "Object"


@dataclass
class Target:
    kind: str                  # "name" or "coords"
    query: str
    ra: float                  # catalogue (name) or typed (coords) position, deg
    dec: float
    name: str | None = None
    otype: str | None = None
    label: str = "Coordinates"
    epoch: float = 2000.0      # Julian year of ra/dec
    pmra: float | None = None  # mas/yr, includes cos(dec)
    pmdec: float | None = None
    plx: float | None = None   # mas
    rv: float | None = None    # km/s
    notes: list[str] = field(default_factory=list)

    @property
    def moves(self) -> bool:
        return self.kind == "name" and bool(self.pmra or self.pmdec)

    def position_at(self, t: Time) -> tuple[float, float]:
        """Sky position at time t. Coordinates typed by a visitor never move."""
        if not self.moves:
            return self.ra, self.dec
        return propagate(self.ra, self.dec, self.pmra or 0.0, self.pmdec or 0.0,
                         self.plx, self.rv, Time(self.epoch, format="jyear"), t)

    def to_dict(self) -> dict:
        d = asdict(self)
        d["moves"] = self.moves
        return d


def propagate(ra, dec, pmra, pmdec, plx, rv, t0: Time, t1: Time) -> tuple[float, float]:
    """Rigorous space-motion propagation (astropy); linear if no parallax."""
    if plx and plx > 0:
        c = SkyCoord(ra=ra * u.deg, dec=dec * u.deg,
                     pm_ra_cosdec=pmra * u.mas / u.yr, pm_dec=pmdec * u.mas / u.yr,
                     distance=Distance(parallax=plx * u.mas),
                     radial_velocity=(rv or 0.0) * u.km / u.s,
                     obstime=t0, frame="icrs")
        c1 = c.apply_space_motion(new_obstime=t1)
        return float(c1.ra.deg) % 360.0, float(c1.dec.deg)
    dt = (t1 - t0).to_value(u.yr)
    dec1 = dec + pmdec * dt / 3.6e6
    ra1 = ra + pmra * dt / 3.6e6 / max(np.cos(np.radians(dec)), 1e-6)
    return float(ra1) % 360.0, float(dec1)


# --- coordinates ---------------------------------------------------------------

_NUM = r"[+-]?\d+(?:\.\d*)?"
_DECIMAL_PAIR = re.compile(rf"^\s*({_NUM})\s*[ ,;]\s*({_NUM})\s*$")


class ParseError(ValueError):
    pass


class NotFoundError(ParseError):
    pass


def parse_coordinates(text: str) -> tuple[float, float] | None:
    """Decimal degrees ("133.759 -7.242") or sexagesimal
    ("08h55m02.3s -07d14m32s", "08:55:02.3 -07:14:32", "08 55 02.3 -07 14 32").
    Returns None if the text does not look like coordinates at all."""
    s = text.strip()
    m = _DECIMAL_PAIR.match(s)
    if m:
        ra, dec = float(m.group(1)), float(m.group(2))
        return _validate(ra, dec)
    looks_sexa = bool(re.search(r"\d\s*[hH:]\s*\d", s)) or bool(
        re.fullmatch(r"[\d\s.+\-:dDhHmMsS°′″'\",]+", s)) and len(re.findall(r"\d+(?:\.\d+)?", s)) >= 4
    if not looks_sexa:
        return None
    try:
        c = SkyCoord(s.replace(",", " "), unit=(u.hourangle, u.deg), frame="icrs")
    except Exception as e:  # noqa: BLE001
        raise ParseError(f"Could not read '{text}' as coordinates") from e
    return _validate(float(c.ra.deg), float(c.dec.deg))


def _validate(ra: float, dec: float) -> tuple[float, float]:
    if not (0.0 <= ra < 360.0):
        raise ParseError("RA must be in [0, 360) degrees")
    if not (-90.0 <= dec <= 90.0):
        raise ParseError("Dec must be in [-90, +90] degrees")
    return ra, dec


# --- names -------------------------------------------------------------------

def _f(el: ET.Element | None, tag: str) -> float | None:
    if el is None:
        return None
    x = el.find(tag)
    if x is None or x.text is None:
        return None
    try:
        return float(x.text)
    except ValueError:
        return None


def parse_sesame(xml_text: str, query: str) -> Target | None:
    root = ET.fromstring(xml_text)
    for res in root.iter("Resolver"):
        ra, dec = _f(res, "jradeg"), _f(res, "jdedeg")
        if ra is None or dec is None:
            continue
        pm = res.find("pm")
        plx = res.find("plx")
        vel = res.find("Vel")
        otype_el = res.find("otype")
        oname_el = res.find("oname")
        otype = otype_el.text.strip() if otype_el is not None and otype_el.text else None
        t = Target(
            kind="name", query=query, ra=ra, dec=dec,
            name=(oname_el.text.strip() if oname_el is not None and oname_el.text else query),
            otype=otype, label=otype_label(otype), epoch=2000.0,
            pmra=_f(pm, "pmRA"), pmdec=_f(pm, "pmDE"),
            plx=_f(plx, "v"), rv=_f(vel, "v"),
        )
        t.notes.append(f"Resolved by {res.get('name', 'Sesame')}")
        return t
    return None


def resolve(query: str, client: httpx.Client | None = None) -> Target:
    q = query.strip()
    if not q:
        raise ParseError("Type a name or coordinates")
    coords = parse_coordinates(q)
    if coords is not None:
        return Target(kind="coords", query=q, ra=coords[0], dec=coords[1],
                      label="Coordinates",
                      notes=["Typed coordinates are used as given and never moved for proper motion."])
    own = client is None
    client = client or httpx.Client(timeout=config.HTTP_TIMEOUT, follow_redirects=True,
                                    headers={"User-Agent": config.USER_AGENT})
    try:
        r = client.get(SESAME_URL.format(q=quote(q)))
        r.raise_for_status()
        t = parse_sesame(r.text, q)
    finally:
        if own:
            client.close()
    if t is None:
        raise NotFoundError(f"No object called '{q}' was found in SIMBAD, NED or VizieR")
    return t
