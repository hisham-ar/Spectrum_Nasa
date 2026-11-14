import { useState } from "react";
import type { FeaturedCard } from "../lib/types";
import { DETECTORS } from "../lib/types";
import { longDate } from "./Timeline";

/* Public view: only cards a person on the team has approved.
 * Review view (/featured?review): every card, with what to check and how to approve it. */

function ApproveCommand({ slug }: { slug: string }) {
  const cmd = `python backend\\scripts\\featured_cards.py approve ${slug} --by "Your name"`;
  const [copied, setCopied] = useState(false);
  return (
    <div className="approve">
      <code>{cmd}</code>
      <button className="chip" onClick={async () => {
        try { await navigator.clipboard.writeText(cmd); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
      }}>{copied ? "Copied" : "Copy"}</button>
    </div>
  );
}

function Card({ c, review, onOpen }: { c: FeaturedCard; review: boolean; onOpen: (c: FeaturedCard, investigate?: boolean) => void }) {
  const folder = c.sequences[`${c.det}-${c.view}`];
  return (
    <article className={`card ${review && !c.verified ? "unchecked" : ""}`}>
      <button className="card-thumb" onClick={() => onOpen(c)} aria-label={`Open ${c.name}`} style={{ padding: 0, cursor: "pointer" }}>
        {folder && <img src={`/featured/${folder}frame_0.png`} alt="" />}
      </button>
      <div className="card-tags">
        <span className="tag">{c.category}</span>
        {review && (c.verified
          ? <span className="tag ok">Approved by {c.verified_by ?? "the team"}{c.verified_on ? `, ${longDate(c.verified_on)}` : ""}</span>
          : <span className="tag todo">Not checked yet</span>)}
      </div>
      <h2>{c.title}</h2>
      <p>{c.blurb}</p>
      <p className="quiet">What you can really see: {c.can_see}</p>
      <p className="quiet">{c.name}, detector {c.det} ({DETECTORS[c.det].band[0].toFixed(2)} to {DETECTORS[c.det].band[1].toFixed(2)} µm), {c.fov} arcmin field.</p>
      {!review && c.verified_on && <p className="quiet">Checked against the frames on {longDate(c.verified_on)}.</p>}
      <div className="card-actions">
        {c.investigation && <button className="chip on" onClick={() => onOpen(c, true)}>Investigate</button>}
        <button className="chip" onClick={() => onOpen(c)}>Open in the explorer</button>
      </div>
      {c.investigation && <p className="quiet card-q">Investigation: {c.investigation.question}</p>}
      {review && (
        <div className="review">
          {c.check && c.check.length > 0 && (
            <>
              <h3>Before approving, check</h3>
              <ul>{c.check.map((t, i) => <li key={i}>{t}</li>)}</ul>
            </>
          )}
          {c.review_note && (
            <details>
              <summary>Measurements behind this text</summary>
              <p>{c.review_note}</p>
            </details>
          )}
          {!c.verified && <ApproveCommand slug={c.slug} />}
        </div>
      )}
    </article>
  );
}

export default function Featured({ cards, onOpen }: { cards: FeaturedCard[]; onOpen: (c: FeaturedCard, investigate?: boolean) => void }) {
  const review = new URLSearchParams(window.location.search).has("review");
  const shown = review ? cards : cards.filter((c) => c.verified);
  const approved = cards.filter((c) => c.verified).length;
  return (
    <main className="page">
      {review ? (
        <>
          <h1>Review Featured cards</h1>
          <p className="lede">
            Only cards a person has approved appear on the public Featured page. Open each one, check the points listed against
            the real frames, then approve it with the command shown, run from the project folder. {approved} of {cards.length} approved so far.
          </p>
        </>
      ) : (
        <>
          <h1>Things worth a look</h1>
          <p className="lede">Each of these opens the explorer on real SPHEREx frames, checked against what the card says. They load from a saved copy, so they open instantly.</p>
        </>
      )}
      {shown.length === 0 ? (
        <p className="quiet">Nothing here yet: a target only appears once a person has checked it against the real frames. The five challenge targets are on the home page in the meantime.</p>
      ) : (
        <div className="cards">
          {shown.map((c) => <Card key={c.slug} c={c} review={review} onOpen={onOpen} />)}
        </div>
      )}
    </main>
  );
}
