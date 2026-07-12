import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import Lenis from "lenis";
import { Navbar } from "./Navbar";
import { Footer } from "./Footer";
import { ScrollProgress } from "./ScrollProgress";
import { Cursor } from "./Cursor";
import { ChatWidget } from "./chat/ChatWidget";

export const Layout = ({ children }) => {
  const { pathname } = useLocation();

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;

    const isTouch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
    // Native scroll on touch devices is faster and more reliable
    if (isTouch) return;

    const lenis = new Lenis({
      duration: 1.1,
      smoothWheel: true,
      lerp: 0.1,
    });
    let raf;
    const loop = (t) => {
      lenis.raf(t);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      lenis.destroy();
    };
  }, []);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className="App bg-background">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-[100] focus:bg-brand-orange focus:text-brand-ink focus:px-4 focus:py-2 focus:rounded-sm focus:font-semibold"
      >
        Skip to main content
      </a>
      <Cursor />
      <ScrollProgress />
      <Navbar />
      <main id="main-content" tabIndex={-1}>
        {children}
      </main>
      <Footer />
      <ChatWidget />
    </div>
  );
};
