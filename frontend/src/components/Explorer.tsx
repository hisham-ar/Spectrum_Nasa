import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchFeaturedSequence, fetchSequence, type LocationParams } from "../lib/api";
import { DEFAULTS, hasLocation, readUrl, toSearch, type UrlState } from "../lib/url";
import { FOV_PRESETS, type BuildStatus, type FeaturedCard, type Sequence, type TargetInfo } from "../lib/types";
import SkyCanvas, { loadFrame, type Display, type LoadedFrame, type ViewXform } from "./SkyCanvas";
import Timeline from "./Timeline";
import DetectorBar from "./DetectorBar";
import DataPanel from "./DataPanel";
import SearchBox from "./SearchBox";

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
const MAX_BLINK_HZ = 3; // WCAG 2.3.1: never more than 3 flashes per second

/** Challenge targets, used when no pre-computed Featured cache is present. */
export const CHALLENGE_TARGETS: { name: string; q: string; det: number; fov: number; slug: string }[] = [
  { name: "Barnard's Star", q: "Barnard's Star", det: 3, fov: 10, slug: "barnard" },
  { name: "ε Indi B", q: "eps Ind B", det: 6, fov: 10, slug: "eps-indi-b" },
  { name: "WISE 0855−0714", q: "WISE J085510.83-071442.5", det: 6, fov: 10, slug: "wise-0855" },
  { name: "RW Aurigae", q: "RW Aur", det: 3, fov: 10, slug: "rw-aur" },
  { name: "R Draconis", q: "R Dra", det: 3, fov: 10, slug: "r-dra" },
];

interface Props {
  featured: FeaturedCard[];
  featuredReady: boolean;
  onDataDate: (d: string | null) => void;
}

