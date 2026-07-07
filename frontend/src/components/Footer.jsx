import { Link } from "react-router-dom";
import { Phone, MessageSquare, Mail, MapPin } from "lucide-react";
import { COMPANY, NAV_LINKS, SERVICE_AREAS, IMAGES } from "../data/site";

export const Footer = () => {
  return (
    <footer data-testid="site-footer" className="relative bg-brand-ink text-white grain overflow-hidden">
      <div className="container-fg relative z-10 pt-20 pb-10">
        <div className="grid gap-12 lg:grid-cols-12">
          <div className="lg:col-span-4">
            <div className="flex items-center gap-3 mb-5">
              <img src={IMAGES.logo} alt="FloGuard LLC" className="h-12 w-12 object-contain rounded-sm bg-white/95 p-0.5" />
              <span className="font-display text-2xl">Flo<span className="text-brand-orange">Guard</span></span>
            </div>
            <p className="text-white/60 max-w-xs leading-relaxed">{COMPANY.tagline}</p>
            <p className="mt-6 text-sm text-white/40">
              Flood Solutions &amp; Management · Central Florida
            </p>
          </div>

          <div className="lg:col-span-2">
            <h4 className="overline mb-5">Explore</h4>
            <ul className="space-y-3">
              {NAV_LINKS.map((l) => (
                <li key={l.to}>
                  <Link to={l.to} className="text-white/70 hover:text-brand-orange transition-colors text-sm">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div className="lg:col-span-3">
            <h4 className="overline mb-5">Service Area</h4>
            <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-white/60">
              {SERVICE_AREAS.map((a) => (
                <span key={a}>{a}</span>
              ))}
            </div>
          </div>

          <div className="lg:col-span-3">
            <h4 className="overline mb-5">Contact</h4>
            <ul className="space-y-4 text-sm">
              <li>
                <a href={COMPANY.phoneHref} className="flex items-center gap-3 text-white/80 hover:text-brand-orange transition-colors">
                  <Phone size={16} className="text-brand-orange shrink-0" /> {COMPANY.phone}
                </a>
              </li>
              <li>
                <a href={COMPANY.smsHref} className="flex items-center gap-3 text-white/80 hover:text-brand-orange transition-colors">
                  <MessageSquare size={16} className="text-brand-orange shrink-0" /> Text us
                </a>
              </li>
              <li>
                <a href={COMPANY.emailHref} className="flex items-center gap-3 text-white/80 hover:text-brand-orange transition-colors">
                  <Mail size={16} className="text-brand-orange shrink-0" /> {COMPANY.email}
                </a>
              </li>
              <li className="flex items-start gap-3 text-white/60">
                <MapPin size={16} className="text-brand-orange shrink-0 mt-0.5" /> {COMPANY.address}
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-16 pt-8 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-white/40">
          <span>© {new Date().getFullYear()} {COMPANY.legal}. All rights reserved.</span>
          <span>{COMPANY.hours}</span>
        </div>
      </div>
    </footer>
  );
};
