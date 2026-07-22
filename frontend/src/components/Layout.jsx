import { useEffect, lazy, Suspense } from "react";
import { useLocation } from "react-router-dom";
import { Navbar } from "./Navbar";
import { Footer } from "./Footer";
import { ScrollProgress } from "./ScrollProgress";
import { Cursor } from "./Cursor";

// Chat is below the fold for interaction — keep out of initial JS
const ChatWidget = lazy(() =>
  import("./chat/ChatWidget").then((m) => ({ default: m.ChatWidget }))
);

export const Layout = ({ children }) => {
  const { pathname } = useLocation();

  // Smooth scroll (Lenis) — dynamic import so it never lands in the critical bundle
  useEffect(() => {
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
        duration: 1.1,
        smoothWheel: true,
        lerp: 0.1,
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
      <Suspense fallback={null}>
        <ChatWidget />
      </Suspense>
    </div>
  );
};
