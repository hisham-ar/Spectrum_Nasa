import { useEffect, useRef, useState } from "react";
import { resolveName } from "../lib/api";
import { looksLikeCoords } from "../lib/coords";
import type { FeaturedCard, TargetInfo } from "../lib/types";

interface Props {
  featured: FeaturedCard[];
  onPickFeatured: (c: FeaturedCard) => void;
  onResolved: (t: TargetInfo) => void;
  compact?: boolean;
  autoFocus?: boolean;
}

type Sugg = { kind: "featured"; card: FeaturedCard } | { kind: "coords"; text: string } | { kind: "lookup"; text: string };

export default function SearchBox({ featured, onPickFeatured, onResolved, compact, autoFocus }: Props) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const q = text.trim();
  const sugg: Sugg[] = [];
  if (q) {
    if (looksLikeCoords(q)) sugg.push({ kind: "coords", text: q });
    const low = q.toLowerCase();
    for (const c of featured) if (c.name.toLowerCase().includes(low) || c.slug.includes(low)) sugg.push({ kind: "featured", card: c });
    if (!looksLikeCoords(q)) sugg.push({ kind: "lookup", text: q });
  }

  useEffect(() => {
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  async function go(s?: Sugg) {
    setError(null);
    if (s?.kind === "featured") { setOpen(false); onPickFeatured(s.card); return; }
    const term = s ? s.text : q;
    if (!term) return;
    setBusy(true);
    try {
      const t = await resolveName(term);
      setOpen(false);
      onResolved(t);
    } catch (e) {
      setError((e as Error).message.includes("fetch") || (e as Error).message.includes("Server returned")
        ? "Live search is unavailable right now. The featured targets still work."
        : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`search ${compact ? "compact" : ""}`} ref={box}>
      <form
        role="search"
        onSubmit={(e) => { e.preventDefault(); go(open && sugg[active] ? sugg[active] : undefined); }}
      >
        <input
          type="search"
          value={text}
          autoFocus={autoFocus}
          placeholder="Star name or coordinates — try “Barnard's Star” or “269.45 4.77”"
          aria-label="Search by object name or coordinates"
          aria-autocomplete="list"
          aria-expanded={open && sugg.length > 0}
          aria-controls="search-sugg"
          onChange={(e) => { setText(e.target.value); setOpen(true); setActive(0); setError(null); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, sugg.length - 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
            if (e.key === "Escape") setOpen(false);
          }}
        />
        <button className="btn primary" type="submit" disabled={busy || !q}>{busy ? "…" : "Go"}</button>
      </form>
      {open && sugg.length > 0 && (
        <ul className="sugg" id="search-sugg" role="listbox">
          {sugg.map((s, i) => (
            <li key={i} role="option" aria-selected={i === active} className={i === active ? "on" : ""}
                onMouseDown={(e) => { e.preventDefault(); go(s); }} onMouseEnter={() => setActive(i)}>
              {s.kind === "featured" && <><span>{s.card.name}</span><span className="pill">{s.card.category}</span><span className="pill ok">ready</span></>}
              {s.kind === "coords" && <><span className="mono">{s.text}</span><span className="pill">Coordinates</span></>}
              {s.kind === "lookup" && <><span>Look up “{s.text}”</span><span className="pill">SIMBAD name</span></>}
            </li>
          ))}
        </ul>
      )}
      {error && <p className="search-error" role="alert">{error}</p>}
    </div>
  );
}
