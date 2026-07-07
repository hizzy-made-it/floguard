import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { EASE } from "../lib/animations";

// Branded intro curtain — shows once per browser session.
export const Loader = () => {
  const [done, setDone] = useState(() => {
    if (typeof window === "undefined") return true;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return true;
    return sessionStorage.getItem("fg_loaded") === "1";
  });

  useEffect(() => {
    if (done) return;
    const t = setTimeout(() => {
      sessionStorage.setItem("fg_loaded", "1");
      setDone(true);
    }, 900);
    return () => clearTimeout(t);
  }, [done]);

  return (
    <AnimatePresence>
      {!done && (
        <motion.div
          data-testid="intro-loader"
          exit={{ y: "-100%" }}
          transition={{ duration: 0.9, ease: EASE }}
          className="fixed inset-0 z-[100] bg-brand-ink grain flex flex-col items-center justify-center"
        >
          <div className="relative z-10 text-center px-6">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, ease: EASE }}
              className="font-display text-5xl sm:text-6xl text-white tracking-tight"
            >
              Flo<span className="text-brand-orange">Guard</span>
            </motion.div>
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="mt-3 text-xs uppercase tracking-[0.3em] text-white/50"
            >
              Flood Solutions & Management
            </motion.p>
            <div className="mt-8 h-[2px] w-56 max-w-[70vw] mx-auto bg-white/10 overflow-hidden rounded-full">
              <motion.div
                initial={{ width: "0%" }}
                animate={{ width: "100%" }}
                transition={{ duration: 0.8, ease: EASE }}
                className="h-full bg-brand-orange"
              />
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
