import type { ReactNode } from "react";
import type { AsteroidResult, FrameMeta, Sequence } from "../lib/types";
import { DETECTORS } from "../lib/types";
import { fmtDec, fmtRa } from "../lib/coords";
import { FLAG_RGB, SAT_RGB, type Look } from "../lib/render";
import { longDate } from "./Timeline";
import { swingText, type SatSwing } from "../lib/saturation";

export const GLOSSARY: Record<string, string> = {
  "co-add": "Several exposures of the same detector stacked into one cleaner image.",
  saturation: "The star was too bright for the detector, so those pixels hold no usable measurement.",
  zodi: "Zodiacal light: sunlight scattered by dust in the Solar System, glowing across the whole sky.",
  release: "The batch of processed data from the SPHEREx team. Different releases can use different calibrations.",
};

export function Term({ t, children }: { t: keyof typeof GLOSSARY; children?: ReactNode }) {
  return <span className="term" tabIndex={0} title={GLOSSARY[t]}>{children ?? t}</span>;
}

const rgb = (c: number[]) => `rgb(${c.join(",")})`;

interface Props {
  seq: Sequence;
  channels: { det: number; frame: FrameMeta | undefined }[];
  colour: boolean;
  frame: FrameMeta | undefined;
  frameTag?: string;
  look: Look;
  onLook: (l: Look) => void;
  showFlags: boolean;
  onFlags: (v: boolean) => void;
  swing?: SatSwing | null;
  showMarker: boolean;
  onMarker: (v: boolean) => void;
  view: "survey" | "exposures";
  onView: (v: "survey" | "exposures") => void;
  compare: "none" | "blink" | "side";
  pair?: [FrameMeta, FrameMeta];
  open: boolean;
  onClose: () => void;
  ast: boolean;
  onAst: (v: boolean) => void;
  astStatus?: AsteroidResult | "loading" | string;
}

