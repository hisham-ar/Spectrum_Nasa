import type { FeaturedCard } from "../lib/types";
import { DETECTORS } from "../lib/types";

export default function Featured({ cards, onOpen }: { cards: FeaturedCard[]; onOpen: (c: FeaturedCard) => void }) {
  const shown = cards.filter((c) => c.verified);
  return (
    <main className="page">
      <h1>Featured discoveries</h1>
      <p className="lede">Each card opens the explorer on real SPHEREx frames that a person on our team has checked. They load from a saved copy, so they work even when the archive is busy.</p>
      {shown.length === 0 ? (
        <p className="muted">Cards appear here once they have been checked against the real frames. Meanwhile, the five challenge targets are on the Explore page.</p>
      ) : (
        <div className="cards">
          {shown.map((c) => (
            <article key={c.slug} className="card">
              <div className="card-thumb">
                {c.sequences[`${c.det}-${c.view}`] && (
                  <img src={`/featured/${c.sequences[`${c.det}-${c.view}`]}frame_0.png`} alt="" loading="lazy" />
                )}
              </div>
              <div className="card-body">
                <span className="pill">{c.category}</span>
                <h2>{c.title}</h2>
                <p>{c.blurb}</p>
                <p className="small"><strong>What you can really see:</strong> {c.can_see}</p>
                <p className="small muted">{c.name} · detector {c.det} ({DETECTORS[c.det].band[0].toFixed(2)}–{DETECTORS[c.det].band[1].toFixed(2)} µm) · {c.fov}′ field</p>
                <button className="btn primary" onClick={() => onOpen(c)}>Open in the explorer</button>
              </div>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
