import { useCallback, useEffect, useRef, useState } from "react";
import type { Marker, SmallBody } from "../lib/types";

export interface ViewXform { zoom: number; cx: number; cy: number } // zoom 1 = fit; centre in image px
export interface CanvasLabel { x: number; y: number; r: number; label: string }   // image px; r in px

interface Props {
  image: ImageData | null;     // composed frame (real values, shared stretch)
  smooth: boolean;             // display interpolation only; pixels unchanged
  marker: Marker | null;
  showMarker: boolean;
  bodies?: SmallBody[];
  labels?: CanvasLabel[];      // named objects, drawn as gold circles (hidden with the target marker)
  pixelScale: number;
  xform: ViewXform;
  onXform: (x: ViewXform) => void;
  ariaLabel: string;
  fit?: "contain" | "cover";
  interactive?: boolean;
  chrome?: boolean;            // scale bar + compass
  anchor?: [number, number];   // where the view centre sits on screen (fractions)
}

export default function SkyCanvas({ image, smooth, marker, showMarker, bodies, labels, pixelScale, xform, onXform,
  ariaLabel, fit = "contain", interactive = true, chrome = true, anchor = [0.5, 0.5] }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const off = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState({ w: 300, h: 300 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; zoom: number } | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const iw = image?.width ?? 1, ih = image?.height ?? 1;
  const base = fit === "cover" ? Math.max(size.w / iw, size.h / ih) : Math.min(size.w / iw, size.h / ih) * 0.94;
  const scale = base * xform.zoom;

  useEffect(() => {
    const c = cv.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.max(1, Math.round(size.w * dpr));
    c.height = Math.max(1, Math.round(size.h * dpr));
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, size.w, size.h);
    if (!image) return;
    if (!off.current) off.current = document.createElement("canvas");
    const o = off.current;
    if (o.width !== iw || o.height !== ih) { o.width = iw; o.height = ih; }
    o.getContext("2d")!.putImageData(image, 0, 0);
    const ox = size.w * anchor[0] - xform.cx * scale;
    const oy = size.h * anchor[1] - xform.cy * scale;
    ctx.imageSmoothingEnabled = smooth;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(o, ox, oy, iw * scale, ih * scale);

    const at = (x: number, y: number) => [ox + (x + 0.5) * scale, oy + (y + 0.5) * scale];

    if (showMarker && marker) {
      const [sx, sy] = at(marker.x, marker.y);
      const r = Math.max(10, 2.4 * scale);
      ctx.strokeStyle = "rgba(168, 208, 255, 0.95)";
      ctx.lineWidth = 1.25;
      ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }
    if (showMarker && labels?.length) {
      ctx.font = "12.5px 'Instrument Sans Variable', system-ui, sans-serif";
      for (const l of labels) {
        const [sx, sy] = at(l.x, l.y);
        const r = Math.max(12, l.r * scale);
        ctx.strokeStyle = "rgba(242, 210, 75, 0.9)";
        ctx.lineWidth = 1.25;
        ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.stroke();
        const w = ctx.measureText(l.label).width;
        // label above the circle, kept inside the canvas
        const lx = Math.min(Math.max(4, sx - w / 2 - 4), size.w - w - 12);
        const ly = sy - r - 24 < 2 ? sy + r + 6 : sy - r - 24;
        ctx.fillStyle = "rgba(0,0,0,0.72)";
        ctx.fillRect(lx, ly, w + 8, 18);
        ctx.fillStyle = "rgba(250, 230, 160, 0.98)";
        ctx.fillText(l.label, lx + 4, ly + 13);
      }
    }
    if (bodies?.length) {
      ctx.font = "12px 'Instrument Sans Variable', system-ui, sans-serif";
      for (const bd of bodies) {
        const [sx, sy] = at(bd.x, bd.y);
        const r = Math.max(8, 2 * scale);
        ctx.strokeStyle = "rgba(242, 210, 75, 0.95)";
        ctx.lineWidth = 1.25;
        ctx.strokeRect(sx - r, sy - r, 2 * r, 2 * r);
        const label = `${bd.name} (predicted)`;
        const w = ctx.measureText(label).width;
        ctx.fillStyle = "rgba(0,0,0,0.7)";
        ctx.fillRect(sx + r + 4, sy - 9, w + 8, 18);
        ctx.fillStyle = "rgba(250, 230, 160, 0.95)";
        ctx.fillText(label, sx + r + 8, sy + 4);
      }
    }
    if (!chrome) return;
    // scale bar + compass, bottom right of the image area
    const oneArcmin = (60 / pixelScale) * scale;
    const len = oneArcmin >= 36 ? 1 : oneArcmin >= 10 ? 5 : 10;
    const bar = len * oneArcmin;
    if (bar < size.w * 0.4) {
      const x1 = size.w - 20, y = size.h - 30;
      ctx.strokeStyle = "rgba(232, 230, 225, 0.85)";
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x1 - bar, y); ctx.lineTo(x1, y); ctx.stroke();
      ctx.fillStyle = "rgba(232, 230, 225, 0.85)";
      ctx.font = "12px 'Instrument Sans Variable', system-ui, sans-serif";
      const t = `${len} arcmin`;
      ctx.fillText(t, x1 - ctx.measureText(t).width, y + 16);
      // compass: north up, east left
      const cx0 = x1 - bar - 40, cy0 = y + 14;
      ctx.beginPath(); ctx.moveTo(cx0, cy0); ctx.lineTo(cx0, cy0 - 18); ctx.moveTo(cx0, cy0); ctx.lineTo(cx0 - 18, cy0); ctx.stroke();
      ctx.fillText("N", cx0 - 4, cy0 - 22);
      ctx.fillText("E", cx0 - 30, cy0 + 4);
    }
  }, [image, smooth, marker, showMarker, labels, bodies, xform, size, scale, pixelScale, chrome, iw, ih, anchor[0], anchor[1]]);

  const zoomAt = useCallback((factor: number, sx: number, sy: number) => {
    const z = Math.min(20, Math.max(0.5, xform.zoom * factor));
    const s0 = base * xform.zoom, s1 = base * z;
    const ix = xform.cx + (sx - size.w / 2) / s0;
    const iy = xform.cy + (sy - size.h / 2) / s0;
    onXform({ zoom: z, cx: ix - (sx - size.w / 2) / s1, cy: iy - (sy - size.h / 2) / s1 });
  }, [xform, base, size, onXform]);

  const handlers = interactive ? {
    onWheel: (e: React.WheelEvent) => {
      const r = cv.current!.getBoundingClientRect();
      zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top);
    },
    onPointerDown: (e: React.PointerEvent) => {
      (e.target as Element).setPointerCapture(e.pointerId);
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.current.size === 2) {
        const [a, b] = [...pointers.current.values()];
        pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom: xform.zoom };
      }
    },
    onPointerMove: (e: React.PointerEvent) => {
      const prev = pointers.current.get(e.pointerId);
      if (!prev) return;
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.current.size === 2 && pinch.current) {
        const [a, b] = [...pointers.current.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        onXform({ ...xform, zoom: Math.min(20, Math.max(0.5, pinch.current.zoom * d / pinch.current.d)) });
        return;
      }
      onXform({ ...xform, cx: xform.cx - (e.clientX - prev.x) / scale, cy: xform.cy - (e.clientY - prev.y) / scale });
    },
    onPointerUp: (e: React.PointerEvent) => {
      pointers.current.delete(e.pointerId);
      if (pointers.current.size < 2) pinch.current = null;
    },
    onDoubleClick: () => image && onXform({ zoom: 1, cx: iw / 2, cy: ih / 2 }),
  } : {};

  return (
    <div className={`sky ${interactive ? "interactive" : ""}`} ref={wrap}>
      <canvas ref={cv} role="img" aria-label={ariaLabel}
        style={{ width: size.w, height: size.h, touchAction: interactive ? "none" : "auto" }}
        {...handlers}
        onPointerCancel={handlers.onPointerUp} />
    </div>
  );
}
