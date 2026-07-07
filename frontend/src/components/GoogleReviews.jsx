import { motion } from "framer-motion";
import { Star } from "lucide-react";
import { TESTIMONIALS, COMPANY } from "../data/site";
import { Reveal } from "./Reveal";
import { viewportOnce, EASE } from "../lib/animations";

const GoogleG = () => (
  <svg width="22" height="22" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#4285F4" d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z" />
    <path fill="#34A853" d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z" />
    <path fill="#FBBC05" d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z" />
    <path fill="#EA4335" d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z" />
  </svg>
);

export const GoogleReviews = () => (
  <section data-testid="google-reviews" className="section bg-secondary">
    <div className="container-fg">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-8 mb-14">
        <Reveal>
          <p className="overline mb-5">Trusted by your neighbors</p>
          <h2 className="font-display text-4xl sm:text-5xl tracking-tight text-brand-navy leading-tight max-w-xl">
            Rated 5 stars by Central Florida homeowners.
          </h2>
        </Reveal>
        <Reveal className="shrink-0">
          <div className="flex items-center gap-4 bg-card border border-border rounded-sm px-6 py-4">
            <GoogleG />
            <div>
              <div className="flex items-center gap-2">
                <span className="font-display text-2xl text-brand-navy">{COMPANY.rating}</span>
                <div className="flex gap-0.5">
                  {Array.from({ length: 5 }).map((_, i) => <Star key={i} size={15} className="fill-brand-orange text-brand-orange" />)}
                </div>
              </div>
              <div className="text-xs text-brand-slate/70 mt-0.5">Google Reviews · {COMPANY.legal}</div>
            </div>
          </div>
        </Reveal>
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        {TESTIMONIALS.map((t, i) => (
          <motion.figure
            key={t.name}
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={viewportOnce}
            transition={{ duration: 0.6, ease: EASE, delay: i * 0.08 }}
            className="bg-card border border-border rounded-sm p-7 flex flex-col"
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-full bg-brand-navy text-white flex items-center justify-center font-display text-lg">
                  {t.name.charAt(0)}
                </div>
                <div>
                  <div className="font-medium text-brand-navy leading-tight">{t.name}</div>
                  <div className="text-xs text-brand-slate/60">{t.location}</div>
                </div>
              </div>
              <GoogleG />
            </div>
            <div className="flex gap-0.5 mb-3">
              {Array.from({ length: t.rating }).map((_, j) => <Star key={j} size={15} className="fill-brand-orange text-brand-orange" />)}
            </div>
            <blockquote className="text-brand-slate leading-relaxed flex-1">"{t.quote}"</blockquote>
            <figcaption className="mt-4 text-xs text-brand-slate/50">Posted on Google</figcaption>
          </motion.figure>
        ))}
      </div>
    </div>
  </section>
);
