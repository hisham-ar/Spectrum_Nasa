import type { Sequence } from "./types";

/** Smallest blob counted as a saturated star rather than a stray pixel. */
export const SAT_NOTE_MIN_PX = 12;

export interface SatSwing { min: number; max: number; det: number }

/** Does the blank (saturated) area change so much between visits that the visits
 *  can't be compared for this star? (Antares: 23 vs 7,461 blank pixels, because
 *  SPHEREx's processing labelled the overloaded pixels differently per exposure.)
 *  Needs a big absolute change (2% of the view) and a big ratio (3x). */
export function saturationSwing(seqs: { det: number; seq: Sequence }[]): SatSwing | null {
  let worst: SatSwing | null = null;
  for (const { det, seq } of seqs) {
    if (seq.frames.length < 2) continue;
    const counts = seq.frames.map((f) => f.saturated_px);
    const min = Math.min(...counts), max = Math.max(...counts);
    const area = seq.grid.nx * seq.grid.ny;
    if (max - min >= 0.02 * area && max >= 3 * Math.max(min, 1)) {
      if (!worst || max - min > worst.max - worst.min) worst = { min, max, det };
    }
  }
  return worst;
}

export const swingText = (s: SatSwing) =>
  `How much of this star SPHEREx could measure changes a lot between visits (from ${s.min.toLocaleString("en-US")} to ${s.max.toLocaleString("en-US")} blank pixels on detector ${s.det}), because the overloaded pixels were labelled differently in different exposures. Don't compare this star's appearance from one visit to the next.`;
