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

export default function Blog() {
  const [filter, setFilter] = useState("All");
  const [featured, ...rest] = POSTS;
  const pool = filter === "All" ? POSTS : POSTS.filter((p) => p.category === filter);
  const showFeatured = filter === "All";
  const grid = showFeatured ? rest : pool;

  return (
    <>
      <PageHero
        overline="FloGuard Journal"
        title="Drainage know-how for Florida homeowners."
        subtitle="Practical, no-jargon guides on French drains, sump pumps, flooding and protecting your home — written by the crew who installs them."
        image={IMAGES.landscaped}
        primary={{ label: "Get a free assessment", to: "/contact" }}
      />

      {/* Featured post */}
      {showFeatured && (
        <section data-testid="blog-featured" className="section bg-background pb-0">
          <div className="container-fg">
            <Link to={`/blog/${featured.slug}`} data-testid="featured-post" className="group grid lg:grid-cols-12 gap-8 items-center">
              <div className="lg:col-span-7 relative overflow-hidden rounded-sm">
                <img src={featured.image} alt={featured.title} className="w-full h-[300px] md:h-[440px] object-cover transition-transform duration-700 group-hover:scale-105" loading="lazy" />
                <span className="absolute top-4 left-4 text-xs font-bold uppercase tracking-widest text-white bg-brand-orange px-3 py-1 rounded-sm">Latest</span>
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
                <span className="mt-6 inline-flex items-center gap-2 text-brand-navy font-bold">
                  Read the guide <ArrowUpRight size={18} className="group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform" />
                </span>
              </div>
            </Link>
          </div>
        </section>
      )}

      {/* Grid + filters */}
      <section data-testid="blog-grid" className="section bg-background">
        <div className="container-fg">
          <div className="flex flex-wrap gap-3 mb-12">
            {BLOG_CATEGORIES.map((c) => (
              <button
                key={c}
                onClick={() => setFilter(c)}
                data-testid={`blog-filter-${c.toLowerCase().replace(/[^a-z]+/g, "-")}`}
                className={`px-5 py-2.5 text-sm font-medium rounded-full border transition-colors ${
                  filter === c ? "bg-brand-navy text-white border-brand-navy" : "border-border text-brand-slate hover:border-brand-navy"
                }`}
              >
                {c}
              </button>
            ))}
          </div>

          <motion.div layout className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
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
                  transition={{ duration: 0.5, ease: EASE, delay: (i % 3) * 0.06 }}
                  className="group bg-card border border-border rounded-sm overflow-hidden flex flex-col"
                >
                  <Link to={`/blog/${p.slug}`} className="block" data-cursor="hover">
                    <div className="relative h-52 overflow-hidden">
                      <img src={p.image} alt={p.title} className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" loading="lazy" />
                      <span className="absolute top-3 left-3 text-[10px] font-bold uppercase tracking-widest text-white bg-brand-ink/70 px-2.5 py-1 rounded-sm">{p.category}</span>
                    </div>
                    <div className="p-6 flex flex-col flex-1">
                      <div className="flex items-center gap-4 text-xs text-brand-slate/60 mb-3">
                        <span className="flex items-center gap-1"><Calendar size={12} /> {formatDate(p.date)}</span>
                        <span className="flex items-center gap-1"><Clock size={12} /> {p.readTime} min</span>
                      </div>
                      <h3 className="font-display text-xl tracking-tight text-brand-navy leading-snug group-hover:text-brand-orange transition-colors">{p.title}</h3>
                      <p className="mt-3 text-sm text-brand-slate leading-relaxed line-clamp-3">{p.excerpt}</p>
                      <span className="mt-5 inline-flex items-center gap-2 text-brand-navy font-bold text-sm">
                        Read more <ArrowUpRight size={15} className="group-hover:translate-x-1 transition-transform" />
                      </span>
                    </div>
                  </Link>
                </motion.article>
              ))}
            </AnimatePresence>
          </motion.div>
        </div>
      </section>

      <GuideDownload />

      <FinalCTA />
    </>
  );
}
