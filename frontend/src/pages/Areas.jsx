import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { MapPin, ArrowUpRight } from "lucide-react";
import { PageHero } from "../components/PageHero";
import { Reveal } from "../components/Reveal";
import { FinalCTA } from "../components/FinalCTA";
import { CITIES } from "../data/cities";
import { IMAGES } from "../data/site";
import { EASE, viewportOnce } from "../lib/animations";
import { Seo } from "../components/Seo";

export default function Areas() {
  return (
    <>
      <Seo
        title="Areas We Serve — Drainage & French Drains Across Central Florida | FloGuard"
        description="FloGuard installs French drain and sump pump systems across Daytona Beach, Port Orange, Sanford, Orlando and the Central Florida corridor. Free assessments."
        path="/areas"
      />
      <PageHero
        overline="Areas We Serve"
        title="Drainage experts across Central Florida."
        subtitle="From the coast to the Orlando corridor, FloGuard designs and installs drainage systems built for your city's soil, water table, and storms."
        image={IMAGES.landscaped}
        primary={{ label: "Request a free assessment", to: "/contact" }}
      />

      <section className="section bg-background">
        <div className="container-fg">
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {CITIES.map((c, i) => (
              <motion.div
                key={c.slug}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={viewportOnce}
                transition={{ duration: 0.5, ease: EASE, delay: (i % 3) * 0.06 }}
              >
                <Link to={`/areas/${c.slug}`} data-testid={`area-card-${c.slug}`} className="group block bg-card border border-border rounded-sm overflow-hidden h-full">
                  <div className="relative h-48 overflow-hidden">
                    <img src={c.image} alt={c.name} className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" loading="lazy" />
                    <div className="absolute inset-0 bg-gradient-to-t from-brand-ink/80 to-transparent" />
                    <div className="absolute bottom-4 left-4">
                      <div className="flex items-center gap-2 text-white/70 text-xs uppercase tracking-widest"><MapPin size={12} className="text-brand-orange" /> {c.county}</div>
                      <h3 className="font-display text-2xl text-white tracking-tight mt-1">{c.name}</h3>
                    </div>
                  </div>
                  <div className="p-6">
                    <p className="text-brand-slate text-sm leading-relaxed line-clamp-3">{c.intro}</p>
                    <span className="mt-4 inline-flex items-center gap-2 text-brand-navy font-bold text-sm">
                      Drainage in {c.name} <ArrowUpRight size={15} className="group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform" />
                    </span>
                  </div>
                </Link>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <FinalCTA />
    </>
  );
}
