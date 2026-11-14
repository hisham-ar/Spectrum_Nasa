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
      Try it yourself: {children}
    </a>
  );
}

function Link({ to, onNavigate, children }: { to: string; onNavigate: (to: string) => void; children: ReactNode }) {
  return <a href={to} onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); onNavigate(to); }}>{children}</a>;
}

const STEPS = [
  ["what", "What SPHEREx is"],
  ["image", "Understanding an image"],
  ["detectors", "Exploring the six detectors"],
  ["colour", "Exploring the sky in colour"],
  ["time", "Travelling through time"],
  ["pixels", "Understanding missing and flagged pixels"],
  ["limits", "What the images can and cannot tell us"],
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
          A ten-minute introduction to exploring the sky with NASA's SPHEREx telescope, for curious visitors, students and educators.
          It starts with the basics and builds up to the tools you can use to investigate the changing sky.
          Every image in this guide is a real SPHEREx observation.
        </p>
        <nav className="guide-toc" aria-label="In this guide">
          <ol>
            {STEPS.map(([id, t]) => <li key={id}><a href={`#${id}`}>{t}</a></li>)}
          </ol>
        </nav>
        {f === "missing" && <p className="warn">The example images could not be loaded right now. The text below still applies.</p>}
      </header>

      <Step n={1} id="what" title={STEPS[0][1]}>
        <p>SPHEREx is a NASA space telescope launched in March 2025. It observes the universe in <strong>infrared light</strong>, wavelengths that are invisible to the human eye.</p>
        <p>It maps the entire sky about every six months, in 102 infrared wavelength bands. Because it observes the same regions again and again, it lets us study how the sky changes over time.</p>
        <p>Most stars appear fixed because they are incredibly distant. A few nearby stars move noticeably against the more distant background, and some stars change in brightness. <strong>Lost in the Spectrum makes these observations accessible</strong>, so you can explore the sky and investigate these changes yourself.</p>
      </Step>

      <Step n={2} id="image" title={STEPS[1][1]}
        figure={<>
          <Sky image={fr?.grey[3]} marker={fr?.marker} chrome label="Barnard's Star, detector 3, one SPHEREx visit" />
          <p className="guide-cap">Barnard's Star seen by SPHEREx detector 3{fr ? ` in ${fr.when[0]}` : ""}. The image covers about 10 arcminutes.</p>
        </>}>
        <p>Each image shows a small region of the sky centred on the object or coordinates you chose.</p>
        <ul>
          <li><strong>Brightness:</strong> brighter pixels generally mean a stronger infrared signal. Infrared is invisible, so its intensity is shown in shades of grey.</li>
          <li><strong>Dashed circle:</strong> the predicted position of your star at the time of the observation, calculated from its catalogued position and motion.</li>
          <li><strong>Scale bar:</strong> the angular size of the region. One arcminute is about a thirtieth of the full Moon's apparent diameter.</li>
          <li><strong>Orientation:</strong> north is at the top and east to the left, the standard way astronomers show the sky.</li>
          <li><strong>Combined exposures:</strong> each image combines several exposures from one visit, giving a clearer picture of the region.</li>
        </ul>
        <TryIt to="/?target=barnard&det=3&fov=10" onNavigate={onNavigate}>explore Barnard's Star</TryIt>
      </Step>

      <Step n={3} id="detectors" title={STEPS[2][1]}
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
                <Sky image={fr?.grey[d]} size="small" label={`Barnard's Star through detector ${d}`} />
                <figcaption>Detector {d}<br /><span className="quiet">{DETECTORS[d].band[0].toFixed(2)}–{DETECTORS[d].band[1].toFixed(2)} µm</span></figcaption>
              </figure>
            ))}
          </div>
          <p className="guide-cap">The same region in three wavelength ranges. <strong>Look closely:</strong> which objects stay bright in all three, and which fade or stand out?</p>
        </>}>
        <p>SPHEREx uses six detectors, each observing a different part of the infrared spectrum, from about 0.75 to 5 micrometres (µm).</p>
        <p>In the explorer, the coloured bar along the bottom shows the six detector ranges, shorter wavelengths on the left and longer on the right. <strong>Select any section of the bar to switch detectors</strong> and see the same region in a different wavelength range.</p>
        <p>The colours of the bar are only labels to tell the detectors apart. They are not the actual colours of the objects.</p>
        <ul>
          <li><strong>Shorter infrared wavelengths</strong> often highlight ordinary stars and other sources that are bright in the near-infrared.</li>
          <li><strong>Longer infrared wavelengths</strong> can reveal objects and materials that stand out there, including cool brown dwarfs and some dust and molecular features.</li>
        </ul>
      </Step>

      <Step n={4} id="colour" title={STEPS[3][1]}
        figure={<>
          <Sky image={fr?.colour} label="Barnard's Star in false colour" />
          <p className="guide-cap">Barnard's Star in false colour: detector 1 as blue, detector 3 as green, detector 6 as red.</p>
        </>}>
        <p>SPHEREx observes invisible infrared light, but colour can make differences between wavelengths easier to see. Select the <strong>Colour</strong> button to combine three detectors into one image:</p>
        <ul>
          <li><strong>Blue:</strong> the shorter infrared wavelengths.</li>
          <li><strong>Green:</strong> the middle wavelengths.</li>
          <li><strong>Red:</strong> the longer wavelengths.</li>
        </ul>
        <p>This is called <strong>false-colour imaging</strong>. It is not what our eyes would see; it is a way to compare infrared measurements across wavelength ranges.</p>
        <p>An object that looks mostly blue has a stronger contribution from the shorter-wavelength channel, and one that looks red has a stronger contribution from the longer-wavelength channel. These differences can hint at an object's physical nature or surrounding material, but colour alone does not establish its identity or temperature.</p>
        <TryIt to="/?target=barnard&det=3&fov=10&col=1" onNavigate={onNavigate}>explore the false-colour view</TryIt>
      </Step>

      <Step n={5} id="time" title={STEPS[4][1]}
        figure={<>
          <Sky image={fr?.blink[phase]} marker={fr?.blinkMarkers[phase]} zoom={2.2} centre={core} label={`Barnard's Star, ${phase ? "later" : "earlier"} visit`} />
          <div className="guide-blink">
            <span className="guide-blink-tag"><b>{phase ? "B" : "A"}</b> {fr ? fr.when[phase] : ""}</span>
            <button className="chip" onClick={() => setBlinking((b) => !b)}>{blinking ? "Pause" : "Blink"}</button>
            {!blinking && <button className="chip" onClick={() => setPhase((p) => 1 - p)}>Switch visit</button>}
          </div>
          <p className="guide-cap">Barnard's Star about one year apart, zoomed in. Compare its position with the more distant background stars.</p>
        </>}>
        <p>SPHEREx observes the same sky again and again. The timeline beneath the image has one stop for each visit, with its dates and the number of days between visits. There are three ways to explore changes:</p>
        <ul>
          <li><strong>Step:</strong> move between visits by selecting a stop or using the ← and → keys, or press play to watch them in sequence.</li>
          <li><strong>Blink:</strong> rapidly alternate between two visits (press <kbd>B</kbd>). Changes in position are easier to spot when the images alternate.</li>
          <li><strong>Side by side:</strong> show two visits next to each other for closer inspection.</li>
        </ul>
        <h3>Try observing Barnard's Star</h3>
        <p>Barnard's Star is the fastest-moving star in our sky, crossing about 10 arcseconds a year. That is about 1.7 SPHEREx pixels a year, enough to see.</p>
        <p>Zoom in with <strong>+</strong>, then switch on <strong>Blink</strong> and watch its position against the surrounding stars. Can you see it move?</p>
        <TryIt to="/?target=barnard&det=3&fov=10&cmp=blink" onNavigate={onNavigate}>compare Barnard's Star over time</TryIt>
      </Step>

      <Step n={6} id="pixels" title={STEPS[5][1]}
        figure={<>
          <div className="guide-pair">
            <figure>
              <Sky image={fr?.grey[3]} zoom={3.2} centre={core} size="small" label="Barnard's Star close up, normal view" />
              <figcaption>Normal view</figcaption>
            </figure>
            <figure>
              <Sky image={fr?.tinted} zoom={3.2} centre={core} size="small" label="Barnard's Star close up, left-out pixels highlighted" />
              <figcaption>Flagged-pixel view</figcaption>
            </figure>
          </div>
          <div className="legend guide-legend">
            <span><i style={{ background: rgb(SAT_RGB) }} /> too bright to measure</span>
            <span><i style={{ background: rgb(FLAG_RGB) }} /> flagged for other quality issues</span>
          </div>
        </>}>
        <p>Some bright stars have dark, missing pixels at their centres. This happens when a source is too bright for the detector to measure accurately, which is called <strong>saturation</strong>. Rather than show unreliable measurements, Lost in the Spectrum leaves these pixels out.</p>
        <p>Pixels are also left out when the SPHEREx data marks a problem, such as a cosmic-ray hit or a detector artefact.</p>
        <p>To inspect these areas:</p>
        <ol>
          <li>Open <strong>Details</strong> in the explorer.</li>
          <li>Tick <strong>Tint saturated and flagged pixels</strong>.</li>
          <li>Look at the highlighted areas to see which measurements were left out.</li>
        </ol>
        <p>These markers show the limits of the observations, so missing data isn't mistaken for an astronomical feature.</p>
      </Step>

      <Step n={7} id="limits" title={STEPS[6][1]}>
        <p>Interpreting SPHEREx images takes care. Knowing the limits of the data matters as much as exploring it.</p>
        <ul>
          <li><strong>Image resolution.</strong> Each pixel covers about 6.15 arcseconds of sky, so small changes in position can be hard to see, especially over short periods.</li>
          <li><strong>Not every difference is a discovery.</strong> An object that appears in one image but not another could be a moving asteroid, a cosmic-ray hit, an instrumental artefact or another astronomical source. A visible difference is a reason to investigate, not necessarily evidence of a new discovery.</li>
          <li><strong>Brightness comparisons need caution.</strong> Observations can differ in pointing, wavelength coverage, calibration and image quality, which can change how an object looks even when its real brightness hasn't changed.</li>
          <li><strong>Your observations matter.</strong> The site gives you tools to compare images, but it doesn't claim to find every change or decide what a difference means. If something catches your eye, check it across several observations with the comparison tools.</li>
          <li><strong>No AI or machine learning.</strong> The site uses conventional astronomical calculations and documented image processing. It does not generate images or use AI to interpret observations. More in <Link to="/about" onNavigate={onNavigate}>About the data</Link>.</li>
        </ul>
      </Step>

      <Step n={8} id="class" title={STEPS[7][1]}>
        <h3>Do stars really stay in the same place?</h3>
        <p className="guide-q">Start with a question: if stars are constantly moving through space, why do the constellations look almost the same today as they did hundreds of years ago?</p>
        <ol className="guide-activity">
          <li><strong>Observe the motion.</strong> Open Barnard's Star and switch on <strong>Blink</strong>. Ask students to compare its position with the surrounding stars. What differences can they see?</li>
          <li><strong>Examine the pixels.</strong> Zoom in with <strong>+</strong> and switch on <strong>True pixels</strong> to show the individual pixels. Compare the first and last visits: roughly how many pixels has Barnard's Star moved?</li>
          <li><strong>Calculate the movement.</strong> Each pixel is about 6.15 arcseconds. Use the pixel count to work out how far the star moved, then use the dates on the timeline to find its motion per year. The expected value is about <strong>10 arcseconds a year</strong>, although a measurement from the screen will be less precise.</li>
          <li><strong>Compare another star.</strong> Go back to the main page and choose <strong>ε Indi B</strong> (Epsilon Indi B). This nearby pair of brown dwarfs also moves, but by less than a pixel a year, so it is harder to see. Can students tell the difference?</li>
          <li><strong>Discuss the results.</strong> Barnard's Star is about six light-years away, one of the Sun's nearest neighbours. Nearby objects show more noticeable motion across the sky, just as a nearby car seems to race across your view while a distant aircraft crawls.</li>
        </ol>
        <h3>So why do the constellations look unchanged?</h3>
        <p>Stars are always moving through space, but most are so distant that their positions barely change over a human lifetime. Over thousands of years, their motion slowly reshapes the familiar constellations.</p>
        <div className="guide-end">
          <a className="chip on big" href="/?target=barnard&det=3&fov=10&cmp=blink" onClick={(e) => { e.preventDefault(); onNavigate("/?target=barnard&det=3&fov=10&cmp=blink"); }}>Open Barnard's Star</a>
          <a className="chip big" href="/" onClick={(e) => { e.preventDefault(); onNavigate("/"); }}>Search for another star</a>
        </div>
      </Step>
    </main>
  );
}
