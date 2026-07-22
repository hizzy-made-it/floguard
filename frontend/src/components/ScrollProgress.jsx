import { useEffect, useRef } from "react";

/** Thin top progress bar — native scroll, no framer-motion. */
export const ScrollProgress = () => {
  const barRef = useRef(null);

  useEffect(() => {
    let ticking = false;
    const update = () => {
      const el = barRef.current;
      if (!el) return;
      const doc = document.documentElement;
      const max = doc.scrollHeight - window.innerHeight;
      const p = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      el.style.transform = `scaleX(${p})`;
      ticking = false;
    };
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return (
    <div
      ref={barRef}
      data-testid="scroll-progress"
      className="fixed top-0 left-0 right-0 h-[3px] bg-brand-orange origin-left z-[60] will-change-transform"
      style={{ transform: "scaleX(0)" }}
    />
  );
};
