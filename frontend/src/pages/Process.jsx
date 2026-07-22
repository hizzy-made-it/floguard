import { useState } from "react";
import { PageHero } from "../components/PageHero";
import { Seo } from "../components/Seo";
import { Reveal } from "../components/Reveal";
import { FlowPath } from "../components/FlowPath";
import { ProcessTimeline } from "../components/ProcessTimeline";
import { FinalCTA } from "../components/FinalCTA";
import { SYSTEM_EXPLANATION } from "../data/site";
import { ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";
import { StatsBar } from "../components/StatsBar";

export default function Process() {
  const [activeTimeline, setActiveTimeline] = useState(-1);

  // Map timeline step hover to relevant flow step(s) for micro highlight
  const flowHighlight = activeTimeline === 0 ? 0 : 
                        activeTimeline === 1 ? 2 : 
                        activeTimeline === 2 ? 3 : 
                        activeTimeline === 3 ? 4 : -1;

  return (
    <>
      <Seo 
        title="How French Drains + Sump Pumps Work in Florida | FloGuard" 
        description="Step-by-step explanation of French drain and sump pump systems for high water tables, flat lots, and heavy Florida rain. Engineered protection for Central Florida homes." 
        path="/process" 
        image="/images/case4-after.webp"
        jsonLd={{
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "HowTo",
              name: "How a French Drain + Sump Pump System Works in Florida",
              description:
                "Step-by-step: FloGuard intercepts Florida groundwater with a French drain, collects it in a sump, and discharges it safely away from the foundation.",
              totalTime: "P2D",
              estimatedCost: {
                "@type": "MonetaryAmount",
                currency: "USD",
                value: "4500-12000",
              },
              step: [
                {
                  "@type": "HowToStep",
                  position: 1,
                  name: "Site Evaluation",
                  text: "Walk the property, map low spots, water table indicators, and runoff paths to find where water enters and pools.",
                },
                {
                  "@type": "HowToStep",
                  position: 2,
                  name: "Custom System Design",
                  text: "Engineer trench layout, slopes, pipe routing, filter fabric, sump placement, and code-compliant discharge for the specific yard.",
                },
                {
                  "@type": "HowToStep",
                  position: 3,
                  name: "Clean Installation",
                  text: "Install the French drain (perforated pipe in clean gravel with fabric), sump basin, pump, check valve, and discharge line; restore landscaping.",
                },
                {
                  "@type": "HowToStep",
                  position: 4,
                  name: "Maintenance & Monitoring",
                  text: "Test pumps, clear basins, verify discharge, and optionally add battery backup or monitoring for Florida storm season.",
                },
              ],
            },
            {
              "@type": "FAQPage",
              mainEntity: [
                {
                  "@type": "Question",
                  name: "How does a French drain and sump pump work together?",
                  acceptedAnswer: {
                    "@type": "Answer",
                    text: "The French drain intercepts groundwater in a fabric-lined gravel trench. Water flows by gravity to a sump basin; the pump lifts it out a discharge line away from the foundation.",
                  },
                },
                {
                  "@type": "Question",
                  name: "Why do Florida homes often need both systems?",
                  acceptedAnswer: {
                    "@type": "Answer",
                    text: "High water tables and flat lots mean gravity alone often cannot move water far enough. A sump provides the lift needed for safe discharge.",
                  },
                },
                {
                  "@type": "Question",
                  name: "How long does installation take?",
                  acceptedAnswer: {
                    "@type": "Answer",
                    text: "Many residential systems install in 1–3 days depending on trench length, access, and scope. You get a schedule after the free assessment.",
                  },
                },
              ],
            },
          ],
        }}
      />
      <PageHero
        overline="Technology & Process"
        title="How FloGuard keeps your home dry."
        subtitle="A clear, engineered path — from the first site walk to a system that quietly protects your home for years."
        image="/images/case4-after.webp"
        primary={{ label: "Start with an assessment", to: "/contact" }}
        secondary={{ label: "See our results", to: "/case-studies" }}
      />

      <StatsBar />

      {/* The water path - cinematic and precise */}
      <section data-testid="process-flow" className="section bg-background">
        <div className="container-fg">
          <div className="max-w-3xl mb-14">
            <Reveal>
              <p className="overline mb-5">The water's journey</p>
              <h2 className="font-display text-3xl sm:text-5xl md:text-6xl tracking-tight text-brand-navy leading-none break-words">
                Every drop follows one engineered path.
              </h2>
            </Reveal>
          </div>
          <FlowPath activeIndex={flowHighlight} />
          <Reveal delay={0.1} className="mt-8 text-lg text-brand-slate max-w-2xl">
            We intercept water before it reaches your foundation, move it through clean gravel and perforated pipe, and discharge it safely away from your home.
          </Reveal>
        </div>
      </section>

      {/* Why This System Matters in Florida */}
      <section className="section bg-background">
        <div className="container-fg">
          <div className="max-w-3xl mb-14">
            <Reveal>
              <p className="overline mb-5">Florida-Specific Challenges</p>
              <h2 className="font-display text-4xl sm:text-5xl tracking-tight text-brand-navy leading-tight">
                Why a sump pump + French drain system matters here.
              </h2>
            </Reveal>
          </div>
          <div className="grid lg:grid-cols-12 gap-12">
            <div className="lg:col-span-5">
              <Reveal>
                <p className="text-lg text-brand-slate leading-relaxed">
                  {SYSTEM_EXPLANATION.intro}
                </p>
              </Reveal>
            </div>
            <div className="lg:col-span-7">
              <Reveal delay={0.1}>
                <p className="text-lg text-brand-slate leading-relaxed mb-6">
                  {SYSTEM_EXPLANATION.whyMatters}
                </p>
                <p className="text-lg text-brand-slate leading-relaxed">
                  {SYSTEM_EXPLANATION.benefits}
                </p>
              </Reveal>
            </div>
          </div>
        </div>
      </section>

      {/* The Two Main Parts */}
      <section className="section bg-secondary">
        <div className="container-fg">
          <div className="max-w-3xl mb-14">
            <Reveal>
              <p className="overline mb-5">The System</p>
              <h2 className="font-display text-4xl sm:text-5xl tracking-tight text-brand-navy leading-tight">
                Two main parts working as one.
              </h2>
            </Reveal>
          </div>
          <div className="grid md:grid-cols-2 gap-8">
            {SYSTEM_EXPLANATION.parts.map((part, i) => (
              <Reveal key={i} delay={i * 0.1} className="bg-white border border-border rounded-sm p-8">
                <h3 className="font-display text-2xl text-brand-navy mb-4">{part.title}</h3>
                <p className="text-brand-slate leading-relaxed">{part.desc}</p>
              </Reveal>
            ))}
          </div>
          <div className="mt-8">
            <Link to="/services" className="inline-flex items-center gap-2 text-brand-navy font-bold link-underline">
              See our specific service packages <ArrowUpRight size={18} />
            </Link>
          </div>
        </div>
      </section>

      {/* How the System Works Step-by-Step */}
      <section className="section bg-background">
        <div className="container-fg">
          <div className="max-w-3xl mb-14">
            <Reveal>
              <p className="overline mb-5">During Heavy Rain</p>
              <h2 className="font-display text-4xl sm:text-5xl tracking-tight text-brand-navy leading-tight">
                How the system works together.
              </h2>
            </Reveal>
          </div>
          <ol className="grid md:grid-cols-2 gap-x-12 gap-y-8 text-lg text-brand-slate">
            {SYSTEM_EXPLANATION.howItWorks.map((step, i) => (
              <li key={i} className="flex gap-4">
                <span className="font-display text-brand-orange text-2xl font-bold tabular-nums w-8 shrink-0">{(i + 1).toString().padStart(2, "0")}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
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
              <img
                src="/images/diagram.webp"
                alt="FloGuard drainage system diagram"
                width={960}
                height={540}
                className="w-full object-cover"
                loading="lazy"
                decoding="async"
              />
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
          <div 
            onMouseEnter={() => setActiveTimeline(0)} 
            onMouseLeave={() => setActiveTimeline(-1)}
            className="cursor-default"
          >
            <ProcessTimeline dark activeIndex={activeTimeline} />
          </div>
          <div className="mt-14">
            <Link to="/case-studies" className="inline-flex items-center gap-2 text-white font-bold link-underline">
              See these steps in action <ArrowUpRight size={18} />
            </Link>
          </div>
        </div>
      </section>

      {/* Florida-Specific Considerations */}
      <section className="section bg-brand-ink text-white grain">
        <div className="container-fg">
          <div className="max-w-3xl mb-14">
            <Reveal>
              <p className="overline mb-5 text-brand-orange">Local Conditions</p>
              <h2 className="font-display text-4xl sm:text-5xl tracking-tight leading-tight">
                Florida-specific considerations.
              </h2>
            </Reveal>
          </div>
          <ul className="grid md:grid-cols-2 gap-x-12 gap-y-8 text-lg text-white/80">
            {SYSTEM_EXPLANATION.floridaSpecific.map((item, i) => (
              <li key={i} className="flex gap-4">
                <span className="text-brand-orange">•</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Protects vs Does Not Protect */}
      <section className="section bg-background">
        <div className="container-fg grid md:grid-cols-2 gap-12">
          <div>
            <Reveal>
              <p className="overline mb-5">Effective Protection</p>
              <h3 className="font-display text-3xl tracking-tight text-brand-navy">What the system is good at.</h3>
              <p className="mt-6 text-lg text-brand-slate">{SYSTEM_EXPLANATION.protects}</p>
            </Reveal>
          </div>
          <div>
            <Reveal delay={0.1}>
              <p className="overline mb-5">Limitations</p>
              <h3 className="font-display text-3xl tracking-tight text-brand-navy">What it is not designed to protect against.</h3>
              <p className="mt-6 text-lg text-brand-slate">{SYSTEM_EXPLANATION.doesNotProtect}</p>
            </Reveal>
          </div>
        </div>
      </section>

      {/* Maintenance */}
      <section className="section bg-secondary">
        <div className="container-fg">
          <div className="max-w-3xl mb-14">
            <Reveal>
              <p className="overline mb-5">Long-Term Performance</p>
              <h2 className="font-display text-4xl sm:text-5xl tracking-tight text-brand-navy leading-tight">
                Maintenance tips.
              </h2>
              <p className="mt-6 text-lg text-brand-slate">Important in Florida’s climate.</p>
            </Reveal>
          </div>
          <ul className="grid md:grid-cols-2 gap-6 text-lg text-brand-slate">
            {SYSTEM_EXPLANATION.maintenance.map((tip, i) => (
              <li key={i} className="flex gap-4 bg-white border border-border rounded-sm p-6">
                <span className="text-brand-orange">✓</span>
                <span>{tip}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Bottom Line */}
      <section className="section bg-background border-t border-border">
        <div className="container-fg max-w-3xl">
          <Reveal>
            <p className="overline mb-5">The Bottom Line</p>
            <p className="text-2xl text-brand-navy leading-tight">
              {SYSTEM_EXPLANATION.bottomLine}
            </p>
          </Reveal>
          <div className="mt-8">
            <Link to="/contact" className="inline-flex items-center gap-2 text-brand-navy font-bold link-underline">
              Request a free assessment <ArrowUpRight size={18} />
            </Link>
          </div>
        </div>
      </section>

      <FinalCTA />
    </>
  );
}
