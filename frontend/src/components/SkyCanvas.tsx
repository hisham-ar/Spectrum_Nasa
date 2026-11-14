import { useCallback, useEffect, useRef, useState } from "react";
import type { Marker, SmallBody } from "../lib/types";

export interface LoadedFrame { gray: Uint8ClampedArray; mask: Uint8ClampedArray; w: number; h: number }

export interface ViewXform { zoom: number; cx: number; cy: number } // zoom 1 = fit; centre in image px

export interface Display {
  showFlags: boolean;
  showMarker: boolean;
  brightness: number; // -0.5..0.5
  contrast: number;   // 0.5..3
  smooth: boolean;
}

// Pixel-class colours (match the legend in the data panel)
export const SAT_RGB: [number, number, number] = [255, 79, 216];   // saturated
export const FLAG_RGB: [number, number, number] = [122, 108, 255]; // flagged / no usable data
const OUTSIDE_RGB: [number, number, number] = [21, 26, 36];

export function loadImage(src: string): Promise<HTMLImageElement> {
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

export async function loadFrame(pngUrl: string, maskUrl: string): Promise<LoadedFrame> {
  const [g, m] = await Promise.all([loadImage(pngUrl), loadImage(maskUrl)]);
  return { gray: channel(g), mask: channel(m), w: g.naturalWidth, h: g.naturalHeight };
}

function compose(f: LoadedFrame, d: Display): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = f.w;
  c.height = f.h;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(f.w, f.h);
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) lut[v] = (v / 255 - 0.5) * d.contrast * 255 + 127.5 + d.brightness * 255;
  const px = img.data;
  for (let i = 0; i < f.gray.length; i++) {
    const m = f.mask[i];
    let r: number, g: number, b: number;
    if (m === 3) [r, g, b] = OUTSIDE_RGB;
    else if (m === 1) [r, g, b] = d.showFlags ? SAT_RGB : [0, 0, 0];
    else if (m === 2) [r, g, b] = d.showFlags ? FLAG_RGB : [0, 0, 0];
    else r = g = b = lut[f.gray[i]];
    px[i * 4] = r; px[i * 4 + 1] = g; px[i * 4 + 2] = b; px[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

interface Props {
  frame: LoadedFrame | null;
  marker: Marker | null;
  bodies?: SmallBody[];
  pixelScale: number;
  display: Display;
  xform: ViewXform;
  onXform: (x: ViewXform) => void;
  label?: string;
  ariaLabel: string;
}

export default function SkyCanvas({ frame, marker, bodies, pixelScale, display, xform, onXform, label, ariaLabel }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 300, h: 300 });
  const composed = useRef<{ key: string; f: LoadedFrame; c: HTMLCanvasElement } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; zoom: number } | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fit = frame ? Math.min(size.w / frame.w, size.h / frame.h) * 0.96 : 1;
  const scale = fit * xform.zoom;

  useEffect(() => {
    const c = cv.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.max(1, Math.round(size.w * dpr));
    c.height = Math.max(1, Math.round(size.h * dpr));
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#070910";
    ctx.fillRect(0, 0, size.w, size.h);
    if (!frame) return;
    const key = `${display.showFlags}|${display.brightness}|${display.contrast}`;
    if (!composed.current || composed.current.key !== key || composed.current.f !== frame) {
      composed.current = { key, f: frame, c: compose(frame, display) };
    }
    const ox = size.w / 2 - xform.cx * scale;
    const oy = size.h / 2 - xform.cy * scale;
    ctx.imageSmoothingEnabled = display.smooth;
    ctx.drawImage(composed.current.c, ox, oy, frame.w * scale, frame.h * scale);

    // proper-motion marker: hollow, so it never hides the data
    if (display.showMarker && marker) {
      const sx = ox + (marker.x + 0.5) * scale;
      const sy = oy + (marker.y + 0.5) * scale;
      const r = Math.max(9, 2.2 * scale);
      ctx.strokeStyle = "rgba(90, 209, 255, 0.95)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // known small bodies (JPL): hollow amber squares, labelled "predicted"
    if (bodies && bodies.length) {
      ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
      for (const bd of bodies) {
        const sx = ox + (bd.x + 0.5) * scale;
        const sy = oy + (bd.y + 0.5) * scale;
        const r = Math.max(8, 2 * scale);
        ctx.strokeStyle = "rgba(255, 181, 71, 0.95)";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(sx - r, sy - r, 2 * r, 2 * r);
        const label = `${bd.name}${bd.vmag !== null ? ` V${bd.vmag}` : ""} (predicted)`;
        ctx.fillStyle = "rgba(7,9,16,0.75)";
        const w = ctx.measureText(label).width;
        ctx.fillRect(sx + r + 3, sy - 8, w + 6, 15);
        ctx.fillStyle = "rgba(255, 210, 140, 0.95)";
        ctx.fillText(label, sx + r + 6, sy + 3);
      }
    }

    // scale bar
    const oneArcmin = (60 / pixelScale) * scale;
    const len = oneArcmin >= 40 ? 1 : 5;
    const barPx = len * oneArcmin;
    if (barPx < size.w * 0.6) {
      const x0 = 16, y0 = size.h - 18;
      ctx.strokeStyle = "rgba(235,238,245,0.9)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x0, y0); ctx.lineTo(x0 + barPx, y0);
      ctx.moveTo(x0, y0 - 4); ctx.lineTo(x0, y0 + 4);
      ctx.moveTo(x0 + barPx, y0 - 4); ctx.lineTo(x0 + barPx, y0 + 4);
      ctx.stroke();
      ctx.fillStyle = "rgba(235,238,245,0.9)";
      ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
      ctx.fillText(`${len}′`, x0 + barPx / 2 - 6, y0 - 7);
    }
    // compass: north up, east left
    const cx0 = size.w - 30, cy0 = 46;
    ctx.strokeStyle = "rgba(235,238,245,0.75)";
    ctx.fillStyle = "rgba(235,238,245,0.85)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx0, cy0); ctx.lineTo(cx0, cy0 - 22);
    ctx.moveTo(cx0, cy0); ctx.lineTo(cx0 - 22, cy0);
    ctx.stroke();
    ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
    ctx.fillText("N", cx0 - 4, cy0 - 26);
    ctx.fillText("E", cx0 - 34, cy0 + 4);
  }, [frame, marker, bodies, display, xform, size, scale, pixelScale]);

  const zoomAt = useCallback((factor: number, sx: number, sy: number) => {
    const z = Math.min(16, Math.max(0.5, xform.zoom * factor));
    const s0 = fit * xform.zoom, s1 = fit * z;
    // keep the image point under the cursor fixed
    const ix = xform.cx + (sx - size.w / 2) / s0;
    const iy = xform.cy + (sy - size.h / 2) / s0;
    onXform({ zoom: z, cx: ix - (sx - size.w / 2) / s1, cy: iy - (sy - size.h / 2) / s1 });
  }, [xform, fit, size, onXform]);

  const onWheel = (e: React.WheelEvent) => {
    const r = cv.current!.getBoundingClientRect();
    zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom: xform.zoom };
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      onXform({ ...xform, zoom: Math.min(16, Math.max(0.5, pinch.current.zoom * d / pinch.current.d)) });
      return;
    }
    onXform({ ...xform, cx: xform.cx - (e.clientX - prev.x) / scale, cy: xform.cy - (e.clientY - prev.y) / scale });
  };
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  };

  return (
    <div className="sky" ref={wrap}>
      <canvas
        ref={cv}
        role="img"
        aria-label={ariaLabel}
        style={{ width: size.w, height: size.h, touchAction: "none" }}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => frame && onXform({ zoom: 1, cx: frame.w / 2, cy: frame.h / 2 })}
      />
      {label && <div className="sky-label">{label}</div>}
    </div>
  );
}
