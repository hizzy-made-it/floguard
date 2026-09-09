import { Link } from "react-router-dom";
import { Seo } from "../components/Seo";

// Rendered for any unmatched marketing path. Cloudflare Pages serves build/404.html
// (a copy of the shell) with a real 404 status, so this page is what users see there.
export default function NotFound() {
  return (
    <>
      <Seo title="Page Not Found | FloGuard" description="That page doesn't exist." noindex />
      <section className="max-w-3xl mx-auto px-6 py-24 text-center">
        <p className="text-sm font-semibold tracking-widest text-brand-slate uppercase">404</p>
        <h1 className="mt-3 text-3xl sm:text-4xl font-bold">That page washed away.</h1>
        <p className="mt-4 text-brand-slate">
          Try one of these instead — or call us and we'll point you the right way.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link to="/services/french-drains" className="px-5 py-3 rounded-lg bg-brand-navy text-white font-medium">French Drains</Link>
          <Link to="/services/sump-pumps" className="px-5 py-3 rounded-lg border font-medium">Sump Pumps</Link>
          <Link to="/blog/french-drain-cost-central-florida-2026" className="px-5 py-3 rounded-lg border font-medium">Pricing Guide</Link>
          <Link to="/contact" className="px-5 py-3 rounded-lg border font-medium">Free Assessment</Link>
        </div>
      </section>
    </>
  );
}
