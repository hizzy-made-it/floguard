import { useEffect, lazy, Suspense, useState } from "react";
import { useLocation } from "react-router-dom";
import { Navbar } from "./Navbar";
import { Footer } from "./Footer";
import { ScrollProgress } from "./ScrollProgress";

// Desktop-only polish — never on critical path
const Cursor = lazy(() => import("./Cursor").then((m) => ({ default: m.Cursor })));
const ChatWidget = lazy(() =>
  import("./chat/ChatWidget").then((m) => ({ default: m.ChatWidget }))
);

export const Layout = ({ children }) => {
  const { pathname } = useLocation();
  const [enableChrome, setEnableChrome] = useState(false);

  // Defer cursor / chat / lenis until idle so they don't steal main-thread from LCP
  useEffect(() => {
    let cancelled = false;
    const arm = () => {
      if (!cancelled) setEnableChrome(true);
    };
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(arm, { timeout: 2500 });
      return () => {
        cancelled = true;
        window.cancelIdleCallback?.(id);
      };
    }
    const t = setTimeout(arm, 1200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, []);

  // Smooth scroll (Lenis) — desktop only, after idle
  useEffect(() => {
    if (!enableChrome) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;
    const isTouch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
    if (isTouch) return;

    let cancelled = false;
    let lenis;
    let raf;

    import("lenis").then(({ default: Lenis }) => {
      if (cancelled) return;
      lenis = new Lenis({
        duration: 1.05,
        smoothWheel: true,
        lerp: 0.12,
      });
      const loop = (t) => {
        lenis.raf(t);
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    });

    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
      if (lenis) lenis.destroy();
    };
  }, [enableChrome]);

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
      <ScrollProgress />
      <Navbar />
      <main id="main-content" tabIndex={-1}>
        {children}
      </main>
      <Footer />
      {enableChrome && (
        <Suspense fallback={null}>
          <Cursor />
          <ChatWidget />
        </Suspense>
      )}
    </div>
  );
};
