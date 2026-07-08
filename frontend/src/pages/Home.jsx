import { useRef, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowUpRight, Phone, ArrowDown } from "lucide-react";
import { Reveal } from "../components/Reveal";
import { StatsBar } from "../components/StatsBar";
import { Marquee } from "../components/Marquee";
import { ServicesGrid } from "../components/ServicesGrid";
import { ProcessTimeline } from "../components/ProcessTimeline";
import { FlowPath } from "../components/FlowPath";
import { Testimonials } from "../components/Testimonials";
import { GoogleReviews } from "../components/GoogleReviews";
import { FinalCTA } from "../components/FinalCTA";
import { LeadForm } from "../components/LeadForm";
import { COMPANY, IMAGES, SERVICE_AREAS } from "../data/site";
import { wordContainer, wordChild, fadeUp, EASE } from "../lib/animations";
import { Seo } from "../components/Seo";

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
    setIsTouchDevice('ontouchstart' in window || navigator.maxTouchPoints > 0);

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
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
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
      const sensitivity = e.pointerType === 'touch' ? 0.003 : 0.002;
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
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (err) {}
      // resume beautiful cinematic loop after drag
      if (videoRef.current) {
        videoRef.current.play().catch(() => {});
      }
    }
  };

  // Kick off the autoplay cinematic loop (browsers require muted for autoplay)
  useEffect(() => {
    const v = videoRef.current;
    if (v) {
      const tryPlay = () => v.play().catch(() => {});
      tryPlay();
      // In case metadata not ready yet
      const t = setTimeout(tryPlay, 400);
      return () => clearTimeout(t);
    }
  }, []);

  return (
    <>
      <Seo
        title="FloGuard LLC — French Drain & Sump Pump Flood Solutions | Central Florida"
        description="Flooded yard, wet crawlspace or foundation damage? FloGuard engineers custom French drain and sump pump systems that keep Central Florida homes dry. Request a free drainage assessment."
        path="/"
      />
      {/* ===== CINEMATIC HERO (video) ===== */}
      <section 
        data-testid="home-hero" 
        className="relative h-[100svh] min-h-[640px] w-full overflow-hidden"
        onPointerDown={onHeroPointerDown}
        onPointerMove={onHeroPointerMove}
        onPointerUp={onHeroPointerUp}
        onPointerLeave={onHeroPointerUp}
        onPointerCancel={onHeroPointerUp}
      >
        {/* High-quality cinematic hero video (replaces fragile 3D). Autoplay + loop + scroll/drag scrub. */}
        <video
          ref={videoRef}
          src="/hero.mp4"
          className="absolute inset-0 z-[2] w-full h-full object-cover"
          autoPlay
          muted
          loop
          playsInline
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            const d = v.duration;
            if (d && d > 0) setVideoDuration(d);
            // initial sync to current scroll progress (e.g. if reloaded mid-page)
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

        {/* readability scrim — darken the lower half so the headline + CTA read cleanly */}
        <div className="pointer-events-none absolute inset-0 z-[3] bg-gradient-to-t from-[#0B0F1A] via-[#0B0F1A]/75 via-35% to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-24 z-[3] bg-gradient-to-b from-[#0B0F1A]/40 to-transparent" />

        <div className="pointer-events-none relative z-10 h-full container-fg flex flex-col justify-end pb-24 pt-28">
          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: EASE, delay: 0.3 }}
            className="overline mb-6"
          >
            Flood Solutions &amp; Management · Central Florida
          </motion.p>

          <motion.h1
            variants={wordContainer}
            initial="hidden"
            animate="visible"
            className="font-display text-white text-6xl sm:text-7xl lg:text-8xl leading-[0.9] tracking-[-1.5px] max-w-4xl"
          >
            {headline.map((w, i) => (
              <span key={i} className="inline-block overflow-hidden mr-[0.2em] align-bottom">
                <motion.span variants={wordChild} className={`inline-block ${i % 2 ? "text-brand-orange" : ""}`}>
                  {w}
                </motion.span>
              </span>
            ))}
          </motion.h1>

          <motion.p
            variants={fadeUp}
            initial="hidden"
            animate="visible"
            transition={{ delay: 0.9 }}
            className="mt-8 text-[17px] sm:text-xl text-white/70 max-w-[42ch] leading-tight"
          >
            We engineer the precise path water must take to leave your property forever.
          </motion.p>

          <motion.div
            variants={fadeUp}
            initial="hidden"
            animate="visible"
            transition={{ delay: 1.05 }}
            className="pointer-events-auto mt-10 flex flex-wrap items-center gap-4"
          >
            <Link
              to="/contact"
              data-testid="hero-cta-primary"
              className="group inline-flex items-center gap-2 bg-brand-orange text-white px-9 py-[17px] text-sm font-bold uppercase tracking-[0.5px] rounded-sm hover:bg-brand-orangeDark active:scale-[0.985] transition-all"
            >
              Request free assessment
              <ArrowUpRight size={18} className="group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
            </Link>
            <a
              href={COMPANY.phoneHref}
              data-testid="hero-cta-phone"
              className="inline-flex items-center gap-2 border border-white/25 text-white px-8 py-[17px] text-sm font-bold uppercase tracking-[0.5px] rounded-sm hover:bg-white/10 transition-colors"
            >
              <Phone size={16} /> {COMPANY.phone}
            </a>
          </motion.div>

          {/* Scroll/drag-synced journey indicator — explicit premium narrative control */}
          <div className="mt-5 flex items-center gap-3 text-[10px] uppercase tracking-[2px] text-white/35">
            <div className="flex-1 h-px bg-white/15 overflow-hidden rounded">
              <div 
                className="h-px bg-brand-orange transition-[width] duration-100" 
                style={{ width: `${heroProgress * 100}%` }} 
              />
            </div>
            FOLLOW THE WATER
            <span className="ml-2 text-brand-orange/70 tabular-nums">{getJourneyLabel(heroProgress)}</span>
            <span className="ml-auto hidden md:inline text-white/30">{isTouchDevice ? 'or swipe' : 'or drag horizontally'}</span>
          </div>
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.6 }}
          className="absolute bottom-8 right-8 md:right-14 z-10 flex items-center gap-2 text-white/40 text-[10px] font-medium uppercase tracking-[2px]"
        >
          {isTouchDevice ? 'Swipe' : 'Scroll'} to explore <ArrowDown size={13} className="animate-bounce" />
        </motion.div>
      </section>

      <StatsBar />

      <Marquee />

      {/* ===== PROBLEM / AGITATION (light) - elite editorial */}
      <section data-testid="problem-section" className="section bg-background">
        <div className="container-fg grid lg:grid-cols-12 gap-12 items-center">
          <div className="lg:col-span-5">
            <Reveal>
              <p className="overline mb-5">The Florida water problem</p>
              <h2 className="font-display text-4xl sm:text-6xl tracking-tight text-brand-navy leading-none">
                Standing water is quietly destroying your home.
              </h2>
              <p className="mt-6 text-[17px] text-brand-slate leading-tight">
                Florida has a high water table (often only 2–6 feet below the surface), flat terrain, intense rainfall (2+ inches per hour), and sandy soils. Heavy storms push groundwater against foundations, drown lawns, and invade crawlspaces. A properly installed French drain + sump pump system actively lowers the water table and removes water before it can damage your home.
              </p>
              <ul className="mt-8 space-y-2.5 text-brand-slate">
                {["Chronic standing water & flooded patios", "Damp crawlspaces and foundation moisture", "Soil erosion and dying landscaping"].map((x) => (
                  <li key={x} className="flex items-center gap-3 text-[15px]">
                    <span className="w-1.5 h-1.5 rounded-full bg-brand-orange" /> {x}
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>
          <div className="lg:col-span-7">
            <motion.div
              initial={{ opacity: 0, clipPath: "inset(0 0 100% 0)" }}
              whileInView={{ opacity: 1, clipPath: "inset(0 0 0% 0)" }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 1, ease: EASE }}
              className="relative rounded-sm overflow-hidden ring-1 ring-black/5"
            >
              <img src="/images/storm.jpg" alt="Central Florida home with standing water in yard during heavy rain" className="w-full h-[520px] object-cover" loading="lazy" />
              <div className="absolute bottom-6 left-6 glass px-5 py-2.5 rounded-sm text-white text-sm tracking-wide">
                When the next storm hits, will your home be ready?
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ===== HOW IT WORKS (light) ===== */}
      <section data-testid="how-it-works" className="section bg-secondary">
        <div className="container-fg">
          <div className="max-w-3xl mb-14">
            <Reveal>
              <p className="overline mb-5">How our system works</p>
              <h2 className="font-display text-4xl sm:text-5xl tracking-tight text-brand-navy leading-tight">
                French drain → sump pump → safe discharge.
              </h2>
              <p className="mt-5 text-lg text-brand-slate">
                A sump pump + French drain system actively lowers the water table. The French drain (perforated pipe in gravel with filter fabric) intercepts water. The sump pump pushes it far away. It protects against Florida's high water table, flat terrain and heavy rain.
              </p>
            </Reveal>
          </div>

          <FlowPath />

          <Reveal delay={0.1} className="mt-14 rounded-sm overflow-hidden border border-border">
            <img src="/images/case-studies-hero.jpg" alt="Technical cross-section of FloGuard French drain and sump pump drainage system" className="w-full object-cover" loading="lazy" />
          </Reveal>

          <div className="mt-10">
            <Link to="/process" data-testid="how-learn-more" className="inline-flex items-center gap-2 text-brand-navy font-bold link-underline">
              See the full process <ArrowUpRight size={18} />
            </Link>
          </div>
        </div>
      </section>

      {/* ===== SERVICES PREVIEW ===== */}
      <section data-testid="services-preview" className="section bg-background">
        <div className="container-fg">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-14">
            <Reveal>
              <p className="overline mb-5">What we install</p>
              <h2 className="font-display text-4xl sm:text-5xl tracking-tight text-brand-navy max-w-xl leading-tight">
                Custom drainage, engineered for your yard.
              </h2>
            </Reveal>
            <Link to="/services" className="inline-flex items-center gap-2 text-brand-navy font-bold link-underline shrink-0">
              All services <ArrowUpRight size={18} />
            </Link>
          </div>
          <ServicesGrid />
        </div>
      </section>

      {/* ===== PROCESS TIMELINE (dark) ===== */}
      <section data-testid="process-preview" className="section bg-brand-ink grain relative">
        <div className="container-fg relative z-10">
          <div className="max-w-2xl mb-16">
            <Reveal>
              <p className="overline mb-5">From flooded to dry</p>
              <h2 className="font-display text-4xl sm:text-5xl tracking-tight text-white leading-tight">
                Four steps to a permanently dry property.
              </h2>
            </Reveal>
          </div>
          <ProcessTimeline dark />
        </div>
      </section>

      <Testimonials />

      <GoogleReviews />

      {/* ===== LEAD SECTION ===== */}
      <section data-testid="home-lead" className="section bg-brand-ink grain relative">
        <div className="container-fg relative z-10 grid lg:grid-cols-12 gap-12 items-start">
          <div className="lg:col-span-5">
            <Reveal>
              <p className="overline mb-5">Free on-site evaluation</p>
              <h2 className="font-display text-4xl sm:text-5xl tracking-tight text-white leading-tight">
                Tell us about your water problem.
              </h2>
              <p className="mt-6 text-lg text-white/65 leading-relaxed">
                Answer three quick questions and a FloGuard specialist will schedule a free assessment — no obligation,
                just a clear plan to keep your home dry.
              </p>
              <div className="mt-8 flex flex-wrap gap-2">
                {SERVICE_AREAS.slice(0, 8).map((a) => (
                  <span key={a} className="text-xs text-white/50 border border-white/15 px-3 py-1.5 rounded-full">{a}</span>
                ))}
              </div>
            </Reveal>
          </div>
          <div className="lg:col-span-7">
            <LeadForm />
          </div>
        </div>
      </section>

      <FinalCTA />
    </>
  );
}
