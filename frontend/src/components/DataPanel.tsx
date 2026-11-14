import type { ReactNode } from "react";
import type { FrameMeta, Sequence } from "../lib/types";
import { DETECTORS } from "../lib/types";
import { fmtDec, fmtRa } from "../lib/coords";
import type { Display } from "./SkyCanvas";
import { FLAG_RGB, SAT_RGB } from "./SkyCanvas";

export const GLOSSARY: Record<string, string> = {
  "co-add": "Several exposures of the same detector stacked into one cleaner image.",
  saturation: "The star was too bright for the detector, so those pixels hold no usable measurement.",
  zodi: "Zodiacal light: sunlight scattered by dust in the Solar System, glowing across the whole sky.",
  PSF: "Point spread function: the shape a single point of light takes in the telescope's images.",
  epoch: "One visit to this patch of sky. SPHEREx comes back roughly every six months.",
  release: "The batch of processed data from the SPHEREx team. Different releases can use different calibrations.",
};

export function Term({ t, children }: { t: keyof typeof GLOSSARY; children?: ReactNode }) {
  return <span className="term" tabIndex={0} title={GLOSSARY[t]}>{children ?? t}</span>;
}

const rgb = (c: number[]) => `rgb(${c.join(",")})`;

interface Props {
  seq: Sequence;
  frame: FrameMeta | undefined;
  frameTag?: string;
  display: Display;
  onDisplay: (d: Display) => void;
  view: "survey" | "exposures";
  onView: (v: "survey" | "exposures") => void;
  compare: "none" | "blink" | "side";
  pair?: [FrameMeta, FrameMeta];
  open: boolean;
  onClose: () => void;
}

