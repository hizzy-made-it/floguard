import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Phone, ArrowUpRight } from "lucide-react";
import { COMPANY } from "../data/site";
import { Reveal } from "./Reveal";
import { EASE } from "../lib/animations";

export const FinalCTA = () => (
  <section data-testid="final-cta" className="relative bg-brand-ink text-white overflow-hidden grain">
    <div className="container-fg relative z-10 py-24 md:py-32 grid lg:grid-cols-12 gap-12 items-center">
      <div className="lg:col-span-7">
        <Reveal>
          <p className="overline mb-5 text-brand-orange">Your home deserves to stay dry</p>
          <h2 className="font-display text-4xl sm:text-5xl lg:text-6xl tracking-[-1px] leading-[0.95] max-w-2xl">
            One engineered system.<br />Years of quiet protection.
          </h2>
          <p className="mt-6 text-lg text-white/65 max-w-xl">
            Free on-site assessment. Custom design. Invisible install. 15-year warranty-backed.
          </p>
        </Reveal>
      </div>
      <div className="lg:col-span-5 flex flex-col gap-3">
        <Link
          to="/contact"
          data-testid="cta-assessment"
          className="group flex items-center justify-between bg-brand-orange text-white px-8 py-5 rounded-sm font-bold uppercase tracking-wider text-sm hover:bg-brand-orangeDark active:scale-[0.985] transition-all"
        >
          Request free assessment
          <ArrowUpRight size={20} className="group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
        </Link>
        <a
          href={COMPANY.phoneHref}
          data-testid="cta-phone"
          className="flex items-center justify-between border border-white/20 text-white px-8 py-5 rounded-sm font-bold uppercase tracking-wider text-sm hover:bg-white/5 transition-colors"
        >
          Call {COMPANY.phone}
          <Phone size={18} />
        </a>
      </div>
    </div>
  </section>
);
