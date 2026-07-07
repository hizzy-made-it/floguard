import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Star, ArrowLeft, ArrowRight, Quote } from "lucide-react";
import { TESTIMONIALS } from "../data/site";
import { EASE } from "../lib/animations";
import { Reveal } from "./Reveal";

export const Testimonials = () => {
  const [[idx, dir], setIdx] = useState([0, 0]);
  const paginate = (d) => setIdx(([i]) => [(i + d + TESTIMONIALS.length) % TESTIMONIALS.length, d]);
  const t = TESTIMONIALS[idx];

  return (
    <section data-testid="testimonials" className="section bg-brand-ink text-white grain relative overflow-hidden">
      <div className="container-fg relative z-10">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 mb-14">
          <Reveal>
            <p className="overline mb-4">Trusted by neighbors</p>
            <h2 className="font-display text-4xl sm:text-5xl tracking-tight max-w-xl">
              5.0 stars from Central Florida homeowners.
            </h2>
          </Reveal>
          <div className="flex gap-3">
            <button
              onClick={() => paginate(-1)}
              data-testid="testimonial-prev"
              aria-label="Previous testimonial"
              className="w-12 h-12 rounded-sm border border-white/20 flex items-center justify-center hover:bg-white/10 transition-colors"
            >
              <ArrowLeft size={18} />
            </button>
            <button
              onClick={() => paginate(1)}
              data-testid="testimonial-next"
              aria-label="Next testimonial"
              className="w-12 h-12 rounded-sm border border-white/20 flex items-center justify-center hover:bg-white/10 transition-colors"
            >
              <ArrowRight size={18} />
            </button>
          </div>
        </div>

        <div className="relative min-h-[240px]">
          <AnimatePresence mode="wait" custom={dir}>
            <motion.blockquote
              key={idx}
              custom={dir}
              initial={{ opacity: 0, x: dir >= 0 ? 60 : -60 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: dir >= 0 ? -60 : 60 }}
              transition={{ duration: 0.5, ease: EASE }}
              className="max-w-4xl"
              data-testid="testimonial-card"
            >
              <Quote className="text-brand-orange mb-6" size={40} />
              <p className="font-display text-2xl sm:text-3xl leading-snug text-white/90">"{t.quote}"</p>
              <div className="mt-8 flex items-center gap-4">
                <div className="flex gap-1">
                  {Array.from({ length: t.rating }).map((_, i) => (
                    <Star key={i} size={16} className="fill-brand-orange text-brand-orange" />
                  ))}
                </div>
                <span className="text-white/80 font-medium">{t.name}</span>
                <span className="text-white/40 text-sm">· {t.location}</span>
              </div>
            </motion.blockquote>
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
};
