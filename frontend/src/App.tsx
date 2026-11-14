import { useEffect, useState } from "react";
import { fetchFeatured } from "./lib/api";
import type { FeaturedCard } from "./lib/types";
import Explorer from "./components/Explorer";
import Featured from "./components/Featured";
import About from "./components/About";

type Page = "explore" | "featured" | "about";

function pageOf(path: string): Page {
  if (path.startsWith("/featured")) return "featured";
  if (path.startsWith("/about")) return "about";
  return "explore";
}

export default function App() {
  const [page, setPage] = useState<Page>(() => pageOf(window.location.pathname));
  const [featured, setFeatured] = useState<FeaturedCard[]>([]);
  const [dataAsOf, setDataAsOf] = useState<string | null>(null);
  const [builtAt, setBuiltAt] = useState<string | null>(null);
  const [navKey, setNavKey] = useState(0);
  const [featuredReady, setFeaturedReady] = useState(false);

  useEffect(() => {
    fetchFeatured().then((ix) => {
      setFeaturedReady(true);
      if (!ix) return;
      setFeatured(ix.cards);
      setBuiltAt(ix.data_as_of ?? ix.built_at?.slice(0, 10) ?? null);
    });
    const onPop = () => setPage(pageOf(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const go = (to: string) => {
    window.history.pushState(null, "", to);
    setPage(pageOf(to));
    setNavKey((k) => k + 1);
    window.scrollTo(0, 0);
  };
  const link = (to: string) => (e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    go(to);
  };

  return (
    <div className={`app ${page === "explore" ? "fill" : ""}`}>
      <a className="skip" href="#content">Skip to content</a>
      <header className="topbar">
        <a href="/" className="brand" onClick={link("/")} aria-label="Lost in the Spectrum, home">
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-name">Lost in the Spectrum</span>
        </a>
        <nav aria-label="Main">
          <a href="/" onClick={link("/")} aria-current={page === "explore" ? "page" : undefined}>Explore</a>
          <a href="/featured" onClick={link("/featured")} aria-current={page === "featured" ? "page" : undefined}>Featured</a>
          <a href="/about" onClick={link("/about")} aria-current={page === "about" ? "page" : undefined}><span className="nav-long">About &amp; Data</span><span className="nav-short">About</span></a>
        </nav>
      </header>
      <div id="content">
        {page === "explore" && <Explorer key={navKey} featured={featured} featuredReady={featuredReady} onDataDate={setDataAsOf} />}
        {page === "featured" && <Featured cards={featured} onOpen={(c) => go(`/?target=${c.slug}&det=${c.det}&fov=${c.fov}${c.view !== "survey" ? `&view=${c.view}` : ""}${c.compare && c.compare !== "none" ? `&cmp=${c.compare}` : ""}`)} />}
        {page === "about" && <About />}
      </div>
      <footer className="footer">
        <span>Latest SPHEREx exposure shown: {dataAsOf ?? builtAt ?? "see each frame"} · NASA/IPAC Infrared Science Archive</span>
        <span>No AI in this site: every frame is real data, every step is conventional processing.</span>
      </footer>
    </div>
  );
}
