import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

/**
 * Internal studio route — 3D heroes removed from the product.
 * The live marketing hero is the cinematic video on Home (hero.mp4). Do not re-add WebGL here.
 */
export default function Studio() {
  return (
    <div className="min-h-[100svh] bg-brand-ink text-white flex flex-col items-center justify-center p-8 text-center">
      <p className="overline text-brand-orange mb-4">Studio</p>
      <h1 className="font-display text-4xl sm:text-5xl tracking-tight max-w-xl">
        Cinematic hero is live on the homepage.
      </h1>
      <p className="mt-6 text-white/60 max-w-md leading-relaxed">
        The WebGL rain journey was retired. Marketing uses the locked <code className="text-brand-orange">hero.mp4</code> scroll-scrub experience on Home.
      </p>
      <Link
        to="/"
        data-testid="studio-back"
        className="mt-10 inline-flex items-center gap-2 bg-brand-orange text-brand-ink font-semibold px-6 py-3 rounded-sm hover:brightness-110 transition"
      >
        <ArrowLeft size={16} /> Back to site
      </Link>
    </div>
  );
}
