import { DETECTORS, type EpochSummary } from "../lib/types";

interface Props {
  det: number;
  onDet: (d: number) => void;
  coverage?: Record<string, EpochSummary[]>;
  available?: (d: number) => boolean;
}

export default function DetectorBar({ det, onDet, coverage }: Props) {
  return (
    <div className="detbar" role="radiogroup" aria-label="Detector (wavelength band)">
      <div className="detbar-ruler" aria-hidden="true">
        <span>0.75 µm</span><span>infrared light, shorter → longer wavelengths</span><span>5.0 µm</span>
      </div>
      <div className="detbar-row">
        {[1, 2, 3, 4, 5, 6].map((d) => {
          const info = DETECTORS[d];
          const eps = coverage?.[String(d)];
          const n = eps?.length;
          return (
            <button
              key={d}
              role="radio"
              aria-checked={d === det}
              className={`det det-${d} ${d === det ? "on" : ""}`}
              onClick={() => onDet(d)}
              title={`Detector ${d}: ${info.band[0].toFixed(2)}–${info.band[1].toFixed(2)} µm`}
            >
              <span className="det-id">D{d}</span>
              <span className="det-name">{info.label}</span>
              <span className="det-band mono">{info.band[0].toFixed(2)}–{info.band[1].toFixed(2)} µm</span>
              {n !== undefined && <span className="det-count">{n === 0 ? "no data" : `${n} epoch${n === 1 ? "" : "s"}`}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
