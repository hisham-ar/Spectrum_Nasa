import type { View } from "./types";

/** Everything a visitor can reach is reproducible from the URL. */
export interface UrlState {
  q?: string;          // object name (resolved server-side, proper motion applied)
  ra?: number;         // typed coordinates (never propagated)
  dec?: number;
  target?: string;     // featured slug (static, pre-computed)
  fov: number;
  det: number;
  view: View;
  frame?: number;
  cmp: "none" | "blink" | "side";
  a?: number;          // compare frame A / B
  b?: number;
  flags: boolean;      // tint saturated / flagged pixels
  marker: boolean;
  ast: boolean;        // known-asteroid overlay (Every-exposure view)
  col: boolean;        // false colour from three detectors
  grid: boolean;       // all six detectors side by side
  inv: boolean;        // guided investigation panel open (Featured cards)
  step?: number;       // current investigation step
  px: boolean;         // true pixels (no display smoothing)
}

export const DEFAULTS: UrlState = { fov: 10, det: 3, view: "survey", cmp: "none", flags: false, marker: true, ast: false, col: false, grid: false, inv: false, px: false };

function num(v: string | null): number | undefined {
  if (v === null || v.trim() === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export function readUrl(search = window.location.search): UrlState {
  const p = new URLSearchParams(search);
  const det = num(p.get("det"));
  const fov = num(p.get("fov"));
  const view = p.get("view") === "exposures" ? "exposures" : "survey";
  const cmp = p.get("cmp");
  return {
    q: p.get("q") || undefined,
    ra: num(p.get("ra")),
    dec: num(p.get("dec")),
    target: p.get("target") || undefined,
    fov: fov && fov > 0 ? Math.min(fov, 20) : DEFAULTS.fov,  // a featured card sets its own field
    det: det && det >= 1 && det <= 6 ? Math.round(det) : DEFAULTS.det,
    view,
    frame: num(p.get("frame")),
    cmp: cmp === "blink" || cmp === "side" ? cmp : "none",
    a: num(p.get("a")),
    b: num(p.get("b")),
    flags: p.get("flags") === "1",
    marker: p.get("marker") !== "0",
    ast: p.get("ast") === "1",
    col: p.get("col") === "1" && p.get("grid") !== "1",
    grid: p.get("grid") === "1",
    inv: p.get("inv") === "1",
    step: num(p.get("step")),
    px: p.get("px") === "1",
  };
}

export function toSearch(s: UrlState): string {
  const p = new URLSearchParams();
  if (s.target) p.set("target", s.target);
  else if (s.q) p.set("q", s.q);
  else if (s.ra !== undefined && s.dec !== undefined) {
    p.set("ra", s.ra.toFixed(5));
    p.set("dec", s.dec.toFixed(5));
  }
  p.set("fov", String(s.fov));
  p.set("det", String(s.det));
  if (s.view !== "survey") p.set("view", s.view);
  if (s.frame !== undefined) p.set("frame", String(s.frame));
  if (s.cmp !== "none") {
    p.set("cmp", s.cmp);
    if (s.a !== undefined) p.set("a", String(s.a));
    if (s.b !== undefined) p.set("b", String(s.b));
  }
  if (s.flags) p.set("flags", "1");
  if (!s.marker) p.set("marker", "0");
  if (s.ast) p.set("ast", "1");
  if (s.col) p.set("col", "1");
  if (s.grid) p.set("grid", "1");
  if (s.inv) p.set("inv", "1");
  if (s.inv && s.step !== undefined) p.set("step", String(s.step));
  if (s.px) p.set("px", "1");
  return "?" + p.toString();
}

export function hasLocation(s: UrlState): boolean {
  return Boolean(s.target || s.q || (s.ra !== undefined && s.dec !== undefined));
}
