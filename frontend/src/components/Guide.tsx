import { useEffect, useState, type ReactNode } from "react";
import { fetchFeaturedSequence } from "../lib/api";
import { DEFAULT_LOOK, FALLBACK_STRETCH, FLAG_RGB, SAT_RGB, loadPlane, renderGray, renderRGB, type Plane, type Stretch } from "../lib/render";
import { DETECTORS, type FeaturedCard, type FrameMeta, type Sequence } from "../lib/types";
import SkyCanvas, { type ViewXform } from "./SkyCanvas";
import { RAIL_COLOURS } from "./SpectralRail";
import { monthSpan } from "./Timeline";

/* A plain-language guide, written so a teacher or hobbyist can read it alone and
 * then show a class. Every picture is a real SPHEREx frame of Barnard's Star. */

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
const rgb = (c: number[]) => `rgb(${c.join(",")})`;

interface Frames {
  grey: Record<number, ImageData>;   // first visit, detectors 1, 3, 6
  colour: ImageData | null;          // first visit, D1/D3/D6 as blue/green/red
  blink: [ImageData, ImageData];     // detector 3, first and last visit
  tinted: ImageData;                 // detector 3, first visit, left-out pixels tinted
  marker: FrameMeta["marker"];
  blinkMarkers: [FrameMeta["marker"], FrameMeta["marker"]];   // each visit's own predicted position
  when: [string, string];
  nx: number;
}

function useBarnard(featured: FeaturedCard[], ready: boolean): Frames | null | "missing" {
  const [out, setOut] = useState<Frames | null | "missing">(null);
  useEffect(() => {
    if (!ready) return;
    const card = featured.find((c) => c.slug === "barnard");
    const paths = [1, 3, 6].map((d) => card?.sequences[`${d}-survey`]);
    if (!card || !paths[1]) { setOut("missing"); return; }
    let live = true;
    (async () => {
      const seqs: (Sequence | null)[] = await Promise.all(paths.map((p) => (p ? fetchFeaturedSequence(p) : Promise.resolve(null))));
      const s3 = seqs[1]!;
      if (s3.frames.length < 2) { setOut("missing"); return; }
      const stretch = (sq: Sequence, p: Plane): Stretch => (p.fallback ? FALLBACK_STRETCH : { lo: sq.stretch.lo, hi: sq.stretch.hi, a: sq.stretch.a });
      const first = s3.frames[0], last = s3.frames[s3.frames.length - 1];
      const planeFor = async (sq: Sequence, survey: number) => {
        const f = sq.frames.find((x) => x.survey === survey) ?? sq.frames[0];
        return loadPlane(sq.base!, f, sq.grid.nx, sq.grid.ny, sq.query);
      };
      const grey: Record<number, ImageData> = {};
      const firstPlanes: (Plane | null)[] = [];
      for (const [k, sq] of seqs.entries()) {
        if (!sq) { firstPlanes.push(null); continue; }
        const p = await planeFor(sq, first.survey);
        firstPlanes.push(p);
        grey[[1, 3, 6][k]] = renderGray(p, stretch(sq, p), DEFAULT_LOOK);
      }
      const lastPlane = await planeFor(s3, last.survey);
      const colour = firstPlanes.every(Boolean)
        ? renderRGB(firstPlanes as [Plane, Plane, Plane],
            seqs.map((sq, k) => stretch(sq!, firstPlanes[k]!)) as [Stretch, Stretch, Stretch], DEFAULT_LOOK)
        : null;
      const p3 = firstPlanes[1]!;
      if (!live) return;
      setOut({
        grey, colour,
        blink: [grey[3], renderGray(lastPlane, stretch(s3, lastPlane), DEFAULT_LOOK)],
        tinted: renderGray(p3, stretch(s3, p3), { ...DEFAULT_LOOK, showFlags: true }),
        marker: first.marker,
        blinkMarkers: [first.marker, last.marker],
        when: [monthSpan(first.date_start, first.date_end), monthSpan(last.date_start, last.date_end)],
        nx: s3.grid.nx,
      });
    })().catch(() => live && setOut("missing"));
    return () => { live = false; };
  }, [featured, ready]);
  return out;
}

