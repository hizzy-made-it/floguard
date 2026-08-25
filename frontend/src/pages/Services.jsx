import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Minus, Check, ArrowUpRight } from "lucide-react";
import { PageHero } from "../components/PageHero";
import { Seo } from "../components/Seo";
import { Reveal } from "../components/Reveal";
import { ServicesGrid } from "../components/ServicesGrid";
import { FinalCTA } from "../components/FinalCTA";
import { Link } from "react-router-dom";
import { SERVICES } from "../data/site";
import { EASE } from "../lib/animations";
import { StatsBar } from "../components/StatsBar";

function Accordion({ service, open, onToggle, index }) {
  return (
    <div data-testid={`service-accordion-${service.id}`} className="border-b border-border">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={`service-panel-${service.id}`}
        id={`service-trigger-${service.id}`}
        className="w-full flex items-center justify-between gap-6 py-7 text-left group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-orange"
        data-testid={`accordion-toggle-${service.id}`}
      >
        <div className="flex items-baseline gap-5">
          <span className="font-display text-lg text-brand-orange">0{index + 1}</span>
          <h3 className="font-display text-2xl sm:text-3xl tracking-tight text-brand-navy group-hover:text-brand-orange transition-colors">
            {service.title}
          </h3>
        </div>
        <span className="shrink-0 w-10 h-10 rounded-full border border-border flex items-center justify-center text-brand-navy">
          {open ? <Minus size={18} /> : <Plus size={18} />}
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={`service-panel-${service.id}`}
            role="region"
            aria-labelledby={`service-trigger-${service.id}`}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.4, ease: EASE }}
            className="overflow-hidden"
          >
            <div className="pb-9 grid md:grid-cols-2 gap-8 items-center">
              <div>
                <p className="text-lg text-brand-slate leading-relaxed">{service.blurb}</p>
                <ul className="mt-5 space-y-2.5">
                  {service.features.map((f) => (
                    <li key={f} className="flex items-center gap-2.5 text-brand-slate">
                      <Check size={16} className="text-brand-orange shrink-0" /> {f}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-sm overflow-hidden">
                <img src={service.image} alt={service.title} className="w-full h-64 object-cover" loading="lazy" />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function Services() {
  const [open, setOpen] = useState(SERVICES[0].id);

  return (
    <>
      <Seo 
        title="French Drain & Sump Pump Services | Central Florida | FloGuard" 
        description="Expert French drain installation, sump pumps, and yard drainage in Port Orange, Daytona, Orlando and Central Florida. Custom engineered systems for high water tables and heavy rain. Free assessments." 
        path="/services" 
        jsonLd={{
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "Organization",
              "name": "FloGuard, LLC",
              "url": "https://floguardfl.com",
              "logo": "https://floguardfl.com/images/logo-schema.png",
              "address": {
                "@type": "PostalAddress",
                "streetAddress": "5114 S Ridgewood Ave",
                "addressLocality": "Port Orange",
                "addressRegion": "FL",
                "postalCode": "32127",
                "addressCountry": "US"
              },
              "telephone": "(386) 259-0023"
            },
            {
              "@type": "Service",
              "serviceType": "Exterior French Drains",
              "provider": { "@id": "https://floguardfl.com/#organization" },
              "areaServed": ["Port Orange", "Daytona Beach", "Orlando", "Central Florida"],
              "description": "Perimeter French drain systems with perforated pipe in gravel and filter fabric to protect foundations from groundwater and runoff."
            },
            {
              "@type": "Service",
              "serviceType": "Interior Drains + Sump Pumps",
              "provider": { "@id": "https://floguardfl.com/#organization" },
              "areaServed": ["Port Orange", "Daytona Beach", "Orlando", "Central Florida"],
              "description": "Interior drainage systems and automatic sump pumps for crawlspaces and flat lots with high water tables."
            }
          ]
        }}
      />
      <PageHero
        overline="Services & Solutions"
        title="Every drainage problem has a custom fix."
        subtitle="Exterior French drains, interior sump systems, yard drainage & grading, plus ongoing pump maintenance. We install the right combination for Central Florida homes."
        image="/images/case1-after.webp"
        primary={{ label: "Request an assessment", to: "/contact" }}
      />

      <StatsBar />

      {/* Bento grid overview */}
      <section data-testid="services-overview" className="section bg-background">
        <div className="container-fg">
          <Reveal className="mb-14 max-w-2xl">
            <p className="overline mb-5">Core solutions</p>
            <h2 className="font-display text-4xl sm:text-5xl tracking-tight text-brand-navy leading-tight">
              Systems that work together.
            </h2>
          </Reveal>
          <ServicesGrid />
        </div>
      </section>

      {/* Accordion detail */}
      <section data-testid="services-detail" className="section bg-secondary">
        <div className="container-fg grid lg:grid-cols-12 gap-12">
          <div className="lg:col-span-4">
            <Reveal>
              <p className="overline mb-5">In detail</p>
              <h2 className="font-display text-4xl sm:text-5xl tracking-tight text-brand-navy leading-tight">
                Explore each service.
              </h2>
              <p className="mt-5 text-brand-slate text-lg">Tap any service to see how it protects your home.</p>
            </Reveal>
          </div>
          <div className="lg:col-span-8">
            {SERVICES.map((s, i) => (
              <Accordion
                key={s.id}
                service={s}
                index={i}
                open={open === s.id}
                onToggle={() => setOpen(open === s.id ? null : s.id)}
              />
            ))}
          </div>
        </div>
      </section>

      {/* How these services work together — link out to avoid duplication with /process */}
      <section className="section bg-background border-t border-border">
        <div className="container-fg max-w-3xl">
          <Reveal>
            <p className="overline mb-5">Engineered as one system</p>
            <h2 className="font-display text-3xl sm:text-4xl tracking-tight text-brand-navy">
              Our services combine into a complete French drain + sump pump solution.
            </h2>
            <p className="mt-4 text-lg text-brand-slate">
              The water path, Florida-specific challenges, what it protects (and what it doesn&apos;t), plus our 4-step installation process are explained in detail on the How It Works page.
            </p>
          </Reveal>
          <div className="mt-8">
            <Link to="/process" className="inline-flex items-center gap-2 text-brand-navy font-bold link-underline">
              See exactly how it works <ArrowUpRight size={18} />
            </Link>
          </div>
        </div>
      </section>

      <FinalCTA />
    </>
  );
}
