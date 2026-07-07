import { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MapPin, ArrowRight, X } from "lucide-react";
import { PageHero } from "../components/PageHero";
import { Reveal } from "../components/Reveal";
import { FinalCTA } from "../components/FinalCTA";
import { CASE_STUDIES, CASE_FILTERS, IMAGES } from "../data/site";
import { EASE } from "../lib/animations";

/* Draggable before/after comparison slider */
function BeforeAfter({ before, after }) {
  const [pos, setPos] = useState(50);
  const ref = useRef(null);

  const move = (clientX) => {
    const rect = ref.current.getBoundingClientRect();
    const p = ((clientX - rect.left) / rect.width) * 100;
    setPos(Math.max(0, Math.min(100, p)));
  };

  return (
    <div
      ref={ref}
      data-testid="before-after-slider"
      className="relative w-full h-[280px] md:h-[420px] overflow-hidden rounded-sm select-none cursor-ew-resize"
      onMouseMove={(e) => e.buttons === 1 && move(e.clientX)}
      onClick={(e) => move(e.clientX)}
      onTouchMove={(e) => move(e.touches[0].clientX)}
    >
      <img src={after} alt="After FloGuard" className="absolute inset-0 w-full h-full object-cover" />
      <div className="absolute inset-0 overflow-hidden" style={{ width: `${pos}%` }}>
        <img src={before} alt="Before FloGuard" className="absolute inset-0 h-full object-cover" style={{ width: ref.current?.offsetWidth || "100%", maxWidth: "none" }} />
        <span className="absolute top-4 left-4 bg-brand-ink/80 text-white text-xs font-bold uppercase tracking-widest px-3 py-1.5 rounded-sm">Before</span>
      </div>
      <span className="absolute top-4 right-4 bg-brand-orange text-white text-xs font-bold uppercase tracking-widest px-3 py-1.5 rounded-sm">After</span>
      <div className="absolute top-0 bottom-0 w-0.5 bg-white" style={{ left: `${pos}%` }}>
        <span className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-9 h-9 rounded-full bg-white flex items-center justify-center shadow-lg">
          <ArrowRight size={14} className="text-brand-navy -mr-1" />
          <ArrowRight size={14} className="text-brand-navy rotate-180 -ml-1" />
        </span>
      </div>
    </div>
  );
}

export default function CaseStudies() {
  const [filter, setFilter] = useState("All");
  const [active, setActive] = useState(null);
  const list = filter === "All" ? CASE_STUDIES : CASE_STUDIES.filter((c) => c.category === filter);

  return (
    <>
      <PageHero
        overline="Results & Case Studies"
        title="From swamped to bone dry."
        subtitle="Real Central Florida properties we've protected. Drag the slider to see the transformation."
        image={IMAGES.afterDry}
        primary={{ label: "Get your transformation", to: "/contact" }}
      />

      <section data-testid="case-studies-grid" className="section bg-background">
        <div className="container-fg">
          {/* filters */}
          <div className="flex flex-wrap gap-3 mb-12">
            {CASE_FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                data-testid={`filter-${f.toLowerCase().replace(/\W+/g, "-")}`}
                className={`px-5 py-2.5 text-sm font-medium rounded-full border transition-colors ${
                  filter === f
                    ? "bg-brand-navy text-white border-brand-navy"
                    : "border-border text-brand-slate hover:border-brand-navy"
                }`}
              >
                {f}
              </button>
            ))}
          </div>

          <motion.div layout className="grid md:grid-cols-2 gap-6">
            <AnimatePresence mode="popLayout">
              {list.map((c) => (
                <motion.article
                  key={c.id}
                  layout
                  data-testid={`case-card-${c.id}`}
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  transition={{ duration: 0.4, ease: EASE }}
                  onClick={() => setActive(c)}
                  className="group cursor-pointer bg-card border border-border rounded-sm overflow-hidden"
                  data-cursor="hover"
                >
                  <div className="relative h-64 overflow-hidden">
                    <img src={c.after} alt={c.title} className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" loading="lazy" />
                    <div className="absolute inset-0 bg-gradient-to-t from-brand-ink/70 to-transparent" />
                    <span className="absolute top-4 left-4 text-xs font-bold uppercase tracking-widest text-white bg-brand-orange px-3 py-1 rounded-sm">{c.category}</span>
                  </div>
                  <div className="p-7">
                    <div className="flex items-center gap-2 text-sm text-brand-slate/70 mb-2">
                      <MapPin size={14} className="text-brand-orange" /> {c.location}
                    </div>
                    <h3 className="font-display text-2xl tracking-tight text-brand-navy">{c.title}</h3>
                    <p className="mt-3 text-brand-slate leading-relaxed">{c.summary}</p>
                    <span className="mt-5 inline-flex items-center gap-2 text-brand-navy font-bold text-sm">
                      View before / after <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
                    </span>
                  </div>
                </motion.article>
              ))}
            </AnimatePresence>
          </motion.div>
        </div>
      </section>

      {/* Modal */}
      <AnimatePresence>
        {active && (
          <motion.div
            data-testid="case-modal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setActive(null)}
            className="fixed inset-0 z-[80] bg-brand-ink/80 backdrop-blur-sm flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ opacity: 0, y: 30, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 30, scale: 0.97 }}
              transition={{ duration: 0.4, ease: EASE }}
              onClick={(e) => e.stopPropagation()}
              className="bg-background rounded-sm max-w-4xl w-full max-h-[90vh] overflow-y-auto"
            >
              <div className="relative">
                <button
                  onClick={() => setActive(null)}
                  data-testid="case-modal-close"
                  className="absolute top-4 right-4 z-10 w-10 h-10 rounded-full bg-brand-ink/70 text-white flex items-center justify-center hover:bg-brand-orange transition-colors"
                >
                  <X size={18} />
                </button>
                <BeforeAfter before={active.before} after={active.after} />
              </div>
              <div className="p-8">
                <div className="flex items-center gap-2 text-sm text-brand-slate/70 mb-2">
                  <MapPin size={14} className="text-brand-orange" /> {active.location} · {active.category}
                </div>
                <h3 className="font-display text-3xl tracking-tight text-brand-navy">{active.title}</h3>
                <p className="mt-4 text-lg text-brand-slate leading-relaxed">{active.summary}</p>
                <div className="mt-6 p-5 bg-secondary rounded-sm border-l-2 border-brand-orange">
                  <span className="overline">Result</span>
                  <p className="mt-1 text-brand-navy font-medium text-lg">{active.result}</p>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <FinalCTA />
    </>
  );
}
