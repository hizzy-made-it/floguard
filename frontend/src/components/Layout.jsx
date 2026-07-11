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

    const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    // Lighter or native-feeling scroll on mobile
    const lenis = new Lenis({
      duration: isTouch ? 0.8 : 1.1,
      smoothWheel: !isTouch,
      lerp: isTouch ? 0.2 : 0.1,
    });
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
      <ChatWidget />
    </div>
  );
};
