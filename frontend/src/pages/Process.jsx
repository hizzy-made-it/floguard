import { PageHero } from "../components/PageHero";
import { Reveal } from "../components/Reveal";
import { FlowPath } from "../components/FlowPath";
import { ProcessTimeline } from "../components/ProcessTimeline";
import { FinalCTA } from "../components/FinalCTA";
import { IMAGES } from "../data/site";
import { ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";

export default function Process() {
  return (
    <>
      <PageHero
        overline="Technology & Process"
        title="How FloGuard keeps your home dry."
        subtitle="A clear, engineered path — from the first site walk to a system that quietly protects your home for years."
        image={IMAGES.diagram}
        primary={{ label: "Start with an assessment", to: "/contact" }}
        secondary={{ label: "See our results", to: "/case-studies" }}
      />

      {/* The water path */}
      <section data-testid="process-flow" className="section bg-background">
        <div className="container-fg">
          <Reveal className="mb-14 max-w-3xl">
            <p className="overline mb-5">The water's journey</p>
            <h2 className="font-display text-4xl sm:text-5xl tracking-tight text-brand-navy leading-tight">
              Surface water → gravel trench → perforated pipe → sump → safe discharge.
            </h2>
            <p className="mt-5 text-lg text-brand-slate">
              Groundwater and runoff enter the gravel, flow through a perforated pipe by gravity, and — when the lot is
              flat — collect in a sump basin where a pump lifts it to a safe discharge point far from your foundation.
            </p>
          </Reveal>
          <FlowPath />
        </div>
      </section>

      {/* Diagram feature */}
      <section data-testid="process-diagram" className="section bg-secondary">
        <div className="container-fg grid lg:grid-cols-12 gap-12 items-center">
          <div className="lg:col-span-5">
            <Reveal>
              <p className="overline mb-5">Engineered, not guessed</p>
              <h2 className="font-display text-4xl sm:text-5xl tracking-tight text-brand-navy leading-tight">
                A system designed around your property.
              </h2>
              <p className="mt-6 text-lg text-brand-slate leading-relaxed">
                We solve three problems at once: hydrostatic pressure against your foundation, standing water in the
                yard, and intrusion into basements and crawlspaces. Done well, it's invisible after backfill.
              </p>
              <ul className="mt-7 space-y-3 text-brand-slate">
                {["Protects the home's foundation", "Custom trench, slope & pipe design", "Catch basins and safe outflow"].map((x) => (
                  <li key={x} className="flex items-center gap-3">
                    <span className="w-1.5 h-1.5 rounded-full bg-brand-orange" /> {x}
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>
          <div className="lg:col-span-7">
            <Reveal className="rounded-sm overflow-hidden border border-border">
              <img src={IMAGES.diagram} alt="FloGuard drainage system cross-section" className="w-full object-cover" loading="lazy" />
            </Reveal>
          </div>
        </div>
      </section>

      {/* 4 step timeline */}
      <section data-testid="process-steps" className="section bg-brand-ink grain relative">
        <div className="container-fg relative z-10">
          <Reveal className="mb-16 max-w-2xl">
            <p className="overline mb-5">Our process</p>
            <h2 className="font-display text-4xl sm:text-5xl tracking-tight text-white leading-tight">
              Four steps, zero guesswork.
            </h2>
          </Reveal>
          <ProcessTimeline dark />
          <div className="mt-14">
            <Link to="/case-studies" className="inline-flex items-center gap-2 text-white font-bold link-underline">
              See these steps in action <ArrowUpRight size={18} />
            </Link>
          </div>
        </div>
      </section>

      <FinalCTA />
    </>
  );
}
