// The live-search server may live at a different address from the website (VITE_API_BASE).
// On free hosting it sleeps when nobody has searched for a while and takes up to a minute
// to wake, so the site wakes it as soon as anyone opens a page and says so while it waits.
import { useSyncExternalStore } from "react";
import { API } from "./api";

export type ServerState = "same-origin" | "waking" | "ready" | "down";

let state: ServerState = API ? "ready" : "same-origin";   // optimistic until a check is slow
const subs = new Set<() => void>();
let checking: Promise<void> | null = null;

function set(s: ServerState) {
  if (s === state) return;
  state = s;
  subs.forEach((f) => f());
}

async function ping(timeoutMs: number): Promise<boolean> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(`${API}/api/health`, { cache: "no-store", signal: ac.signal });
    return r.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

/** Check the server, waking it if it sleeps. Shows "waking" only if it doesn't answer quickly. */
export function ensureAwake(): Promise<void> {
  if (!API) return Promise.resolve();
  if (checking) return checking;
  const slow = setTimeout(() => set("waking"), 1500);
  checking = (async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (await ping(75_000)) { set("ready"); return; }
      await new Promise((r) => setTimeout(r, 4000));
    }
    set("down");
  })().finally(() => { clearTimeout(slow); checking = null; });
  return checking;
}

export function useServerState(): ServerState {
  return useSyncExternalStore(
    (cb) => { subs.add(cb); return () => { subs.delete(cb); }; },
    () => state,
  );
}
