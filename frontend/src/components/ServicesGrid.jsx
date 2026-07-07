import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowUpRight, Check } from "lucide-react";
import { SERVICES } from "../data/site";
import { viewportOnce, EASE } from "../lib/animations";

// Asymmetric bento grid — no identical 3-column rows.
const spanClass = {
  wide: "md:col-span-7",
  tall: "md:col-span-5",
};

export const ServicesGrid = () => (
  <div data-testid="services-grid" className="grid md:grid-cols-12 gap-5 md:gap-6">
    {SERVICES.map((s, i) => (
      <motion.article
        key={s.id}
        data-testid={`service-card-${s.id}`}
        initial={{ opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={viewportOnce}
        transition={{ duration: 0.7, ease: EASE, delay: (i % 2) * 0.1 }}
        className={`group relative overflow-hidden rounded-sm border border-border bg-card ${spanClass[s.span]}`}
      >
        <div className="relative h-56 md:h-64 overflow-hidden">
          <img
            src={s.image}
            alt={s.title}
            loading="lazy"
            className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-brand-ink/70 to-transparent" />
          <span className="absolute top-4 left-4 text-xs font-bold uppercase tracking-widest text-white/80">
            0{i + 1}
          </span>
        </div>
        <div className="p-7">
          <div className="flex items-start justify-between gap-4">
            <h3 className="font-display text-2xl tracking-tight text-brand-navy">{s.title}</h3>
            <ArrowUpRight className="text-brand-slate group-hover:text-brand-orange transition-colors shrink-0" size={22} />
          </div>
          <p className="mt-3 text-brand-slate leading-relaxed">{s.blurb}</p>
          <ul className="mt-5 space-y-2">
            {s.features.map((f) => (
              <li key={f} className="flex items-center gap-2.5 text-sm text-brand-slate">
                <Check size={15} className="text-brand-orange shrink-0" /> {f}
              </li>
            ))}
          </ul>
        </div>
        <Link
          to="/services"
          className="absolute inset-0"
          aria-label={`Learn more about ${s.title}`}
        />
      </motion.article>
    ))}
  </div>
);
