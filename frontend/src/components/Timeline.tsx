import type { FrameMeta, View } from "../lib/types";
import { daysBetween } from "../lib/coords";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function monthSpan(a: string, b: string): string {
  const [ya, ma] = a.split("-").map(Number);
  const [yb, mb] = b.split("-").map(Number);
  if (ya === yb && ma === mb) return `${MONTHS[ma - 1]} ${ya}`;
  if (ya === yb) return `${MONTHS[ma - 1]}–${MONTHS[mb - 1]} ${ya}`;
  return `${MONTHS[ma - 1]} ${ya} – ${MONTHS[mb - 1]} ${yb}`;
}

export function longDate(d: string): string {
  const [y, m, day] = d.split("-").map(Number);
  return `${day} ${MONTHS[m - 1]} ${y}`;
}

interface Props {
  frames: FrameMeta[];
  index: number;
  onIndex: (i: number) => void;
  playing: boolean;
  onPlaying: (p: boolean) => void;
  view: View;
  marks?: [number, number];   // A and B when comparing
}

export default function Timeline({ frames, index, onIndex, playing, onPlaying, view, marks }: Props) {
  const n = frames.length;
  const label = (f: FrameMeta) => view === "exposures" ? f.time_mid.slice(5, 16).replace("T", " ") : monthSpan(f.date_start, f.date_end);
  return (
    <div className="timeline">
      <button className="play" onClick={() => onPlaying(!playing)} disabled={n < 2}
        aria-label={playing ? "Pause (Space)" : "Play (Space)"} title={n < 2 ? "Only one survey here so far" : "Space"}>
        {playing ? <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="2" width="3.5" height="12" rx="1" /><rect x="9.5" y="2" width="3.5" height="12" rx="1" /></svg>
          : <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5v11l9.5-5.5z" /></svg>}
      </button>
      <div className="tl-line" role="radiogroup" aria-label={view === "exposures" ? "Exposures" : "Surveys"}>
        {n > 14 ? (
          <input type="range" min={0} max={n - 1} value={index} onChange={(e) => onIndex(Number(e.target.value))}
            aria-label="Frame" aria-valuetext={frames[index]?.summary} />
        ) : (
          frames.map((f, i) => (
            <div className="tl-seg" key={i}>
              {i > 0 && <span className="tl-gap" aria-hidden="true">{daysBetween(frames[i - 1].date_start, f.date_start)} days</span>}
              <button role="radio" aria-checked={i === index} aria-label={f.summary}
                className={`tl-stop ${i === index ? "on" : ""} ${marks?.includes(i) ? "mark" : ""}`} onClick={() => onIndex(i)}>
                <span className="tl-dot" aria-hidden="true">{marks ? (i === marks[0] ? "A" : i === marks[1] ? "B" : "") : ""}</span>
                <span className="tl-when">{label(f)}</span>
                <span className="tl-sub">{view === "exposures" ? f.release : `Survey ${f.survey}, ${f.release}`}</span>
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
