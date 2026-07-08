import { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { motion, AnimatePresence, useScroll, useMotionValueEvent } from "framer-motion";
import { Menu, X, Phone } from "lucide-react";
import { NAV_LINKS, COMPANY, IMAGES } from "../data/site";
import { EASE } from "../lib/animations";

export const Navbar = () => {
  const [hidden, setHidden] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const { scrollY } = useScroll();
  const location = useLocation();

  useMotionValueEvent(scrollY, "change", (latest) => {
    const prev = scrollY.getPrevious() ?? 0;
    setScrolled(latest > 40);
    if (latest > prev && latest > 240) setHidden(true);
    else setHidden(false);
  });

  useEffect(() => setOpen(false), [location.pathname]);

  return (
    <motion.header
      data-testid="site-navbar"
      initial={{ y: -100 }}
      animate={{ y: hidden ? -120 : 0 }}
      transition={{ duration: 0.4, ease: EASE }}
      className={`fixed top-0 left-0 w-full z-50 transition-colors duration-300 ${
        scrolled ? "glass border-b border-white/10" : "bg-transparent"
      }`}
    >
      <nav className="container-fg flex items-center justify-between h-20">
        <Link to="/" data-testid="nav-logo" className="flex items-center gap-3 group">
          <img src={IMAGES.logo} alt="FloGuard LLC" className="h-8 object-contain" />
          <span className="font-display text-xl tracking-tight text-white leading-none">
            Flo<span className="text-brand-orange">Guard</span>
          </span>
        </Link>

        <div className="hidden lg:flex items-center gap-6 xl:gap-8 text-sm">
          {NAV_LINKS.map((l) => {
            const active = location.pathname === l.to;
            return (
              <Link
                key={l.to}
                to={l.to}
                data-testid={`nav-link-${l.label.toLowerCase().replace(/\s+/g, "-")}`}
                className={`link-underline font-medium tracking-[0.3px] transition-colors ${active ? "text-brand-orange" : "text-white/75 hover:text-white"}`}
              >
                {l.label}
              </Link>
            );
          })}
        </div>

        <div className="flex items-center gap-3">
          <a
            href={COMPANY.phoneHref}
            data-testid="nav-phone"
            className="hidden xl:inline-flex items-center gap-2 text-sm font-medium text-white/80 hover:text-white transition-colors"
          >
            <Phone size={15} className="text-brand-orange" />
            {COMPANY.phone}
          </a>
          <Link
            to="/contact"
            data-testid="nav-cta"
            className="hidden sm:inline-flex items-center bg-brand-orange text-white px-5 py-2.5 text-xs font-bold uppercase tracking-wider rounded-sm hover:bg-brand-orangeDark transition-colors"
          >
            Free Assessment
          </Link>
          <button
            onClick={() => setOpen((o) => !o)}
            data-testid="mobile-menu-toggle"
            aria-label="Toggle menu"
            className="lg:hidden inline-flex items-center justify-center w-11 h-11 text-white border border-white/15 rounded-sm"
          >
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </nav>

      <AnimatePresence>
        {open && (
          <motion.div
            data-testid="mobile-menu"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.35, ease: EASE }}
            className="lg:hidden glass border-t border-white/10 overflow-hidden pb-[env(safe-area-inset-bottom)]"
          >
            <div className="container-fg py-6 flex flex-col gap-1">
              {NAV_LINKS.map((l, i) => (
                <motion.div
                  key={l.to}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05, ease: EASE }}
                >
                  <Link
                    to={l.to}
                    data-testid={`mobile-nav-link-${l.label.toLowerCase().replace(/\s+/g, "-")}`}
                    className="block py-4 text-lg font-medium text-white/90 border-b border-white/5 active:bg-white/5"
                  >
                    {l.label}
                  </Link>
                </motion.div>
              ))}
              <a href={COMPANY.phoneHref} className="mt-4 inline-flex items-center gap-2 text-brand-orange font-semibold py-1">
                <Phone size={16} /> {COMPANY.phone}
              </a>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.header>
  );
};
