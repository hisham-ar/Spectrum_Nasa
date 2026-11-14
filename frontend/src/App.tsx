import { useEffect, useState } from "react";
import { fetchFeatured } from "./lib/api";
import { hasLocation, readUrl } from "./lib/url";
import type { FeaturedCard, TargetInfo } from "./lib/types";
import Explorer from "./components/Explorer";
import Featured from "./components/Featured";
import About from "./components/About";
import SearchBox from "./components/SearchBox";

type Page = "explore" | "featured" | "about";

function pageOf(path: string): Page {
  if (path.startsWith("/featured")) return "featured";
  if (path.startsWith("/about")) return "about";
  return "explore";
}

export default function App() {
  const [page, setPage] = useState<Page>(() => pageOf(window.location.pathname));
  const [featured, setFeatured] = useState<FeaturedCard[]>([]);
  const [featuredReady, setFeaturedReady] = useState(false);
  const [dataAsOf, setDataAsOf] = useState<string | null>(null);
  const [navKey, setNavKey] = useState(0);
  const [, force] = useState(0);

  useEffect(() => {
    fetchFeatured().then((ix) => {
      setFeaturedReady(true);
      if (ix) setFeatured(ix.cards);
    });
    const onPop = () => { setPage(pageOf(window.location.pathname)); force((x) => x + 1); };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const go = (to: string) => {
    window.history.pushState(null, "", to);
    setPage(pageOf(to.split("?")[0]));
    setNavKey((k) => k + 1);
    window.scrollTo(0, 0);
  };
  const link = (to: string) => (e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    go(to);
  };
  const onResolved = (t: TargetInfo) =>
    go(t.kind === "coords" ? `/?ra=${t.ra.toFixed(5)}&dec=${t.dec.toFixed(5)}&fov=10` : `/?q=${encodeURIComponent(t.query)}&fov=10`);
  const onPick = (c: FeaturedCard) => go(`/?target=${c.slug}&det=${c.det}&fov=${c.fov}${c.compare && c.compare !== "none" ? `&cmp=${c.compare}` : ""}`);
  const exploring = page === "explore" && hasLocation(readUrl());

  return (
    <div className={`app ${page === "explore" ? "fill" : ""}`}>
      <a className="skip" href="#content">Skip to content</a>
      <header className="topbar">
        <a href="/" className="brand" onClick={link("/")} aria-label="Lost in the Spectrum, home">
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-name">Lost in the Spectrum</span>
        </a>
        {exploring && <SearchBox key={navKey} featured={featured} onPickFeatured={onPick} onResolved={onResolved} compact />}
        <nav aria-label="Main">
          <a href="/" onClick={link("/")} aria-current={page === "explore" ? "page" : undefined}>Explore</a>
          <a href="/featured" onClick={link("/featured")} aria-current={page === "featured" ? "page" : undefined}>Featured</a>
          <a href="/about" onClick={link("/about")} aria-current={page === "about" ? "page" : undefined}><span className="nav-long">About the data</span><span className="nav-short">About</span></a>
        </nav>
      </header>
      <div id="content">
        {page === "explore" && <Explorer key={navKey} featured={featured} featuredReady={featuredReady} onDataDate={setDataAsOf} onNavigate={go} />}
        {page === "featured" && <Featured cards={featured} onOpen={onPick} />}
        {page === "about" && <About />}
      </div>
      <footer className="footer">
        <span>{dataAsOf ? `Newest SPHEREx exposure shown: ${dataAsOf}.` : "SPHEREx images from the NASA/IPAC Infrared Science Archive."}</span>
        <span>Every frame is real data, processed by conventional steps. No AI runs on this site.</span>
      </footer>
    </div>
  );
}
