import { Suspense, lazy } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowUpRight, Phone, ArrowDown } from "lucide-react";
import { Reveal } from "../components/Reveal";
import { StatsBar } from "../components/StatsBar";
import { Marquee } from "../components/Marquee";
import { ThreeBoundary } from "../components/ThreeBoundary";
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

const FlowHero = lazy(() => import("../components/three/TrenchHero"));

const HeroFallback = () => (
  <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, #dfeecb 0%, #b6d08a 42%, #7d9e59 100%)" }} />
);

const headline = ["Protected", "flow.", "Engineered", "trust."];

export default function Home() {
  return (
    <>
      <Seo
        title="FloGuard LLC — French Drain & Sump Pump Flood Solutions | Central Florida"
        description="Flooded yard, wet crawlspace or foundation damage? FloGuard engineers custom French drain and sump pump systems that keep Central Florida homes dry. Request a free drainage assessment."
        path="/"
      />
      {/* ===== 3D HERO ===== */}
      <section data-testid="home-hero" className="relative h-[100svh] min-h-[640px] w-full overflow-hidden bg-brand-ink">
        <Suspense fallback={<HeroFallback />}>
          <ThreeBoundary fallback={<HeroFallback />}>
            <div className="absolute inset-0 z-[2]">
              <FlowHero />
            </div>
          </ThreeBoundary>
        </Suspense>

        {/* readability scrim — darken the lower half so the headline + CTA read cleanly */}
        <div className="pointer-events-none absolute inset-0 z-[3] bg-gradient-to-t from-brand-ink via-brand-ink/75 via-35% to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-24 z-[3] bg-gradient-to-b from-brand-ink/40 to-transparent" />

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
            className="font-display text-white text-6xl sm:text-7xl lg:text-8xl leading-[0.9] tracking-tight max-w-4xl"
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
            className="mt-7 text-lg sm:text-xl text-white/75 max-w-xl leading-relaxed"
          >
            Flooded yards, wet crawlspaces, foundation damage — we engineer custom French drain and sump pump systems
            that keep Florida homes dry through every storm.
          </motion.p>

          <motion.div
            variants={fadeUp}
            initial="hidden"
            animate="visible"
            transition={{ delay: 1.05 }}
            className="pointer-events-auto mt-9 flex flex-wrap items-center gap-4"
          >
            <Link
              to="/contact"
              data-testid="hero-cta-primary"
              className="group inline-flex items-center gap-2 bg-brand-orange text-white px-8 py-4 text-sm font-bold uppercase tracking-wider rounded-sm hover:bg-brand-orangeDark transition-colors"
            >
              Request a drainage assessment
              <ArrowUpRight size={18} className="group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
            </Link>
            <a
              href={COMPANY.phoneHref}
              data-testid="hero-cta-phone"
              className="inline-flex items-center gap-2 border border-white/25 text-white px-8 py-4 text-sm font-bold uppercase tracking-wider rounded-sm hover:bg-white/10 transition-colors"
            >
              <Phone size={16} /> {COMPANY.phone}
            </a>
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.6 }}
          className="absolute bottom-6 right-6 md:right-12 z-10 flex items-center gap-2 text-white/50 text-xs uppercase tracking-widest"
        >
          Scroll <ArrowDown size={14} className="animate-bounce" />
        </motion.div>
      </section>

      <StatsBar />

      <Marquee />

      {/* ===== PROBLEM / AGITATION (light) ===== */}
      <section data-testid="problem-section" className="section bg-background">
        <div className="container-fg grid lg:grid-cols-12 gap-12 items-center">
          <div className="lg:col-span-5">
            <Reveal>
              <p className="overline mb-5">The Florida water problem</p>
              <h2 className="font-display text-4xl sm:text-5xl tracking-tight text-brand-navy leading-tight">
                Standing water isn't just annoying. It's eroding your home.
              </h2>
              <p className="mt-6 text-lg text-brand-slate leading-relaxed">
                Heavy Florida storms push groundwater against your foundation, drown your lawn, and creep into
                crawlspaces. Left alone, it means erosion, mold, and costly structural damage.
              </p>
              <ul className="mt-7 space-y-3 text-brand-slate">
                {["Chronic standing water & flooded patios", "Damp crawlspaces and foundation moisture", "Soil erosion and dying landscaping"].map((x) => (
                  <li key={x} className="flex items-center gap-3">
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
              className="relative rounded-sm overflow-hidden"
            >
              <img src={IMAGES.storm} alt="Florida home battered by storm and rising water" className="w-full h-[520px] object-cover" loading="lazy" />
              <div className="absolute bottom-4 left-4 glass px-4 py-2 rounded-sm text-white text-sm">
                When the next storm hits, is your home ready?
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
                We capture water in the soil, move it along a controlled path, then lift and discharge it safely away
                from your home. Here's the full journey.
              </p>
            </Reveal>
          </div>

          <FlowPath />

          <Reveal delay={0.1} className="mt-14 rounded-sm overflow-hidden border border-border">
            <img src={IMAGES.diagram} alt="Cross-section diagram of a FloGuard residential drainage system" className="w-full object-cover" loading="lazy" />
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