export default function Explorer({ featured, featuredReady, onDataDate }: Props) {
  const [st, setSt] = useState<UrlState>(() => readUrl());
  const [seq, setSeq] = useState<Sequence | null>(null);
  const [build, setBuild] = useState<BuildStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<(LoadedFrame | null)[]>([]);
  const [xf, setXf] = useState<ViewXform>({ zoom: 1, cx: 50, cy: 50 });
  const [playing, setPlaying] = useState(false);
  const [fps, setFps] = useState(1);
  const [blinkRunning, setBlinkRunning] = useState(() => !reducedMotion());
  const [blinkHz, setBlinkHz] = useState(1);
  const [phase, setPhase] = useState(0);
  const [panelOpen, setPanelOpen] = useState(false);
  const [disp, setDisp] = useState<Omit<Display, "showFlags" | "showMarker">>({ brightness: 0, contrast: 1, smooth: false });
  const [copied, setCopied] = useState(false);

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

  const card = st.target ? featured.find((c) => c.slug === st.target) : undefined;
  const challenge = st.target ? CHALLENGE_TARGETS.find((c) => c.slug === st.target) : undefined;
  const locKey = `${featuredReady}|${st.target ?? ""}|${st.q ?? ""}|${st.ra ?? ""}|${st.dec ?? ""}|${st.fov}|${st.det}|${st.view}|${card ? "c" : ""}`;

  // --- load sequence --------------------------------------------------------------
  useEffect(() => {
    if (!hasLocation(st)) { setSeq(null); return; }
    if (st.target && !featuredReady) return; // wait: the target may be pre-computed
    const ac = new AbortController();
    setErr(null); setBuild(null); setSeq(null); setLoaded([]); setPlaying(false);
    (async () => {
      try {
        const folder = card?.sequences[`${st.det}-${st.view}`];
        let s: Sequence;
        if (folder && card && st.fov === card.fov) {
          s = await fetchFeaturedSequence(folder, ac.signal);
        } else {
          let loc: LocationParams;
          if (card) loc = { q: card.q ?? card.name };
          else if (challenge) loc = { q: challenge.q };
          else if (st.q) loc = { q: st.q };
          else loc = { ra: st.ra, dec: st.dec };
          s = await fetchSequence(loc, st.fov, st.det, st.view, setBuild, ac.signal);
        }
        if (ac.signal.aborted) return;
        setSeq(s);
        setBuild(null);
        const last = s.provenance.queried_at ?? s.provenance.built_at;
        onDataDate(last ? String(last).slice(0, 10) : null);
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setErr((e as Error).message);
      }
    })();
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locKey]);

  // --- load frame images -----------------------------------------------------------
  useEffect(() => {
    if (!seq) return;
    let live = true;
    setXf({ zoom: 1, cx: seq.grid.nx / 2, cy: seq.grid.ny / 2 });
    Promise.all(seq.frames.map((f) => loadFrame(seq.base + f.png, seq.base + f.mask).catch(() => null)))
      .then((fr) => { if (live) setLoaded(fr); });
    return () => { live = false; };
  }, [seq]);

  const n = seq?.frames.length ?? 0;
  const clamp = (i: number | undefined, d: number) => (i === undefined || !Number.isFinite(i) ? d : Math.max(0, Math.min(n - 1, Math.round(i))));
  const frameIdx = clamp(st.frame, 0);
  const a = clamp(st.a, 0);
  const b = clamp(st.b, n - 1);
  const cmp = n < 2 ? "none" : st.cmp;

  // --- playback --------------------------------------------------------------------
  useEffect(() => {
    if (!playing || n < 2 || cmp !== "none") return;
    const t = setInterval(() => {
      setSt((s) => {
        const next = { ...s, frame: ((s.frame ?? 0) + 1) % n };
        window.history.replaceState(null, "", window.location.pathname + toSearch(next));
        return next;
      });
    }, 1000 / fps);
    return () => clearInterval(t);
  }, [playing, fps, n, cmp]);

  useEffect(() => {
    if (cmp !== "blink" || !blinkRunning) return;
    const hz = Math.min(blinkHz, MAX_BLINK_HZ);
    const t = setInterval(() => setPhase((p) => 1 - p), 1000 / hz);
    return () => clearInterval(t);
  }, [cmp, blinkRunning, blinkHz]);

  const shown = cmp === "blink" ? (phase ? b : a) : frameIdx;

  // --- keyboard ----------------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (!seq) return;
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        if (cmp === "blink") { setBlinkRunning(false); setPhase((p) => 1 - p); return; }
        const d = e.key === "ArrowLeft" ? -1 : 1;
        update({ frame: Math.max(0, Math.min(n - 1, frameIdx + d)) });
      } else if (e.key === " ") {
        e.preventDefault();
        if (cmp === "blink") setBlinkRunning((r) => !r);
        else if (n > 1) setPlaying((p) => !p);
      } else if (e.key === "b" || e.key === "B") {
        if (n > 1) update({ cmp: cmp === "blink" ? "none" : "blink" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [seq, cmp, n, frameIdx, update]);

  const display: Display = useMemo(() => ({ ...disp, showFlags: st.flags, showMarker: st.marker }), [disp, st.flags, st.marker]);
  const setDisplay = (d: Display) => {
    setDisp({ brightness: d.brightness, contrast: d.contrast, smooth: d.smooth });
    if (d.showFlags !== st.flags || d.showMarker !== st.marker) update({ flags: d.showFlags, marker: d.showMarker });
  };

  const goTarget = (t: TargetInfo) => {
    if (t.kind === "coords") update({ ra: t.ra, dec: t.dec, q: undefined, target: undefined, frame: undefined, cmp: "none", a: undefined, b: undefined }, true);
    else update({ q: t.query, ra: undefined, dec: undefined, target: undefined, frame: undefined, cmp: "none", a: undefined, b: undefined, fov: t.moves ? 10 : st.fov }, true);
  };
  const goCard = (c: FeaturedCard) => update({ target: c.slug, q: undefined, ra: undefined, dec: undefined, det: c.det, fov: c.fov, view: c.view, frame: c.frame, cmp: c.compare ?? "none", a: undefined, b: undefined }, true);
  const goChallenge = (c: (typeof CHALLENGE_TARGETS)[number], demo = false) => {
    const fc = featured.find((f) => f.slug === c.slug);
    if (fc) { goCard({ ...fc, compare: demo ? "blink" : fc.compare }); return; }
    update({ target: c.slug, q: undefined, ra: undefined, dec: undefined, det: c.det, fov: c.fov, view: "survey", frame: undefined, cmp: demo ? "blink" : "none", a: undefined, b: undefined }, true);
  };

  const share = async () => {
    try { await navigator.clipboard.writeText(window.location.href); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { /* ignore */ }
  };

  // --- render: welcome --------------------------------------------------------------
  if (!hasLocation(st)) {
    return (
      <main className="welcome">
        <h1>Watch the infrared sky move.</h1>
        <p className="lede">Real images from NASA's SPHEREx telescope, survey by survey. Type a star or coordinates, then step through time.</p>
        <SearchBox featured={featured} onPickFeatured={goCard} onResolved={goTarget} autoFocus />
        <button className="demo-invite" onClick={() => goChallenge(CHALLENGE_TARGETS[0], true)}>
          <span className="dot" aria-hidden="true" /> Want to see the sky change? <strong>Try a 30-second demo</strong>
        </button>
        <h2 className="quick-h">The five challenge targets</h2>
        <div className="quick">
          {CHALLENGE_TARGETS.map((c) => {
            const fc = featured.find((f) => f.slug === c.slug);
            return (
              <button key={c.slug} className="quick-btn" onClick={() => goChallenge(c)}>
                <span>{c.name}</span>
                <span className={`pill ${fc ? "ok" : ""}`}>{fc ? "instant" : "live"}</span>
              </button>
            );
          })}
        </div>
      </main>
    );
  }

  const frame = seq?.frames[cmp === "side" ? a : shown];
  const pairMeta = seq && n >= 2 ? ([seq.frames[a], seq.frames[b]] as [typeof seq.frames[0], typeof seq.frames[0]]) : undefined;
  const title = seq?.target?.name ?? card?.name ?? challenge?.name ?? st.q ?? (st.ra !== undefined ? `${st.ra?.toFixed(4)}, ${st.dec?.toFixed(4)}` : "");

  return (
    <main className="explorer">
      <div className="explorer-top">
        <SearchBox featured={featured} onPickFeatured={goCard} onResolved={goTarget} compact />
        <DetectorBar det={st.det} onDet={(d) => update({ det: d, frame: undefined, a: undefined, b: undefined })} coverage={seq?.coverage} />
      </div>

      <div className="stage">
        <div className="stage-main">
          <div className="toolbar" role="toolbar" aria-label="View controls">
            <h1 className="stage-title">{title}</h1>
            <div className="seg" role="radiogroup" aria-label="Field of view">
              {FOV_PRESETS.map((p) => (
                <button key={p.id} role="radio" aria-checked={st.fov === p.id} className={st.fov === p.id ? "on" : ""} onClick={() => update({ fov: p.id })}>{p.label}</button>
              ))}
            </div>
            <div className="seg" role="radiogroup" aria-label="Compare mode">
              <button role="radio" aria-checked={cmp === "none"} className={cmp === "none" ? "on" : ""} onClick={() => update({ cmp: "none" })}>Single</button>
              <button role="radio" aria-checked={cmp === "blink"} className={cmp === "blink" ? "on" : ""} disabled={n < 2} onClick={() => update({ cmp: "blink" })} title="Blink (B)">Blink</button>
              <button role="radio" aria-checked={cmp === "side"} className={cmp === "side" ? "on" : ""} disabled={n < 2} onClick={() => update({ cmp: "side" })}>Side by side</button>
            </div>
            <div className="zoom">
              <button className="btn icon" aria-label="Zoom in" onClick={() => setXf((x) => ({ ...x, zoom: Math.min(16, x.zoom * 1.4) }))}>+</button>
              <button className="btn icon" aria-label="Zoom out" onClick={() => setXf((x) => ({ ...x, zoom: Math.max(0.5, x.zoom / 1.4) }))}>−</button>
              <button className="btn" onClick={() => seq && setXf({ zoom: 1, cx: seq.grid.nx / 2, cy: seq.grid.ny / 2 })}>Reset</button>
            </div>
            <button className="btn" onClick={share}>{copied ? "Link copied" : "Share"}</button>
            <button className="btn only-mobile" onClick={() => setPanelOpen(true)} aria-expanded={panelOpen}>Details</button>
          </div>

          {err && (
            <div className="state error" role="alert">
              <p><strong>Could not load this view.</strong> {err}</p>
              <button className="btn" onClick={() => update({ ...DEFAULTS, target: "barnard", q: undefined, ra: undefined, dec: undefined }, true)}>Open the Barnard's Star demo instead</button>
            </div>
          )}
          {!err && !seq && (
            <div className="state loading" aria-live="polite">
              <p><strong>{build ? stageText(build) : "Searching the SPHEREx archive…"}</strong></p>
              {build && build.total > 0 && <progress max={build.total} value={build.done} />}
              {build?.elapsed_s !== undefined && <p className="small muted">{build.elapsed_s.toFixed(0)} s. The first look at a new patch downloads real SPHEREx cutouts from IRSA. Featured targets open instantly.</p>}
            </div>
          )}
          {seq && n === 0 && (
            <div className="state empty">
              <p><strong>No SPHEREx coverage yet</strong> for detector {seq.detector.id} at this position in the current releases.</p>
              <p className="small muted">A name resolving does not guarantee SPHEREx has observed it. Try another detector above (they show how many epochs each has), or a featured target.</p>
            </div>
          )}

          {seq && n > 0 && (
            <>
              <div className={`canvases ${cmp === "side" ? "two" : ""}`}>
                {cmp === "side" ? (
                  <>
                    <SkyCanvas frame={loaded[a] ?? null} marker={seq.frames[a].marker} pixelScale={seq.grid.pixel_scale_arcsec} display={display} xform={xf} onXform={setXf}
                      label={`A · Survey ${seq.frames[a].survey} · ${seq.frames[a].date_start} · D${seq.detector.id} · ${seq.frames[a].release}`} ariaLabel={seq.frames[a].summary} />
                    <SkyCanvas frame={loaded[b] ?? null} marker={seq.frames[b].marker} pixelScale={seq.grid.pixel_scale_arcsec} display={display} xform={xf} onXform={setXf}
                      label={`B · Survey ${seq.frames[b].survey} · ${seq.frames[b].date_start} · D${seq.detector.id} · ${seq.frames[b].release}`} ariaLabel={seq.frames[b].summary} />
                  </>
                ) : (
                  <SkyCanvas frame={loaded[shown] ?? null} marker={frame?.marker ?? null} pixelScale={seq.grid.pixel_scale_arcsec} display={display} xform={xf} onXform={setXf}
                    label={cmp === "blink" ? `${phase ? "B" : "A"} · Survey ${frame?.survey} · ${frame?.date_start} · ${frame?.release}` : undefined}
                    ariaLabel={frame?.summary ?? "SPHEREx frame"} />
                )}
              </div>

              {cmp !== "none" ? (
                <div className="compare-bar">
                  <p className="small">
                    {a === 0 && b === n - 1 ? `Showing the two most widely separated surveys for detector ${seq.detector.id}.` : `Comparing two chosen frames for detector ${seq.detector.id}.`}
                  </p>
                  <label>A <select value={a} onChange={(e) => update({ a: Number(e.target.value) })}>{seq.frames.map((f, i) => <option key={i} value={i}>{st.view === "exposures" ? f.time_mid.slice(0, 16) : `Survey ${f.survey} · ${f.date_start}`}</option>)}</select></label>
                  <label>B <select value={b} onChange={(e) => update({ b: Number(e.target.value) })}>{seq.frames.map((f, i) => <option key={i} value={i}>{st.view === "exposures" ? f.time_mid.slice(0, 16) : `Survey ${f.survey} · ${f.date_start}`}</option>)}</select></label>
                  {cmp === "blink" && (
                    <>
                      <button className="btn" onClick={() => setBlinkRunning((r) => !r)}>{blinkRunning ? "Pause blink" : "Start blink"}</button>
                      <label>Rate <select value={blinkHz} onChange={(e) => setBlinkHz(Math.min(MAX_BLINK_HZ, Number(e.target.value)))}>
                        <option value={0.5}>0.5 / s</option><option value={1}>1 / s</option><option value={2}>2 / s</option><option value={3}>3 / s (max)</option>
                      </select></label>
                    </>
                  )}
                </div>
              ) : (
                <Timeline frames={seq.frames} index={frameIdx} onIndex={(i) => update({ frame: i })} playing={playing} onPlaying={setPlaying} fps={fps} onFps={setFps} view={st.view} />
              )}
            </>
          )}
        </div>

        {seq && (
          <DataPanel seq={seq} frame={frame} frameTag={cmp === "blink" ? `Showing ${phase ? "B" : "A"}` : cmp === "side" ? "Showing A (left)" : undefined}
            display={display} onDisplay={setDisplay} view={st.view} onView={(v) => update({ view: v, frame: undefined, a: undefined, b: undefined })}
            compare={cmp} pair={pairMeta} open={panelOpen} onClose={() => setPanelOpen(false)} />
        )}
      </div>
    </main>
  );
}

function stageText(b: BuildStatus): string {
  switch (b.stage) {
    case "queued": return "Queued…";
    case "searching": return "Searching the SPHEREx archive (IRSA)…";
    case "downloading": return `Downloading SPHEREx cutouts: ${b.done} of ${b.total}`;
    case "combining": return `Combining exposures: epoch ${b.done + 1} of ${b.total}`;
    default: return "Working…";
  }
}
