export default function About() {
  return (
    <main className="page prose">
      <h1>About &amp; Data</h1>

      <h2>How to explore</h2>
      <ol>
        <li>Type a star's name (for example <em>Barnard's Star</em>) or coordinates (<span className="mono">269.45 4.77</span> or <span className="mono">17h57m47s +04d46m</span>).</li>
        <li>Pick a detector on the spectrum bar. Each one sees a different slice of infrared light.</li>
        <li>Step through the timeline with ← and →, or press Space to play. Each stop is one SPHEREx visit, about six months apart.</li>
        <li>Press <kbd>B</kbd> to blink between the first and last visit. Anything that jumps has moved.</li>
        <li>Share the link: everything you see is stored in the address.</li>
      </ol>

      <h2>What SPHEREx is</h2>
      <p>SPHEREx is a NASA space telescope that maps the whole sky in 102 infrared colours every six months. It has six detectors. Each sits behind a filter whose colour changes across the chip, so a star's colour in a single picture depends on where it lands. SPHEREx builds spectra by pointing again and again.</p>
      <p>That is why this site's main timeline shows one picture per detector per visit. It stacks every exposure of that detector from one visit, so the comparison over time stays fair. The "Every exposure" view shows raw single exposures for fast-moving asteroids. In that view brightness is not comparable, because the colour changes from one exposure to the next.</p>

      <h2>Limits of the data — please read</h2>
      <ul>
        <li><strong>Coarse pixels.</strong> One pixel is 6.15 arcseconds. Only nearby, fast-moving stars shift visibly within a year or two.</li>
        <li><strong>Saturation.</strong> Very bright stars overload the detector. Those pixels carry no measurement and are shown black, or tinted when you switch the tint on. They are never averaged in. Pixels that only came close to saturation are kept, as IRSA's own photometry tool does, and tinted separately.</li>
        <li><strong>Flags.</strong> Pixels the SPHEREx pipeline flags (cosmic rays, hot pixels, persistence and others) are left out of each stack.</li>
        <li><strong>Releases.</strong> Frames are labelled DR1 or QR3. Different releases may be calibrated differently, so compare their brightness with care.</li>
        <li><strong>No verdicts.</strong> The site never decides whether something changed. It shows suitable observations; you look. A moving dot could be an asteroid, a cosmic ray, an artefact, or something uncatalogued.</li>
        <li><strong>No AI.</strong> Nothing on this site is generated, classified or recommended by AI or machine learning. Every step is conventional processing you can read about under "How was this made?" beside each view.</li>
      </ul>

      <h2>How each frame is made</h2>
      <p>For every exposure: subtract IRSA's zodiacal-light model, remove flagged and saturated pixels, reproject onto one north-up grid at the native pixel scale, then take an inverse-variance weighted mean of all exposures from the same visit. All frames in a sequence share one asinh display stretch, so any brightness change you see is in the data, not the display.</p>

      <h2>Challenge considerations, one line each</h2>
      <ul>
        <li><strong>New data:</strong> live searches query IRSA's current SPHEREx collections (re-checked daily); the collection list lives in one config value, and Featured frames rebuild with one script.</li>
        <li><strong>102 bands:</strong> the six detectors appear as six plain-language bands; each frame lists the exact wavelengths at its centre.</li>
        <li><strong>Co-adding:</strong> one stack per detector per visit, inverse-variance weighted.</li>
        <li><strong>Add / subtract:</strong> Blink and side-by-side compare; difference images are limited to frames from the same release.</li>
        <li><strong>Field of view:</strong> 5′, 10′ and 20′ presets, plus zoom and pan.</li>
        <li><strong>Overlays:</strong> predicted position of the searched object on every frame date (from its proper motion), and known asteroids and comets from NASA/JPL in the Every-exposure view.</li>
        <li><strong>URL query:</strong> every view is a shareable link (<span className="mono">?q=…&amp;det=…&amp;fov=…&amp;frame=…</span>).</li>
        <li><strong>Metadata and flags:</strong> release, survey, dates, detector, wavelengths, exposure count and flagged pixels on every frame.</li>
      </ul>

      <h2>Credits and citations</h2>
      <h3>Data</h3>
      <ul>
        <li>SPHEREx spectral images, releases DR1 and QR3, from the <a href="https://irsa.ipac.caltech.edu/Missions/spherex.html">NASA/IPAC Infrared Science Archive (IRSA)</a>, via its SIA2 search and cutout service. This research has made use of the NASA/IPAC Infrared Science Archive, which is funded by the National Aeronautics and Space Administration and operated by the California Institute of Technology.</li>
        <li>Object names, positions and proper motions: <a href="https://cds.unistra.fr/cgi-bin/Sesame">CDS Sesame</a> and the <a href="https://simbad.cds.unistra.fr/simbad/">SIMBAD database</a>, CDS, Strasbourg Astronomical Observatory, France.</li>
        <li>Known asteroids and comets: <a href="https://ssd-api.jpl.nasa.gov/doc/sb_ident.html">NASA/JPL Small-Body Identification API</a> (Solar System Dynamics group).</li>
        <li>SPHEREx mission facts: <a href="https://caltech-ipac.github.io/spherex-archive-documentation/spherex-data-products">IRSA SPHEREx archive documentation</a>, the SPHEREx Explanatory Supplement, and <a href="https://arxiv.org/abs/2404.11017">Crill et al. (2024)</a>.</li>
      </ul>
      <h3>Open-source software</h3>
      <p>Astropy, reproject, NumPy, SciPy, Pillow, httpx, FastAPI and Uvicorn (backend); React, Vite and TypeScript (frontend).</p>
      <h3>Tools used to build the site</h3>
      <p>Claude (Anthropic), an AI coding assistant, helped write the code. AI was used only to build the site. Nothing on the site runs AI.</p>
      <p className="small muted">Built for the NASA International Space Apps Challenge 2026, "Planet X and SPHEREx".</p>
    </main>
  );
}
