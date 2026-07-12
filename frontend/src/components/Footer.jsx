import { Link } from "react-router-dom";
import { Phone, MessageSquare, Mail, MapPin } from "lucide-react";
import { COMPANY, NAV_LINKS, SERVICE_AREAS, IMAGES } from "../data/site";

export const Footer = () => {
  return (
    <footer data-testid="site-footer" className="relative bg-brand-ink text-white grain overflow-hidden border-t border-white/10">
      <div className="container-fg relative z-10 pt-20 pb-12">
        <div className="grid gap-x-8 gap-y-12 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <div className="flex items-center gap-4 mb-6">
              <img src={IMAGES.logo} alt="FloGuard LLC" className="h-9 object-contain" />
              <span className="font-display text-3xl tracking-tight">Flo<span className="text-brand-orange">Guard</span></span>
            </div>
            <p className="text-white/60 max-w-sm text-[15px] leading-relaxed">{COMPANY.tagline}</p>
            <div className="mt-8 text-sm text-white/40">
              Flood Solutions &amp; Management · Central Florida
            </div>
          </div>

          <div className="lg:col-span-2">
            <div className="text-xs uppercase tracking-[2px] text-white/40 mb-4">Explore</div>
            <ul className="space-y-2.5 text-sm">
              {NAV_LINKS.map((l) => (
                <li key={l.to}>
                  <Link to={l.to} className="text-white/70 hover:text-brand-orange transition-colors">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div className="lg:col-span-2">
            <div className="text-xs uppercase tracking-[2px] text-white/40 mb-4">Service Area</div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm text-white/60">
              {SERVICE_AREAS.map((a) => <div key={a}>{a}</div>)}
            </div>
          </div>

          <div className="lg:col-span-3">
            <div className="text-xs uppercase tracking-[2px] text-white/40 mb-4">Contact</div>
            <div className="space-y-3 text-sm">
              <a href={COMPANY.phoneHref} className="flex items-center gap-3 text-white/80 hover:text-brand-orange transition-colors">
                <Phone size={15} className="text-brand-orange" /> {COMPANY.phone}
              </a>
              <a href={COMPANY.smsHref} className="flex items-center gap-3 text-white/80 hover:text-brand-orange transition-colors">
                <MessageSquare size={15} className="text-brand-orange" /> Text us
              </a>
              <a href={COMPANY.emailHref} className="flex items-center gap-3 text-white/80 hover:text-brand-orange transition-colors">
                <Mail size={15} className="text-brand-orange" /> {COMPANY.email}
              </a>
              <div className="flex items-start gap-3 text-white/60 pt-1 text-[13px]">
                <MapPin size={15} className="text-brand-orange mt-0.5 shrink-0" /> {COMPANY.address}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-16 pt-6 border-t border-white/10 text-xs text-white/40 flex flex-col sm:flex-row items-center justify-between gap-y-2">
          <div>© {new Date().getFullYear()} {COMPANY.legal}. All rights reserved.</div>
          <a 
            href="https://hdconnex.com" 
            target="_blank" 
            rel="noopener noreferrer" 
            className="flex items-center gap-1.5 hover:text-white transition-colors"
            aria-label="Site built by HDCONNEX"
          >
            <img src="/images/hdconnex.svg" alt="HDCONNEX" className="h-3.5 w-auto" width="88" height="14" loading="lazy" decoding="async" />
            <span>Site built by HDCONNEX</span>
          </a>
          <div>{COMPANY.hours} · Serving Central Florida</div>
        </div>
      </div>
    </footer>
  );
};
