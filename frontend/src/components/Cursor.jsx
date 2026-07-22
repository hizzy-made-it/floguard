import { useEffect, useRef, useState } from "react";

// Magnetic dot + ring cursor for pointer devices. Disabled for touch / reduced motion.
export const Cursor = () => {
  const dot = useRef(null);
  const ring = useRef(null);
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!fine || reduced) return;
    setEnabled(true);
    document.documentElement.classList.add("fg-cursor-active");

    let rx = 0, ry = 0, tx = 0, ty = 0, raf;
    const move = (e) => {
      tx = e.clientX; ty = e.clientY;
      if (dot.current) dot.current.style.transform = `translate3d(${tx}px, ${ty}px, 0)`;
      const t = e.target;
      const interactive = t.closest("a, button, [role='button'], input, textarea, select, [data-cursor='hover']");
      const isPrimary = !!t.closest('[data-testid*="cta"], .bg-brand-orange, [data-cursor="primary"]');
      if (ring.current) {
        ring.current.dataset.hover = interactive ? "true" : "false";
        ring.current.dataset.primary = isPrimary ? "true" : "false";
      }
    };
    const loop = () => {
      rx += (tx - rx) * 0.18; ry += (ty - ry) * 0.18;
      if (ring.current) ring.current.style.transform = `translate3d(${rx}px, ${ry}px, 0)`;
      raf = requestAnimationFrame(loop);
    };
    window.addEventListener("mousemove", move);
    raf = requestAnimationFrame(loop);
    return () => {
      window.removeEventListener("mousemove", move);
      cancelAnimationFrame(raf);
      document.documentElement.classList.remove("fg-cursor-active");
    };
  }, []);

  if (!enabled) return null;
  return (
    <>
      <div
        ref={dot}
        className="pointer-events-none fixed top-0 left-0 z-[9999] -ml-[3px] -mt-[3px] w-1.5 h-1.5 rounded-full bg-brand-orange"
      />
      <div
        ref={ring}
        data-hover="false"
        data-primary="false"
        className="fg-cursor-ring pointer-events-none fixed top-0 left-0 z-[9998] -ml-4 -mt-4 w-8 h-8 rounded-full border border-brand-orange/60 transition-[width,height,margin,background-color,border-color] duration-200"
      />
    </>
  );
};

export default Cursor;