function Sky({ image, label, marker, zoom = 1, centre, chrome = false, size }: {
  image: ImageData | undefined | null; label: string; marker?: FrameMeta["marker"]; zoom?: number;
  centre?: [number, number]; chrome?: boolean; size?: "small";
}) {
  const n = image?.width ?? 100;
  const [xf, setXf] = useState<ViewXform>({ zoom, cx: centre?.[0] ?? n / 2, cy: centre?.[1] ?? n / 2 });
  useEffect(() => { setXf({ zoom, cx: centre?.[0] ?? n / 2, cy: centre?.[1] ?? n / 2 }); }, [zoom, n, centre?.[0], centre?.[1]]);
  return (
    <div className={`guide-sky ${size ?? ""}`}>
      {image
        ? <SkyCanvas image={image} smooth marker={marker ?? null} showMarker={!!marker} pixelScale={6.15}
            xform={xf} onXform={setXf} interactive={false} chrome={chrome} fit="cover" ariaLabel={label} />
        : <div className="guide-sky-wait" aria-hidden="true" />}
    </div>
  );
}

function Step({ n, id, title, children, figure }: { n: number; id: string; title: string; children: ReactNode; figure?: ReactNode }) {
  return (
    <section className="guide-step" id={id} aria-labelledby={`${id}-h`}>
      <div className="guide-num" aria-hidden="true">{n}</div>
      <div className="guide-text">
        <h2 id={`${id}-h`}>{title}</h2>
        {children}
      </div>
      {figure && <div className="guide-fig">{figure}</div>}
    </section>
  );
}

function TryIt({ to, onNavigate, children }: { to: string; onNavigate: (to: string) => void; children: ReactNode }) {
  return (
    <a className="try" href={to} onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); onNavigate(to); }}>
      Try it: {children}
    </a>
  );
}

const STEPS = [
  ["what", "What SPHEREx is"],
  ["picture", "Reading one picture"],
  ["detectors", "Six detectors, one colour bar"],
  ["colour", "The colour view"],
  ["time", "Moving through time"],
  ["black", "Black centres and tinted pixels"],
  ["limits", "What the pictures can and can't tell you"],
  ["class", "A ten-minute classroom activity"],
] as const;

