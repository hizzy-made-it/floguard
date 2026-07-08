import { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MapPin, ArrowRight, X } from "lucide-react";
import { PageHero } from "../components/PageHero";
import { Seo } from "../components/Seo";
import { Reveal } from "../components/Reveal";
import { FinalCTA } from "../components/FinalCTA";
import { CASE_STUDIES, CASE_FILTERS, IMAGES } from "../data/site";
import { StatsBar } from "../components/StatsBar";
import { EASE } from "../lib/animations";

/* Signature premium before/after — draggable, keyboard, live %, following labels, polished handle */
function BeforeAfter({ before, after, title }) {
  const [pos, setPos] = useState(50);
  const ref = useRef(null);

  const clamp = (v) => Math.max(6, Math.min(94, v));

  const move = (clientX) => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const p = ((clientX - rect.left) / rect.width) * 100;
    setPos(clamp(p));
  };

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowLeft') setPos(p => clamp(p - 5));
    if (e.key === 'ArrowRight') setPos(p => clamp(p + 5));
    if (e.key === 'Home') setPos(6);
    if (e.key === 'End') setPos(94);
    if (e.key.toLowerCase() === 'r') setPos(50);
  };

  const reset = () => setPos(50);

  const beforeLabelStyle = {
    left: `calc(${pos}% - 60px)`,
  };

  return (
    <div
      ref={ref}
      data-testid="before-after-slider"
      className="group relative w-full h-[260px] sm:h-[320px] md:h-[480px] overflow-hidden rounded-sm select-none cursor-ew-resize shadow-2xl ring-1 ring-black/5 focus:outline-none focus:ring-2 focus:ring-brand-orange/60 touch-pan-x"
      tabIndex={0}
      onMouseMove={(e) => e.buttons === 1 && move(e.clientX)}
      onClick={(e) => move(e.clientX)}
      onTouchMove={(e) => move(e.touches[0].clientX)}
      onKeyDown={handleKeyDown}
      onDoubleClick={reset}
      aria-label={`Before and after comparison for ${title || 'project'}. Drag, use arrow keys, or double-click to reset.`}
    >
      {/* After (full) */}
      <img src={after} alt="After FloGuard" className="absolute inset-0 w-full h-full object-cover" />

      {/* Before (clipped) */}
      <div className="absolute inset-0 overflow-hidden" style={{ width: `${pos}%` }}>
        <img 
          src={before} 
          alt="Before FloGuard" 
          className="absolute inset-0 h-full object-cover" 
          style={{ width: ref.current ? `${ref.current.offsetWidth}px` : '100%', maxWidth: 'none' }} 
        />
        {/* Moving Before label */}
        <span 
          className="absolute top-4 bg-black/80 text-white text-[10px] font-bold uppercase tracking-[1.5px] px-3 py-1 rounded-sm border border-white/30 transition-all"
          style={beforeLabelStyle}
        >
          Before
        </span>
      </div>

      {/* After label fixed */}
      <span className="absolute top-4 right-4 bg-brand-orange text-white text-[10px] font-bold uppercase tracking-[1.5px] px-3 py-1 rounded-sm shadow">After</span>

      {/* Elegant vertical divider + premium handle */}
      <div 
        className="absolute top-0 bottom-0 w-[2px] bg-white/95 shadow-[0_0_0_1px_rgba(0,0,0,0.2)] pointer-events-none" 
        style={{ left: `${pos}%` }}
      >
        {/* Large polished handle */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white shadow-xl flex items-center justify-center ring-1 ring-black/10 group-hover:scale-105 transition-transform">
          <div className="flex items-center gap-0.5 text-brand-navy">
            <ArrowRight size={16} className="-mr-0.5" />
            <ArrowRight size={16} className="rotate-180" />
          </div>
        </div>
        {/* Live percentage */}
        <div className="absolute -top-7 left-1/2 -translate-x-1/2 bg-brand-ink text-white text-[10px] font-mono px-2 py-0.5 rounded border border-white/20 tabular-nums">
          {Math.round(pos)}%
        </div>
      </div>

      {/* Subtle hint */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 text-[9px] uppercase tracking-[2px] text-white/40 bg-black/40 px-2 py-px rounded pointer-events-none">
        drag • arrows • double-tap reset
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
      <Seo title="Results & Case Studies — Before & After Drainage Projects | FloGuard" description="See real Central Florida yards transformed from flooded to bone dry. Drag the before/after slider on our French drain and sump pump projects." path="/case-studies" />
      <PageHero
        overline="Results & Case Studies"
        title="From swamped to bone dry."
        subtitle="Real Central Florida properties we've protected with French drain + sump pump systems. Drag the slider to see the transformation from flooded to dry."
        image="/images/landscaped.jpg"
        primary={{ label: "Get your transformation", to: "/contact" }}
      />

      <StatsBar />

      <section data-testid="case-studies-grid" className="section bg-background">
        <div className="container-fg">
          {/* filters - premium pills */}
          <div className="flex flex-wrap gap-3 mb-14">
            {CASE_FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                data-testid={`filter-${f.toLowerCase().replace(/\W+/g, "-")}`}
                className={`px-6 py-2.5 text-sm font-medium rounded-full border transition-all ${
                  filter === f
                    ? "bg-brand-navy text-white border-brand-navy shadow-sm"
                    : "border-border text-brand-slate hover:border-brand-navy hover:text-brand-navy"
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
                    <img src={c.after} alt={c.title} className="w-full h-full object-cover transition-all duration-700 group-hover:scale-[1.03] group-hover:brightness-[0.92]" loading="lazy" />
                    <div className="absolute inset-0 bg-gradient-to-t from-brand-ink/75 via-brand-ink/30 to-transparent" />
                    <span className="absolute top-4 left-4 text-xs font-bold uppercase tracking-[1px] text-white bg-brand-orange px-3 py-1 rounded-sm">{c.category}</span>
                  </div>
                  <div className="p-7">
                    <div className="flex items-center gap-2 text-sm text-brand-slate/70 mb-2">
                      <MapPin size={14} className="text-brand-orange" /> {c.location}
                    </div>
                    <h3 className="font-display text-2xl tracking-tight text-brand-navy group-hover:text-brand-orange transition-colors">{c.title}</h3>
                    <p className="mt-3 text-brand-slate leading-relaxed line-clamp-3">{c.summary}</p>
                    <div className="mt-6 inline-flex items-center gap-2 text-brand-navy font-bold text-sm border-b border-transparent group-hover:border-brand-orange pb-0.5 transition-all">
                      View transformation <ArrowRight size={16} className="group-hover:translate-x-0.5 transition-transform" />
                    </div>
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
                <BeforeAfter before={active.before} after={active.after} title={active.title} />
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
