import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Minus, Check } from "lucide-react";
import { PageHero } from "../components/PageHero";
import { Seo } from "../components/Seo";
import { Reveal } from "../components/Reveal";
import { ServicesGrid } from "../components/ServicesGrid";
import { FlowPath } from "../components/FlowPath";
import { FinalCTA } from "../components/FinalCTA";
import { SERVICES, IMAGES } from "../data/site";
import { EASE } from "../lib/animations";

function Accordion({ service, open, onToggle, index }) {
  return (
    <div data-testid={`service-accordion-${service.id}`} className="border-b border-border">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-6 py-7 text-left group"
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
      <Seo title="Drainage Services — French Drains, Sump Pumps & Yard Drainage | FloGuard" description="Exterior & interior French drains, sump pump systems, yard drainage, catch basins and maintenance plans for Central Florida homes." path="/services" />
      <PageHero
        overline="Services & Solutions"
        title="Every drainage problem has a custom fix."
        subtitle="From exterior French drains to interior sump systems and yard grading — we install the right combination for your property, not a one-size-fits-all kit."
        image={IMAGES.frenchDrain}
        primary={{ label: "Request an assessment", to: "/contact" }}
      />

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

      {/* How it works centerpiece */}
      <section data-testid="services-how" className="section bg-brand-ink grain relative">
        <div className="container-fg relative z-10">
          <Reveal className="mb-14 max-w-2xl">
            <p className="overline mb-5">How it works</p>
            <h2 className="font-display text-4xl sm:text-5xl tracking-tight text-white leading-tight">
              One controlled path for every drop.
            </h2>
          </Reveal>
          <FlowPath dark />
        </div>
      </section>

      <FinalCTA />
    </>
  );
}
