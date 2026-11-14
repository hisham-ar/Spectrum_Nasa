import { useEffect, useMemo, useRef, useState } from "react";
import { skyToPixel } from "../lib/coords";
import { FALLBACK_STRETCH, renderGray, type Look, type Plane } from "../lib/render";
import { DETECTORS, type FrameMeta, type Sequence } from "../lib/types";
import SkyCanvas, { type CanvasLabel, type ViewXform } from "./SkyCanvas";
import { RAIL_COLOURS } from "./SpectralRail";

/* All six detectors at once: the same patch of sky, one panel per detector, each
 * showing its visit from the same survey as the timeline where it has one, with
 * that visit's real dates. Zoom and pan are linked across panels unless unlinked. */

export interface GridChannel { det: number; seq: Sequence; planes: (Plane | null)[] }

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function dateRange(start: string, end: string): string {
  const [y1, m1, d1] = start.slice(0, 10).split("-").map(Number);
  const [y2, m2, d2] = end.slice(0, 10).split("-").map(Number);
  if (y1 === y2 && m1 === m2) return d1 === d2 ? `${d1} ${MONTHS[m1 - 1]} ${y1}` : `${d1}–${d2} ${MONTHS[m1 - 1]} ${y1}`;
  if (y1 === y2) return `${d1} ${MONTHS[m1 - 1]} – ${d2} ${MONTHS[m2 - 1]} ${y1}`;
  return `${d1} ${MONTHS[m1 - 1]} ${y1} – ${d2} ${MONTHS[m2 - 1]} ${y2}`;
}

/** Frames taken within this many days of each other belong to the same SPHEREx visit:
 *  one visit to a patch of sky spans up to about six weeks, and visits come about six months apart.
 *  (The nominal "survey" numbers can't be used for this: two visits can share a survey number.) */
export const SAME_VISIT_DAYS = 60;

/** The frame of `seq` closest in time to a reference visit, and whether it counts as the same visit. */
export function matchFrame(seq: Sequence, ref: FrameMeta): { i: number; sameVisit: boolean; gapDays: number } | null {
  if (!seq.frames.length) return null;
  const t = Date.parse(ref.time_mid);
  let best = 0, gap = Infinity;
  seq.frames.forEach((f, i) => {
    const d = (Date.parse(f.time_mid) - t) / 86400000;
    if (Math.abs(d) < Math.abs(gap)) { best = i; gap = d; }
  });
  return { i: best, sameVisit: Math.abs(gap) <= SAME_VISIT_DAYS, gapDays: gap };
}

function gapText(days: number): string {
  const months = Math.max(1, Math.round(Math.abs(days) / 30.44));
  return `no visit at this time; closest is ${months} month${months === 1 ? "" : "s"} ${days > 0 ? "later" : "earlier"}`;
}

interface Props {
  dets: number[];                        // panel order (1..6)
  channels: GridChannel[];               // loaded so far
  refDet: number;                        // the detector the timeline follows
  refFrame: FrameMeta | undefined;       // the visit on the timeline
  loading: { det: number; text: string | null; frac: number | null } | null;
  failed: Record<number, string>;
  look: Look;
  smooth: boolean;
  showMarker: boolean;
  linked: boolean;
  xform: ViewXform;
  onXform: (x: ViewXform) => void;
  labelsFor: (seq: Sequence) => CanvasLabel[] | undefined;
  onPick: (det: number) => void;
}

