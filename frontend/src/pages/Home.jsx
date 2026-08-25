import { useRef, useEffect, useState, lazy, Suspense } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, Phone, ArrowDown } from "lucide-react";
import { COMPANY, IMAGES } from "../data/site";
import { Seo, organizationLd, faqPageLd } from "../components/Seo";
import { LANDING_FAQ } from "../data/site";

const headline = ["Protected", "flow.", "Engineered", "trust."];

const JOURNEY_PHASES = [
  { t: 0.0, label: "Rain falls" },
  { t: 0.12, label: "Roof & gutter" },
  { t: 0.26, label: "Downspout" },
  { t: 0.36, label: "Into the drain" },
  { t: 0.50, label: "French drain" },
  { t: 0.68, label: "Sump pump" },
  { t: 0.82, label: "Safe discharge" },
];

function getJourneyLabel(p) {
  for (let i = JOURNEY_PHASES.length - 1; i >= 0; i--) {
    if (p >= JOURNEY_PHASES[i].t) return JOURNEY_PHASES[i].label;
  }
  return JOURNEY_PHASES[0].label;
}

/** Load below-fold only after browser is idle (or short timeout). Keeps framer off the critical path. */
function useDeferredMount(ms = 1200) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const go = () => {
      if (!cancelled) setReady(true);
    };
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(go, { timeout: ms });
      return () => {
        cancelled = true;
        window.cancelIdleCallback?.(id);
      };
    }
    const t = setTimeout(go, Math.min(ms, 800));
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [ms]);
  return ready;
}

const HomeBelowFold = lazy(() => import("./HomeBelowFold"));

