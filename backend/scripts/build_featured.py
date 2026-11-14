"""Pre-compute Featured frames into static files, using the live pipeline.

    python backend/scripts/build_featured.py                 # every card
    python backend/scripts/build_featured.py --only barnard  # one card
    python backend/scripts/build_featured.py --default-only  # just each card's default detector (fast)

Writes frontend/public/featured/<slug>/d<det>-<view>/ and
frontend/public/featured/index.json, and mirrors them into frontend/dist if it
exists, so a running backend serves them without rebuilding the frontend.
Rerun after a new SPHEREx release: new surveys become new slider stops.
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from lits import config, frames  # noqa: E402
from lits.resolve import resolve  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
CARDS = ROOT / "backend" / "featured_cards.json"
OUT = ROOT / "frontend" / "public" / "featured"
DIST = ROOT / "frontend" / "dist" / "featured"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", nargs="*", help="card slugs")
    ap.add_argument("--default-only", action="store_true")
    ap.add_argument("--views", default="survey", help="comma list: survey,exposures")
    args = ap.parse_args()

    spec = json.loads(CARDS.read_text(encoding="utf-8"))
    index_path = OUT / "index.json"
    old = {c["slug"]: c for c in json.loads(index_path.read_text(encoding="utf-8"))["cards"]} if index_path.exists() else {}
    cards_out = []
    latest = ""
    for card in spec["cards"]:
        slug = card["slug"]
        if args.only and slug not in args.only:
            if slug in old:
                cards_out.append(old[slug])
            continue
        t0 = time.time()
        tgt = resolve(card["q"]) if card.get("q") else None
        ra = tgt.ra if tgt else card["ra"]
        dec = tgt.dec if tgt else card["dec"]
        dets = card["build_dets"][:1] if args.default_only else card["build_dets"]
        seqs = dict(old.get(slug, {}).get("sequences", {}))
        for view in args.views.split(","):
            for det in dets:
                folder = f"{slug}/d{det}-{view}/"
                out = OUT / folder
                if out.exists():
                    shutil.rmtree(out)
                req = frames.Request(ra=ra, dec=dec, fov=card["fov"], det=det, view=view, target=tgt,
                                     max_per_epoch=config.FEATURED_MAX_EXPOSURES_PER_EPOCH)
                def prog(stage, done, total, _d=det):
                    print(f"\r  {slug} D{_d} {view}: {stage} {done}/{total}   ", end="", flush=True)
                seq = frames.build_sequence(req, out_dir=out, progress=prog)
                for npy in out.glob("*.npy"):
                    npy.unlink()
                n = len(seq["frames"])
                print(f"\r  {slug} D{det} {view}: {n} frames, {seq['timings']['cutouts']} cutouts, "
                      f"{seq['timings']['cutout_mb']} MB, {seq['timings']['total_s']} s")
                if n:
                    seqs[f"{det}-{view}"] = folder
                    latest = max(latest, max(f["date_end"] for f in seq["frames"]))
                else:
                    seqs.pop(f"{det}-{view}", None)
        c = {k: v for k, v in card.items() if k not in ("build_dets",)}
        c["ra"], c["dec"] = ra, dec
        c["sequences"] = seqs
        cards_out.append(c)
        print(f"{slug}: done in {time.time() - t0:.0f} s")

    index = {"built_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
             "data_as_of": latest or None, "collections": config.COLLECTIONS, "cards": cards_out}
    OUT.mkdir(parents=True, exist_ok=True)
    index_path.write_text(json.dumps(index, indent=1, ensure_ascii=False), encoding="utf-8")
    if DIST.parent.exists():
        if DIST.exists():
            shutil.rmtree(DIST)
        shutil.copytree(OUT, DIST)
        print(f"Mirrored into {DIST}")
    print(f"Wrote {index_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
