import { Link, useParams, Navigate } from "react-router-dom";
import { Check, ArrowUpRight, Phone } from "lucide-react";
import { PageHero } from "../components/PageHero";
import { Reveal } from "../components/Reveal";
import { FinalCTA } from "../components/FinalCTA";
import { Seo, organizationLd, faqPageLd, SITE } from "../components/Seo";
import { getService, SERVICES, COMPANY } from "../data/site";

export default function ServiceDetail() {
  const { slug } = useParams();
  const service = getService(slug);
  if (!service) return <Navigate to="/services" replace />;

  const others = SERVICES.filter((s) => s.slug !== service.slug);

  return (
    <>
      <Seo
        title={service.seoTitle || `${service.title} | FloGuard`}
        description={service.seoDescription || service.blurb}
        path={`/services/${service.slug}`}
        image={service.image}
        jsonLd={{
          "@context": "https://schema.org",
          "@graph": [
            organizationLd,
            {
              "@type": "Service",
              name: service.title,
              description: service.answerFirst || service.blurb,
              provider: { "@id": organizationLd["@id"] },
              areaServed: organizationLd.areaServed,
              url: `${SITE}/services/${service.slug}`,
            },
            faqPageLd(service.faqs || []),
          ].filter(Boolean),
        }}
      />

      <PageHero
        overline="Services"
        title={service.title}
        subtitle={service.answerFirst || service.blurb}
        image={service.image}
        primary={{ label: "Request a free assessment", to: "/contact" }}
        secondary={{ label: `Call ${COMPANY.phone}`, to: "/contact" }}
      />

      <section className="section bg-background">
        <div className="container-fg grid lg:grid-cols-12 gap-12">
          <div className="lg:col-span-7 space-y-6">
            <Reveal>
              <p className="overline mb-4">How it works</p>
              <h2 className="font-display text-3xl sm:text-4xl tracking-tight text-brand-navy">
                Engineered for Florida conditions.
              </h2>
            </Reveal>
            {(service.longContent || []).map((p) => (
              <Reveal key={p.slice(0, 40)}>
                <p className="text-lg text-brand-slate leading-relaxed">{p}</p>
              </Reveal>
            ))}
            <ul className="space-y-3 pt-2">
              {service.features.map((f) => (
                <li key={f} className="flex items-center gap-2.5 text-brand-slate">
                  <Check size={16} className="text-brand-orange shrink-0" /> {f}
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-4 pt-4">
              <Link to="/contact" className="inline-flex items-center gap-2 bg-brand-orange text-brand-ink font-semibold px-5 py-3 rounded-sm">
                Free assessment <ArrowUpRight size={16} />
              </Link>
              <a href={COMPANY.phoneHref} className="inline-flex items-center gap-2 text-brand-navy font-semibold">
                <Phone size={16} className="text-brand-orange" /> {COMPANY.phone}
              </a>
            </div>
          </div>
          <div className="lg:col-span-5">
            <div className="rounded-sm overflow-hidden border border-border">
              <img
                src={service.image}
                alt={service.title}
                className="w-full h-72 object-cover"
                width={800}
                height={500}
                loading="lazy"
                decoding="async"
              />
            </div>
            <p className="mt-4 text-sm text-brand-slate">
              Related:{" "}
              <Link to="/process" className="text-brand-orange hover:underline">how we install</Link>
              {" · "}
              <Link to="/blog/french-drain-cost-central-florida-2026" className="text-brand-orange hover:underline">2026 cost guide</Link>
              {" · "}
              <Link to="/areas" className="text-brand-orange hover:underline">service areas</Link>
            </p>
          </div>
        </div>
      </section>

      {service.faqs?.length > 0 && (
        <section className="section bg-secondary">
          <div className="container-fg max-w-3xl">
            <h2 className="font-display text-3xl tracking-tight text-brand-navy mb-8">
              {service.title} FAQs
            </h2>
            <div className="space-y-6">
              {service.faqs.map((f) => (
                <div key={f.q} className="border-b border-border pb-6">
                  <h3 className="font-display text-xl text-brand-navy">{f.q}</h3>
                  <p className="mt-2 text-brand-slate leading-relaxed">{f.a}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="section bg-background">
        <div className="container-fg">
          <h2 className="font-display text-2xl text-brand-navy mb-6">Other services</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {others.map((s) => (
              <Link
                key={s.slug}
                to={`/services/${s.slug}`}
                className="group flex items-center justify-between border border-border rounded-sm p-5 hover:border-brand-orange transition-colors"
              >
                <span className="font-display text-lg text-brand-navy">{s.title}</span>
                <ArrowUpRight size={18} className="text-brand-slate group-hover:text-brand-orange" />
              </Link>
            ))}
          </div>
        </div>
      </section>

      <FinalCTA />
    </>
  );
}
