import { useEffect } from "react";
import { Link, useParams, Navigate } from "react-router-dom";
import { motion, useScroll, useSpring } from "framer-motion";
import { ArrowLeft, ArrowUpRight, Calendar, Clock, Phone } from "lucide-react";
import { getPost, POSTS, formatDate } from "../data/blog";
import { COMPANY, IMAGES } from "../data/site";
import { Seo } from "../components/Seo";
import { EASE } from "../lib/animations";

function Block({ block }) {
  if (block.type === "h2")
    return <h2 className="font-display text-2xl sm:text-3xl tracking-tight text-brand-navy mt-12 mb-4">{block.text}</h2>;
  if (block.type === "quote")
    return (
      <blockquote className="my-10 border-l-2 border-brand-orange pl-6 py-1">
        <p className="font-display text-2xl text-brand-navy leading-snug">{block.text}</p>
      </blockquote>
    );
  if (block.type === "ul")
    return (
      <ul className="my-6 space-y-3">
        {block.items.map((it) => (
          <li key={it} className="flex items-start gap-3 text-lg text-brand-slate leading-relaxed">
            <span className="mt-2.5 w-1.5 h-1.5 rounded-full bg-brand-orange shrink-0" /> {it}
          </li>
        ))}
      </ul>
    );
  return <p className="my-5 text-lg text-brand-slate leading-relaxed">{block.text}</p>;
}

export default function BlogPost() {
  const { slug } = useParams();
  const post = getPost(slug);
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 120, damping: 30, mass: 0.4 });

  useEffect(() => {
    if (post) {
      document.title = `${post.title} — FloGuard LLC`;
      return () => { document.title = "FloGuard LLC — Smart Drainage Systems for Florida Homes"; };
    }
  }, [post]);

  if (!post) return <Navigate to="/blog" replace />;

  const related = POSTS.filter((p) => p.slug !== post.slug && p.category === post.category).slice(0, 3);
  const fill = POSTS.filter((p) => p.slug !== post.slug).slice(0, 3);
  const suggestions = (related.length ? related : fill).slice(0, 3);

  return (
    <>
      <Seo
        title={`${post.title} — FloGuard LLC`}
        description={post.excerpt}
        path={`/blog/${post.slug}`}
        image={post.image}
        type="article"
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "BlogPosting",
          headline: post.title,
          description: post.excerpt,
          image: post.image,
          datePublished: post.date,
          dateModified: post.date,
          keywords: post.keyword,
          articleSection: post.category,
          author: { "@type": "Organization", name: "FloGuard, LLC" },
          publisher: {
            "@type": "Organization",
            name: "FloGuard, LLC",
            logo: { "@type": "ImageObject", url: IMAGES.logo },
          },
          mainEntityOfPage: `https://www.floguardfl.com/blog/${post.slug}`,
        }}
      />
      {/* article read progress */}
      <motion.div style={{ scaleX }} className="fixed top-0 left-0 right-0 h-[3px] bg-brand-orange origin-left z-[61]" />

      {/* hero */}
      <section data-testid="blogpost-hero" className="relative min-h-[68vh] flex items-end overflow-hidden bg-brand-ink text-white grain">
        <motion.img
          src={post.image}
          alt=""
          initial={{ scale: 1.12 }}
          animate={{ scale: 1 }}
          transition={{ duration: 2, ease: EASE }}
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-brand-ink via-brand-ink/60 to-brand-ink/30" />
        <div className="container-fg relative z-10 pb-14 pt-40">
          <Link to="/blog" data-testid="back-to-blog" className="inline-flex items-center gap-2 text-white/70 hover:text-brand-orange transition-colors text-sm mb-6">
            <ArrowLeft size={16} /> All articles
          </Link>
          <div className="flex flex-wrap items-center gap-4 text-sm text-white/60 mb-5">
            <span className="text-brand-orange font-bold uppercase tracking-widest text-xs">{post.category}</span>
            <span className="flex items-center gap-1.5"><Calendar size={14} /> {formatDate(post.date)}</span>
            <span className="flex items-center gap-1.5"><Clock size={14} /> {post.readTime} min read</span>
          </div>
          <motion.h1
            initial={{ opacity: 0, y: 24, filter: "blur(10px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ duration: 0.9, ease: EASE, delay: 0.1 }}
            className="font-display text-4xl sm:text-5xl lg:text-6xl tracking-tight leading-[0.98] max-w-4xl"
          >
            {post.title}
          </motion.h1>
        </div>
      </section>

      {/* body - elite reading experience */}
      <article data-testid="blogpost-body" className="bg-background">
        <div className="container-fg py-16 md:py-24 grid lg:grid-cols-12 gap-12">
          <div className="lg:col-span-8 lg:col-start-2">
            <p className="text-[21px] text-brand-navy font-medium leading-tight tracking-[-0.2px] mb-10 max-w-[42ch]">{post.excerpt}</p>
            <div className="prose prose-slate max-w-none text-[17px] leading-relaxed text-brand-slate">
              {post.content.map((b, i) => (
                <Block key={i} block={b} />
              ))}
            </div>

            {/* inline CTA */}
            <div className="mt-14 rounded-sm bg-brand-navy text-white p-8 sm:p-10">
              <h3 className="font-display text-2xl sm:text-3xl tracking-tight">Standing water on your property?</h3>
              <p className="mt-3 text-white/70 max-w-lg">Book a free, on-site drainage assessment. We'll map the problem and design a system built for Florida storms.</p>
              <div className="mt-6 flex flex-wrap gap-4">
                <Link to="/contact" className="inline-flex items-center gap-2 bg-brand-orange text-white px-6 py-3.5 text-sm font-bold uppercase tracking-wider rounded-sm hover:bg-brand-orangeDark transition-colors">
                  Request assessment <ArrowUpRight size={16} />
                </Link>
                <a href={COMPANY.phoneHref} className="inline-flex items-center gap-2 border border-white/25 px-6 py-3.5 text-sm font-bold uppercase tracking-wider rounded-sm hover:bg-white/10 transition-colors">
                  <Phone size={15} /> {COMPANY.phone}
                </a>
              </div>
            </div>
          </div>
        </div>
      </article>

      {/* related - premium */}
      <section data-testid="blog-related" className="section bg-secondary">
        <div className="container-fg">
          <h2 className="font-display text-3xl sm:text-4xl tracking-tight text-brand-navy mb-9">More from the journal</h2>
          <div className="grid md:grid-cols-3 gap-6">
            {suggestions.map((p) => (
              <Link key={p.slug} to={`/blog/${p.slug}`} className="group bg-white border border-border rounded-sm overflow-hidden flex flex-col">
                <div className="relative h-44 overflow-hidden">
                  <img src={p.image} alt={p.title} className="w-full h-full object-cover transition-all duration-700 group-hover:scale-[1.03]" loading="lazy" />
                </div>
                <div className="p-6 flex-1 flex flex-col">
                  <span className="text-brand-orange font-bold uppercase tracking-[1px] text-[10px]">{p.category}</span>
                  <h3 className="font-display text-[19px] tracking-tight text-brand-navy leading-snug mt-2.5 group-hover:text-brand-orange transition-colors flex-1">{p.title}</h3>
                  <span className="mt-4 text-sm font-semibold text-brand-navy group-hover:text-brand-orange inline-flex items-center">
                    Read article <ArrowUpRight size={15} className="ml-1.5 group-hover:translate-x-0.5 transition" />
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
