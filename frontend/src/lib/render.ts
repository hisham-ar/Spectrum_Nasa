/* Rendering of real SPHEREx values in the browser.
 *
 * Each frame arrives as float32 surface brightness (MJy/sr, north up) plus a
 * pixel-class mask. The display stretch is shared by every frame of a
 * sequence, so a brightness change on screen is a change in the data.
 */

export interface Plane {
  data: Float32Array;       // MJy/sr, NaN where unusable
  mask: Uint8ClampedArray;  // 0 good, 1 saturated, 2 flagged, 3 outside, 4 near saturation
  w: number;
  h: number;
  fallback?: boolean;       // older sequence: values are already-stretched 0-255
}

export interface Stretch { lo: number; hi: number; a: number }

export interface Look {
  gain: number;        // -2..+2: brightens by raising the white point (2^-gain)
  soft: number;        // -2..+2: asinh softening multiplier (2^soft), more = flatter
  showFlags: boolean;
}

export const DEFAULT_LOOK: Look = { gain: 0, soft: 0, showFlags: false };

export const SAT_RGB: [number, number, number] = [255, 79, 216];
export const FLAG_RGB: [number, number, number] = [122, 108, 255];
const OUTSIDE_RGB: [number, number, number] = [18, 20, 23];

function curve(s: Stretch, look: Look): (v: number) => number {
  if (s.a >= 5) {                         // fallback planes: already display values
    const k = Math.pow(2, look.gain);
    return (v) => Math.min(255, Math.max(0, v * k));
  }
  const hi = s.lo + (s.hi - s.lo) * Math.pow(2, -look.gain);
  const a = s.a * Math.pow(2, look.soft);
  const span = hi - s.lo || 1;
  const norm = Math.asinh(1 / a);
  return (v) => {
    let x = (v - s.lo) / span;
    if (!(x > 0)) return 0;
    if (x > 1) x = 1;
    return (Math.asinh(x / a) / norm) * 255;
  };
}

function maskColour(m: number, look: Look, base: [number, number, number]): [number, number, number] | null {
  if (m === 3) return OUTSIDE_RGB;
  if (m === 1) return look.showFlags ? SAT_RGB : [0, 0, 0];
  if (m === 2) return look.showFlags ? FLAG_RGB : [0, 0, 0];
  if (m === 4 && look.showFlags) return [(base[0] + SAT_RGB[0]) / 2, (base[1] + 60) / 2, (base[2] + SAT_RGB[2]) / 2];
  return null;
}

/** One detector in grey. */
export function renderGray(p: Plane, s: Stretch, look: Look): ImageData {
  const f = curve(s, look);
  const img = new ImageData(p.w, p.h);
  const px = img.data;
  for (let i = 0; i < p.data.length; i++) {
    const g = f(p.data[i]);
    const c = maskColour(p.mask[i], look, [g, g, g]) ?? [g, g, g];
    px[i * 4] = c[0]; px[i * 4 + 1] = c[1]; px[i * 4 + 2] = c[2]; px[i * 4 + 3] = 255;
  }
  return img;
}

/** False colour: three detectors (short, middle, long wavelength) as blue,
 *  green and red, each with its own shared stretch. */
export function renderRGB(planes: [Plane, Plane, Plane], s: [Stretch, Stretch, Stretch], look: Look): ImageData {
  const [b, g, r] = planes;
  const fb = curve(s[0], look), fg = curve(s[1], look), fr = curve(s[2], look);
  const img = new ImageData(r.w, r.h);
  const px = img.data;
  for (let i = 0; i < r.data.length; i++) {
    const rgb: [number, number, number] = [fr(r.data[i]), fg(g.data[i]), fb(b.data[i])];
    // a pixel unusable in any band is shown as such (never silently mixed)
    const mr = r.mask[i], mg = g.mask[i], mb = b.mask[i];
    const any = (k: number) => mr === k || mg === k || mb === k;
    const m = any(3) ? 3 : any(1) ? 1 : any(2) ? 2 : any(4) ? 4 : 0;
    const c = maskColour(m, look, rgb) ?? rgb;
    px[i * 4] = c[0]; px[i * 4 + 1] = c[1]; px[i * 4 + 2] = c[2]; px[i * 4 + 3] = 255;
  }
  return img;
}

// ---- loading ------------------------------------------------------------------------

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const im = new Image();
    im.crossOrigin = "anonymous";
    im.onload = () => res(im);
    im.onerror = () => rej(new Error(`Could not load ${src}`));
    im.src = src;
  });
}

function channel(im: HTMLImageElement): Uint8ClampedArray {
  const c = document.createElement("canvas");
  c.width = im.naturalWidth;
  c.height = im.naturalHeight;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(im, 0, 0);
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  const out = new Uint8ClampedArray(c.width * c.height);
  for (let i = 0; i < out.length; i++) out[i] = d[i * 4];
  return out;
}

/** Float frame if the sequence has one, else the older 8-bit PNG. */
export async function loadPlane(base: string, f: { png: string; mask: string; f32?: string }, w: number, h: number): Promise<Plane> {
  const mask = channel(await loadImage(base + f.mask));
  if (f.f32) {
    const r = await fetch(base + f.f32);
    if (r.ok) {
      const buf = await r.arrayBuffer();
      if (buf.byteLength === w * h * 4) return { data: new Float32Array(buf), mask, w, h };
    }
  }
  const g = channel(await loadImage(base + f.png));
  return { data: Float32Array.from(g), mask, w, h, fallback: true };
}
