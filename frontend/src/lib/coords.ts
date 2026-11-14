export function fmtRa(deg: number): string {
  let h = ((deg % 360) + 360) % 360 / 15;
  const hh = Math.floor(h);
  h = (h - hh) * 60;
  const mm = Math.floor(h);
  const ss = (h - mm) * 60;
  return `${String(hh).padStart(2, "0")}h${String(mm).padStart(2, "0")}m${ss.toFixed(1).padStart(4, "0")}s`;
}

export function fmtDec(deg: number): string {
  const sign = deg < 0 ? "−" : "+";
  let d = Math.abs(deg);
  const dd = Math.floor(d);
  d = (d - dd) * 60;
  const mm = Math.floor(d);
  const ss = (d - mm) * 60;
  return `${sign}${String(dd).padStart(2, "0")}°${String(mm).padStart(2, "0")}′${ss.toFixed(0).padStart(2, "0")}″`;
}

/** Quick client-side check so typeahead can label "Coordinates" instantly. */
export function looksLikeCoords(text: string): boolean {
  const s = text.trim();
  if (/^[+-]?\d+(\.\d*)?\s*[ ,;]\s*[+-]?\d+(\.\d*)?$/.test(s)) return true;
  if (/\d\s*[hH:]\s*\d/.test(s)) return true;
  return /^[\d\s.+\-:dDhHmMsS°′″'",]+$/.test(s) && (s.match(/\d+(\.\d+)?/g) || []).length >= 4;
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}
