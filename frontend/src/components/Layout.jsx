import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import Lenis from "lenis";
import { Navbar } from "./Navbar";
import { Footer } from "./Footer";
import { ScrollProgress } from "./ScrollProgress";
import { Cursor } from "./Cursor";

export const Layout = ({ children }) => {
  const { pathname } = useLocation();

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;
    const lenis = new Lenis({ duration: 1.1, smoothWheel: true, lerp: 0.1 });
    let raf;
    const loop = (t) => { lenis.raf(t); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); lenis.destroy(); };
  }, []);

  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);

  return (
    <div className="App bg-background">
      <Cursor />
      <ScrollProgress />
      <Navbar />
      <main>{children}</main>
      <Footer />
    </div>
  );
};
