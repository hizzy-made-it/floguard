import { PageHero } from "../components/PageHero";
import { Seo, organizationLd, breadcrumbListLd, SITE } from "../components/Seo";
import { Reveal, RevealGroup, RevealItem } from "../components/Reveal";
import { FinalCTA } from "../components/FinalCTA";
import { VALUES, IMAGES } from "../data/site";
import { StatsBar } from "../components/StatsBar";
import { ShieldCheck, Users, MapPin, Award } from "lucide-react";

const VALUE_ICONS = [ShieldCheck, Users, MapPin, Award];

export default function About() {
  return (
    <>
      <Seo
        title="About FloGuard | Local French Drain Experts | Central Florida"
        description="Family-run Central Florida drainage contractor. Engineered French drain and sump pump systems for high water table homes in Daytona, Port Orange, and Orlando."
        path="/about"
        jsonLd={{
          "@context": "https://schema.org",
          "@graph": [
            organizationLd,
            {
              ...breadcrumbListLd([
                { name: "Home", path: "/" },
                { name: "About", path: "/about" },
              ]),
              "@id": `${SITE}/about#breadcrumb`,
            },
          ].filter(Boolean),
        }}
      />
      <PageHero
        overline="About FloGuard"
        title="A local team that takes flooding personally."
        subtitle="Family-run and Florida-based, we design drainage systems the way engineers do — for the specific water your property faces."
        image="/images/case3-after.jpg"
        imageAlt="FloGuard team and completed drainage work for Central Florida homes"
        primary={{ label: "Meet us on-site", to: "/contact" }}
      />

      {/* Story - editorial and powerful */}
      <section data-testid="about-story" className="section bg-background">
        <div className="container-fg">
          <div className="max-w-4xl">
            <Reveal>
              <p className="overline mb-5">Our story</p>
              <h2 className="font-display text-3xl sm:text-5xl md:text-6xl tracking-tight text-brand-navy leading-none break-words">
                We got tired of watching homeowners get sold systems that didn't work.
              </h2>
            </Reveal>
          </div>
          <div className="mt-12 grid lg:grid-cols-12 gap-12 text-[17px] text-brand-slate leading-relaxed">
            <div className="lg:col-span-5">
              <Reveal delay={0.05}>
                <p>FloGuard was born from frustration. Too many Central Florida homes were being sold generic "drainage solutions" that failed the first real storm.</p>
              </Reveal>
            </div>
            <div className="lg:col-span-7 space-y-8">
              <Reveal delay={0.1}>
                <p>We do it the hard way: on-site evaluation of your actual water table, soil, slopes, and runoff paths. Then we engineer a complete French drain + sump pump system — precise trench with perforated pipe in clean gravel and filter fabric, plus automatic pumps with battery backup for Florida power outages.</p>
              </Reveal>
              <Reveal delay={0.15}>
                <p>The system disappears under a restored lawn. The flooding disappears for good. That's why families across Port Orange, Daytona, Sanford, and Orlando trust us with the single biggest investment they own.</p>
              </Reveal>
            </div>
          </div>
        </div>
      </section>

      {/* Values - Elite editorial grid */}
      <section data-testid="about-values" className="section bg-secondary">
        <div className="container-fg">
          <div className="grid lg:grid-cols-12 gap-12 items-end mb-14">
            <div className="lg:col-span-7">
              <Reveal>
                <p className="overline mb-5">What we stand for</p>
                <h2 className="font-display text-4xl sm:text-5xl tracking-tight text-brand-navy leading-tight">
                  Engineered. Local. Built for the storms that actually hit Florida.
                </h2>
              </Reveal>
            </div>
            <div className="lg:col-span-5">
              <Reveal delay={0.1}>
                <p className="text-lg text-brand-slate">No kits. No guesswork. Every system is designed for your exact yard, soil, and water table.</p>
              </Reveal>
            </div>
          </div>
          <RevealGroup className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {VALUES.map((v, i) => {
              const Icon = VALUE_ICONS[i];
              return (
                <RevealItem key={v.title} className="group bg-white border border-border rounded-sm p-8 hover:border-brand-orange/40 transition-all duration-300">
                  <div className="flex items-center justify-between">
                    <Icon className="text-brand-orange" size={32} />
                    <div className="text-[10px] uppercase tracking-[2px] text-brand-slate/50 group-hover:text-brand-orange transition-colors">0{i+1}</div>
                  </div>
                  <h3 className="font-display text-2xl text-brand-navy tracking-tight mt-8 leading-none">{v.title}</h3>
                  <p className="mt-4 text-brand-slate leading-relaxed text-[15px]">{v.body}</p>
                </RevealItem>
              );
            })}
          </RevealGroup>
        </div>
      </section>

      {/* Signature protection visual (static — no WebGL) */}
      <section className="section bg-brand-ink text-white overflow-hidden">
        <div className="container-fg grid lg:grid-cols-12 gap-12 items-center">
          <div className="lg:col-span-5">
            <Reveal>
              <p className="overline mb-5 text-brand-orange">The FloGuard difference</p>
              <h2 className="font-display text-4xl sm:text-5xl tracking-tight leading-none">Protection you can't see.<br />Results you can't ignore.</h2>
              <p className="mt-6 text-lg text-white/60 max-w-md">Our systems disappear under the lawn. The flooding disappears for good.</p>
            </Reveal>
          </div>
          <div className="lg:col-span-7 h-[420px] relative rounded-sm overflow-hidden border border-white/10">
            <img
              src={IMAGES.diagram}
              alt="FloGuard French drain and sump pump system diagram"
              className="absolute inset-0 w-full h-full object-cover"
              width={1200}
              height={800}
              loading="lazy"
              decoding="async"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-brand-ink/80 via-transparent to-transparent" />
            <div className="absolute bottom-6 left-6 text-sm text-white/70">Engineered for your specific water table</div>
          </div>
        </div>
      </section>

      <StatsBar />

      <FinalCTA />
    </>
  );
}