export default function Guide({ featured, featuredReady, onNavigate }: {
  featured: FeaturedCard[]; featuredReady: boolean; onNavigate: (to: string) => void;
}) {
  const f = useBarnard(featured, featuredReady);
  const fr = f && f !== "missing" ? f : null;
  const [phase, setPhase] = useState(0);
  const [blinking, setBlinking] = useState(() => !reducedMotion());
  useEffect(() => {
    if (!fr || !blinking) return;
    const t = setInterval(() => setPhase((p) => 1 - p), 1000);   // 1 per second, well under 3 Hz
    return () => clearInterval(t);
  }, [fr, blinking]);

  const core: [number, number] | undefined = fr?.marker ? [fr.marker.x + 0.5, fr.marker.y + 0.5] : undefined;
  const span = 5.0 - 0.75;   // micrometres covered by the six detectors

  return (
    <main className="page guide">
      <header className="guide-head">
        <h1>How to use Lost in the Spectrum</h1>
        <p className="lede">
          A ten-minute guide to reading the pictures, for curious visitors and for teachers getting ready to show a class.
          It starts from the basics. Every picture on this page is real data from NASA's SPHEREx telescope.
        </p>
        <nav className="guide-toc" aria-label="In this guide">
          <ol>
            {STEPS.map(([id, t]) => <li key={id}><a href={`#${id}`}>{t}</a></li>)}
          </ol>
        </nav>
        {f === "missing" && <p className="warn">The example pictures could not be loaded right now. The text below still applies.</p>}
      </header>

      <Step n={1} id="what" title="What SPHEREx is">
        <p>SPHEREx is a NASA space telescope that launched in March 2025. It photographs the whole sky in infrared light, the kind just past red that our eyes can't see. It finishes a full map of the sky about every six months, then starts again.</p>
        <p>Because it keeps coming back to the same patches of sky, you can compare its pictures over time. Most stars are so far away that they never seem to move. A few nearby ones shift visibly from one map to the next, and this site helps you see that.</p>
      </Step>

      <Step n={2} id="picture" title="Reading one picture"
        figure={<>
          <Sky image={fr?.grey[3]} marker={fr?.marker} chrome label="Barnard's Star, detector 3, one SPHEREx visit" />
          <p className="guide-cap">Barnard's Star, detector 3, {fr?.when[0] ?? "first visit"}. 10 arcminutes across.</p>
        </>}>
        <p>Each picture is a small square of sky around the star you picked.</p>
        <ul>
          <li><strong>Brighter means more infrared light.</strong> The picture is grey because infrared has no colour we can see, so brightness is all there is to show.</li>
          <li><strong>The dashed circle</strong> marks where the star you searched for should be on that date, worked out from its catalogue position and how fast it moves.</li>
          <li><strong>The scale bar</strong> in the corner shows size on the sky. One arcminute is about a thirtieth of the width of the full Moon.</li>
          <li><strong>North is up and east is to the left</strong>, the way astronomers draw the sky as seen from below.</li>
          <li><strong>Each picture is a stack</strong> of several exposures from one visit, so it's cleaner than a single snapshot.</li>
        </ul>
        <TryIt to="/?target=barnard&det=3&fov=10" onNavigate={onNavigate}>open this picture</TryIt>
      </Step>

      <Step n={3} id="detectors" title="Six detectors, one colour bar"
        figure={<>
          <div className="guide-rail" role="img" aria-label="The six SPHEREx detectors from 0.75 to 5 micrometres">
            {[1, 2, 3, 4, 5, 6].map((d) => {
              const [a, b] = DETECTORS[d].band;
              return (
                <div key={d} className="guide-rail-seg" style={{ flexGrow: (b - a) / span, background: RAIL_COLOURS[d - 1] }}>
                  <span>{d}</span>
                </div>
              );
            })}
          </div>
          <div className="guide-rail-scale" aria-hidden="true"><span>0.75 µm</span><span>5.0 µm</span></div>
          <div className="guide-trio">
            {[1, 3, 6].map((d) => (
              <figure key={d}>
                <Sky image={fr?.grey[d]} size="small" label={`Barnard's Star in detector ${d}`} />
                <figcaption>Detector {d}<br /><span className="quiet">{DETECTORS[d].band[0].toFixed(2)}–{DETECTORS[d].band[1].toFixed(2)} µm</span></figcaption>
              </figure>
            ))}
          </div>
          <p className="guide-cap">The same patch of sky seen by three of the detectors. Compare which stars stay bright and which fade.</p>
        </>}>
        <p>SPHEREx has six detectors. Each one sees its own slice of infrared, from 0.75 micrometres (just past red light) to 5 micrometres. The coloured bar along the bottom of the explorer is a map of those six slices, shortest on the left. Click a slice to switch detectors.</p>
        <p><strong>The colours on the bar are only labels</strong> to tell the slices apart. They are not the colour of the sky.</p>
        <p>Different slices show different things. The short slices on the left pick out ordinary stars. The long slices on the right show cooler things: brown dwarfs, dust and icy clouds.</p>
      </Step>

      <Step n={4} id="colour" title="The colour view"
        figure={<>
          <Sky image={fr?.colour} label="Barnard's Star in false colour" />
          <p className="guide-cap">False colour: detector 1 as blue, 3 as green, 6 as red.</p>
        </>}>
        <p>The <strong>Colour</strong> button joins three detectors into one picture. The shortest slice is shown as blue, the middle as green and the longest as red. Astronomers call this false colour. It's a way of showing invisible light, not what your eye would see.</p>
        <p>A star that looks blue is brighter in the short slice. One that looks red is brighter in the long slice, which usually means it's cooler or surrounded by dust.</p>
        <TryIt to="/?target=barnard&det=3&fov=10&col=1" onNavigate={onNavigate}>the colour view</TryIt>
      </Step>

      <Step n={5} id="time" title="Moving through time"
        figure={<>
          <Sky image={fr?.blink[phase]} marker={fr?.blinkMarkers[phase]} zoom={2.2} centre={core} label={`Barnard's Star, ${phase ? "last" : "first"} visit`} />
          <div className="guide-blink">
            <span className="guide-blink-tag"><b>{phase ? "B" : "A"}</b> {fr ? fr.when[phase] : ""}</span>
            <button className="chip" onClick={() => setBlinking((b) => !b)}>{blinking ? "Pause" : "Blink"}</button>
            {!blinking && <button className="chip" onClick={() => setPhase((p) => 1 - p)}>Switch visit</button>}
          </div>
          <p className="guide-cap">Barnard's Star, about a year apart, zoomed in. Watch the black centre jump while the other stars stay put.</p>
        </>}>
        <p>The timeline under the picture has one stop for each SPHEREx visit, with the number of days between visits. There are three ways to compare them:</p>
        <ul>
          <li><strong>Step</strong> through the visits one at a time with the play button or the ← and → keys.</li>
          <li><strong>Blink</strong> flips quickly between two visits (press <kbd>B</kbd>). Anything that jumps has moved.</li>
          <li><strong>Side by side</strong> puts two visits next to each other.</li>
        </ul>
        <p>Barnard's Star moves about 10 arcseconds a year across the sky, which is almost two SPHEREx pixels. Zoom in with <strong>+</strong> and blink to see it hop.</p>
        <TryIt to="/?target=barnard&det=3&fov=10&cmp=blink" onNavigate={onNavigate}>blink Barnard's Star</TryIt>
      </Step>

      <Step n={6} id="black" title="Black centres and tinted pixels"
        figure={<>
          <div className="guide-pair">
            <figure>
              <Sky image={fr?.grey[3]} zoom={3.2} centre={core} size="small" label="Barnard's Star close up, as normally shown" />
              <figcaption>As normally shown</figcaption>
            </figure>
            <figure>
              <Sky image={fr?.tinted} zoom={3.2} centre={core} size="small" label="Barnard's Star close up, with left-out pixels tinted" />
              <figcaption>With pixels tinted</figcaption>
            </figure>
          </div>
          <div className="legend guide-legend">
            <span><i style={{ background: rgb(SAT_RGB) }} /> too bright to measure</span>
            <span><i style={{ background: rgb(FLAG_RGB) }} /> marked faulty</span>
          </div>
        </>}>
        <p>Bright stars overload the detector. Those pixels hold no real measurement, so the site leaves them blank instead of guessing. That's the black centre you'll see on bright stars, including Barnard's Star.</p>
        <p>The SPHEREx team also marks some pixels as faulty, for example where a cosmic ray hit the detector. Those are left out too.</p>
        <p>To see exactly which pixels were left out, open <strong>Details</strong> and tick <strong>Tint saturated and flagged pixels</strong>.</p>
      </Step>

      <Step n={7} id="limits" title="What the pictures can and can't tell you">
        <ul>
          <li><strong>The pixels are big.</strong> Each one is 6.15 arcseconds across, so only nearby, fast-moving stars move visibly within a year or two.</li>
          <li><strong>The site never decides what you're seeing.</strong> A dot that appears in only one picture could be an asteroid, a cosmic-ray hit, a glitch or something new. You look and decide.</li>
          <li><strong>Brightness changes need care.</strong> SPHEREx visits each patch of sky pointed a different way each time, and bright stars look different on every visit. Pictures from different data releases may also be calibrated differently.</li>
          <li><strong>No AI.</strong> Nothing here is made or judged by artificial intelligence. Every picture is real data processed in plain, documented steps; see <a href="/about" onClick={(e) => { e.preventDefault(); onNavigate("/about"); }}>About the data</a>.</li>
        </ul>
      </Step>

      <Step n={8} id="class" title="A ten-minute classroom activity">
        <p className="guide-q">Start with a question: if stars move, why do the constellations look the same as they did for our grandparents?</p>
        <ol className="guide-activity">
          <li>Open Barnard's Star and press <strong>Blink</strong>. Ask the class what they notice.</li>
          <li>Zoom in with <strong>+</strong> and turn on <strong>True pixels</strong> to see the individual squares. Count how many pixels the star hops between the first and last visit.</li>
          <li>Turn pixels into arcseconds (one pixel is 6.15 arcseconds), then read the dates on the timeline and work out the speed in arcseconds per year. It should come to about 10.</li>
          <li>Try ε Indi B from the main page. It moves too, but less than one pixel a year, so it's much harder to see.</li>
          <li>Discuss why. Barnard's Star is about 6 light-years away, one of the Sun's nearest neighbours. Nearby things seem to move faster, like a car passing close by compared with a distant plane.</li>
        </ol>
        <p>The answer to the opening question: stars do move, but most are so far away that it takes thousands of years for their motion to change a constellation's shape.</p>
        <div className="guide-end">
          <a className="chip on big" href="/?target=barnard&det=3&fov=10&cmp=blink" onClick={(e) => { e.preventDefault(); onNavigate("/?target=barnard&det=3&fov=10&cmp=blink"); }}>Open Barnard's Star</a>
          <a className="chip big" href="/" onClick={(e) => { e.preventDefault(); onNavigate("/"); }}>Search for a star</a>
        </div>
      </Step>
    </main>
  );
}
