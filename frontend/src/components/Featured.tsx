import type { FeaturedCard } from "../lib/types";
import { DETECTORS } from "../lib/types";

export default function Featured({ cards, onOpen }: { cards: FeaturedCard[]; onOpen: (c: FeaturedCard) => void }) {
  const shown = cards.filter((c) => c.verified);
  return (
    <main className="page">
      <h1>Things worth a look</h1>
      <p className="lede">Each of these opens the explorer on real SPHEREx frames that someone on our team has checked by eye. They load from a saved copy, so they open instantly.</p>
      {shown.length === 0 ? (
        <p className="quiet">Nothing here yet: a target only appears once a person has checked it against the real frames. The five challenge targets are on the home page in the meantime.</p>
      ) : (
        <div className="cards">
          {shown.map((c) => {
            const folder = c.sequences[`${c.det}-${c.view}`];
            return (
              <article key={c.slug} className="card">
                <button className="card-thumb" onClick={() => onOpen(c)} aria-label={`Open ${c.name}`} style={{ padding: 0, cursor: "pointer" }}>
                  {folder && <img src={`/featured/${folder}frame_0.png`} alt="" loading="lazy" />}
                </button>
                <span className="tag" style={{ alignSelf: "flex-start" }}>{c.category}</span>
                <h2>{c.title}</h2>
                <p>{c.blurb}</p>
                <p className="quiet">What you can really see: {c.can_see}</p>
                <p className="quiet">{c.name}, detector {c.det} ({DETECTORS[c.det].band[0].toFixed(2)} to {DETECTORS[c.det].band[1].toFixed(2)} µm), {c.fov} arcmin field.</p>
                <button className="chip" onClick={() => onOpen(c)}>Open in the explorer</button>
              </article>
            );
          })}
        </div>
      )}
    </main>
  );
}
