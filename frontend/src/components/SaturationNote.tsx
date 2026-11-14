import { useState } from "react";

const KEY = "lits:hide-saturation-note";

function hiddenForGood(): boolean {
  try { return window.localStorage.getItem(KEY) === "1"; } catch { return false; }
}

/** Explains the blank (black) centres of bright stars. Shown once per view;
 *  "Don't show this again" remembers the choice in this browser. */
export default function SaturationNote({ onShowPixels, suppressed }: { onShowPixels: () => void; suppressed: boolean }) {
  const [open, setOpen] = useState(() => !hiddenForGood());
  // On a phone the full note would cover the star it explains: start as a small button.
  const [expanded, setExpanded] = useState(() => !(window.matchMedia?.("(max-width: 820px)").matches ?? false));
  if (!open || suppressed) return null;   // suppressed: flag colours already show the pixels
  if (!expanded) {
    return (
      <div className="sat-note-pill">
        <button className="chip" aria-expanded="false" onClick={() => setExpanded(true)}>Why is the centre black?</button>
        <button className="sat-note-x" aria-label="Close" onClick={() => setOpen(false)}>×</button>
      </div>
    );
  }
  const never = () => {
    try { window.localStorage.setItem(KEY, "1"); } catch { /* storage blocked: just close */ }
    setOpen(false);
  };
  return (
    <aside className="sat-note" role="status" aria-labelledby="sat-note-title">
      <button className="sat-note-x" aria-label="Close" onClick={() => setOpen(false)}>×</button>
      <h2 id="sat-note-title">Why bright stars have black centres</h2>
      <p>This star is brighter than SPHEREx can measure. Where the detector maxed out, the pixels are left blank, not filled with a number that was never really measured.</p>
      <p>The glow around a bright star also looks different from visit to visit. SPHEREx comes back to each patch of sky about every six months, pointed at a different angle each time, so a change in that glow doesn't mean the star got brighter or fainter.</p>
      <div className="sat-note-actions">
        <button className="chip" onClick={() => { onShowPixels(); setOpen(false); }}>Show which pixels</button>
        <button className="sat-note-never" onClick={never}>Don't show this again</button>
      </div>
    </aside>
  );
}
