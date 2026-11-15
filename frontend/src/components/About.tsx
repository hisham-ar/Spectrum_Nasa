import type { ReactNode } from "react";

function Go({ to, onNavigate, children }: { to: string; onNavigate: (to: string) => void; children: ReactNode }) {
  return (
    <a className="try" href={to} onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); onNavigate(to); }}>
      {children}
    </a>
  );
}

const STEPS: [string, string][] = [
  ["Collect", "SPHEREx observes a region of the sky, recording infrared measurements across its detector arrays."],
  ["Retrieve", "The site finds the matching observations in NASA's Infrared Science Archive (IRSA), with their timestamps, wavelengths and quality information."],
  ["Process", "Using conventional astronomical calculations, it removes the modelled zodiacal light, leaves out unreliable pixels, aligns the observations and combines compatible exposures."],
  ["Explore", "The processed images appear in the viewer with their observation dates and detector information. You can move through time, switch infrared wavelengths and compare observations."],
];

export default function About({ onNavigate }: { onNavigate: (to: string) => void }) {
  return (
    <main className="page prose about">
      <h1>About the data</h1>
      <p className="lede">Real observations, real science. Every image you explore in Lost in the Spectrum comes from NASA's SPHEREx space telescope.</p>
      <p>We turn its observations into something you can explore: switch between infrared wavelengths, compare the sky across different dates, and investigate changes yourself.</p>
      <p><strong>No simulated astronomical images. No AI-generated interpretations.</strong></p>

      <h2>Meet SPHEREx</h2>
      <p>Launched in March 2025, NASA's SPHEREx telescope observes the entire sky in 102 infrared wavelength bands, completing an all-sky survey about every six months.</p>
      <p>Infrared light can't be seen by the human eye, but it reveals a lot about stars, galaxies, dust and other astronomical objects.</p>
      <p>SPHEREx uses six detectors, each covering a different part of the infrared spectrum. By combining observations across wavelengths and dates, astronomers can study the properties and behaviour of objects throughout the universe.</p>
      <Go to="/" onNavigate={onNavigate}>Explore the sky</Go>

      <h2>From telescope to timeline</h2>
      <p>How does a SPHEREx observation become an image you can explore?</p>
      <ol className="about-steps">
        {STEPS.map(([title, text], i) => (
          <li key={title}>
            <span className="about-num" aria-hidden="true">{i + 1}</span>
            <div>
              <h3>{title}</h3>
              <p>{text}</p>
            </div>
          </li>
        ))}
      </ol>
      <details className="about-more">
        <summary>How does the processing work?</summary>
        <p>Each image is made from real SPHEREx spectral exposures.</p>
        <p>The pipeline subtracts the zodiacal-light model provided with each exposure, applies the pixel-quality masks, reprojects the valid measurements onto a shared north-up sky grid at the native 6.15″ pixel scale, and combines compatible exposures from the same visit with inverse-variance weighting.</p>
        <p>All images in a detector sequence share one asinh display scaling, so the display itself doesn't create brightness differences between dates. Differences in calibration, wavelength coverage and observing conditions can still affect apparent brightness.</p>
        <p>Each frame's original observation information and links to the source data are in the explorer's Details panel.</p>
      </details>

      <h2>Understanding what you see</h2>
      <h3>Why do some stars have black centres?</h3>
      <p>Very bright objects can exceed the range a detector can measure reliably. This is called saturation. Rather than invent the missing values, the site leaves out every measurement flagged as unusable. Switch on the pixel tint in the explorer to tell saturated areas apart from other flagged pixels.</p>
      <h3>Why do different infrared wavelengths look different?</h3>
      <p>Each SPHEREx detector covers a different infrared wavelength range. Some objects stand out more in certain detectors because their infrared light differs from one wavelength to another. Detector sensitivity, background noise and image scaling also affect how they look. The six-detector Grid view lets you investigate these differences side by side.</p>
      <h3>Why aren't all observations taken on the same date?</h3>
      <p>SPHEREx surveys the sky again and again, but coverage and timing vary between detectors and parts of the sky. The explorer shows the actual dates of each image. Its timeline is a set of available observation groups, not a continuous recording of the sky.</p>
      <h3>Does a visible difference mean something was discovered?</h3>
      <p>Not necessarily. A difference could be genuine motion or variability, but it could also be noise, a calibration difference, a cosmic ray or an instrument artefact. Lost in the Spectrum gives you the tools to investigate observations; it never declares discoveries for you.</p>
      <p><strong>We encourage you to inspect, compare, question and explore.</strong></p>

      <h2>Scientific transparency</h2>
      <h3>Real data, documented methods</h3>
      <p>The astronomical images are made from genuine SPHEREx observations, from the NASA/IPAC Infrared Science Archive's data releases DR1 and QR3. Every frame is labelled with its observation dates, wavelength range and data release.</p>
      <h3>No AI or machine learning in the website</h3>
      <p>Lost in the Spectrum uses conventional computational methods for image processing, coordinate calculations and data visualisation. No AI model generates the images, identifies discoveries or interprets observations for visitors.</p>
      <p>AI-assisted coding tools were used during development, but no AI or machine-learning system powers the public website.</p>
      <h3>Understanding the limitations</h3>
      <p>SPHEREx's pixels are about 6.15 arcseconds across, which limits the positional detail in each image. Saturation, calibration differences between releases, varying coverage and detector characteristics can also affect comparisons. The site shows the relevant quality information so visitors can interpret observations responsibly.</p>
      <details className="about-more">
        <summary>How the site answers the challenge's considerations</summary>
        <ul>
          <li><strong>New data:</strong> live searches query IRSA's current SPHEREx collections; the list of collections is one setting, and Featured frames rebuild with one script.</li>
          <li><strong>102 bands:</strong> the six detectors appear as six plain-language bands, and each frame lists the exact wavelengths at its centre.</li>
          <li><strong>Co-adding:</strong> one stack per detector per visit, inverse-variance weighted.</li>
          <li><strong>Comparing:</strong> Step, Blink, Side by side, Colour and the six-detector Grid.</li>
          <li><strong>Field of view:</strong> 5′, 10′ and 20′, plus zoom and pan.</li>
          <li><strong>Overlays:</strong> the searched object's predicted position on every date, from its proper motion, and known asteroids and comets from NASA/JPL in the Every-exposure view.</li>
          <li><strong>URL queries:</strong> every view is a shareable link (<span className="mono">?q=…&amp;det=…&amp;fov=…&amp;frame=…</span>).</li>
          <li><strong>Metadata and flags:</strong> release, survey, dates, detector, wavelengths, exposure count and flagged pixels for every frame.</li>
        </ul>
      </details>

      <h2>Sources and credits</h2>
      <h3>Astronomical data</h3>
      <p><a href="https://irsa.ipac.caltech.edu/Missions/spherex.html">NASA/IPAC Infrared Science Archive (IRSA)</a>: the SPHEREx spectral images, data releases DR1 and QR3. This research has made use of the NASA/IPAC Infrared Science Archive, which is funded by the National Aeronautics and Space Administration and operated by the California Institute of Technology.</p>
      <h3>Object identification</h3>
      <p><a href="https://simbad.cds.unistra.fr/simbad/">SIMBAD</a> and <a href="https://cds.unistra.fr/cgi-bin/Sesame">Sesame</a>, CDS, Strasbourg Astronomical Observatory, France: object names, coordinates and catalogued proper motions.</p>
      <h3>Solar System data</h3>
      <p><a href="https://ssd-api.jpl.nasa.gov/doc/sb_ident.html">NASA/JPL Small-Body Identification API</a>: predicted positions of known asteroids and comets.</p>
      <h3>Scientific references</h3>
      <ul>
        <li><a href="https://caltech-ipac.github.io/spherex-archive-documentation/spherex-data-products">SPHEREx archive documentation</a> (IRSA)</li>
        <li>Crill et al. (2024), <a href="https://arxiv.org/abs/2404.11017"><em>SPHEREx: NASA's Near-Infrared Spectrophotometric All-Sky Survey</em></a></li>
      </ul>
      <h3>Open-source software</h3>
      <p>Backend: Python, Astropy, NumPy, SciPy, reproject, Pillow, httpx, FastAPI and Uvicorn. Frontend: React, TypeScript and Vite.</p>
      <p className="quiet">Built for the NASA International Space Apps Challenge 2026, under the Planet X and SPHEREx challenge.</p>

      <p className="about-end"><em>Explore real observations. Understand their limitations. Make your own investigations.</em></p>
      <div className="about-links">
        <Go to="/" onNavigate={onNavigate}>Back to the explorer</Go>
        <Go to="/guide" onNavigate={onNavigate}>Learn how to use the website</Go>
      </div>
    </main>
  );
}