export default function GridView(p: Props) {
  const ref = p.channels.find((c) => c.det === p.refDet) ?? p.channels[0];

  // Grids normally match exactly; if one doesn't, shift its view so the same sky stays centred.
  const offsets = useMemo(() => {
    const out: Record<number, { x: number; y: number }> = {};
    if (!ref) return out;
    for (const c of p.channels) {
      const g = c.seq.grid, rg = ref.seq.grid;
      const a = skyToPixel(g, rg.crval[0], rg.crval[1]), b = skyToPixel(rg, rg.crval[0], rg.crval[1]);
      out[c.det] = { x: a.x - b.x, y: a.y - b.y };
    }
    return out;
  }, [p.channels, ref]);

  // Unlinked panels keep their own view, starting from wherever the shared view was.
  const [own, setOwn] = useState<Record<number, ViewXform>>({});
  useEffect(() => { if (!p.linked) setOwn({}); }, [p.linked]);

  // Pick the layout (6x1, 3x2, 2x3 or 1x6) that gives the biggest square panels in the space we have.
  const box = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState(3);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const { width: w, height: h } = e.contentRect;
      let best = 3, bestSide = 0;
      for (const c of [6, 3, 2, 1]) {
        const side = Math.min(w / c, h / Math.ceil(6 / c));
        if (side > bestSide * 1.04) { best = c; bestSide = side; }
      }
      setCols(best);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const cache = useRef(new Map<string, ImageData>());
  useEffect(() => { cache.current.clear(); }, [p.channels, p.look]);
  const imageOf = (c: GridChannel, i: number): ImageData | null => {
    const key = `${c.det}:${i}`;
    const hit = cache.current.get(key);
    if (hit) return hit;
    const plane = c.planes[i];
    if (!plane) return null;
    const stretch = plane.fallback ? FALLBACK_STRETCH : { lo: c.seq.stretch.lo, hi: c.seq.stretch.hi, a: c.seq.stretch.a };
    const img = renderGray(plane, stretch, p.look);
    cache.current.set(key, img);
    return img;
  };

  return (
    <div className="canvases grid" role="group" aria-label="All six detectors" ref={box}
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${Math.ceil(6 / cols)}, minmax(0, 1fr))` }}>
      {p.dets.map((det, k) => {
        const c = p.channels.find((x) => x.det === det);
        const [lo, hi] = DETECTORS[det].band;
        const head = (
          <div className="grid-head">
            <span className="grid-swatch" style={{ background: RAIL_COLOURS[det - 1] }} aria-hidden="true" />
            <span className="grid-name">Detector {det}</span>
            <span className="grid-band">{lo.toFixed(2)}–{hi.toFixed(2)} µm</span>
          </div>
        );
        if (!c) {
          const busy = p.loading?.det === det;
          return (
            <figure key={det} className="pane grid-pane pending">
              {head}
              <div className="grid-wait">
                {p.failed[det] ? <p>Could not load this detector. {p.failed[det]}</p> : (
                  <>
                    <p>{busy ? (p.loading?.text ?? "Searching the archive") : "Waiting for its turn"}</p>
                    {busy && p.loading?.frac != null && <div className="meter" aria-hidden="true"><i style={{ width: `${Math.round(p.loading.frac * 100)}%` }} /></div>}
                  </>
                )}
              </div>
            </figure>
          );
        }
        const m = p.refFrame ? matchFrame(c.seq, p.refFrame) : null;
        if (!m) {
          return (
            <figure key={det} className="pane grid-pane pending">
              {head}
              <div className="grid-wait"><p>No SPHEREx data here for this detector yet.</p></div>
            </figure>
          );
        }
        const f = c.seq.frames[m.i];
        const off = offsets[det] ?? { x: 0, y: 0 };
        const xf = p.linked ? { ...p.xform, cx: p.xform.cx + off.x, cy: p.xform.cy + off.y } : (own[det] ?? { ...p.xform, cx: p.xform.cx + off.x, cy: p.xform.cy + off.y });
        const setXf = (x: ViewXform) => (p.linked
          ? p.onXform({ ...x, cx: x.cx - off.x, cy: x.cy - off.y })
          : setOwn((o) => ({ ...o, [det]: x })));
        return (
          <figure key={det} className={`pane grid-pane ${det === p.refDet ? "ref" : ""} ${m.sameVisit ? "" : "other-visit"}`}>
            <SkyCanvas image={imageOf(c, m.i)} smooth={p.smooth} marker={f.marker} showMarker={p.showMarker}
              labels={p.labelsFor(c.seq)} pixelScale={c.seq.grid.pixel_scale_arcsec} xform={xf} onXform={setXf}
              chrome={k === p.dets.length - 1} ariaLabel={`Detector ${det}, ${lo.toFixed(2)} to ${hi.toFixed(2)} micrometres, ${dateRange(f.date_start, f.date_end)}`} />
            {head}
            <figcaption className="grid-when">
              {dateRange(f.date_start, f.date_end)}
              {!m.sameVisit && <span className="grid-other"> ({gapText(m.gapDays)})</span>}
            </figcaption>
            <button className="grid-open" onClick={() => p.onPick(det)} title={`Show detector ${det} on its own`}>Show alone</button>
          </figure>
        );
      })}
    </div>
  );
}
