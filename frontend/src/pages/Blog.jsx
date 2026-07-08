import { useState } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowUpRight, Calendar, Clock } from "lucide-react";
import { PageHero } from "../components/PageHero";
import { FinalCTA } from "../components/FinalCTA";
import { POSTS, BLOG_CATEGORIES, formatDate } from "../data/blog";
import { GuideDownload } from "../components/GuideDownload";
import { IMAGES } from "../data/site";
import { EASE, viewportOnce } from "../lib/animations";
import { Seo } from "../components/Seo";
import { StatsBar } from "../components/StatsBar";

export default function Blog() {
  const [filter, setFilter] = useState("All");
  const [featured, ...rest] = POSTS;
  const pool = filter === "All" ? POSTS : POSTS.filter((p) => p.category === filter);
  const showFeatured = filter === "All";
  const grid = showFeatured ? rest : pool;

  return (
    <>
      <Seo
        title="Florida Drainage Blog — French Drains, Sump Pumps & Flood Tips | FloGuard"
        description="Practical guides on French drains, sump pumps, standing water and flood protection for Central Florida homeowners, from the FloGuard crew."
        path="/blog"
      />
      <PageHero
        overline="FloGuard Journal"
        title="Drainage know-how for Florida homeowners."
        subtitle="Practical, no-jargon guides on French drains, sump pumps, flooding and protecting your home — written by the crew who installs them."
        image="/images/case2-after.jpg"
        primary={{ label: "Get a free assessment", to: "/contact" }}
      />

      <StatsBar />

      {/* Featured post */}
      {showFeatured && (
        <section data-testid="blog-featured" className="section bg-background pb-0">
          <div className="container-fg">
            <Link to={`/blog/${featured.slug}`} data-testid="featured-post" className="group grid lg:grid-cols-12 gap-8 items-center">
              <div className="lg:col-span-7 relative overflow-hidden rounded-sm ring-1 ring-black/5">
                <img src={featured.image} alt={featured.title} className="w-full h-[300px] md:h-[440px] object-cover transition-all duration-700 group-hover:scale-[1.02]" loading="lazy" />
                <span className="absolute top-4 left-4 text-xs font-bold uppercase tracking-[1px] text-white bg-brand-orange px-3 py-1 rounded-sm">Featured</span>
              </div>
              <div className="lg:col-span-5">
                <div className="flex items-center gap-4 text-sm text-brand-slate/70 mb-4">
                  <span className="text-brand-orange font-bold uppercase tracking-widest text-xs">{featured.category}</span>
                  <span className="flex items-center gap-1.5"><Calendar size={14} /> {formatDate(featured.date)}</span>
                </div>
                <h2 className="font-display text-3xl sm:text-4xl tracking-tight text-brand-navy leading-tight group-hover:text-brand-orange transition-colors">
                  {featured.title}
                </h2>
                <p className="mt-4 text-lg text-brand-slate leading-relaxed">{featured.excerpt}</p>
                <span className="mt-6 inline-flex items-center gap-2 text-brand-navy font-bold text-sm border-b border-transparent group-hover:border-brand-orange pb-px">
                  Read the full guide <ArrowUpRight size={17} className="group-hover:translate-x-0.5 transition-transform" />
                </span>
              </div>
            </Link>
          </div>
        </section>
      )}

      {/* Grid + filters - editorial elite */}
      <section data-testid="blog-grid" className="section bg-background">
        <div className="container-fg">
          <div className="flex flex-wrap gap-2 mb-10">
            {BLOG_CATEGORIES.map((c) => (
              <button
                key={c}
                onClick={() => setFilter(c)}
                data-testid={`blog-filter-${c.toLowerCase().replace(/[^a-z]+/g, "-")}`}
                className={`px-6 py-2 text-sm font-medium rounded-full border transition-all ${filter === c ? "bg-brand-navy text-white border-brand-navy" : "border-border text-brand-slate hover:border-brand-navy hover:text-brand-navy"}`}
              >
                {c}
              </button>
            ))}
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            <AnimatePresence mode="popLayout">
              {grid.map((p, i) => (
                <motion.article
                  key={p.slug}
                  layout
                  data-testid={`blog-card-${p.slug}`}
                  initial={{ opacity: 0, y: 24 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={viewportOnce}
                  exit={{ opacity: 0, scale: 0.96 }}
                  transition={{ duration: 0.45, ease: EASE, delay: (i % 3) * 0.05 }}
                  className="group bg-card border border-border rounded-sm overflow-hidden flex flex-col"
                >
                  <Link to={`/blog/${p.slug}`} className="block" data-cursor="hover">
                    <div className="relative h-56 overflow-hidden">
                      <img src={p.image} alt={p.title} className="w-full h-full object-cover transition-all duration-700 group-hover:scale-[1.03]" loading="lazy" />
                      <span className="absolute top-4 left-4 text-xs font-bold uppercase tracking-[1px] text-white bg-brand-ink/80 px-3 py-1 rounded-sm">{p.category}</span>
                    </div>
                    <div className="p-7 flex flex-col flex-1">
                      <div className="flex items-center gap-4 text-xs text-brand-slate/60 mb-3">
                        <span className="flex items-center gap-1"><Calendar size={13} /> {formatDate(p.date)}</span>
                        <span className="flex items-center gap-1"><Clock size={13} /> {p.readTime}</span>
                      </div>
                      <h3 className="font-display text-[21px] tracking-tight text-brand-navy leading-tight group-hover:text-brand-orange transition-colors">{p.title}</h3>
                      <p className="mt-3 text-[15px] text-brand-slate leading-relaxed line-clamp-3">{p.excerpt}</p>
                      <span className="mt-6 inline-flex items-center text-sm font-semibold text-brand-navy group-hover:text-brand-orange">
                        Read the guide <ArrowUpRight size={16} className="ml-1.5 group-hover:translate-x-0.5 transition-transform" />
                      </span>
                    </div>
                  </Link>
                </motion.article>
              ))}
            </AnimatePresence>
          </div>
        </div>
      </section>

      <GuideDownload />

      <FinalCTA />
    </>
  );
}
