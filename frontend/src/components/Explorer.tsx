import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchAsteroids, fetchFeaturedSequence, fetchSequence, type LocationParams } from "../lib/api";
import { ensureAwake, useServerState } from "../lib/server";
import { hasLocation, readUrl, toSearch, type UrlState } from "../lib/url";
import { DETECTORS, FOV_PRESETS, type AsteroidResult, type BuildStatus, type FeaturedCard, type FrameMeta,
  type Sequence, type SmallBody, type StepView, type TargetInfo } from "../lib/types";
import { DEFAULT_LOOK, FALLBACK_STRETCH, loadPlane, renderGray, renderRGB, type Look, type Plane, type Stretch } from "../lib/render";
import SkyCanvas, { type CanvasLabel, type ViewXform } from "./SkyCanvas";
import { skyToPixel } from "../lib/coords";
import Timeline, { longDate, monthSpan } from "./Timeline";
import SpectralRail from "./SpectralRail";
import DataPanel from "./DataPanel";
import SaturationNote from "./SaturationNote";
import RocketGame from "./RocketGame";
import { SAT_NOTE_MIN_PX, saturationSwing } from "../lib/saturation";
import SearchBox from "./SearchBox";
import GridView, { matchFrame } from "./GridView";
import InvestigationPanel from "./InvestigationPanel";

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
const MAX_BLINK_HZ = 3; // WCAG 2.3.1: never more than 3 flashes per second

/** Challenge targets, used when no pre-computed Featured cache is present. */
export const CHALLENGE_TARGETS: { name: string; q: string; det: number; fov: number; slug: string }[] = [
  { name: "Barnard's Star", q: "Barnard's Star", det: 3, fov: 10, slug: "barnard" },
  { name: "ε Indi B", q: "eps Ind B", det: 6, fov: 20, slug: "eps-indi-b" },
  { name: "WISE 0855−0714", q: "WISE J085510.83-071442.5", det: 6, fov: 10, slug: "wise-0855" },
  { name: "RW Aurigae", q: "RW Aur", det: 3, fov: 10, slug: "rw-aur" },
  { name: "R Draconis", q: "R Dra", det: 3, fov: 10, slug: "r-dra" },
];

interface Channel { det: number; seq: Sequence; planes: (Plane | null)[] }
interface Stop { idx: number[]; meta: FrameMeta; metas: FrameMeta[] }


function stretchOf(c: Channel, i: number): Stretch {
  return c.planes[i]?.fallback ? FALLBACK_STRETCH : { lo: c.seq.stretch.lo, hi: c.seq.stretch.hi, a: c.seq.stretch.a };
}

/** Colour uses three pre-computed detectors when a card has them. */
function colourDetsFor(card: FeaturedCard | undefined, view: string): [number, number, number] {
  if (card) {
    const have = Object.keys(card.sequences).filter((k) => k.endsWith(`-${view}`)).map((k) => Number(k.split("-")[0])).sort((a, b) => a - b);
    if (have.length >= 3) {
      const mid = have.slice(1, -1).reduce((best, d) => (Math.abs(d - 3) < Math.abs(best - 3) ? d : best), have[1]);
      return [have[0], mid, have[have.length - 1]];
    }
  }
  return [1, 3, 6];
}

interface Props {
  featured: FeaturedCard[];
  featuredReady: boolean;
  onDataDate: (d: string | null) => void;
  onNavigate: (to: string) => void;
}

