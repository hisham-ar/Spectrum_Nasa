"""Review and approve Featured cards without rebuilding anything.

    python backend/scripts/featured_cards.py status
    python backend/scripts/featured_cards.py approve barnard --by "Your name"
    python backend/scripts/featured_cards.py unapprove barnard
    python backend/scripts/featured_cards.py sync        # after editing card text in featured_cards.json

A card only appears on the public Featured page after a person has looked at the
real frames (see /featured?review for what to check) and approved it here.
Card text and approvals live in backend/featured_cards.json; this script copies
them into the built Featured list (frontend/public/featured and frontend/dist/featured).
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SPEC = ROOT / "backend" / "featured_cards.json"
INDEXES = [ROOT / "frontend" / "public" / "featured" / "index.json",
           ROOT / "frontend" / "dist" / "featured" / "index.json"]
REVIEW_FIELDS = ("verified", "verified_by", "verified_on")


def load_spec() -> dict:
    return json.loads(SPEC.read_text(encoding="utf-8"))


def save_spec(spec: dict) -> None:
    SPEC.write_text(json.dumps(spec, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def sync(spec: dict) -> list[str]:
    """Copy card text, settings and approvals into every built index. Returns warnings."""
    warnings: list[str] = []
    by_slug = {c["slug"]: c for c in spec["cards"]}
    found_any = False
    for path in INDEXES:
        if not path.exists():
            continue
        found_any = True
        ix = json.loads(path.read_text(encoding="utf-8"))
        for card in ix["cards"]:
            src = by_slug.get(card["slug"])
            if not src:
                continue
            for k, v in src.items():
                if k not in ("build_dets", "ra", "dec"):       # keep the positions the build resolved
                    card[k] = v
            for k in REVIEW_FIELDS:
                if k not in src:
                    card.pop(k, None)
            want = f"{card['det']}-{card.get('view', 'survey')}"
            if want not in card.get("sequences", {}):
                warnings.append(f"{card['slug']}: detector {card['det']} has not been built; run build_featured.py --only {card['slug']}")
        built = {c["slug"] for c in ix["cards"]}
        for slug in by_slug:
            if slug not in built:
                warnings.append(f"{slug}: not built yet; run build_featured.py --only {slug}")
        path.write_text(json.dumps(ix, indent=1, ensure_ascii=False), encoding="utf-8")
    if not found_any:
        warnings.append("No built Featured list found. Run backend/scripts/build_featured.py first.")
    return sorted(set(warnings))


def find(spec: dict, slug: str) -> dict:
    for c in spec["cards"]:
        if c["slug"] == slug:
            return c
    names = ", ".join(c["slug"] for c in spec["cards"])
    sys.exit(f"No card called '{slug}'. Cards: {names}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("status", help="list cards and who approved them")
    sub.add_parser("sync", help="copy edited card text into the built Featured list")
    a = sub.add_parser("approve", help="mark a card as checked by a person")
    a.add_argument("slug")
    a.add_argument("--by", required=True, help="who checked the frames")
    u = sub.add_parser("unapprove", help="take a card off the public Featured page")
    u.add_argument("slug")
    args = ap.parse_args()

    spec = load_spec()
    if args.cmd == "status":
        for c in spec["cards"]:
            state = f"approved by {c.get('verified_by', '?')} on {c.get('verified_on', '?')}" if c.get("verified") else "not checked yet"
            print(f"  {c['slug']:12s} {c['title'][:44]:46s} {state}")
        print("\nReview them at http://127.0.0.1:8000/featured?review")
        return 0
    if args.cmd == "approve":
        c = find(spec, args.slug)
        c.update(verified=True, verified_by=args.by.strip(), verified_on=date.today().isoformat())
        save_spec(spec)
        print(f"Approved {c['slug']} ({c['title']}), checked by {c['verified_by']}.")
    elif args.cmd == "unapprove":
        c = find(spec, args.slug)
        c["verified"] = False
        c.pop("verified_by", None)
        c.pop("verified_on", None)
        save_spec(spec)
        print(f"{c['slug']} is off the public Featured page.")
    for w in sync(spec):
        print("  ! " + w)
    print("Featured list updated. Refresh the page to see it (no server restart needed).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
