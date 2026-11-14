"""Pre-compute Featured frames into static files, using the live pipeline.

    python backend/scripts/build_featured.py                 # every card, every build_dets detector
    python backend/scripts/build_featured.py --only barnard  # one card
    python backend/scripts/build_featured.py --default-only  # each card's default detector only (fast)

Shows a progress bar with an ETA, and writes backend/scripts/out/build_status.json
and build_featured.log while it runs. Safe to stop and rerun: finished sequences
are kept and skipped, and every download is cached.

Output: frontend/public/featured/<slug>/d<det>-<view>/ + index.json, mirrored
into frontend/dist/featured so a running backend serves them straight away.
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from lits import archive, coadd, config, frames  # noqa: E402
from lits.progress import BuildProgress  # noqa: E402
from lits.resolve import resolve  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
CARDS = ROOT / "backend" / "featured_cards.json"
OUT = ROOT / "frontend" / "public" / "featured"
DIST = ROOT / "frontend" / "dist" / "featured"
LOGDIR = ROOT / "backend" / "scripts" / "out"
STATUS = LOGDIR / "build_status.json"
LOG = LOGDIR / "build_featured.log"


def _network_down(err: str) -> bool:
    e = err.lower()
    return any(k in e for k in ("getaddrinfo", "name or service not known", "nodename nor servname",
                                "temporary failure in name resolution", "network is unreachable"))


def _internet_ok() -> bool:
    import socket
    try:
        socket.getaddrinfo("nasa-irsa-spherex.s3.us-east-1.amazonaws.com", 443)
        return True
    except OSError:
        return False


def log(msg: str) -> None:
    LOGDIR.mkdir(parents=True, exist_ok=True)
    with open(LOG, "a", encoding="utf-8") as fh:
        fh.write(f"{datetime.now().strftime('%H:%M:%S')}  {msg}\n")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", nargs="*", help="card slugs")
    ap.add_argument("--default-only", action="store_true")
    ap.add_argument("--views", default="survey", help="comma list: survey,exposures")
    ap.add_argument("--force", action="store_true", help="rebuild even if a sequence is up to date")
    args = ap.parse_args()

    spec = json.loads(CARDS.read_text(encoding="utf-8"))
    index_path = OUT / "index.json"
    old = {c["slug"]: c for c in json.loads(index_path.read_text(encoding="utf-8"))["cards"]} if index_path.exists() else {}
    log(f"=== build started: only={args.only} default_only={args.default_only} views={args.views}")

    # ---- phase 1: plan every sequence (archive searches only, no downloads) ----
    print("Planning: searching the SPHEREx archive for every card...", flush=True)
    jobs, cards = [], []
    for card in spec["cards"]:
        if args.only and card["slug"] not in args.only:
            continue
        try:
            tgt = resolve(card["q"]) if card.get("q") else None
        except Exception as e:  # noqa: BLE001
            print(f"  ! {card['slug']}: could not resolve '{card.get('q')}': {e}")
            log(f"resolve failed {card['slug']}: {e}")
            continue
        if tgt is not None:
            tgt.name = card["name"]          # show the card's display name, not SIMBAD's identifier
        ra = tgt.ra if tgt else card["ra"]
        dec = tgt.dec if tgt else card["dec"]
        cards.append((card, tgt, ra, dec))
        dets = card["build_dets"][:1] if args.default_only else card["build_dets"]
        for view in args.views.split(","):
            for det in dets:
                req = frames.Request(ra=ra, dec=dec, fov=card["fov"], det=det, view=view, target=tgt,
                                     max_per_epoch=config.FEATURED_MAX_EXPOSURES_PER_EPOCH)
                try:
                    p = frames.plan(req)
                except Exception as e:  # noqa: BLE001
                    print(f"  ! {card['slug']} D{det}: archive search failed: {e}")
                    log(f"plan failed {card['slug']} D{det}: {e}")
                    continue
                out = OUT / card["slug"] / f"d{det}-{view}"
                exps = [e for u in p["units"] for e in u]
                cra, cdec = p["centre"]
                size = coadd.cutout_size_arcmin(req.fov)
                existing = out / "sequence.json"
                prev = json.loads(existing.read_text(encoding="utf-8")) if existing.exists() else {}
                pf = prev.get("frames", [])
                complete = (len(pf) == len(p["units"]) and not any(f.get("n_failed") for f in pf)) if pf else not p["units"]
                up_to_date = (not args.force and prev.get("key") == p["key"] and complete
                              and prev.get("schema") == frames.SCHEMA_VERSION)
                cached = len(exps) if up_to_date else sum(archive.is_cached_exposure(e, cra, cdec, size) for e in exps)
                jobs.append({"card": card, "det": det, "view": view, "req": req, "plan": p, "out": out,
                             "n": len(exps), "cached": cached, "skip": up_to_date})
                print(f"  {card['slug']:<11} D{det} {view}: {len(p['units'])} epochs, {len(exps)} exposures"
                      f" ({'up to date' if up_to_date else f'{cached} cached'})", flush=True)

    total = sum(j["n"] for j in jobs)
    cached0 = sum(j["cached"] for j in jobs)
    to_fetch = total - cached0
    est = to_fetch * (3 if config.CUTOUT_SOURCE != "irsa" else 14) / config.MAX_PARALLEL_DOWNLOADS
    print(f"\n{len(jobs)} sequences, {total} cutouts, {to_fetch} to download "
          f"(first guess ~{est / 60:.0f} min at {config.MAX_PARALLEL_DOWNLOADS} parallel; the bar refines it)\n", flush=True)
    log(f"planned {len(jobs)} sequences, {total} cutouts, {to_fetch} to download")

    # ---- phase 2: build ------------------------------------------------------------
    prog = BuildProgress(total, cached0, STATUS, "Featured build")
    results: dict[str, dict] = {}
    aborted = False
    for k, j in enumerate(jobs, 1):
        slug, det, view = j["card"]["slug"], j["det"], j["view"]
        tag = f"{slug} D{det} {view} ({k}/{len(jobs)})"
        seqs = results.setdefault(slug, dict(old.get(slug, {}).get("sequences", {})))
        if j["skip"]:
            seqs[f"{det}-{view}"] = f"{slug}/d{det}-{view}/"
            prog.job_done({"job": tag, "status": "up to date", "line": f"  = {tag}: already up to date"})
            continue
        prog.set_current(f"{tag}: starting")
        tmp = j["out"].with_name(j["out"].name + ".building")
        if tmp.exists():
            shutil.rmtree(tmp)
        state = {"prev": 0}
        job_cached = j["cached"]

        def cb(stage, done, n, _t=tag, _s=state, _c=job_cached):
            if stage == "downloading":
                new = max(0, done - _c) - _s["prev"]
                if new > 0:
                    _s["prev"] += new
                    prog.done = min(prog.total, prog.done + new)
                prog.set_current(f"{_t}: downloading {done}/{n}")
            elif stage == "combining":
                prog.set_current(f"{_t}: combining epoch {done + 1}/{n}")

        t0 = time.time()
        seq = None
        try:
            seq = frames.build_sequence(j["req"], out_dir=tmp, progress=cb, planned=j["plan"])
            for npy in tmp.glob("*.npy"):
                npy.unlink()
            if j["out"].exists():
                shutil.rmtree(j["out"])
            tmp.rename(j["out"])
            nf = len(seq["frames"])
            failed = sum(f.get("n_failed", 0) for f in seq["frames"])
            prog.failed += failed
            if nf:
                seqs[f"{det}-{view}"] = f"{slug}/d{det}-{view}/"
            else:
                seqs.pop(f"{det}-{view}", None)
            line = (f"  + {tag}: {nf} frames, {seq['timings']['cutouts']} cutouts"
                    f"{f', {failed} failed' if failed else ''}, {time.time() - t0:.0f} s")
            prog.job_done({"job": tag, "status": "ok", "frames": nf, "failed_cutouts": failed,
                           "seconds": round(time.time() - t0), "line": line})
            log(line.strip())
        except Exception as e:  # noqa: BLE001 - one bad sequence must not stop the rest
            line = f"  ! {tag}: FAILED ({type(e).__name__}: {e}); keeping any previous version"
            prog.job_done({"job": tag, "status": "failed", "error": str(e)[:300], "line": line})
            log(line.strip() + "\n" + traceback.format_exc())
            if tmp.exists():
                shutil.rmtree(tmp, ignore_errors=True)
            if _network_down(str(e)) or not _internet_ok():
                msg = ("\n\n*** Your internet connection seems to be down (no address lookups work). Stopping here.\n"
                       "    Everything finished so far is kept. Reconnect, then run the same command again to resume. ***")
                print(msg, flush=True)
                log("stopped: network down")
                aborted = True
                break
        # count this job's remaining planned cutouts as handled (done, failed or skipped)
        prog.done = min(prog.total, prog.done + max(0, j["n"] - job_cached - state["prev"]))
        failed_here = sum(f.get("n_failed", 0) for f in (seq["frames"] if seq else []))
        if failed_here and failed_here >= j["n"] // 2 and not _internet_ok():
            print("\n\n*** Many downloads failed and the internet looks unreachable. Stopping; rerun to resume. ***", flush=True)
            log("stopped: network down (many failed downloads)")
            aborted = True
            break

    # ---- index ---------------------------------------------------------------------
    latest = ""
    cards_out = []
    built = {c[0]["slug"]: c for c in cards}
    for card in spec["cards"]:
        slug = card["slug"]
        if slug in built:
            _, _, ra, dec = built[slug]
            c = {k: v for k, v in card.items() if k != "build_dets"}
            c["ra"], c["dec"] = ra, dec
            c["sequences"] = results.get(slug, dict(old.get(slug, {}).get("sequences", {})))
            cards_out.append(c)
        elif slug in old:
            cards_out.append(old[slug])
    for c in cards_out:
        for folder in c["sequences"].values():
            sp = OUT / folder / "sequence.json"
            if sp.exists():
                fr = json.loads(sp.read_text(encoding="utf-8"))["frames"]
                if fr:
                    latest = max(latest, max(f["date_end"] for f in fr))
    index = {"built_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
             "data_as_of": latest or None, "collections": config.COLLECTIONS, "cards": cards_out}
    OUT.mkdir(parents=True, exist_ok=True)
    index_path.write_text(json.dumps(index, indent=1, ensure_ascii=False), encoding="utf-8")
    if DIST.parent.exists():
        if DIST.exists():
            shutil.rmtree(DIST)
        shutil.copytree(OUT, DIST, ignore=shutil.ignore_patterns("*.building"))
    ok = sum(1 for f in prog.finished_jobs if f["status"] != "failed")
    prog.close(("STOPPED EARLY (network). " if aborted else "") +
               f"Done: {ok}/{len(jobs)} sequences ready, {prog.failed} cutouts could not be downloaded. "
               f"Index: {index_path}")
    log(f"=== build finished: {ok}/{len(jobs)} ok")
    return 0 if ok == len(jobs) else 1


if __name__ == "__main__":
    raise SystemExit(main())
