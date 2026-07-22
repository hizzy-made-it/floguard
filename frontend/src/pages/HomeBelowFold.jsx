import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowUpRight } from "lucide-react";
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
import { IMAGES, SERVICE_AREAS } from "../data/site";
import { EASE } from "../lib/animations";

/**
 * Everything below the cinematic hero.
 * Lazy-loaded so framer-motion + form/testimonial code stay out of the LCP path.
 */
export default function HomeBelowFold() {
  return (
    <>
      <StatsBar />
      <Marquee />

      <section data-testid="problem-section" className="section bg-background">
        <div className="container-fg grid lg:grid-cols-12 gap-12 items-center">
          <div className="lg:col-span-5">
            <Reveal>
              <p className="overline mb-5">The Florida water problem</p>
              <h2 className="font-display text-3xl sm:text-5xl md:text-6xl tracking-tight text-brand-navy leading-none break-words">
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
              <img
                src={IMAGES.storm}
                alt="Central Florida home with standing water in yard during heavy rain"
                width={1400}
                height={788}
                className="w-full h-[520px] object-cover"
                loading="lazy"
                decoding="async"
              />
              <div className="absolute bottom-6 left-6 glass px-5 py-2.5 rounded-sm text-white text-sm tracking-wide">
                When the next storm hits, will your home be ready?
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      <section data-testid="how-it-works" className="section bg-secondary">
        <div className="container-fg">
          <div className="max-w-3xl mb-14">
            <Reveal>
              <p className="overline mb-5">How our system works</p>
              <h2 className="font-display text-4xl sm:text-5xl tracking-tight text-brand-navy leading-tight">
                French drain → sump pump → safe discharge.
              </h2>
              <p className="mt-5 text-lg text-brand-slate">
                A sump pump + French drain system actively lowers the water table. The French drain (perforated pipe in gravel with filter fabric) intercepts water. The sump pump pushes it far away. It protects against Florida&apos;s high water table, flat terrain and heavy rain.
              </p>
            </Reveal>
          </div>

          <FlowPath />

          <Reveal delay={0.1} className="mt-14 rounded-sm overflow-hidden border border-border">
            <img
              src={IMAGES.diagram}
              alt="Technical diagram of FloGuard French drain and sump pump drainage system"
              width={960}
              height={540}
              className="w-full object-cover"
              loading="lazy"
              decoding="async"
            />
          </Reveal>

          <div className="mt-10">
            <Link to="/process" data-testid="how-learn-more" className="inline-flex items-center gap-2 text-brand-navy font-bold link-underline">
              See the full process <ArrowUpRight size={18} />
            </Link>
          </div>
        </div>
      </section>

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