export default function DataPanel(p: Props) {
  const { seq, frame } = p;
  const t = seq.target;
  return (
    <aside className={`drawer ${p.open ? "open" : ""}`} aria-label="About this view" aria-hidden={!p.open}>
      <div className="drawer-head">
        <h2>About this view</h2>
        <button className="tool" onClick={p.onClose} aria-label="Close details">×</button>
      </div>

      <section>
        <p className="d-name">{t?.name ?? "Typed coordinates"} {t && <span className="tag">{t.label}</span>}</p>
        <p className="num">{fmtRa(seq.centre.ra)} {fmtDec(seq.centre.dec)}, {seq.request.fov} arcmin field</p>
        <p className="quiet">{seq.centre.note}.</p>
        {t?.moves && <p><span className="ring" aria-hidden="true" /> The dashed circle is where {t.name} should be on each survey's date, from its catalogued motion.</p>}
      </section>

      {frame && (
        <section>
          {p.frameTag && <p className="d-tag">{p.frameTag}</p>}
          <dl className="facts">
            <dt><Term t="release">Release</Term></dt><dd>{frame.release}</dd>
            <dt>Survey</dt><dd>{p.view === "exposures" ? "single exposure" : `${frame.survey} (six-month window)`}</dd>
            <dt>Dates</dt><dd className="num">{longDate(frame.date_start)}{frame.date_end !== frame.date_start ? ` to ${longDate(frame.date_end)}` : ""}</dd>
            {p.channels.map(({ det, frame: f }, k) => (
              <div className="facts-row" key={det}>
                <dt>{p.colour ? ["Blue", "Green", "Red"][k] : "Detector"}</dt>
                <dd>
                  D{det}, {DETECTORS[det].label.toLowerCase()}, <span className="num">{DETECTORS[det].band[0].toFixed(2)}–{DETECTORS[det].band[1].toFixed(2)} µm</span>
                  {f && <span className="quiet"> {f.n_exposures - (f.n_failed ?? 0)} exposures{f.n_available > f.n_exposures ? ` of ${f.n_available}` : ""}{f.n_failed ? `, ${f.n_failed} missing` : ""}</span>}
                </dd>
              </div>
            ))}
            <dt><Term t="saturation">Saturated</Term></dt><dd className="num">{frame.saturated_px} px{frame.near_saturated_px ? `, ${frame.near_saturated_px} near` : ""}</dd>
            <dt>Flagged</dt><dd className="num">{frame.flagged_px} px</dd>
          </dl>
          <p className="sr-only" aria-live="polite">{frame.summary}</p>
        </section>
      )}

      {p.colour && (
        <section>
          <p className="warn">False colour. SPHEREx sees infrared, which has no visible colour; here the shortest band is shown as blue and the longest as red. Each band has its own fixed brightness scale.</p>
        </section>
      )}

      {p.compare !== "none" && p.pair && (
        <section className="callout">
          <p>Comparing survey {p.pair[0].survey} ({longDate(p.pair[0].date_start)}) with survey {p.pair[1].survey} ({longDate(p.pair[1].date_start)}).</p>
          {p.swing
            ? <p className="warn">{swingText(p.swing)}</p>
            : <p>These are suitable observations to compare. We have not automatically checked whether anything changed. Explore them yourself.</p>}
          {p.pair[0].release !== p.pair[1].release && <p className="warn">They come from different releases ({p.pair[0].release} and {p.pair[1].release}). Compare positions, not brightness.</p>}
        </section>
      )}
      {seq.comparability.notes.filter((n) => !n.startsWith("Frames come from different releases") || p.compare === "none").map((n, i) => (
        <section key={i}><p className="warn">{n}</p></section>
      ))}
      {p.swing && p.compare === "none" && (
        <section><p className="warn">{swingText(p.swing)}</p></section>
      )}
      {p.view === "exposures" && (
        <section><p className="warn">Single exposures each catch this spot at a different wavelength, so stars can flicker for no astronomical reason. Use this view for fast movers like asteroids, not for brightness.</p></section>
      )}

      <section>
        <h3>Display</h3>
        <label className="slider">Brightness
          <input type="range" min={-2} max={2} step={0.05} value={p.look.gain} onChange={(e) => p.onLook({ ...p.look, gain: Number(e.target.value) })} />
        </label>
        <label className="slider">Faint detail
          <input type="range" min={-2} max={2} step={0.05} value={-p.look.soft} onChange={(e) => p.onLook({ ...p.look, soft: -Number(e.target.value) })} />
        </label>
        <button className="link" onClick={() => p.onLook({ ...p.look, gain: 0, soft: 0 })}>Reset display</button>
        <p className="quiet">These change every frame in the same way, so comparisons stay fair.</p>
        <label className="check"><input type="checkbox" checked={p.showFlags} onChange={(e) => p.onFlags(e.target.checked)} /> Tint saturated and flagged pixels</label>
        <div className="legend">
          <span><i style={{ background: rgb(SAT_RGB) }} /> saturated, left out</span>
          <span><i style={{ background: "rgb(190,110,180)" }} /> near saturation, kept</span>
          <span><i style={{ background: rgb(FLAG_RGB) }} /> flagged, left out</span>
        </div>
        <p className="quiet">Left-out pixels are never averaged in. Untinted, they show black, which is why the brightest stars have a black core.</p>
        {t?.moves && <label className="check"><input type="checkbox" checked={p.showMarker} onChange={(e) => p.onMarker(e.target.checked)} /> Show predicted position</label>}
      </section>

      <section>
        <h3>Timeline</h3>
        <div className="seg" role="radiogroup" aria-label="Timeline">
          <button role="radio" aria-checked={p.view === "survey"} className={p.view === "survey" ? "on" : ""} onClick={() => p.onView("survey")}>One frame per survey</button>
          <button role="radio" aria-checked={p.view === "exposures"} className={p.view === "exposures" ? "on" : ""} onClick={() => p.onView("exposures")}>Every exposure</button>
        </div>
        <label className="check">
          <input type="checkbox" checked={p.ast} disabled={p.view !== "exposures" || p.colour} onChange={(e) => p.onAst(e.target.checked)} />
          Label known asteroids and comets (NASA JPL)
        </label>
        {p.view !== "exposures" ? (
          <p className="quiet">Asteroids smear out of survey stacks. Switch to every exposure to label them.</p>
        ) : p.ast ? (
          p.astStatus === "loading" ? <p className="quiet">Asking JPL which known bodies were in the field.</p>
            : typeof p.astStatus === "object" ? (
              <p className="quiet">{p.astStatus.bodies.length === 0 ? "JPL lists no known asteroid or comet in this field at this time." : `${p.astStatus.bodies.length} known in the field, yellow squares.`} {p.astStatus.note} Any other moving dot is unidentified: an artefact, a cosmic ray, or something uncatalogued.</p>
            ) : p.astStatus ? (
              <p className="warn">JPL could not be reached ({p.astStatus}). IRSA's <a href="https://irsa.ipac.caltech.edu/applications/MOST/" target="_blank" rel="noreferrer">Moving Object Search Tool</a> does the same job.</p>
            ) : null
        ) : null}
      </section>

      <details>
        <summary>How each frame is made</summary>
        <ul className="how">
          <li>Data: {seq.provenance.source}, collections {(seq.provenance.collections ?? []).join(", ")}.</li>
          <li>Each frame is the {seq.provenance.combine} of one detector's exposures from one visit.</li>
          <li><Term t="zodi">Zodiacal light</Term> subtracted using IRSA's model.</li>
          <li>Left out as saturated: {seq.provenance.saturation_flags.join(", ")}. Left out as flagged: {seq.provenance.masked_flags.join(", ")}.</li>
          {seq.provenance.near_saturation_flags && <li>Kept but marked: {seq.provenance.near_saturation_flags.join(", ")}.</li>}
          <li>{seq.provenance.reprojection}; {seq.grid.orientation}.</li>
          <li>Display: asinh stretch with black at the sky level, the same for every frame. Smoothing is display-only; "True pixels" shows each pixel as recorded.</li>
          <li>No frame is interpolated in time or invented. No automated detection or AI is used.</li>
        </ul>
      </details>

      {frame && frame.exposures.length > 0 && !p.colour && (
        <details>
          <summary>Exposures in this frame ({frame.exposures.length})</summary>
          <ul className="explist num">
            {frame.exposures.map((e) => (
              <li key={e.obs_id}>{e.obs_id}{e.time ? `, ${e.time.slice(0, 16).replace("T", " ")}` : ""}{e.wavelength_um ? `, ${e.wavelength_um.toFixed(3)} µm` : ""}{e.error ? `, skipped (${e.error.slice(0, 60)})` : ""}</li>
            ))}
          </ul>
        </details>
      )}

      <section>
        <p className="quiet">For spectra at this position, open IRSA's <a href="https://irsa.ipac.caltech.edu/applications/spherex" target="_blank" rel="noreferrer">SPHEREx Data Explorer</a> and its Spectrophotometry Tool at {seq.centre.ra.toFixed(5)}, {seq.centre.dec.toFixed(5)}.</p>
      </section>
    </aside>
  );
}