export default function DataPanel({ seq, frame, frameTag, display, onDisplay, view, onView, compare, pair, open, onClose }: Props) {
  const det = DETECTORS[seq.detector.id];
  const t = seq.target;
  return (
    <aside className={`panel ${open ? "open" : ""}`} aria-label="About this frame">
      <div className="panel-head">
        <h2>About this frame</h2>
        <button className="btn icon only-mobile" onClick={onClose} aria-label="Close panel">✕</button>
      </div>

      <section className="panel-sec">
        <div className="target-name">{t?.name ?? "Typed coordinates"}{t && <span className="pill">{t.label}</span>}</div>
        <div className="mono small">{fmtRa(seq.centre.ra)} {fmtDec(seq.centre.dec)} · field {seq.request.fov}′</div>
        <p className="small muted">{seq.centre.note}.</p>
        {t?.moves && display.showMarker && (
          <p className="small"><span className="swatch ring" /> Dashed circle: where {t.name} is predicted to be on each frame's date.</p>
        )}
      </section>

      {frame ? (
        <section className="panel-sec">
          {frameTag && <div className="frame-tag">{frameTag}</div>}
          <dl className="facts">
            <dt><Term t="release">Release</Term></dt><dd>{frame.release}</dd>
            <dt>{view === "exposures" ? "Time" : "Survey"}</dt>
            <dd>{view === "exposures" ? frame.time_mid.replace("T", " ").slice(0, 19) + " UTC" : `${frame.survey} (nominal six-month window)`}</dd>
            <dt>Dates</dt><dd className="mono">{frame.date_start}{frame.date_end !== frame.date_start ? ` → ${frame.date_end}` : ""}</dd>
            <dt>Detector</dt><dd>D{seq.detector.id} · {det.label} · <span className="mono">{det.band[0].toFixed(2)}–{det.band[1].toFixed(2)} µm</span></dd>
            <dt>At the centre</dt>
            <dd className="mono">{frame.wavelength_range_um ? `${frame.wavelength_range_um[0].toFixed(2)}–${frame.wavelength_range_um[1].toFixed(2)} µm` : "not recorded"}</dd>
            <dt>Exposures</dt>
            <dd>{frame.n_exposures}{frame.n_available > frame.n_exposures ? ` of ${frame.n_available} (evenly sampled)` : ""}{view === "survey" ? <> · <Term t="co-add" /></> : " · single exposure"}</dd>
            <dt><Term t="saturation">Saturated</Term></dt><dd>{frame.saturated_px} px</dd>
            <dt>Flagged</dt><dd>{frame.flagged_px} px</dd>
          </dl>
          <p className="sr-only" aria-live="polite">{frame.summary}</p>
        </section>
      ) : null}

      <section className="panel-sec">
        <label className="check">
          <input type="checkbox" checked={display.showFlags} onChange={(e) => onDisplay({ ...display, showFlags: e.target.checked })} />
          Show saturated and flagged pixels
        </label>
        <div className="legend small">
          <span><i style={{ background: rgb(SAT_RGB) }} /> saturated</span>
          <span><i style={{ background: rgb(FLAG_RGB) }} /> flagged / no usable data</span>
          <span><i style={{ background: "#151a24", border: "1px solid #2a3142" }} /> outside coverage</span>
        </div>
        <p className="small muted">Bad pixels are never averaged in. With the tint off they show black, which is why the brightest stars have a black core.</p>
        {t?.moves && (
          <label className="check">
            <input type="checkbox" checked={display.showMarker} onChange={(e) => onDisplay({ ...display, showMarker: e.target.checked })} />
            Show predicted position
          </label>
        )}
      </section>

      {compare !== "none" && pair && (
        <section className="panel-sec callout">
          <p><strong>Comparing</strong> {compare === "blink" ? "A ↔ B" : "A | B"}: Survey {pair[0].survey} ({pair[0].date_start}) and Survey {pair[1].survey} ({pair[1].date_start}), detector {seq.detector.id}.</p>
          <p>These are suitable observations to compare. We have not automatically checked whether anything changed — explore them yourself.</p>
          {pair[0].release !== pair[1].release && <p className="warn">A and B come from different releases ({pair[0].release} vs {pair[1].release}). Compare positions, not brightness.</p>}
        </section>
      )}

      {seq.comparability.notes.length > 0 && (
        <section className="panel-sec">
          {seq.comparability.notes.map((n, i) => <p key={i} className="warn small">{n}</p>)}
        </section>
      )}
      {view === "exposures" && (
        <section className="panel-sec">
          <p className="warn small">Raw exposures: each one sees this spot at a different wavelength, so stars can "flicker" for no astronomical reason. Use this view for fast movers such as asteroids, not for brightness.</p>
        </section>
      )}

      <details className="panel-sec">
        <summary>Advanced controls</summary>
        <div className="seg" role="radiogroup" aria-label="Timeline mode">
          <button role="radio" aria-checked={view === "survey"} className={view === "survey" ? "on" : ""} onClick={() => onView("survey")}>One frame per survey</button>
          <button role="radio" aria-checked={view === "exposures"} className={view === "exposures" ? "on" : ""} onClick={() => onView("exposures")}>Every exposure</button>
        </div>
        <label className="slider">Brightness
          <input type="range" min={-0.5} max={0.5} step={0.01} value={display.brightness} onChange={(e) => onDisplay({ ...display, brightness: Number(e.target.value) })} />
        </label>
        <label className="slider">Contrast
          <input type="range" min={0.5} max={3} step={0.05} value={display.contrast} onChange={(e) => onDisplay({ ...display, contrast: Number(e.target.value) })} />
        </label>
        <label className="check">
          <input type="checkbox" checked={display.smooth} onChange={(e) => onDisplay({ ...display, smooth: e.target.checked })} />
          Smooth pixels (display only)
        </label>
        <button className="btn small" onClick={() => onDisplay({ ...display, brightness: 0, contrast: 1 })}>Reset display</button>
        <p className="small muted">Brightness and contrast change the same way for every frame, so the comparison stays fair.</p>
      </details>

      <details className="panel-sec">
        <summary>How was this made?</summary>
        <ul className="small how">
          <li>Data: {seq.provenance.source}; collections {(seq.provenance.collections ?? []).join(", ")}.</li>
          <li>Release shown on every frame. Frames from different releases are never subtracted.</li>
          <li>Each frame: {seq.provenance.combine} of detector {seq.detector.id} exposures from one visit.</li>
          <li><Term t="zodi">Zodiacal light</Term> model subtracted (IRSA ZODI layer).</li>
          <li>Excluded as saturated: {seq.provenance.saturation_flags.join(", ")}.</li>
          <li>Excluded as flagged: {seq.provenance.masked_flags.join(", ")}.</li>
          <li>Reprojection: {seq.provenance.reprojection}; {seq.grid.orientation}.</li>
          <li>Stretch: {seq.stretch.kind} (a={seq.stretch.a}), limits {seq.stretch.lo.toPrecision(3)}–{seq.stretch.hi.toPrecision(3)} {seq.stretch.unit} ({seq.stretch.percentiles[0]}th–{seq.stretch.percentiles[1]}th percentile of all frames), the same for every frame.</li>
          <li>No frame is interpolated or invented. No automated detection or AI is used.</li>
          <li>Built {seq.provenance.built_at}{seq.provenance.queried_at ? `, archive searched ${seq.provenance.queried_at}` : ""}.</li>
        </ul>
      </details>

      {frame && frame.exposures.length > 0 && (
        <details className="panel-sec">
          <summary>Exposures in this frame ({frame.exposures.length})</summary>
          <ul className="small mono explist">
            {frame.exposures.map((e) => (
              <li key={e.obs_id}>{e.obs_id}{e.time ? ` · ${e.time.slice(0, 16)}` : ""}{e.wavelength_um ? ` · ${e.wavelength_um.toFixed(3)} µm` : ""}{e.error ? ` · skipped: ${e.error}` : ""}</li>
            ))}
          </ul>
        </details>
      )}

      <section className="panel-sec small">
        <a href={`https://irsa.ipac.caltech.edu/applications/spherex`} target="_blank" rel="noreferrer">Open the IRSA SPHEREx Data Explorer ↗</a>
        <span className="muted"> · for spectra, use its Spectrophotometry Tool at {seq.centre.ra.toFixed(5)}, {seq.centre.dec.toFixed(5)}</span>
      </section>
    </aside>
  );
}
