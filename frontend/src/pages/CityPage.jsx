import { Link, useParams, Navigate } from "react-router-dom";
import { useEffect } from "react";
import { motion } from "framer-motion";
import { MapPin, Check, ArrowUpRight, Phone } from "lucide-react";
import { PageHero } from "../components/PageHero";
import { Reveal } from "../components/Reveal";
import { FlowPath } from "../components/FlowPath";
import { ServicesGrid } from "../components/ServicesGrid";
import { Testimonials } from "../components/Testimonials";
import { FinalCTA } from "../components/FinalCTA";
import { getCity, CITIES } from "../data/cities";
import { COMPANY } from "../data/site";
import { Seo } from "../components/Seo";
import { EASE, viewportOnce } from "../lib/animations";

export default function CityPage() {
  const { slug } = useParams();
  const city = getCity(slug);

  useEffect(() => {
    if (city) {
      document.title = `French Drains & Drainage in ${city.name}, FL — FloGuard LLC`;
      return () => { document.title = "FloGuard LLC — Smart Drainage Systems for Florida Homes"; };
    }
  }, [city]);

  if (!city) return <Navigate to="/areas" replace />;

  const others = CITIES.filter((c) => c.slug !== city.slug).slice(0, 6);

  return (
    <>
      <Seo
        title={`French Drains & Drainage in ${city.name}, FL — FloGuard LLC`}
        description={`Professional French drain, sump pump & yard drainage in ${city.name}, ${city.county}. Stop standing water and protect your foundation. Free assessments.`}
        path={`/areas/${city.slug}`}
        image={city.image}
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "LocalBusiness",
          name: `FloGuard, LLC — Drainage in ${city.name}`,
          description: city.intro,
          telephone: "+13862590023",
          url: `https://www.floguardfl.com/areas/${city.slug}`,
          areaServed: { "@type": "City", name: city.name },
          address: {
            "@type": "PostalAddress",
            streetAddress: "5114 S Ridgewood Ave",
            addressLocality: "Port Orange",
            addressRegion: "FL",
            postalCode: "32127",
            addressCountry: "US",
          },
          aggregateRating: { "@type": "AggregateRating", ratingValue: "5.0", reviewCount: "2" },
        }}
      />
      <PageHero
        overline={`${city.county} · Serving ${city.name}`}
        title={`French Drain & Drainage in ${city.name}, FL`}
        subtitle={city.intro}
        image={city.image}
        primary={{ label: "Request a free assessment", to: "/contact" }}
        secondary={{ label: `Call ${COMPANY.phone}`, to: "/contact" }}
      />

      {/* Local problems */}
      <section className="section bg-background">
        <div className="container-fg grid lg:grid-cols-12 gap-12">
          <div className="lg:col-span-5">
            <Reveal>
              <p className="overline mb-5">Local water challenges</p>
              <h2 className="font-display text-4xl sm:text-5xl tracking-tight text-brand-navy leading-tight">
                Why {city.name} homes flood.
              </h2>
              <p className="mt-6 text-lg text-brand-slate leading-relaxed">
                Every property is different — but {city.name} homeowners keep calling us about the same water problems.
                Here's what we solve most often in {city.county}.
              </p>
              <a href={COMPANY.phoneHref} className="mt-8 inline-flex items-center gap-2 text-brand-navy font-bold link-underline">
                <Phone size={16} className="text-brand-orange" /> {COMPANY.phone}
              </a>
            </Reveal>
          </div>
          <div className="lg:col-span-7 space-y-4">
            {city.problems.map((p, i) => (
              <motion.div
                key={p}
                initial={{ opacity: 0, x: 30 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={viewportOnce}
                transition={{ duration: 0.6, ease: EASE, delay: i * 0.1 }}
                className="flex items-start gap-4 bg-card border border-border rounded-sm p-6"
              >
                <span className="font-display text-2xl text-brand-orange">0{i + 1}</span>
                <p className="text-lg text-brand-slate leading-relaxed">{p}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="section bg-brand-ink grain relative">
        <div className="container-fg relative z-10">
          <Reveal className="mb-14 max-w-2xl">
            <p className="overline mb-5">Our system in {city.name}</p>
            <h2 className="font-display text-4xl sm:text-5xl tracking-tight text-white leading-tight">
              French drain → sump pump → safe discharge.
            </h2>
          </Reveal>
          <FlowPath dark />
        </div>
      </section>

      {/* Services */}
      <section className="section bg-background">
        <div className="container-fg">
          <Reveal className="mb-14 max-w-2xl">
            <p className="overline mb-5">What we install in {city.name}</p>
            <h2 className="font-display text-4xl sm:text-5xl tracking-tight text-brand-navy leading-tight">
              Drainage solutions for your property.
            </h2>
          </Reveal>
          <ServicesGrid />
        </div>
      </section>

      {/* Neighborhoods */}
      <section className="section bg-secondary">
        <div className="container-fg">
          <Reveal className="mb-8">
            <p className="overline mb-5">Neighborhoods we serve</p>
            <h2 className="font-display text-3xl sm:text-4xl tracking-tight text-brand-navy leading-tight">
              Proudly protecting homes across {city.name}.
            </h2>
          </Reveal>
          <div className="flex flex-wrap gap-3">
            {city.neighborhoods.map((n) => (
              <span key={n} className="inline-flex items-center gap-2 bg-card border border-border rounded-full px-4 py-2 text-sm text-brand-slate">
                <MapPin size={14} className="text-brand-orange" /> {n}
              </span>
            ))}
          </div>
        </div>
      </section>

      <Testimonials />

      {/* Other cities */}
      <section className="section bg-background">
        <div className="container-fg">
          <h2 className="font-display text-3xl tracking-tight text-brand-navy mb-8">Other areas we serve</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {others.map((c) => (
              <Link key={c.slug} to={`/areas/${c.slug}`} className="group flex items-center justify-between bg-card border border-border rounded-sm p-5 hover:border-brand-orange transition-colors">
                <span className="font-display text-lg text-brand-navy">{c.name}</span>
                <ArrowUpRight size={18} className="text-brand-slate group-hover:text-brand-orange transition-colors" />
              </Link>
            ))}
          </div>
        </div>
      </section>

      <FinalCTA />
    </>
  );
}
