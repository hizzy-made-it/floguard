import { useEffect, useRef } from "react";
import { useInView, useMotionValue, animate } from "framer-motion";
import { RevealGroup } from "./Reveal";
import { STATS } from "../data/site";

function formatValue(value, decimals = 0) {
  return Number(value).toFixed(decimals);
}

function Counter({ value, suffix = "", decimals = 0 }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  const mv = useMotionValue(value);
  const fallback = formatValue(value, decimals);

  useEffect(() => {
    // Prefer-reduced-motion: keep real HTML numbers (no zero flash)
    const prefersReduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    if (prefersReduced) {
      if (ref.current) ref.current.textContent = fallback;
      return;
    }
    if (!inView) return;
    // Animate from 0 → value only when visible; start DOM already shows real value
    if (ref.current) ref.current.textContent = formatValue(0, decimals);
    const controls = animate(mv, value, {
      duration: 1.8,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => {
        if (ref.current) ref.current.textContent = formatValue(v, decimals);
      },
    });
    return () => controls.stop();
  }, [inView, value, decimals, mv, fallback]);

  return (
    <span className="font-display text-4xl sm:text-5xl text-white tracking-tight tabular-nums">
      {/* Real numbers in HTML for crawlers + first paint; JS may animate after */}
      <span ref={ref}>{fallback}</span>
      <span className="text-brand-orange">{suffix}</span>
    </span>
  );
}

export const StatsBar = () => (
  <section data-testid="stats-bar" className="relative bg-brand-ink border-y border-white/10 grain">
    <RevealGroup className="container-fg relative z-10 py-10 sm:py-14 grid grid-cols-2 sm:grid-cols-4 gap-y-8 gap-x-6 sm:gap-x-8">
      {STATS.map((s) => (
        <div key={s.label} className="flex flex-col gap-2 border-l border-white/10 pl-4 sm:pl-5">
          <Counter value={s.value} suffix={s.suffix} decimals={s.decimals || 0} />
          <p className="text-xs sm:text-sm text-white/55 leading-snug max-w-[15rem]">{s.label}</p>
        </div>
      ))}
    </RevealGroup>
  </section>
);
