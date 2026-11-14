import type { AsteroidResult, BuildStatus, EpochSummary, FeaturedIndex, Sequence, TargetInfo, View } from "./types";

export const API = ((import.meta.env.VITE_API_BASE as string | undefined) ?? "").replace(/\/+$/, "");

export const UNREACHABLE = "The search server can't be reached right now. Featured targets still work.";

async function getJson<T>(url: string, signal?: AbortSignal): Promise<{ status: number; body: T }> {
  let r: Response;
  try {
    r = await fetch(url, { signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new Error(UNREACHABLE);   // network failure: server down or unreachable
  }
  let body: T;
  try {
    body = (await r.json()) as T;
  } catch {
    throw new Error(`Server returned ${r.status}`);
  }
  if (r.status >= 400) {
    const detail = (body as unknown as { detail?: string; error?: string })?.detail
      ?? (body as unknown as { error?: string })?.error ?? `HTTP ${r.status}`;
    throw new Error(detail);
  }
  return { status: r.status, body };
}

export async function resolveName(q: string, signal?: AbortSignal): Promise<TargetInfo> {
  return (await getJson<TargetInfo>(`${API}/api/resolve?q=${encodeURIComponent(q)}`, signal)).body;
}

export interface LocationParams { q?: string; ra?: number; dec?: number }

function locParams(l: LocationParams): string {
  if (l.q) return `q=${encodeURIComponent(l.q)}`;
  return `ra=${l.ra}&dec=${l.dec}`;
}

export async function fetchCoverage(l: LocationParams, signal?: AbortSignal) {
  return (await getJson<{ coverage: Record<string, EpochSummary[]>; latest_date: string | null }>(
    `${API}/api/coverage?${locParams(l)}`, signal)).body;
}

/** Polls the build job until the sequence is ready. */
export async function fetchSequence(
  l: LocationParams, fov: number, det: number, view: View,
  onProgress: (s: BuildStatus) => void, signal: AbortSignal,
): Promise<Sequence> {
  const url = `${API}/api/sequence?${locParams(l)}&fov=${fov}&det=${det}&view=${view}`;
  for (;;) {
    const { status, body } = await getJson<Sequence | BuildStatus>(url, signal);
    if (status === 200 && (body as Sequence).frames) {
      const seq = body as Sequence;
      seq.base = `${API}/api/seq/${seq.key}/`;
      return seq;
    }
    onProgress(body as BuildStatus);
    await new Promise((res, rej) => {
      const t = setTimeout(res, 1200);
      signal.addEventListener("abort", () => { clearTimeout(t); rej(new DOMException("aborted", "AbortError")); });
    });
  }
}

let featuredCache: Promise<FeaturedIndex | null> | null = null;
let featuredBuilt = "";   // build stamp, added to every Featured file URL so a rebuild is never served stale

export function fetchFeatured(): Promise<FeaturedIndex | null> {
  // Always re-check the list: a rebuild keeps the same file names.
  featuredCache ??= fetch("/featured/index.json", { cache: "no-cache" })
    .then((r) => (r.ok ? (r.json() as Promise<FeaturedIndex>) : null))
    .then((ix) => { featuredBuilt = ix?.built_at ?? ""; return ix; })
    .catch(() => null);
  return featuredCache;
}

export async function fetchFeaturedSequence(folder: string, signal?: AbortSignal): Promise<Sequence> {
  const base = `/featured/${folder}`;
  const query = featuredBuilt ? `v=${encodeURIComponent(featuredBuilt)}` : "";
  const r = await fetch(`${base}sequence.json${query ? `?${query}` : ""}`, { signal, cache: "no-cache" });
  if (!r.ok) throw new Error(`Featured sequence missing (${r.status})`);
  const seq = (await r.json()) as Sequence;
  seq.base = base;
  seq.query = query;
  return seq;
}

export async function fetchAsteroids(key: string, frame: number, signal?: AbortSignal): Promise<AsteroidResult> {
  return (await getJson<AsteroidResult>(`${API}/api/asteroids?key=${key}&frame=${frame}`, signal)).body;
}
