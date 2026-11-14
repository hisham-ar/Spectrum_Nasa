export type View = "survey" | "exposures";

export interface ExposureMeta {
  obs_id: string;
  time?: string;
  wavelength_um?: number | null;
  bandwidth_um?: number | null;
  saturated_px?: number;
  flagged_px?: number;
  error?: string;
}

export interface Marker { x: number; y: number; ra: number; dec: number }

export interface SmallBody { name: string; ra: number; dec: number; x: number; y: number; vmag: number | null }
export interface AsteroidResult { frame: number; time: string; observer: string; note: string; bodies: SmallBody[] }

export interface FrameMeta {
  index: number;
  png: string;
  mask: string;
  release: string;
  survey: number;
  date_start: string;
  date_end: string;
  time_mid: string;
  n_exposures: number;
  n_available: number;
  exposures: ExposureMeta[];
  wavelength_range_um: [number, number] | null;
  saturated_px: number;
  near_saturated_px?: number;
  n_failed?: number;
  flagged_px: number;
  outside_px: number;
  marker: Marker | null;
  summary: string;
  asteroids?: AsteroidResult; // pre-computed for Featured exposures views
}

export interface EpochSummary {
  detector: number; release: string; survey: number;
  date_start: string; date_end: string; n_exposures: number;
}

export interface TargetInfo {
  kind: "name" | "coords";
  query: string;
  name: string | null;
  label: string;
  otype: string | null;
  ra: number; dec: number;
  pmra: number | null; pmdec: number | null; plx: number | null;
  moves: boolean;
  notes: string[];
  position_now?: { ra: number; dec: number; date: string };
}

export interface Sequence {
  query?: string;          // cache-busting query for Featured files (set by the client)
  schema: number;
  key: string;
  status: "ready";
  request: { ra: number; dec: number; fov: number; det: number; view: View };
  target: TargetInfo | null;
  centre: { ra: number; dec: number; note: string };
  grid: { nx: number; ny: number; pixel_scale_arcsec: number; crval: [number, number]; orientation: string };
  detector: { id: number; band_um: [number, number]; label: string };
  stretch: { kind: string; a: number; lo: number; hi: number; percentiles: [number, number]; unit: string };
  frames: FrameMeta[];
  coverage: Record<string, EpochSummary[]>;
  comparability: { mixed_releases: boolean; channel_mix_differs: boolean; notes: string[] };
  provenance: Record<string, unknown> & {
    combine: string; saturation_flags: string[]; masked_flags: string[]; near_saturation_flags?: string[];
    reprojection: string; collections?: string[]; queried_at?: string; built_at: string; source: string;
  };
  timings?: Record<string, number>;
  /** set by the client: URL folder holding the PNGs */
  base?: string;
}

export interface BuildStatus {
  status: "building" | "error";
  stage: string;
  done: number;
  total: number;
  elapsed_s?: number;
  error?: string;
}

export interface FeaturedCard {
  slug: string;
  name: string;
  q?: string; // name sent to the resolver for live builds
  title: string;
  blurb: string;
  can_see: string;
  category: string;
  verified: boolean;
  ra: number; dec: number;
  fov: number;
  det: number;
  view: View;
  frame?: number;
  compare?: "blink" | "side" | "none";
  sequences: Record<string, string>; // "3-survey" -> "barnard/d3-survey/"
}

export interface FeaturedIndex { built_at: string; data_as_of?: string; cards: FeaturedCard[] }

export const DETECTORS: Record<number, { band: [number, number]; label: string }> = {
  1: { band: [0.75, 1.09], label: "Just past red" },
  2: { band: [1.10, 1.62], label: "Near infrared" },
  3: { band: [1.63, 2.41], label: "Warm-star infrared" },
  4: { band: [2.42, 3.82], label: "Ices and dust" },
  5: { band: [3.83, 4.41], label: "CO₂ and cold objects" },
  6: { band: [4.42, 5.00], label: "Coldest objects" },
};

export const FOV_PRESETS = [
  { id: 5, label: "5′" },
  { id: 10, label: "10′" },
  { id: 20, label: "20′" },
];
