import { useEffect, useState } from "react";

/**
 * Lightweight intro mark — CSS only, no framer-motion.
 * Skipped on return visits, reduced-motion, and slow connections so it never blocks LCP.
 */
export const Loader = () => {
  const [visible, setVisible] = useState(() => {
    if (typeof window === "undefined") return false;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
    try {
      if (sessionStorage.getItem("fg_loaded") === "1") return false;
    } catch {
      /* ignore */
    }
    // Save-Data / 2G: skip curtain so LCP paints immediately
    const conn = navigator.connection;
    if (conn?.saveData || /2g/.test(conn?.effectiveType || "")) return false;
    return true;
  });

  useEffect(() => {
    if (!visible) return;
    // Match CSS curtain exit (~0.42s delay + 0.55s slide)
    const t = setTimeout(() => {
      try {
        sessionStorage.setItem("fg_loaded", "1");
      } catch {
        /* ignore */
      }
      setVisible(false);
    }, 980);
    return () => clearTimeout(t);
  }, [visible]);

  if (!visible) return null;

  return (
    <div
      data-testid="intro-loader"
      className="fg-loader fixed inset-0 z-[100] bg-brand-ink grain flex flex-col items-center justify-center pointer-events-none"
      aria-hidden="true"
    >
      <div className="relative z-10 text-center px-6">
        <div className="font-display text-5xl sm:text-6xl text-white tracking-tight fg-loader-brand">
          Flo<span className="text-brand-orange">Guard</span>
        </div>
        <p className="mt-3 text-xs uppercase tracking-[0.3em] text-white/50 fg-loader-sub">
          Flood Solutions &amp; Management
        </p>
        <div className="mt-8 h-[2px] w-56 max-w-[70vw] mx-auto bg-white/10 overflow-hidden rounded-full">
          <div className="h-full bg-brand-orange fg-loader-bar" />
        </div>
      </div>
    </div>
  );
};
