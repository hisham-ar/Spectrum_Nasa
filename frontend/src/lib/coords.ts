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

/** Sky position to display pixel (x right, y down) on a sequence's grid: gnomonic
 *  projection, north up, east left. Matches backend/lits/coadd.target_grid. */
export function skyToPixel(grid: { nx: number; ny: number; pixel_scale_arcsec: number; crval: [number, number]; crpix?: [number, number] },
  ra: number, dec: number): { x: number; y: number } {
  const rad = Math.PI / 180;
  const [a0, d0] = [grid.crval[0] * rad, grid.crval[1] * rad];
  const [a, d] = [ra * rad, dec * rad];
  const cosc = Math.sin(d0) * Math.sin(d) + Math.cos(d0) * Math.cos(d) * Math.cos(a - a0);
  const xi = (Math.cos(d) * Math.sin(a - a0)) / cosc / rad;           // degrees, east positive
  const eta = (Math.cos(d0) * Math.sin(d) - Math.sin(d0) * Math.cos(d) * Math.cos(a - a0)) / cosc / rad;
  const sc = grid.pixel_scale_arcsec / 3600;
  const [cx, cy] = grid.crpix ?? [(grid.nx + 1) / 2, (grid.ny + 1) / 2];
  return { x: cx - 1 - xi / sc, y: grid.ny - 1 - (cy - 1 + eta / sc) };
}
