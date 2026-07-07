import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Phone, ArrowUpRight } from "lucide-react";
import { COMPANY } from "../data/site";
import { Reveal } from "./Reveal";
import { EASE } from "../lib/animations";

export const FinalCTA = () => (
  <section data-testid="final-cta" className="relative bg-brand-navy text-white overflow-hidden">
    <div className="absolute -right-32 -top-32 w-[500px] h-[500px] rounded-full border border-white/10" />
    <div className="absolute -right-10 top-20 w-[320px] h-[320px] rounded-full border border-white/10" />
    <div className="container-fg relative z-10 py-24 md:py-32 grid lg:grid-cols-12 gap-10 items-center">
      <div className="lg:col-span-8">
        <Reveal>
          <p className="overline mb-5">Stop flooding your yard</p>
          <h2 className="font-display text-4xl sm:text-5xl lg:text-6xl tracking-tight leading-[0.98] max-w-2xl">
            Get a dry yard and a protected foundation.
          </h2>
          <p className="mt-6 text-lg text-white/70 max-w-xl">
            Book a free, no-pressure on-site assessment. We'll map your water problem and design a system built for
            Florida storms.
          </p>
        </Reveal>
      </div>
      <div className="lg:col-span-4 flex flex-col gap-4">
        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.7, ease: EASE }}>
          <Link
            to="/contact"
            data-testid="cta-assessment"
            className="group flex items-center justify-between bg-brand-orange text-white px-7 py-5 rounded-sm font-bold uppercase tracking-wider text-sm hover:bg-brand-orangeDark transition-colors"
          >
            Request a drainage assessment
            <ArrowUpRight size={20} className="group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform" />
          </Link>
          <a
            href={COMPANY.phoneHref}
            data-testid="cta-phone"
            className="mt-4 flex items-center justify-between border border-white/25 text-white px-7 py-5 rounded-sm font-bold uppercase tracking-wider text-sm hover:bg-white/10 transition-colors"
          >
            Call {COMPANY.phone}
            <Phone size={18} />
          </a>
        </motion.div>
      </div>
    </div>
  </section>
);
