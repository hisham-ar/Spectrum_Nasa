import { useCallback, useEffect, useRef, useState } from "react";

/* A small snake-style game for long loads: steer a rocket, eat planets, grow a
 * longer exhaust trail. Walls and your own trail end the run. */

const COLS = 18, ROWS = 12, CELL = 24;
const W = COLS * CELL, H = ROWS * CELL;
const START_MS = 150, MIN_MS = 80;           // time per step; speeds up as you eat
const BEST_KEY = "lits:rocket-best";

type Dir = [number, number];
type Cell = [number, number];
interface Planet { at: Cell; colour: string; ring: boolean }
interface Game { body: Cell[]; dir: Dir; queued: Dir[]; planet: Planet; eaten: number; over: boolean }

const PLANET_COLOURS = ["#7c84ff", "#46c6e3", "#86e08f", "#f2d24b", "#f5973c", "#e5484d", "#c9a37a", "#b9c2d0"];
const UP: Dir = [0, -1], DOWN: Dir = [0, 1], LEFT: Dir = [-1, 0], RIGHT: Dir = [1, 0];
const KEYS: Record<string, Dir> = {
  ArrowUp: UP, ArrowDown: DOWN, ArrowLeft: LEFT, ArrowRight: RIGHT,
  w: UP, s: DOWN, a: LEFT, d: RIGHT, W: UP, S: DOWN, A: LEFT, D: RIGHT,
};

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
const readBest = () => { try { return Number(window.localStorage.getItem(BEST_KEY)) || 0; } catch { return 0; } };
const saveBest = (n: number) => { try { window.localStorage.setItem(BEST_KEY, String(n)); } catch { /* storage blocked */ } };

function newPlanet(body: Cell[]): Planet {
  const taken = new Set(body.map(([x, y]) => `${x},${y}`));
  const free: Cell[] = [];
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (!taken.has(`${x},${y}`)) free.push([x, y]);
  const at = free[Math.floor(Math.random() * free.length)] ?? [0, 0];
  return { at, colour: PLANET_COLOURS[Math.floor(Math.random() * PLANET_COLOURS.length)], ring: Math.random() < 0.3 };
}

function newGame(): Game {
  const body: Cell[] = [[5, 6], [4, 6], [3, 6]];
  return { body, dir: RIGHT, queued: [], planet: newPlanet(body), eaten: 0, over: false };
}

// Fixed background stars so the board reads as space, not a grid.
const STARS = Array.from({ length: 46 }, (_, i) => {
  const r = Math.sin(i * 12.9898) * 43758.5453;
  const f = r - Math.floor(r), g = (Math.sin(i * 78.233) * 12345.678) % 1;
  return { x: f * W, y: Math.abs(g) * H, a: 0.15 + 0.35 * ((i * 7) % 5) / 4 };
});

function draw(ctx: CanvasRenderingContext2D, g: Game, t: number, still: boolean) {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  for (const s of STARS) { ctx.fillStyle = `rgba(232,230,225,${s.a})`; ctx.fillRect(s.x, s.y, 1.5, 1.5); }

  // planet
  const [px, py] = g.planet.at;
  const cx = px * CELL + CELL / 2, cy = py * CELL + CELL / 2, pr = CELL * 0.34;
  const grad = ctx.createRadialGradient(cx - pr * 0.4, cy - pr * 0.4, pr * 0.1, cx, cy, pr);
  grad.addColorStop(0, "#ffffff");
  grad.addColorStop(0.25, g.planet.colour);
  grad.addColorStop(1, "#111318");
  ctx.fillStyle = grad;
  ctx.beginPath(); ctx.arc(cx, cy, pr, 0, Math.PI * 2); ctx.fill();
  if (g.planet.ring) {
    ctx.strokeStyle = "rgba(232,230,225,0.75)"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(cx, cy, pr * 1.55, pr * 0.45, -0.35, 0, Math.PI * 2); ctx.stroke();
  }

  // exhaust trail: the body, fading and shrinking towards the end
  const n = g.body.length;
  for (let i = n - 1; i >= 1; i--) {
    const [x, y] = g.body[i];
    const k = i / n;                                  // 0 near the rocket, 1 at the end
    const flicker = still ? 0 : Math.sin(t / 90 + i) * 0.6;
    const r = CELL * (0.36 - 0.2 * k) + flicker;
    const hot = i <= 2;
    ctx.fillStyle = hot ? `rgba(242,210,75,${0.95 - 0.2 * k})` : `rgba(245,151,60,${0.8 - 0.65 * k})`;
    ctx.beginPath(); ctx.arc(x * CELL + CELL / 2, y * CELL + CELL / 2, Math.max(2, r), 0, Math.PI * 2); ctx.fill();
  }

  // rocket, pointing where it's going
  const [hx, hy] = g.body[0];
  ctx.save();
  ctx.translate(hx * CELL + CELL / 2, hy * CELL + CELL / 2);
  ctx.rotate(Math.atan2(g.dir[1], g.dir[0]));     // drawn pointing right (+x)
  const L = CELL * 0.5;
  // fins
  ctx.fillStyle = "#e5484d";
  ctx.beginPath(); ctx.moveTo(-L * 0.55, -L * 0.3); ctx.lineTo(-L * 0.95, -L * 0.75); ctx.lineTo(-L * 0.2, -L * 0.3); ctx.fill();
  ctx.beginPath(); ctx.moveTo(-L * 0.55, L * 0.3); ctx.lineTo(-L * 0.95, L * 0.75); ctx.lineTo(-L * 0.2, L * 0.3); ctx.fill();
  // body
  ctx.fillStyle = "#e8e6e1";
  ctx.beginPath();
  ctx.moveTo(L, 0);
  ctx.quadraticCurveTo(L * 0.55, -L * 0.42, -L * 0.6, -L * 0.34);
  ctx.lineTo(-L * 0.6, L * 0.34);
  ctx.quadraticCurveTo(L * 0.55, L * 0.42, L, 0);
  ctx.fill();
  // window
  ctx.fillStyle = "#a8d0ff";
  ctx.beginPath(); ctx.arc(L * 0.12, 0, L * 0.17, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  if (g.over) {
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, 0, W, H);
  }
}

