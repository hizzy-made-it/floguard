import { Suspense, lazy } from "react";
import { motion } from "framer-motion";
import { Phone, MessageSquare, Mail, MapPin, Clock } from "lucide-react";
import { Reveal } from "../components/Reveal";
import { LeadForm } from "../components/LeadForm";
import { Seo } from "../components/Seo";
import { ThreeBoundary } from "../components/ThreeBoundary";
import { COMPANY } from "../data/site";
import { wordContainer, wordChild, fadeUp, EASE } from "../lib/animations";

const MiniShield = lazy(() => import("../components/three/MiniShield"));

const contactItems = [
  { icon: Phone, label: "Call", value: COMPANY.phone, href: COMPANY.phoneHref },
  { icon: MessageSquare, label: "Text", value: "Message us anytime", href: COMPANY.smsHref },
  { icon: Mail, label: "Email", value: COMPANY.email, href: COMPANY.emailHref },
];

export default function Contact() {
  const title = "Request your free assessment.".split(" ");
  return (
    <>
      <Seo title="Contact FloGuard — Request a Free Drainage Assessment | Central Florida" description="Book a free, on-site drainage assessment. Call (386) 259-0023 or request an inspection online. Serving Daytona, Port Orange, Sanford & Orlando." path="/contact" />
      {/* Animated hero (no full 3D) */}
      <section data-testid="contact-hero" className="relative bg-brand-ink text-white grain overflow-hidden pt-36 pb-16">
        <div className="container-fg relative z-10 grid lg:grid-cols-12 gap-10 items-center">
          <div className="lg:col-span-8">
            <motion.p initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: EASE }} className="overline mb-5">
              Contact FloGuard
            </motion.p>
            <motion.h1 initial={{ opacity: 0, y: 24, filter: "blur(10px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} transition={{ duration: 0.9, ease: EASE, delay: 0.12 }} className="font-display text-5xl sm:text-6xl lg:text-7xl tracking-tight leading-[0.95]">
              Request your <span className="text-brand-orange">free</span> assessment.
            </motion.h1>
            <motion.p variants={fadeUp} initial="hidden" animate="visible" transition={{ delay: 0.5 }} className="mt-6 text-lg text-white/70 max-w-xl">
              No obligation, no pressure — just a clear plan to keep your Florida home dry. We typically respond within 24 hours.
            </motion.p>
          </div>
          <div className="lg:col-span-4 h-52 lg:h-64 rounded-sm overflow-hidden border border-white/10">
            <Suspense fallback={<div className="w-full h-full bg-brand-surface" />}>
              <ThreeBoundary fallback={<div className="w-full h-full bg-brand-surface flex items-center justify-center text-white/20 font-display text-3xl">FloGuard</div>}>
                <MiniShield />
              </ThreeBoundary>
            </Suspense>
          </div>
        </div>
      </section>

      {/* Contact methods */}
      <section className="bg-brand-ink border-t border-white/10">
        <div className="container-fg grid sm:grid-cols-3 gap-5 py-10">
          {contactItems.map((c) => (
            <a
              key={c.label}
              href={c.href}
              data-testid={`contact-${c.label.toLowerCase()}`}
              className="group flex items-center gap-4 border border-white/10 rounded-sm p-5 hover:border-brand-orange transition-colors"
            >
              <c.icon size={22} className="text-brand-orange shrink-0" />
              <div>
                <div className="text-xs uppercase tracking-widest text-white/40">{c.label}</div>
                <div className="text-white font-medium">{c.value}</div>
              </div>
            </a>
          ))}
        </div>
      </section>

      {/* Form + map */}
      <section data-testid="contact-form-section" className="section bg-brand-ink grain relative">
        <div className="container-fg relative z-10 grid lg:grid-cols-12 gap-10 items-start">
          <div className="lg:col-span-7">
            <LeadForm />
          </div>
          <div className="lg:col-span-5 space-y-6">
            <Reveal className="rounded-sm overflow-hidden border border-white/10">
              <iframe
                title="FloGuard location map"
                src={COMPANY.mapEmbed}
                data-testid="contact-map"
                className="w-full h-64 grayscale-[0.3]"
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
              />
            </Reveal>
            <div className="border border-white/10 rounded-sm p-6 space-y-4 text-white/70">
              <div className="flex items-start gap-3">
                <MapPin size={18} className="text-brand-orange shrink-0 mt-0.5" /> {COMPANY.address}
              </div>
              <div className="flex items-center gap-3">
                <Clock size={18} className="text-brand-orange shrink-0" /> {COMPANY.hours}
              </div>
              <div className="flex items-center gap-3">
                <Phone size={18} className="text-brand-orange shrink-0" /> {COMPANY.phone}
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
