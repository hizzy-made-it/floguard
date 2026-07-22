import { useState, useEffect, useRef } from "react";
import { Link, useLocation } from "react-router-dom";
import { Menu, X, Phone } from "lucide-react";
import { NAV_LINKS, COMPANY, IMAGES } from "../data/site";

export const Navbar = () => {
  const [hidden, setHidden] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const prevY = useRef(0);
  const location = useLocation();

  useEffect(() => {
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const latest = window.scrollY || 0;
        setScrolled(latest > 40);
        const focusedInNav =
          document.activeElement?.closest?.("[data-testid='site-navbar']");
        if (focusedInNav) {
          setHidden(false);
        } else if (latest > prevY.current && latest > 240) {
          setHidden(true);
        } else {
          setHidden(false);
        }
        prevY.current = latest;
        ticking = false;
      });
    };
    prevY.current = window.scrollY || 0;
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => setOpen(false), [location.pathname]);

  return (
    <header
      data-testid="site-navbar"
      className={`fixed top-0 left-0 w-full z-50 transition-[transform,background-color,border-color] duration-300 ease-out ${
        hidden ? "-translate-y-[120%]" : "translate-y-0"
      } ${scrolled ? "glass border-b border-white/10" : "bg-transparent"}`}
    >
      <nav className="container-fg flex items-center justify-between h-16 sm:h-20 min-w-0 gap-2">
        <Link to="/" data-testid="nav-logo" className="flex items-center gap-2 sm:gap-3 group min-w-0 shrink">
          <img
            src={IMAGES.logo}
            alt="FloGuard LLC"
            width={32}
            height={32}
            decoding="async"
            className="h-7 sm:h-8 w-auto object-contain shrink-0"
          />
          <span className="font-display text-lg sm:text-xl tracking-tight text-white leading-none truncate">
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
            aria-expanded={open}
            className="lg:hidden inline-flex items-center justify-center w-11 h-11 text-white border border-white/15 rounded-sm"
          >
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </nav>

      <div
        data-testid="mobile-menu"
        className={`lg:hidden glass border-t border-white/10 overflow-hidden pb-[env(safe-area-inset-bottom)] transition-[max-height,opacity] duration-300 ease-out ${
          open ? "max-h-[80vh] opacity-100" : "max-h-0 opacity-0 pointer-events-none border-t-0"
        }`}
        hidden={!open}
      >
        <div className="container-fg py-6 flex flex-col gap-1">
          {NAV_LINKS.map((l) => (
            <Link
              key={l.to}
              to={l.to}
              data-testid={`mobile-nav-link-${l.label.toLowerCase().replace(/\s+/g, "-")}`}
              className="block py-4 text-lg font-medium text-white/90 border-b border-white/5 active:bg-white/5"
            >
              {l.label}
            </Link>
          ))}
          <a href={COMPANY.phoneHref} className="mt-4 inline-flex items-center gap-2 text-brand-orange font-semibold py-1">
            <Phone size={16} /> {COMPANY.phone}
          </a>
        </div>
      </div>
    </header>
  );
};