export default function Explorer({ featured, featuredReady, onDataDate, onNavigate }: Props) {
  const [st, setSt] = useState<UrlState>(() => readUrl());
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [build, setBuild] = useState<string | null>(null);
  const [buildFrac, setBuildFrac] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const server = useServerState();
  const [xf, setXf] = useState<ViewXform>({ zoom: 1, cx: 50, cy: 50 });
  const [playing, setPlaying] = useState(false);
  const [blinkRunning, setBlinkRunning] = useState(() => !reducedMotion());
  const [blinkHz, setBlinkHz] = useState(1);
  const [phase, setPhase] = useState(0);
  const [drawer, setDrawer] = useState(() => window.innerWidth >= 1500);
  const [look, setLook] = useState<Look>(DEFAULT_LOOK);
  const [copied, setCopied] = useState(false);
  const [gameOpen, setGameOpen] = useState(false);
  const [slowLoad, setSlowLoad] = useState(false);
  const [linked, setLinked] = useState(true);                       // grid: zoom/pan all panels together
  const [gridLoading, setGridLoading] = useState<number | null>(null); // grid: detector being fetched
  const [gridFailed, setGridFailed] = useState<Record<number, string>>({});
  const [gridSlow, setGridSlow] = useState(false);
  const [retryN, setRetryN] = useState(0);            // "Try again" after a failed load   // grid still loading after a few seconds: offer the game
  const [loadedKey, setLoadedKey] = useState<string | null>(null);            // which view the channels belong to
  const [zoomReq, setZoomReq] = useState<{ zoom: number; n: number } | null>(null);  // investigation step zoom
  const [astRes, setAstRes] = useState<Record<number, AsteroidResult | "loading" | string>>({});
  const dockRef = useRef<HTMLDivElement>(null);
  const [dockH, setDockH] = useState(150);
  const headRef = useRef<HTMLElement>(null);
  const [headH, setHeadH] = useState(120);
  useEffect(() => {
    const el = dockRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setDockH(e.contentRect.height + 24));
    ro.observe(el);
    const hd = headRef.current;
    const ro2 = new ResizeObserver(() => hd && setHeadH(hd.offsetTop + hd.offsetHeight));
    if (hd) ro2.observe(hd);
    return () => { ro.disconnect(); ro2.disconnect(); };
  });

  // --- URL sync ---------------------------------------------------------------
  const update = useCallback((patch: Partial<UrlState>, push = false) => {
    setSt((s) => {
      const next = { ...s, ...patch };
      const url = window.location.pathname + toSearch(next);
      if (push) window.history.pushState(null, "", url);
      else window.history.replaceState(null, "", url);
      return next;
    });
  }, []);
  useEffect(() => {
    const onPop = () => setSt(readUrl());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  useEffect(() => { setLook((l) => ({ ...l, showFlags: st.flags })); }, [st.flags]);

  const card = st.target ? featured.find((c) => c.slug === st.target) : undefined;
  const challenge = st.target ? CHALLENGE_TARGETS.find((c) => c.slug === st.target) : undefined;
  const colourDets = colourDetsFor(card, st.view);
  // Grid loads the selected detector first, then the rest; changing the selection within the grid doesn't reload.
  const dets: number[] = st.grid ? [st.det, ...[1, 2, 3, 4, 5, 6].filter((d) => d !== st.det)] : st.col ? colourDets : [st.det];
  const detKey = st.grid ? "grid" : dets.join(",");
  const locKey = `${featuredReady}|${st.target ?? ""}|${st.q ?? ""}|${st.ra ?? ""}|${st.dec ?? ""}|${st.fov}|${detKey}|${st.view}|${card ? "c" : ""}`;

  // --- load sequences + frames ----------------------------------------------------------
  useEffect(() => {
    if (!hasLocation(st)) { setChannels(null); return; }
    if (st.target && !featuredReady) return;
    const ac = new AbortController();
    const key = locKey;
    setErr(null); setBuild(null); setBuildFrac(null); setChannels(null); setPlaying(false); setAstRes({});
    setGridLoading(null); setGridFailed({});
    const loc: LocationParams = card ? { q: card.q ?? card.name } : challenge ? { q: challenge.q }
      : st.q ? { q: st.q } : { ra: st.ra, dec: st.dec };
    const one = async (det: number, k: number): Promise<Channel> => {
      const folder = card?.sequences[`${det}-${st.view}`];
      const featuredSeq = !!(folder && card && st.fov === card.fov);
      if (!featuredSeq) await ensureAwake();
      const seq = featuredSeq
        ? await fetchFeaturedSequence(folder!, ac.signal)
        : await fetchSequence(loc, st.fov, det, st.view, (b: BuildStatus) => {
          const pre = dets.length > 1 && !st.grid ? `Detector ${det} (${k + 1} of ${dets.length}): ` : "";
          setBuild(pre + stageText(b));
          setBuildFrac(b.total ? b.done / b.total : null);
        }, ac.signal);
      if (card && seq.target) seq.target = { ...seq.target, name: card.name };
      const planes = await Promise.all(seq.frames.map((f) => loadPlane(seq.base!, f, seq.grid.nx, seq.grid.ny, seq.query).catch(() => null)));
      return { det, seq, planes };
    };
    const dataDate = (chs: Channel[]) => {
      const s0 = chs[0].seq;
      const latest = chs.flatMap((c) => c.seq.frames).reduce((m, f) => (f.date_end > m ? f.date_end : m), "");
      const checked = String(s0.provenance.queried_at ?? s0.provenance.built_at ?? "").slice(0, 10);
      onDataDate(latest ? `${longDate(latest)}${checked ? ` (archive checked ${longDate(checked)})` : ""}` : null);
    };
    (async () => {
      if (st.grid) {
        // Show each detector as soon as it's ready; one failing detector doesn't stop the others.
        const chs: Channel[] = [];
        const failed: Record<number, string> = {};
        for (let k = 0; k < dets.length; k++) {
          setGridLoading(dets[k]); setBuild(null); setBuildFrac(null);
          try {
            chs.push(await one(dets[k], k));
          } catch (e) {
            if (ac.signal.aborted || (e as Error).name === "AbortError") return;
            failed[dets[k]] = (e as Error).message;
            setGridFailed({ ...failed });
            continue;
          }
          if (ac.signal.aborted) return;
          if (chs.length === 1) setXf({ zoom: 1, cx: chs[0].seq.grid.nx / 2, cy: chs[0].seq.grid.ny / 2 });
          setChannels([...chs]);
          setLoadedKey(key);
          dataDate(chs);
        }
        setGridLoading(null);
        if (!chs.length) setErr(Object.values(failed)[0] ?? "No detector could be loaded.");
        return;
      }
      try {
        const chs: Channel[] = [];
        for (let k = 0; k < dets.length; k++) chs.push(await one(dets[k], k));   // one at a time: the archive is shared
        if (ac.signal.aborted) return;
        setChannels(chs);
        setLoadedKey(key);
        const s0 = chs[0].seq;
        setXf({ zoom: 1, cx: s0.grid.nx / 2, cy: s0.grid.ny / 2 });
        dataDate(chs);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setErr((e as Error).message);
      }
    })();
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locKey, retryN]);

  // --- stops: one per survey (single) or per survey common to all colour channels ------
  const stops: Stop[] = useMemo(() => {
    if (!channels) return [];
    if (st.grid) {   // the timeline follows the selected detector; other panels match it by survey
      const ref = channels.find((c) => c.det === st.det) ?? channels[0];
      return ref.seq.frames.map((f, i) => ({ idx: [i], meta: f, metas: [f] }));
    }
    if (channels.length === 1) return channels[0].seq.frames.map((f, i) => ({ idx: [i], meta: f, metas: [f] }));
    // Colour only combines frames from the same visit (by date, not by survey number).
    const [b, g, r] = channels;
    const out: Stop[] = [];
    g.seq.frames.forEach((fg, ig) => {
      const mb = matchFrame(b.seq, fg), mr = matchFrame(r.seq, fg);
      if (mb?.sameVisit && mr?.sameVisit) out.push({ idx: [mb.i, ig, mr.i], meta: fg, metas: [b.seq.frames[mb.i], fg, r.seq.frames[mr.i]] });
    });
    return out;
  }, [channels, st.grid, st.det]);

  const n = stops.length;
  // Only a live search needs the server; Featured frames are plain files on the website.
  const waking = server === "waking" && !build;
  const waitText = build ?? (waking ? "Starting the search server" : "Searching the SPHEREx archive");
  const gridDone = (channels?.length ?? 0) + Object.keys(gridFailed).length;   // detectors finished (loaded or failed)
  const gameReady = st.grid ? !!channels && gridLoading === null : !!channels;
  const gameReadyText = st.grid
    ? (gridDone - Object.keys(gridFailed).length === 6 ? "All six detectors are ready."
      : `Loading finished: ${gridDone - Object.keys(gridFailed).length} of 6 detectors have images.`)
    : n > 0 ? "Your images are ready." : "Loading finished, but SPHEREx has no images here.";
  const clamp = (i: number | undefined, d: number) => (i === undefined || !Number.isFinite(i) ? d : Math.max(0, Math.min(n - 1, Math.round(i))));
  const frameIdx = clamp(st.frame, 0);
  const a = clamp(st.a, 0);
  const b = clamp(st.b, n - 1);
  const cmp = n < 2 || (st.grid && st.cmp === "side") ? "none" : st.cmp;

  // --- composed images (cached per stop for the current look) ---------------------------
  const cache = useRef(new Map<string, ImageData>());
  useEffect(() => { cache.current.clear(); }, [channels, look]);
  const imageFor = useCallback((si: number): ImageData | null => {
    if (!channels || !stops[si]) return null;
    const key = `${si}`;
    const hit = cache.current.get(key);
    if (hit) return hit;
    const s = stops[si];
    let img: ImageData | null = null;
    if (channels.length === 1) {
      const p = channels[0].planes[s.idx[0]];
      if (p) img = renderGray(p, stretchOf(channels[0], s.idx[0]), look);
    } else {
      const ps = channels.map((c, k) => c.planes[s.idx[k]]);
      if (ps.every(Boolean)) {
        img = renderRGB(ps as [Plane, Plane, Plane],
          channels.map((c, k) => stretchOf(c, s.idx[k])) as [Stretch, Stretch, Stretch], look);
      }
    }
    if (img) cache.current.set(key, img);
    return img;
  }, [channels, stops, look]);

  // --- playback / blink -------------------------------------------------------------------
  useEffect(() => {
    if (!playing || n < 2 || cmp !== "none") return;
    const t = setInterval(() => {
      setSt((s) => {
        const next = { ...s, frame: ((s.frame ?? 0) + 1) % n };
        window.history.replaceState(null, "", window.location.pathname + toSearch(next));
        return next;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [playing, n, cmp]);
  useEffect(() => {
    if (cmp !== "blink" || !blinkRunning) return;
    const t = setInterval(() => setPhase((p) => 1 - p), 1000 / Math.min(blinkHz, MAX_BLINK_HZ));
    return () => clearInterval(t);
  }, [cmp, blinkRunning, blinkHz]);
  const shown = cmp === "blink" ? (phase ? b : a) : frameIdx;

  // An investigation step's zoom waits until the frames for its view have loaded, then centres on the target.
  useEffect(() => {
    if (!zoomReq || !channels || loadedKey !== locKey) return;
    const m = stops[cmp === "blink" ? a : shown]?.meta.marker;
    const g = (st.grid ? (channels.find((c) => c.det === st.det) ?? channels[0]) : channels[0]).seq.grid;
    setXf({ zoom: zoomReq.zoom, cx: m ? m.x + 0.5 : g.nx / 2, cy: m ? m.y + 0.5 : g.ny / 2 });
    setZoomReq(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomReq, channels, loadedKey, locKey]);

  // Guided investigation (Featured cards): each step can set up the view to look at.
  const invCard = card?.investigation && st.fov === card.fov ? card : undefined;
  const applyStep = useCallback((i: number, v?: StepView) => {
    const patch: Partial<UrlState> = { inv: true, step: i };
    if (v) {
      if (v.grid) { patch.grid = true; patch.col = false; }
      else if (v.col) { patch.col = true; patch.grid = false; }
      else { patch.grid = false; patch.col = false; }
      if (v.det !== undefined) patch.det = v.det;
      if (v.cmp) patch.cmp = v.cmp;
      patch.frame = v.frame; patch.a = v.a; patch.b = v.b;
      if (v.flags !== undefined) patch.flags = v.flags;
      if (v.px !== undefined) patch.px = v.px;
      setZoomReq({ zoom: v.zoom ?? 1, n: Date.now() });
    }
    update(patch);
  }, [update]);
  // Opened from the Featured page without a step: set up step 1.
  useEffect(() => {
    if (st.inv && invCard && st.step === undefined) applyStep(0, invCard.investigation!.steps[0]?.view);
  }, [st.inv, st.step, invCard, applyStep]);

  // --- known asteroids (single detector, Every-exposure view only) -----------------------
  const astOn = st.ast && st.view === "exposures" && channels?.length === 1;
  const visible = cmp === "side" ? [a, b] : [shown];
  useEffect(() => {
    if (!astOn || !channels) return;
    const seq = channels[0].seq;
    for (const i of visible) {
      const f = seq.frames[i];
      if (!f || astRes[i] !== undefined) continue;
      if (f.asteroids) { setAstRes((r) => ({ ...r, [i]: f.asteroids! })); continue; }
      if (!seq.base?.includes("/api/seq/")) { setAstRes((r) => ({ ...r, [i]: "Not pre-computed for this saved view." })); continue; }
      setAstRes((r) => ({ ...r, [i]: "loading" }));
      fetchAsteroids(seq.key, i).then((res) => setAstRes((r) => ({ ...r, [i]: res })))
        .catch((e) => setAstRes((r) => ({ ...r, [i]: (e as Error).message })));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [astOn, channels, visible.join(",")]);
  const bodiesFor = (i: number): SmallBody[] | undefined => {
    const r = astRes[i];
    return astOn && r && typeof r === "object" ? r.bodies : undefined;
  };

  // Offer the game only when a load is genuinely slow (a new patch of sky), not for Featured.
  useEffect(() => {
    if (channels || err) { setSlowLoad(false); return; }
    const t = setTimeout(() => setSlowLoad(true), 2500);
    return () => clearTimeout(t);
  }, [channels, err]);

  // In the grid the first detector arrives long before the sixth, so keep the game on offer
  // for the whole load (Featured grids load at once and never show it).
  const gridBusy = st.grid && gridLoading !== null;
  useEffect(() => {
    if (!gridBusy) { setGridSlow(false); return; }
    const t = setTimeout(() => setGridSlow(true), 2500);
    return () => clearTimeout(t);
  }, [gridBusy]);

  // --- keyboard ----------------------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || !channels || gameOpen) return;
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        if (cmp === "blink") { setBlinkRunning(false); setPhase((p) => 1 - p); return; }
        update({ frame: Math.max(0, Math.min(n - 1, frameIdx + (e.key === "ArrowLeft" ? -1 : 1))) });
      } else if (e.key === " ") {
        e.preventDefault();
        if (cmp === "blink") setBlinkRunning((r) => !r);
        else if (n > 1) setPlaying((p) => !p);
      } else if (e.key === "b" || e.key === "B") {
        if (n > 1) update({ cmp: cmp === "blink" ? "none" : "blink" });
      } else if (e.key === "g" || e.key === "G") {
        update({ grid: !st.grid, col: false, frame: undefined, a: undefined, b: undefined });
      } else if (e.key === "i" || e.key === "I") {
        setDrawer((d) => !d);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [channels, cmp, n, frameIdx, update, gameOpen, st.grid]);

  const goTarget = (t: TargetInfo) => {
    if (t.kind === "coords") onNavigate(`/?ra=${t.ra.toFixed(5)}&dec=${t.dec.toFixed(5)}&fov=${st.fov}`);
    else onNavigate(`/?q=${encodeURIComponent(t.query)}&fov=10`);
  };
  const goCard = (c: FeaturedCard) => onNavigate(`/?target=${c.slug}&det=${c.det}&fov=${c.fov}${c.compare && c.compare !== "none" ? `&cmp=${c.compare}` : ""}`);
  const goChallenge = (c: (typeof CHALLENGE_TARGETS)[number], demo = false) => {
    const fc = featured.find((f) => f.slug === c.slug);
    onNavigate(`/?target=${c.slug}&det=${fc?.det ?? c.det}&fov=${fc?.fov ?? c.fov}${demo ? "&cmp=blink" : ""}`);
  };

  // --- welcome -------------------------------------------------------------------------------
  if (!hasLocation(st)) {
    return <Hero featured={featured} featuredReady={featuredReady} onPickFeatured={goCard} onResolved={goTarget} onChallenge={goChallenge} onNavigate={onNavigate} />;
  }

  const ch0 = st.grid ? (channels?.find((c) => c.det === st.det) ?? channels?.[0]) : channels?.[0];
  const stop = stops[cmp === "side" ? a : shown];
  const pairMeta = n >= 2 ? ([stops[a].meta, stops[b].meta] as [FrameMeta, FrameMeta]) : undefined;
  const title = ch0?.seq.target?.name ?? card?.name ?? challenge?.name ?? st.q ?? `${st.ra?.toFixed(4)}, ${st.dec?.toFixed(4)}`;
  const marker = (si: number) => (channels ? channels[channels.length > 1 ? 1 : 0].seq.frames[stops[si]?.idx[channels.length > 1 ? 1 : 0]]?.marker ?? null : null);
  const ariaFor = (si: number) => stops[si]?.meta.summary ?? "SPHEREx frame";
  // Labelled circles for a Featured card's named objects (fixed sky positions), only on the card's own view.
  const labelsFor = (seq: Sequence | undefined): CanvasLabel[] | undefined =>
    card?.annotations && seq && st.fov === card.fov
      ? card.annotations.map((an) => ({ ...skyToPixel(seq.grid, an.ra, an.dec), r: (an.radius_arcsec ?? 30) / seq.grid.pixel_scale_arcsec, label: an.label }))
      : undefined;
  const labels = labelsFor(ch0?.seq);
  const smooth = !st.px;
  // A real saturated blob (not a stray pixel) anywhere in the frames on screen.
  const satSwing = channels ? saturationSwing(channels.map((c) => ({ det: c.det, seq: c.seq }))) : null;
  const hasSaturatedStar = !!channels?.some((c) => c.seq.frames.some((f) => f.saturated_px >= SAT_NOTE_MIN_PX));
  const share = async () => {
    try { await navigator.clipboard.writeText(window.location.href); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { /* ignore */ }
  };
  const det = DETECTORS[st.det];
  const bandText = st.grid
    ? `All six detectors, 0.75 to 5.00 µm. The timeline follows detector ${st.det}.`
    : st.col
    ? `False colour: ${colourDets.map((d, k) => `${["blue", "green", "red"][k]} is detector ${d}`).join(", ")}`
    : `Detector ${st.det}, ${det.band[0].toFixed(2)} to ${det.band[1].toFixed(2)} µm`;

  return (
    <main className={`explorer ${drawer || (st.inv && invCard) ? "drawer-open" : ""}`}>
      <section className="stage" aria-label="Sky view" style={{ ["--dock-h" as string]: `${dockH}px`, ["--head-h" as string]: `${headH}px` }}>
        {st.grid && channels ? (
          <GridView dets={[1, 2, 3, 4, 5, 6]} channels={channels} refDet={st.det} refFrame={stops[shown]?.meta}
            loading={gridLoading !== null ? { det: gridLoading, text: build ?? (waking ? "Starting the search server" : null), frac: buildFrac } : null} failed={gridFailed}
            look={look} smooth={smooth} showMarker={st.marker} linked={linked} xform={xf} onXform={setXf}
            labelsFor={labelsFor} onPick={(d) => update({ grid: false, det: d, frame: undefined, a: undefined, b: undefined })} />
        ) : (
        <div className={`canvases ${cmp === "side" ? "two" : ""}`}>
          {channels && n > 0 && (cmp === "side" ? (
            [a, b].map((si, k) => (
              <figure key={k} className="pane">
                <SkyCanvas image={imageFor(si)} smooth={smooth} marker={marker(si)} showMarker={st.marker} bodies={bodiesFor(si)} labels={labels}
                  pixelScale={ch0!.seq.grid.pixel_scale_arcsec} xform={xf} onXform={setXf} ariaLabel={ariaFor(si)} chrome={k === 1} />
                <figcaption><b>{k ? "B" : "A"}</b> {monthSpan(stops[si].meta.date_start, stops[si].meta.date_end)}, survey {stops[si].meta.survey}, {stops[si].meta.release}</figcaption>
              </figure>
            ))
          ) : (
            <figure className="pane">
              <SkyCanvas image={imageFor(shown)} smooth={smooth} marker={marker(shown)} showMarker={st.marker} bodies={bodiesFor(shown)} labels={labels}
                pixelScale={ch0!.seq.grid.pixel_scale_arcsec} xform={xf} onXform={setXf} ariaLabel={ariaFor(shown)} />
              {cmp === "blink" && <figcaption className="blink-tag"><b>{phase ? "B" : "A"}</b> {monthSpan(stops[shown].meta.date_start, stops[shown].meta.date_end)}</figcaption>}
            </figure>
          ))}
        </div>
        )}

        <header className="stage-head" ref={headRef}>
          <h1>{title}</h1>
          {stop && (
            <p className="stage-when">
              <span>{cmp === "none" ? (st.view === "exposures" ? stop.meta.time_mid.replace("T", " ").slice(0, 16) + " UTC" : `${longDate(stop.meta.date_start)} to ${longDate(stop.meta.date_end)}`) : "Comparing two surveys"}</span>
              <span className="stage-band">{bandText}</span>
            </p>
          )}
        </header>

        <div className="stage-tools" role="toolbar" aria-label="View tools">
          <button className="tool" aria-label="Zoom in" onClick={() => setXf((x) => ({ ...x, zoom: Math.min(20, x.zoom * 1.4) }))}>+</button>
          <button className="tool" aria-label="Zoom out" onClick={() => setXf((x) => ({ ...x, zoom: Math.max(0.5, x.zoom / 1.4) }))}>−</button>
          <button className="tool wide" onClick={() => ch0 && setXf({ zoom: 1, cx: ch0.seq.grid.nx / 2, cy: ch0.seq.grid.ny / 2 })}>Fit</button>
          {st.grid && (
            <button className={`tool wide ${linked ? "on" : ""}`} aria-pressed={linked} onClick={() => setLinked((l) => !l)}
              title="Zoom and move all six panels together">{linked ? "Linked" : "Not linked"}</button>
          )}
          <button className="tool wide" onClick={share}>{copied ? "Copied" : "Copy link"}</button>
          {invCard && (
            <button className={`tool wide ${st.inv ? "on" : ""}`} aria-expanded={st.inv}
              onClick={() => (st.inv ? update({ inv: false }) : update({ inv: true, step: st.step ?? 0 }))}>Investigate</button>
          )}
          <button className={`tool wide ${drawer && !st.inv ? "on" : ""}`} aria-expanded={drawer && !st.inv}
            onClick={() => { if (st.inv) { update({ inv: false }); setDrawer(true); } else setDrawer((d) => !d); }} title="I">Details</button>
        </div>

        {gameOpen && !err && (
          <div className="status game" role="region" aria-label="Rocket game">
            {gridBusy ? (
              <div className="game-load">
                <span>Detector {gridLoading} ({Math.min(gridDone + 1, 6)} of 6): {waitText}</span>
                <div className="meter" aria-hidden="true"><i style={{ width: `${Math.round(((gridDone + (buildFrac ?? 0)) / 6) * 100)}%` }} /></div>
              </div>
            ) : !channels && (
              <div className="game-load">
                <span>{waitText}</span>
                {buildFrac !== null && <div className="meter" aria-hidden="true"><i style={{ width: `${Math.round(buildFrac * 100)}%` }} /></div>}
              </div>
            )}
            <RocketGame ready={gameReady} readyText={gameReadyText}
              onShowSky={() => setGameOpen(false)} onClose={() => setGameOpen(false)} />
          </div>
        )}

        {gridSlow && channels && !gameOpen && !err && (
          <button className="chip game-start grid-game" onClick={() => setGameOpen(true)}>
            Play a game while detectors {Math.min(gridDone + 1, 6)}–6 load
          </button>
        )}

        {!(gameOpen && !err) && (err || !channels || (n === 0 && !st.grid)) && (
          <div className={`status ${err ? "error" : ""}`} role={err ? "alert" : "status"} aria-live="polite">
            {err ? (
              <>
                <p><strong>This view could not be loaded.</strong> {err}</p>
                <div className="status-actions">
                  <button className="chip on" onClick={() => setRetryN((r) => r + 1)}>Try again</button>
                  <button className="chip" onClick={() => onNavigate("/?target=barnard&det=3&fov=10")}>Open Barnard's Star instead</button>
                </div>
              </>
            ) : !channels ? (
              <>
                <p><strong>{waitText}</strong></p>
                {buildFrac !== null && <div className="meter" aria-hidden="true"><i style={{ width: `${Math.round(buildFrac * 100)}%` }} /></div>}
                <p className="quiet">{waking
                  ? "The search server sleeps when nobody has searched for a while and takes up to a minute to wake. Featured targets open instantly."
                  : "A new patch of sky downloads real SPHEREx exposures, about a minute the first time. Featured targets open instantly."}</p>
                {slowLoad && <button className="chip game-start" onClick={() => setGameOpen(true)}>Play a game while you wait</button>}
              </>
            ) : (
              <>
                <p><strong>No SPHEREx coverage here yet</strong> {st.col ? "in all three colour bands." : `for detector ${st.det} in the current releases.`}</p>
                <p className="quiet">A name that resolves is not a guarantee SPHEREx has observed it. Try another band on the rail below.</p>
              </>
            )}
          </div>
        )}

        {hasSaturatedStar && (
          <SaturationNote suppressed={st.flags} swing={satSwing} compact={st.grid || st.inv} onShowPixels={() => { update({ flags: true }); if (window.innerWidth >= 1100) setDrawer(true); }} />
        )}

        <div className="dock" ref={dockRef}>
          <SpectralRail det={st.det} colour={st.col} colourDets={colourDets} grid={st.grid}
            onDet={(d) => update({ det: d, col: false, frame: undefined, a: undefined, b: undefined })}
            onColour={(on) => update({ col: on, grid: false, frame: undefined, a: undefined, b: undefined })}
            onGrid={(on) => update({ grid: on, col: false, frame: undefined, a: undefined, b: undefined })}
            coverage={ch0?.seq.coverage} />
          <div className="dock-row">
            {n > 0 && cmp === "none" && (
              <Timeline frames={stops.map((s) => s.meta)} index={frameIdx} onIndex={(i) => update({ frame: i })}
                playing={playing} onPlaying={setPlaying} view={st.view} />
            )}
            {n > 0 && cmp !== "none" && (
              <div className="compare">
                <Timeline frames={stops.map((s) => s.meta)} index={shown} onIndex={(i) => update(i <= (a + b) / 2 ? { a: i } : { b: i })}
                  playing={cmp === "blink" && blinkRunning} onPlaying={(p) => cmp === "blink" ? setBlinkRunning(p) : undefined}
                  view={st.view} marks={[a, b]} />
              </div>
            )}
            <div className="modes">
              {cmp === "blink" && (
                <label className="rate"><span className="sr-only">Blink speed</span>
                  <select value={blinkHz} onChange={(e) => setBlinkHz(Math.min(MAX_BLINK_HZ, Number(e.target.value)))}>
                    <option value={0.5}>Slow blink</option><option value={1}>1 per second</option><option value={2}>2 per second</option><option value={3}>3 per second</option>
                  </select>
                </label>
              )}
              <div className="seg" role="radiogroup" aria-label="Compare">
                {(["none", "blink", "side"] as const).map((m) => (
                  <button key={m} role="radio" aria-checked={cmp === m} className={cmp === m ? "on" : ""}
                    disabled={(m !== "none" && n < 2) || (m === "side" && st.grid)}
                    onClick={() => update({ cmp: m })} title={m === "blink" ? "B" : undefined}>
                    {m === "none" ? "Step" : m === "blink" ? "Blink" : "Side by side"}
                  </button>
                ))}
              </div>
              <div className="seg" role="radiogroup" aria-label="Field of view">
                {FOV_PRESETS.map((p) => (
                  <button key={p.id} role="radio" aria-checked={st.fov === p.id} className={st.fov === p.id ? "on" : ""} onClick={() => update({ fov: p.id })}>{p.label}</button>
                ))}
              </div>
              <button className={`chip ${st.px ? "on" : ""}`} aria-pressed={st.px} onClick={() => update({ px: !st.px })}
                title="Show each SPHEREx pixel as a square instead of the smoothed display">True pixels</button>
            </div>
          </div>
        </div>
      </section>

      {st.inv && invCard ? (
        <InvestigationPanel card={invCard} step={st.step ?? 0} onStep={applyStep} featured={featured}
          onClose={() => update({ inv: false })} onNavigate={onNavigate} />
      ) : channels && ch0 && (
        <DataPanel seq={ch0.seq} channels={st.grid
            ? [...channels].sort((x, y) => x.det - y.det).map((c) => { const m = stop ? matchFrame(c.seq, stop.meta) : null; return { det: c.det, frame: m ? c.seq.frames[m.i] : undefined }; })
            : channels.map((c, k) => ({ det: c.det, frame: stop ? c.seq.frames[stop.idx[k]] : undefined }))}
          colour={st.col} frame={stop?.meta} frameTag={cmp === "blink" ? `Showing ${phase ? "B" : "A"}` : cmp === "side" ? "A, on the left" : undefined}
          look={look} onLook={setLook} showFlags={st.flags} onFlags={(v) => update({ flags: v })}
          showMarker={st.marker} onMarker={(v) => update({ marker: v })}
          view={st.view} onView={(v) => update({ view: v, col: false, frame: undefined, a: undefined, b: undefined })}
          compare={cmp} pair={pairMeta} swing={satSwing} open={drawer} onClose={() => setDrawer(false)}
          ast={st.ast} onAst={(v) => update({ ast: v })} astStatus={astRes[cmp === "side" ? a : shown]} />
      )}
    </main>
  );
}

function stageText(b: BuildStatus): string {
  switch (b.stage) {
    case "queued": return "Queued";
    case "searching": return "Searching the SPHEREx archive";
    case "downloading": return `Downloading exposures, ${b.done} of ${b.total}`;
    case "combining": return `Combining survey ${b.done + 1} of ${b.total}`;
    default: return "Working";
  }
}

// ---- home: Barnard's Star itself, blinking between its first and latest survey ----------

function Hero({ featured, featuredReady, onPickFeatured, onResolved, onChallenge, onNavigate }: {
  featured: FeaturedCard[]; featuredReady: boolean; onNavigate: (to: string) => void;
  onPickFeatured: (c: FeaturedCard) => void; onResolved: (t: TargetInfo) => void;
  onChallenge: (c: (typeof CHALLENGE_TARGETS)[number], demo?: boolean) => void;
}) {
  const [frames, setFrames] = useState<{ img: ImageData; marker: FrameMeta["marker"]; when: string }[] | null>(null);
  const [phase, setPhase] = useState(0);
  const [xf, setXf] = useState<ViewXform>({ zoom: 1, cx: 50, cy: 50 });
  useEffect(() => {
    if (!featuredReady) return;
    const card = featured.find((c) => c.slug === "barnard");
    if (!card) return;
    const want = [1, 3, 6].map((d) => card.sequences[`${d}-survey`]);
    const grey = card.sequences["3-survey"];
    if (!grey) return;
    let live = true;
    (async () => {
      const useColour = want.every(Boolean);
      const seqs = await Promise.all((useColour ? want : [grey]).map((f) => fetchFeaturedSequence(f!)));
      const s0 = seqs[useColour ? 1 : 0];
      if (s0.frames.length < 2) return;
      const out = [];
      for (const i of [0, s0.frames.length - 1]) {
        const survey = s0.frames[i].survey;
        const planes: Plane[] = [];
        const stretches: Stretch[] = [];
        for (const sq of seqs) {
          const fi = sq.frames.findIndex((f) => f.survey === survey);
          const p = await loadPlane(sq.base!, sq.frames[fi >= 0 ? fi : 0], sq.grid.nx, sq.grid.ny, sq.query);
          planes.push(p);
          stretches.push(p.fallback ? FALLBACK_STRETCH : { lo: sq.stretch.lo, hi: sq.stretch.hi, a: sq.stretch.a });
        }
        const img = useColour
          ? renderRGB(planes as [Plane, Plane, Plane], stretches as [Stretch, Stretch, Stretch], DEFAULT_LOOK)
          : renderGray(planes[0], stretches[0], DEFAULT_LOOK);
        out.push({ img, marker: s0.frames[i].marker, when: monthSpan(s0.frames[i].date_start, s0.frames[i].date_end) });
      }
      if (live) { setFrames(out); setXf({ zoom: 1, cx: s0.grid.nx / 2, cy: s0.grid.ny / 2 }); }
    })().catch(() => undefined);
    return () => { live = false; };
  }, [featured, featuredReady]);
  useEffect(() => {
    if (!frames || reducedMotion()) return;
    const t = setInterval(() => setPhase((p) => 1 - p), 1400);
    return () => clearInterval(t);
  }, [frames]);
  const f = frames?.[phase];
  return (
    <main className="hero">
      <div className="hero-sky" aria-hidden={!f}>
        {f && <SkyCanvas image={f.img} smooth marker={f.marker} showMarker bodies={undefined} pixelScale={6.15}
          xform={xf} onXform={setXf} interactive={false} chrome={false} anchor={[0.7, 0.5]}
          ariaLabel={`Barnard's Star in SPHEREx false colour, ${f.when}`} />}
      </div>
      <div className="hero-copy">
        <h1>Watch a star walk across the sky.</h1>
        <p className="lede">
          These are real infrared images from NASA's SPHEREx telescope. It maps the whole sky every six months. Pick a star and step through the surveys to see what moved.
        </p>
        <div className="hero-search">
          <SearchBox featured={featured} onPickFeatured={onPickFeatured} onResolved={onResolved} />
          <a className="howto" href="/guide" onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); onNavigate("/guide"); }}>How to use</a>
        </div>
        <div className="hero-targets">
          <span className="quiet">Challenge targets</span>
          {CHALLENGE_TARGETS.map((c) => (
            <button key={c.slug} className="chip" onClick={() => onChallenge(c, c.slug === "barnard")}>{c.name}</button>
          ))}
        </div>
      </div>
      {f && <p className="hero-caption">Barnard's Star in SPHEREx false colour, {f.when}. It moves about 10 arcseconds a year, which SPHEREx sees as almost two pixels.</p>}
    </main>
  );
}
