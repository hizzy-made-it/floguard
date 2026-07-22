import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Phone, ArrowUpRight } from "lucide-react";
import { COMPANY } from "../data/site";
import { Reveal } from "./Reveal";
import { EASE } from "../lib/animations";

export const FinalCTA = () => (
  <section data-testid="final-cta" className="relative bg-brand-ink text-white overflow-hidden grain">
    <div className="container-fg relative z-10 py-16 sm:py-24 md:py-32 grid lg:grid-cols-12 gap-8 sm:gap-12 items-center min-w-0">
      <div className="lg:col-span-7 min-w-0">
        <Reveal>
          <p className="overline mb-5 text-brand-orange">Your home deserves to stay dry</p>
          <h2 className="font-display text-3xl sm:text-5xl lg:text-6xl tracking-[-1px] leading-[0.95] max-w-2xl break-words">
            One engineered system.<br />Years of quiet protection.
          </h2>
          <p className="mt-5 sm:mt-6 text-base sm:text-lg text-white/65 max-w-xl">
            Free on-site assessment. Custom design. Invisible install. 15-year warranty-backed.
          </p>
        </Reveal>
      </div>
      <div className="lg:col-span-5 flex flex-col gap-3 min-w-0">
        <Link
          to="/contact"
          data-testid="cta-assessment"
          className="group flex items-center justify-between gap-3 bg-brand-orange text-white px-5 sm:px-8 py-4 sm:py-5 rounded-sm font-bold uppercase tracking-wider text-sm hover:bg-brand-orangeDark active:scale-[0.985] transition-all min-h-[52px]"
        >
          Request free assessment
          <ArrowUpRight size={20} className="shrink-0 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
        </Link>
        <a
          href={COMPANY.phoneHref}
          data-testid="cta-phone"
          className="flex items-center justify-between gap-3 border border-white/20 text-white px-5 sm:px-8 py-4 sm:py-5 rounded-sm font-bold uppercase tracking-wider text-sm hover:bg-white/5 transition-colors min-h-[52px]"
        >
          <span className="truncate">Call {COMPANY.phone}</span>
          <Phone size={18} className="shrink-0" />
        </a>
      </div>
    </div>
  </section>
);
