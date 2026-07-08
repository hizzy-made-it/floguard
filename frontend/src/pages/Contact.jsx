import { motion } from "framer-motion";
import { Phone, Star, ShieldCheck, Clock, MapPin, Check, ChevronDown } from "lucide-react";
import { useState } from "react";
import { Reveal } from "../components/Reveal";
import { AssessmentQuiz } from "../components/AssessmentQuiz";
import { Seo } from "../components/Seo";
import { COMPANY, IMAGES, LANDING_FAQ, TESTIMONIALS } from "../data/site";
import { StatsBar } from "../components/StatsBar";
import { fadeUp, EASE } from "../lib/animations";

const trustPoints = [
  { icon: Star, label: "5.0 Google rating" },
  { icon: ShieldCheck, label: "15-yr warranty-backed" },
  { icon: Clock, label: "24-hr response" },
  { icon: MapPin, label: "Central Florida local" },
];

const FaqItem = ({ q, a, idx }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-white/10">
      <button
        onClick={() => setOpen((o) => !o)}
        data-testid={`faq-toggle-${idx}`}
        className="w-full flex items-center justify-between gap-4 py-5 text-left"
      >
        <span className="text-white font-medium">{q}</span>
        <ChevronDown size={18} className={`text-brand-orange shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      <motion.div initial={false} animate={{ height: open ? "auto" : 0, opacity: open ? 1 : 0 }} transition={{ duration: 0.3, ease: EASE }} className="overflow-hidden">
        <p className="pb-5 text-white/60 leading-relaxed">{a}</p>
      </motion.div>
    </div>
  );
};

export default function Contact() {
  return (
    <>
      <Seo
        title="Free Florida Drainage Assessment — Stop Yard Flooding | FloGuard"
        description="Flooded yard or wet foundation? Answer a few quick questions and get a FREE on-site drainage assessment from FloGuard. Serving Daytona, Port Orange, Sanford & Orlando."
        path="/contact"
      />

      {/* ===== HERO + QUIZ ===== */}
      <section data-testid="landing-hero" className="relative bg-brand-ink text-white grain overflow-hidden pt-32 pb-16 lg:pt-40 lg:pb-24">
        <div className="pointer-events-none absolute -top-24 -left-24 w-[36rem] h-[36rem] rounded-full bg-brand-orange/10 blur-3xl" />
        <div className="container-fg relative z-10 grid lg:grid-cols-12 gap-12 items-start">
          {/* Left: value prop */}
          <div className="lg:col-span-5 lg:pt-6">
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: EASE }}>
              <p className="overline mb-5">Free · No obligation · 24-hr response</p>
              <h1 className="font-display text-5xl sm:text-6xl tracking-tight leading-[0.95]">
                Standing water <span className="text-brand-orange">wrecking</span> your Florida yard?
              </h1>
              <p className="mt-6 text-lg text-white/70 max-w-lg">
                Answer a few quick questions about your water problem and get a free, on-site drainage assessment —
                a clear plan and quote to keep your home dry through every storm.
              </p>

              <div className="mt-8 grid grid-cols-2 gap-3 max-w-md">
                {trustPoints.map((t) => (
                  <div key={t.label} className="flex items-center gap-2.5 text-sm text-white/75">
                    <t.icon size={17} className="text-brand-orange shrink-0" /> {t.label}
                  </div>
                ))}
              </div>

              <div className="mt-8 flex flex-wrap items-center gap-4">
                <a
                  href={COMPANY.phoneHref}
                  data-testid="landing-call"
                  className="inline-flex items-center gap-2 border border-white/25 text-white px-6 py-3.5 text-sm font-bold uppercase tracking-wider rounded-sm hover:bg-white/10 transition-colors"
                >
                  <Phone size={16} /> Call {COMPANY.phone}
                </a>
                <div className="flex items-center gap-1 text-brand-orange">
                  {[...Array(5)].map((_, i) => <Star key={i} size={16} className="fill-brand-orange" />)}
                  <span className="text-white/60 text-sm ml-2">Rated 5.0 by local homeowners</span>
                </div>
              </div>
            </motion.div>
          </div>

          {/* Right: quiz */}
          <div className="lg:col-span-7">
            <motion.div variants={fadeUp} initial="hidden" animate="visible" transition={{ delay: 0.2 }}>
              <AssessmentQuiz />
            </motion.div>
          </div>
        </div>
      </section>

      <StatsBar />

      {/* ===== PROOF ===== */}
      <section className="section bg-brand-ink border-t border-white/10 grain relative">
        <div className="container-fg grid lg:grid-cols-12 gap-12 items-center">
          <div className="lg:col-span-6">
            <Reveal className="grid grid-cols-2 gap-4">
              <div className="rounded-sm overflow-hidden border border-white/10">
                <img src="/images/contact-before.jpg" alt="Flooded Central Florida backyard with standing water before drainage work" className="w-full h-64 object-cover" loading="lazy" />
                <div className="bg-brand-surface text-xs uppercase tracking-widest text-white/50 px-3 py-2">Before</div>
              </div>
              <div className="rounded-sm overflow-hidden border border-white/10">
                <img src="/images/contact-after.jpg" alt="Dry, lush restored Central Florida yard after FloGuard French drain system" className="w-full h-64 object-cover" loading="lazy" />
                <div className="bg-brand-surface text-xs uppercase tracking-widest text-brand-orange px-3 py-2">After</div>
              </div>
            </Reveal>
          </div>
          <div className="lg:col-span-6">
            <Reveal>
              <p className="overline mb-5">Real Florida results</p>
              <h2 className="font-display text-4xl sm:text-5xl tracking-tight text-white leading-tight">
                From swamp to dry — usually within one storm.
              </h2>
              <ul className="mt-7 space-y-4">
                {[
                  "Custom-engineered for your soil, slope & water table",
                  "Clean install — your lawn is fully restored",
                  "Backed by a 15-year warranty design",
                  "Serving all of Central Florida",
                ].map((x) => (
                  <li key={x} className="flex items-start gap-3 text-white/80">
                    <span className="mt-1 shrink-0 w-5 h-5 grid place-items-center rounded-full bg-brand-orange">
                      <Check size={12} className="text-white" strokeWidth={3} />
                    </span>
                    {x}
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ===== TESTIMONIALS ===== */}
      <section className="section bg-brand-surface grain">
        <div className="container-fg">
          <Reveal><p className="overline mb-10">What homeowners say</p></Reveal>
          <div className="grid md:grid-cols-3 gap-5">
            {TESTIMONIALS.map((t, i) => (
              <Reveal key={t.name} delay={i * 0.08} className="bg-brand-ink border border-white/10 rounded-sm p-6">
                <div className="flex gap-1 text-brand-orange mb-4">
                  {[...Array(t.rating)].map((_, j) => <Star key={j} size={14} className="fill-brand-orange" />)}
                </div>
                <p className="text-white/80 leading-relaxed">"{t.quote}"</p>
                <div className="mt-5 text-sm"><span className="text-white font-medium">{t.name}</span><span className="text-white/40"> · {t.location}</span></div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ===== FAQ ===== */}
      <section className="section bg-brand-ink grain relative">
        <div className="container-fg relative z-10 grid lg:grid-cols-12 gap-12">
          <div className="lg:col-span-4">
            <Reveal>
              <p className="overline mb-5">Common questions</p>
              <h2 className="font-display text-4xl tracking-tight text-white leading-tight">Everything you're wondering.</h2>
              <a href={COMPANY.phoneHref} className="mt-6 inline-flex items-center gap-2 text-brand-orange font-semibold hover:underline">
                <Phone size={18} /> Or just call {COMPANY.phone}
              </a>
            </Reveal>
          </div>
          <div className="lg:col-span-8">
            {LANDING_FAQ.map((f, i) => <FaqItem key={f.q} q={f.q} a={f.a} idx={i} />)}
          </div>
        </div>
      </section>

      {/* ===== sticky mobile CTA ===== */}
      <a
        href={COMPANY.phoneHref}
        data-testid="sticky-call"
        className="lg:hidden fixed bottom-4 inset-x-4 z-40 inline-flex items-center justify-center gap-2 bg-brand-orange text-white py-4 text-sm font-bold uppercase tracking-wider rounded-sm shadow-lg"
      >
        <Phone size={16} /> Call FloGuard now
      </a>
    </>
  );
}
