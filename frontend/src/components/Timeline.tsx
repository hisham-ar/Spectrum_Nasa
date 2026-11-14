import type { FrameMeta, View } from "../lib/types";
import { daysBetween } from "../lib/coords";

interface Props {
  frames: FrameMeta[];
  index: number;
  onIndex: (i: number) => void;
  playing: boolean;
  onPlaying: (p: boolean) => void;
  fps: number;
  onFps: (f: number) => void;
  view: View;
  highlight?: [number, number];
}

function stopLabel(f: FrameMeta, view: View): string {
  if (view === "exposures") return f.time_mid.slice(5, 16).replace("T", " ");
  return `S${f.survey} · ${f.date_start.slice(0, 7)}`;
}

export default function Timeline({ frames, index, onIndex, playing, onPlaying, fps, onFps, view, highlight }: Props) {
  const n = frames.length;
  const canPlay = n > 1;
  const cur = frames[index];
  return (
    <div className="timeline" aria-label="Timeline">
      <div className="tl-controls">
        <button
          className="btn icon"
          onClick={() => onPlaying(!playing)}
          disabled={!canPlay}
          aria-label={playing ? "Pause (Space)" : "Play (Space)"}
          title={canPlay ? (playing ? "Pause (Space)" : "Play (Space)") : "Only one epoch so far"}
        >
          {playing ? "❚❚" : "▶"}
        </button>
        <button className="btn icon" onClick={() => onIndex(Math.max(0, index - 1))} disabled={index <= 0} aria-label="Previous frame (←)">‹</button>
        <button className="btn icon" onClick={() => onIndex(Math.min(n - 1, index + 1))} disabled={index >= n - 1} aria-label="Next frame (→)">›</button>
        <label className="tl-speed">
          <span className="sr-only">Playback speed</span>
          <select value={fps} onChange={(e) => onFps(Number(e.target.value))} disabled={!canPlay}>
            <option value={0.5}>0.5 frame/s</option>
            <option value={1}>1 frame/s</option>
            <option value={2}>2 frames/s</option>
          </select>
        </label>
        <div className="tl-now" aria-live="polite">
          {cur ? (
            <>
              <strong>{view === "exposures" ? "Exposure" : `Survey ${cur.survey}`}</strong>{" "}
              <span className="mono">{view === "exposures" ? cur.time_mid.replace("T", " ").slice(0, 16) + " UTC" : `${cur.date_start} → ${cur.date_end}`}</span>
              <span className="pill">{cur.release}</span>
            </>
          ) : null}
        </div>
      </div>
      {n > 0 && (
        <div className="tl-track">
          <input
            type="range"
            min={0}
            max={Math.max(0, n - 1)}
            step={1}
            value={index}
            onChange={(e) => onIndex(Number(e.target.value))}
            disabled={n < 2}
            aria-label="Frame"
            aria-valuetext={cur?.summary}
          />
          {n <= 12 && (
            <ol className="tl-stops" style={{ gridTemplateColumns: `repeat(${n}, 1fr)` }}>
              {frames.map((f, i) => (
                <li key={i} className={[i === index ? "on" : "", highlight && highlight.includes(i) ? "hl" : ""].join(" ")}>
                  <button onClick={() => onIndex(i)} aria-label={f.summary}>
                    <span className="stop-label">{stopLabel(f, view)}</span>
                    {i > 0 && (
                      <span className="gap" title="True time between this stop and the previous one">
                        +{daysBetween(frames[i - 1].date_start, f.date_start)} d
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
      <p className="tl-note">
        Stops are evenly spaced for easy stepping; the real dates and gaps are printed. Playback speed has nothing to do with real elapsed time.
      </p>
    </div>
  );
}
