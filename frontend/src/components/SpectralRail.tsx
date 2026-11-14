import { DETECTORS, type EpochSummary } from "../lib/types";

/* The detector picker drawn as SPHEREx sees light: one continuous band from
 * 0.75 to 5 µm, split where the six detectors split it. Widths follow the real
 * wavelength ranges, so the short-wavelength detectors are narrow. */

export const RAIL_COLOURS = ["#7c84ff", "#46c6e3", "#86e08f", "#f2d24b", "#f5973c", "#e5484d"];

interface Props {
  det: number;
  colour: boolean;
  colourDets: [number, number, number];
  onDet: (d: number) => void;
  onColour: (on: boolean) => void;
  coverage?: Record<string, EpochSummary[]>;
}

export default function SpectralRail({ det, colour, colourDets, onDet, onColour, coverage }: Props) {
  return (
    <div className="rail">
      <div className="rail-band" role="radiogroup" aria-label="Wavelength band (detector)">
        {[1, 2, 3, 4, 5, 6].map((d) => {
          const [a, b] = DETECTORS[d].band;
          const n = coverage?.[String(d)]?.length;
          const inColour = colour && colourDets.includes(d);
          const role = colour ? ["blue", "green", "red"][colourDets.indexOf(d)] : undefined;
          return (
            <button
              key={d}
              role="radio"
              aria-checked={!colour && d === det}
              className={`rail-seg ${!colour && d === det ? "on" : ""} ${inColour ? "in-colour" : ""}`}
              style={{ flexGrow: Math.max(b - a, 0.42), ["--c" as string]: RAIL_COLOURS[d - 1] }}
              onClick={() => onDet(d)}
              title={`Detector ${d}: ${a.toFixed(2)} to ${b.toFixed(2)} µm${n !== undefined ? `, ${n} survey${n === 1 ? "" : "s"} here` : ""}`}
            >
              <span className="rail-name">{DETECTORS[d].label}</span>
              <span className="rail-band-nums">{role ? <span className="rail-role">shown as {role}</span> : <>{a.toFixed(2)}–{b.toFixed(2)} µm</>}</span>
              {n === 0 && <span className="rail-none">no data</span>}
            </button>
          );
        })}
      </div>
      <button className={`chip colour-chip ${colour ? "on" : ""}`} aria-pressed={colour} onClick={() => onColour(!colour)}
        title={`False colour: detector ${colourDets[0]} as blue, ${colourDets[1]} as green, ${colourDets[2]} as red`}>
        <span className="colour-swatch" aria-hidden="true" />
        Colour
      </button>
    </div>
  );
}
