import { useRef, useEffect, useState, lazy, Suspense } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, Phone, ArrowDown } from "lucide-react";
import { COMPANY, IMAGES } from "../data/site";
import { Seo, organizationLd, faqPageLd } from "../components/Seo";
import { LANDING_FAQ } from "../data/site";

// Below-fold content (framer-motion, forms, testimonials) loads after hero paints
const HomeBelowFold = lazy(() => import("./HomeBelowFold"));

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

export default function Home() {
  // Scroll + drag driven progress for the cinematic hero video.
  // Maps scroll/drag to time position in the water journey video (inside-pipe droplet camera follow).
  const heroProgressRef = useRef(0);
  const [heroProgress, setHeroProgress] = useState(0);
  const [isTouchDevice, setIsTouchDevice] = useState(false);

  const videoRef = useRef(null);
  const [videoDuration, setVideoDuration] = useState(8); // updated from metadata

  useEffect(() => {
    const range = 1.35; // scroll distance in viewport heights for full scrub control
    let ticking = false;
    setIsTouchDevice("ontouchstart" in window || navigator.maxTouchPoints > 0);

    const update = () => {
      const p = Math.min(1, Math.max(0, window.scrollY / (window.innerHeight * range)));
      heroProgressRef.current = p;
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(() => {
          setHeroProgress(p);
          // scroll-driven seek into the video journey (replicates the previous 3D behavior)
          const v = videoRef.current;
          if (v) {
            const dur = v.duration || videoDuration;
            const target = p * dur;
            if (Math.abs(v.currentTime - target) > 0.06) {
              v.currentTime = target;
            }
          }
          ticking = false;
        });
      }
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [videoDuration]);

  // Desktop mouse-drag scrub (alternative / additive to scroll)
  const dragActiveRef = useRef(false);
  const dragStartClientXRef = useRef(0);
  const dragStartPRef = useRef(0);

  const onHeroPointerDown = (e) => {
    // Support mouse drag on desktop and horizontal touch drag on mobile for scrub
    dragActiveRef.current = true;
    dragStartClientXRef.current = e.clientX;
    dragStartPRef.current = heroProgressRef.current;
    e.currentTarget.setPointerCapture(e.pointerId);
    // pause for precise manual control
    if (videoRef.current) {
      videoRef.current.pause();
    }
  };

  const onHeroPointerMove = (e) => {
    if (dragActiveRef.current) {
      const dx = e.clientX - dragStartClientXRef.current;
      const sensitivity = e.pointerType === "touch" ? 0.003 : 0.002;
      let np = dragStartPRef.current + dx * sensitivity;
      np = Math.max(0, Math.min(1, np));
      heroProgressRef.current = np;
      setHeroProgress(np);
      // drive video time immediately for responsive scrub
      const v = videoRef.current;
      if (v) {
        const dur = v.duration || videoDuration;
        v.currentTime = np * dur;
      }
    }
  };

  const onHeroPointerUp = (e) => {
    if (dragActiveRef.current) {
      dragActiveRef.current = false;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch (err) {
        /* ignore */
      }
      // resume beautiful cinematic loop after drag
      if (videoRef.current) {
        videoRef.current.play().catch(() => {});
      }
    }
  };

  // Kick off the autoplay cinematic loop (browsers require muted for autoplay)
  // DO NOT replace hero.mp4 — locked marketing asset.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const tryPlay = () => v.play().catch(() => {});
    tryPlay();
    const t = setTimeout(tryPlay, 400);
    const onVis = () => {
      if (document.hidden) v.pause();
      else if (!dragActiveRef.current) tryPlay();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearTimeout(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  return (
    <>
      <Seo
        title="French Drain & Sump Pump Installation | Central Florida | FloGuard"
        description="Stop flooded yards and foundation moisture in Central Florida. FloGuard installs custom French drains and sump pumps. Free assessments in Daytona, Port Orange, Orlando."
        path="/"
        image={IMAGES.heroPosterJpg}
        jsonLd={{
          "@context": "https://schema.org",
          "@graph": [organizationLd, faqPageLd(LANDING_FAQ.slice(0, 5))].filter(Boolean),
        }}
      />
      {/* ===== CINEMATIC HERO (video) — CSS motion only, no framer-motion on LCP path ===== */}
      <section
        data-testid="home-hero"
        className="relative h-[100svh] h-[100dvh] min-h-[520px] sm:min-h-[640px] w-full max-w-[100vw] overflow-hidden"
        onPointerDown={onHeroPointerDown}
        onPointerMove={onHeroPointerMove}
        onPointerUp={onHeroPointerUp}
        onPointerLeave={onHeroPointerUp}
        onPointerCancel={onHeroPointerUp}
      >
        {/* LCP image: explicit img + preload in index.html. Video paints on top once ready. */}
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
        <video
          ref={videoRef}
          src="/hero.mp4"
          poster={IMAGES.heroPoster}
          className="hero-media absolute inset-0 z-[2] object-cover"
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            const d = v.duration;
            if (d && d > 0) setVideoDuration(d);
            const p = heroProgressRef.current || 0;
            v.currentTime = p * d;
          }}
          onTimeUpdate={() => {
            const v = videoRef.current;
            if (v && !dragActiveRef.current) {
              const dur = v.duration || videoDuration;
              if (dur > 0) {
                const p = v.currentTime / dur;
                if (Math.abs(p - heroProgressRef.current) > 0.012) {
                  heroProgressRef.current = p;
                  setHeroProgress(p);
                }
              }
            }
          }}
        />

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
                className="h-px bg-brand-orange transition-[width] duration-100"
                style={{ width: `${heroProgress * 100}%` }}
              />
            </div>
            FOLLOW THE WATER
            <span className="ml-1 text-brand-orange/70 tabular-nums">{getJourneyLabel(heroProgress)}</span>
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

      <Suspense fallback={<div className="min-h-[40vh]" aria-hidden="true" />}>
        <HomeBelowFold />
      </Suspense>
    </>
  );
}