export default function RocketGame({ ready, readyText, onShowSky, onClose }:
  { ready: boolean; readyText: string; onShowSky: () => void; onClose: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const game = useRef<Game>(newGame());
  const [eaten, setEaten] = useState(0);
  const [best, setBest] = useState(readBest);
  const [over, setOver] = useState(false);
  const [paused, setPaused] = useState(false);
  const still = useRef(reducedMotion());

  const steer = useCallback((d: Dir) => {
    const g = game.current;
    const last = g.queued[g.queued.length - 1] ?? g.dir;
    if (d[0] === -last[0] && d[1] === -last[1]) return;    // no turning back into yourself
    if (d[0] === last[0] && d[1] === last[1]) return;
    if (g.queued.length < 3) g.queued.push(d);
  }, []);

  const restart = useCallback(() => {
    game.current = newGame();
    setEaten(0); setOver(false); setPaused(false);
  }, []);

  // When the images arrive mid-game, pause so the player can choose.
  useEffect(() => { if (ready) setPaused(true); }, [ready]);

  // keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;   // typing in the search box
      if (KEYS[e.key]) { e.preventDefault(); e.stopPropagation(); if (!paused && !over) steer(KEYS[e.key]); return; }
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault(); e.stopPropagation();
        if (over) restart(); else setPaused((p) => !p);
      } else if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [steer, restart, paused, over, onClose]);

  // game loop
  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = W * dpr; cv.height = H * dpr;
    const ctx = cv.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    let raf = 0, last = performance.now(), acc = 0;
    const loop = (now: number) => {
      const g = game.current;
      const stepMs = Math.max(MIN_MS, START_MS - g.eaten * 4);
      if (!paused && !g.over) {
        acc += Math.min(250, now - last);
        while (acc >= stepMs) {
          acc -= stepMs;
          if (g.queued.length) g.dir = g.queued.shift()!;
          const [hx, hy] = g.body[0];
          const head: Cell = [hx + g.dir[0], hy + g.dir[1]];
          const ate = head[0] === g.planet.at[0] && head[1] === g.planet.at[1];
          const body = ate ? g.body : g.body.slice(0, -1);
          const crash = head[0] < 0 || head[1] < 0 || head[0] >= COLS || head[1] >= ROWS
            || body.some(([x, y]) => x === head[0] && y === head[1]);
          if (crash) {
            g.over = true;
            setOver(true);
            setBest((b) => { const nb = Math.max(b, g.eaten); if (nb > b) saveBest(nb); return nb; });
            break;
          }
          g.body = [head, ...body];
          if (ate) { g.eaten += 1; setEaten(g.eaten); g.planet = newPlanet(g.body); }
        }
      }
      last = now;
      draw(ctx, g, now, still.current);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [paused]);

  // swipe to steer on touch screens
  const touch = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => { const t = e.touches[0]; touch.current = { x: t.clientX, y: t.clientY }; };
  const onTouchEnd = (e: React.TouchEvent) => {
    const s = touch.current; touch.current = null;
    if (!s) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - s.x, dy = t.clientY - s.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 18) { if (over) restart(); return; }
    steer(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? RIGHT : LEFT) : (dy > 0 ? DOWN : UP));
  };

  return (
    <div className="rocket">
      <div className="rocket-bar">
        <span className="num">Planets eaten: {eaten}</span>
        <span className="num quiet">Best: {best}</span>
        <button className="sat-note-x rocket-close" aria-label="Close the game" onClick={onClose}>×</button>
      </div>
      <div className="rocket-board">
        <canvas ref={canvas} role="img" aria-label={`Rocket game. Planets eaten: ${eaten}.${over ? " Crashed." : ""}`}
          onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} />
        {(over || paused) && (
          <div className="rocket-overlay">
            {ready ? (
              <>
                <p><strong>{readyText}</strong></p>
                <div className="rocket-actions">
                  <button className="chip on" onClick={onShowSky}>Show the sky</button>
                  {!over && <button className="chip" onClick={() => setPaused(false)}>Keep playing</button>}
                  {over && <button className="chip" onClick={restart}>Play again</button>}
                </div>
              </>
            ) : over ? (
              <>
                <p><strong>Crashed.</strong> {eaten} planet{eaten === 1 ? "" : "s"} eaten.</p>
                <button className="chip on" onClick={restart}>Play again</button>
              </>
            ) : (
              <button className="chip on" onClick={() => setPaused(false)}>Resume</button>
            )}
          </div>
        )}
      </div>
      <div className="rocket-pad" aria-hidden="true">
        <button tabIndex={-1} onClick={() => steer(UP)}>▲</button>
        <button tabIndex={-1} onClick={() => steer(LEFT)}>◀</button>
        <button tabIndex={-1} onClick={() => steer(DOWN)}>▼</button>
        <button tabIndex={-1} onClick={() => steer(RIGHT)}>▶</button>
      </div>
      <p className="quiet rocket-help">Steer with the arrow keys or WASD (swipe on a phone). Space pauses. Don't hit the edges or your own trail.</p>
    </div>
  );
}
