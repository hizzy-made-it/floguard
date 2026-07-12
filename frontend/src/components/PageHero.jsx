import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { wordContainer, wordChild, fadeUp, EASE } from "../lib/animations";

// Animated hero for non-3D pages. Cinematic dark base with image + Framer motion.
export const PageHero = ({ overline, title, subtitle, image, primary, secondary, align = "left" }) => {
  return (
    <section
      data-testid="page-hero"
      className="relative min-h-[72vh] flex items-end overflow-hidden bg-brand-ink text-white grain"
    >
      {image && (
        <motion.img
          src={image}
          alt=""
          role="presentation"
          initial={{ scale: 1.12 }}
          animate={{ scale: 1 }}
          transition={{ duration: 2, ease: EASE }}
          className="absolute inset-0 w-full h-full object-cover"
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-brand-ink via-brand-ink/60 to-brand-ink/15" />
      <div className="absolute inset-0 bg-gradient-to-r from-brand-ink/75 via-brand-ink/15 to-transparent" />
      <div className="absolute inset-0 bg-[radial-gradient(#ffffff_0.6px,transparent_1px)] bg-[length:3px_3px] opacity-[0.035]" />

      <div className={`container-fg relative z-10 pb-16 pt-40 ${align === "center" ? "text-center mx-auto" : ""}`}>
        {overline && (
          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: EASE }}
            className="overline mb-5"
          >
            {overline}
          </motion.p>
        )}
        <motion.h1
          initial={{ opacity: 0, y: 24, filter: "blur(10px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ duration: 0.9, ease: EASE, delay: 0.12 }}
          className="font-display text-5xl sm:text-6xl lg:text-7xl tracking-[-1.2px] leading-[0.92] max-w-4xl"
        >
          {title}
        </motion.h1>
        {subtitle && (
          <motion.p
            variants={fadeUp}
            initial="hidden"
            animate="visible"
            transition={{ delay: 0.5 }}
            className="mt-6 text-lg text-white/70 max-w-xl leading-relaxed"
          >
            {subtitle}
          </motion.p>
        )}
        {(primary || secondary) && (
          <motion.div
            variants={fadeUp}
            initial="hidden"
            animate="visible"
            transition={{ delay: 0.65 }}
            className="mt-9 flex flex-wrap gap-4"
          >
            {primary && (
              <Link
                to={primary.to}
                data-testid="hero-primary-cta"
                className="inline-flex items-center bg-brand-orange text-white px-8 py-4 text-sm font-bold uppercase tracking-wider rounded-sm hover:bg-brand-orangeDark transition-colors"
              >
                {primary.label}
              </Link>
            )}
            {secondary && (
              <Link
                to={secondary.to}
                data-testid="hero-secondary-cta"
                className="inline-flex items-center border border-white/25 text-white px-8 py-4 text-sm font-bold uppercase tracking-wider rounded-sm hover:bg-white/10 transition-colors"
              >
                {secondary.label}
              </Link>
            )}
          </motion.div>
        )}
      </div>
    </section>
  );
};
