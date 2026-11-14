import type { FeaturedCard, StepView } from "../lib/types";

/* A short guided investigation for a Featured card: a question, a few steps that
 * each set up the view to look at, and what it means. Lives in the side drawer so
 * it never covers the sky. */

interface Props {
  card: FeaturedCard;
  step: number;
  onStep: (i: number, view?: StepView) => void;
  onClose: () => void;
  onNavigate: (to: string) => void;
  featured: FeaturedCard[];
}

export default function InvestigationPanel({ card, step, onStep, onClose, onNavigate, featured }: Props) {
  const inv = card.investigation!;
  const n = inv.steps.length;
  const done = step >= n;
  const go = (i: number) => onStep(i, inv.steps[i]?.view);
  const next = featured.find((c) => c.slug === inv.try_next_target);
  return (
    <aside className="drawer open inv" aria-label="Guided investigation">
      <div className="drawer-head">
        <h2>Investigate</h2>
        <button className="tool" onClick={onClose} aria-label="Close the investigation">×</button>
      </div>
      <section>
        <p className="inv-q">{inv.question}</p>
        <p className="quiet inv-how">Each step sets up the view for you. Look, then move on when you're ready.</p>
      </section>
      <ol className="inv-steps">
        {inv.steps.map((s, i) => (
          <li key={i} className={i === step ? "on" : i < step ? "seen" : ""}>
            <button className="inv-step-head" aria-expanded={i === step} onClick={() => go(i)}>
              <span className="inv-n" aria-hidden="true">{i + 1}</span>
              <span>{s.title}</span>
            </button>
            {i === step && (
              <div className="inv-body">
                <p>{s.text}</p>
                {s.view && <button className="chip" onClick={() => go(i)}>Set up this view again</button>}
              </div>
            )}
          </li>
        ))}
      </ol>
      <div className="inv-nav">
        <button className="chip" disabled={step <= 0} onClick={() => go(Math.max(0, step - 1))}>Back</button>
        {!done && <button className="chip on" onClick={() => (step + 1 < n ? go(step + 1) : onStep(n))}>{step + 1 < n ? "Next step" : "What it means"}</button>}
      </div>
      {done && (
        <section className="inv-end">
          <h3>What it means</h3>
          <p>{inv.takeaway}</p>
          {inv.try_next && (
            <>
              <h3>Try it yourself</h3>
              <p>{inv.try_next}</p>
              {next ? (
                <button className="chip on" onClick={() => onNavigate(`/?target=${next.slug}&det=${next.det}&fov=${next.fov}${next.investigation ? "&inv=1" : ""}`)}>Open {next.name}</button>
              ) : inv.try_next_q ? (
                <button className="chip on" onClick={() => onNavigate(`/?q=${encodeURIComponent(inv.try_next_q!)}&fov=10`)}>Search for {inv.try_next_q}</button>
              ) : null}
            </>
          )}
          <button className="chip inv-again" onClick={() => go(0)}>Start again</button>
        </section>
      )}
    </aside>
  );
}