export default function Home() {
  // Scroll + drag driven progress for the cinematic hero video.
  // DOM updates via refs — avoid React re-render storms on scroll/timeupdate.
  const heroProgressRef = useRef(0);
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  const [videoReady, setVideoReady] = useState(false);

  const videoRef = useRef(null);
  const progressBarRef = useRef(null);
  const labelRef = useRef(null);
  const videoDurationRef = useRef(8);
  const lastLabelRef = useRef(JOURNEY_PHASES[0].label);

  const showBelowFold = useDeferredMount(1500);

  const paintProgress = (p) => {
    heroProgressRef.current = p;
    if (progressBarRef.current) {
      progressBarRef.current.style.transform = `scaleX(${p})`;
    }
    const label = getJourneyLabel(p);
    if (label !== lastLabelRef.current) {
      lastLabelRef.current = label;
      if (labelRef.current) labelRef.current.textContent = label;
    }
  };

  useEffect(() => {
    setIsTouchDevice("ontouchstart" in window || navigator.maxTouchPoints > 0);
  }, []);

  // Defer video source until after first paint / idle — poster is LCP; 20MB+ was crushing main thread
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;

    const conn = navigator.connection;
    // Still load on slow nets but later; Save-Data users keep poster only
    if (conn?.saveData) return;

    let cancelled = false;
    const arm = () => {
      if (!cancelled) setVideoReady(true);
    };

    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(arm, { timeout: 900 });
      return () => {
        cancelled = true;
        window.cancelIdleCallback?.(id);
      };
    }
    const t = setTimeout(arm, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, []);

  useEffect(() => {
    const range = 1.35;
    let ticking = false;

    const update = () => {
      const p = Math.min(1, Math.max(0, window.scrollY / (window.innerHeight * range)));
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(() => {
          paintProgress(p);
          const v = videoRef.current;
          if (v && v.readyState >= 1) {
            const dur = v.duration || videoDurationRef.current;
            const target = p * dur;
            if (Number.isFinite(target) && Math.abs(v.currentTime - target) > 0.1) {
              try {
                v.currentTime = target;
              } catch {
                /* ignore seek errors mid-load */
              }
            }
          }
          ticking = false;
        });
      }
    };
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  const dragActiveRef = useRef(false);
  const dragStartClientXRef = useRef(0);
  const dragStartPRef = useRef(0);

  const onHeroPointerDown = (e) => {
    dragActiveRef.current = true;
    dragStartClientXRef.current = e.clientX;
    dragStartPRef.current = heroProgressRef.current;
    e.currentTarget.setPointerCapture(e.pointerId);
    if (videoRef.current) videoRef.current.pause();
  };

  const onHeroPointerMove = (e) => {
    if (!dragActiveRef.current) return;
    const dx = e.clientX - dragStartClientXRef.current;
    const sensitivity = e.pointerType === "touch" ? 0.003 : 0.002;
    let np = Math.max(0, Math.min(1, dragStartPRef.current + dx * sensitivity));
    paintProgress(np);
    const v = videoRef.current;
    if (v && v.readyState >= 1) {
      const dur = v.duration || videoDurationRef.current;
      try {
        v.currentTime = np * dur;
      } catch {
        /* ignore */
      }
    }
  };

  const onHeroPointerUp = (e) => {
    if (!dragActiveRef.current) return;
    dragActiveRef.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (videoRef.current) videoRef.current.play().catch(() => {});
  };

  // Autoplay cinematic loop after source is attached (muted required)
  useEffect(() => {
    if (!videoReady) return;
    const v = videoRef.current;
    if (!v) return;
    const tryPlay = () => v.play().catch(() => {});
    tryPlay();
    const t = setTimeout(tryPlay, 300);
    const onVis = () => {
      if (document.hidden) v.pause();
      else if (!dragActiveRef.current) tryPlay();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearTimeout(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [videoReady]);

  return (
    <>
      <Seo
        title="French Drain & Sump Pump Installation | Central Florida | FloGuard"
        description="Stop flooded yards and foundation moisture in Central Florida. Custom French drains and sump pumps. Free assessments in Daytona, Port Orange, Orlando."
        path="/"
        image={IMAGES.heroPosterJpg}
        jsonLd={{
          "@context": "https://schema.org",
          "@graph": [organizationLd, faqPageLd(LANDING_FAQ.slice(0, 5))].filter(Boolean),
        }}
      />
      {/* ===== CINEMATIC HERO (video) — poster LCP first; video deferred.
          Asset: /hero-720.mp4 (web-optimized encode of the locked marketing journey). ===== */}
      <section
        data-testid="home-hero"
        className="relative h-[100svh] h-[100dvh] min-h-[520px] sm:min-h-[640px] w-full max-w-[100vw] overflow-hidden"
        onPointerDown={onHeroPointerDown}
        onPointerMove={onHeroPointerMove}
        onPointerUp={onHeroPointerUp}
        onPointerLeave={onHeroPointerUp}
        onPointerCancel={onHeroPointerUp}
      >
        <img
          src={IMAGES.heroPoster}
          alt=""
          width={1600}
          height={900}
          fetchPriority="high"
          decoding="async"
          className="hero-media absolute inset-0 z-[1] object-cover"
          aria-hidden="true"
        />
        {videoReady && (
          <video
            ref={videoRef}
            src="/hero-720.mp4"
            poster={IMAGES.heroPoster}
            className="hero-media absolute inset-0 z-[2] object-cover"
            autoPlay
            muted
            loop
            playsInline
            preload="auto"
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              const d = v.duration;
              if (d && d > 0) videoDurationRef.current = d;
              const p = heroProgressRef.current || 0;
              try {
                v.currentTime = p * d;
              } catch {
                /* ignore */
              }
            }}
            onTimeUpdate={() => {
              if (dragActiveRef.current) return;
              const v = videoRef.current;
              if (!v) return;
              const dur = v.duration || videoDurationRef.current;
              if (dur > 0) {
                const p = v.currentTime / dur;
                // Wider threshold — fewer React/label updates during free play
                if (Math.abs(p - heroProgressRef.current) > 0.04) {
                  paintProgress(p);
                }
              }
            }}
          />
        )}

        <div className="pointer-events-none absolute inset-0 z-[3] bg-gradient-to-t from-[#0B0F1A] via-[#0B0F1A]/75 via-35% to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-24 z-[3] bg-gradient-to-b from-[#0B0F1A]/40 to-transparent" />

        <div className="pointer-events-none relative z-10 h-full container-fg flex flex-col justify-end pb-12 pt-24 sm:pb-20 sm:pt-28 min-w-0">
          <p className="overline mb-4 sm:mb-6 fg-hero-fade" style={{ animationDelay: "0.15s" }}>
            Flood Solutions &amp; Management · Central Florida
          </p>

          <h1 className="font-display text-white text-[2.5rem] sm:text-7xl lg:text-8xl leading-[0.92] tracking-[-1px] sm:tracking-[-1.5px] max-w-4xl break-words">
            {headline.map((w, i) => (
              <span key={i}>
                {i > 0 ? " " : null}
                <span className="inline-block overflow-hidden align-bottom">
                  <span
                    className={`inline-block fg-hero-word ${i % 2 ? "text-brand-orange" : ""}`}
                    style={{ animationDelay: `${0.25 + i * 0.08}s` }}
                  >
                    {w}
                  </span>
                </span>
              </span>
            ))}
          </h1>

          <p
            className="mt-5 sm:mt-8 text-base sm:text-xl text-white/70 max-w-[42ch] leading-snug sm:leading-tight fg-hero-fade"
            style={{ animationDelay: "0.7s" }}
          >
            We engineer the precise path water must take to leave your property forever.
          </p>

          <div
            className="pointer-events-auto mt-7 sm:mt-10 flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-3 sm:gap-4 fg-hero-fade"
            style={{ animationDelay: "0.85s" }}
          >
            <Link
              to="/contact"
              data-testid="hero-cta-primary"
              className="group inline-flex items-center justify-center gap-2 bg-brand-orange text-white px-6 sm:px-9 py-3.5 sm:py-[17px] text-sm font-bold uppercase tracking-[0.5px] rounded-sm hover:bg-brand-orangeDark active:scale-[0.985] transition-all min-h-[48px]"
            >
              Request free assessment
              <ArrowUpRight size={18} className="group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
            </Link>
            <a
              href={COMPANY.phoneHref}
              data-testid="hero-cta-phone"
              className="inline-flex items-center justify-center gap-2 border border-white/25 text-white px-6 sm:px-8 py-3.5 sm:py-[17px] text-sm font-bold uppercase tracking-[0.5px] rounded-sm hover:bg-white/10 transition-colors min-h-[48px]"
            >
              <Phone size={16} /> {COMPANY.phone}
            </a>
          </div>

          <div className="mt-4 sm:mt-5 flex items-center gap-2 sm:gap-3 text-[9px] sm:text-[10px] uppercase tracking-[2px] text-white/35">
            <div className="flex-1 h-px bg-white/15 overflow-hidden rounded">
              <div
                ref={progressBarRef}
                className="h-px bg-brand-orange origin-left will-change-transform"
                style={{ transform: "scaleX(0)" }}
              />
            </div>
            FOLLOW THE WATER
            <span ref={labelRef} className="ml-1 text-brand-orange/70 tabular-nums">
              {JOURNEY_PHASES[0].label}
            </span>
            <span className="ml-auto text-white/30">{isTouchDevice ? "swipe" : "drag"}</span>
          </div>
        </div>

        <div
          className="absolute bottom-6 right-6 sm:bottom-8 sm:right-8 md:right-14 z-10 flex items-center gap-2 text-white/40 text-[9px] sm:text-[10px] font-medium uppercase tracking-[2px] fg-hero-fade"
          style={{ animationDelay: "1.2s" }}
        >
          {isTouchDevice ? "Swipe" : "Scroll"} to explore <ArrowDown size={13} className="animate-bounce" />
        </div>
      </section>

      {showBelowFold ? (
        <Suspense fallback={<div className="min-h-[40vh]" aria-hidden="true" />}>
          <HomeBelowFold />
        </Suspense>
      ) : (
        <div className="min-h-[40vh]" aria-hidden="true" />
      )}
    </>
  );
}
