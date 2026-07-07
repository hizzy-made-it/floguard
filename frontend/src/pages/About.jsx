import { PageHero } from "../components/PageHero";
import { Seo } from "../components/Seo";
import { Reveal, RevealGroup, RevealItem } from "../components/Reveal";
import { FinalCTA } from "../components/FinalCTA";
import { VALUES, IMAGES, COMPANY, STATS } from "../data/site";
import { ShieldCheck, Users, MapPin, Award } from "lucide-react";

const VALUE_ICONS = [ShieldCheck, Users, MapPin, Award];

export default function About() {
  return (
    <>
      <Seo title="About FloGuard — Local, Family-Run Drainage Experts in Central Florida" description="FloGuard is a local, family-run flood & drainage contractor engineering custom French drain and sump pump systems for Central Florida homes." path="/about" />
      <PageHero
        overline="About FloGuard"
        title="A local team that takes flooding personally."
        subtitle="Family-run and Florida-based, we design drainage systems the way engineers do — for the specific water your property faces."
        image={IMAGES.crew}
        primary={{ label: "Meet us on-site", to: "/contact" }}
      />

      {/* Story */}
      <section data-testid="about-story" className="section bg-background">
        <div className="container-fg grid lg:grid-cols-12 gap-12 items-start">
          <div className="lg:col-span-5">
            <Reveal>
              <p className="overline mb-5">Our story</p>
              <h2 className="font-display text-4xl sm:text-5xl tracking-tight text-brand-navy leading-tight">
                Built on dry yards and honest work.
              </h2>
            </Reveal>
          </div>
          <div className="lg:col-span-7 space-y-6 text-lg text-brand-slate leading-relaxed">
            <Reveal>
              <p>
                FloGuard started with a simple frustration: too many Central Florida homeowners were sold cookie-cutter
                "drainage kits" that never actually solved their flooding. We do the opposite.
              </p>
            </Reveal>
            <Reveal delay={0.1}>
              <p>
                Every project begins with a real evaluation of your soil, slope and water table. Then we engineer a
                system — trench layout, slopes, pipe routing, fabric, gravel, and where needed, sump pumps and
                monitoring — tailored to your home.
              </p>
            </Reveal>
            <Reveal delay={0.15}>
              <p>
                The result is invisible after backfill and massively reduces flood risk. That's why our neighbors give
                us a {COMPANY.rating}-star rating and trust us to protect their biggest investment.
              </p>
            </Reveal>
          </div>
        </div>
      </section>

      {/* Values */}
      <section data-testid="about-values" className="section bg-secondary">
        <div className="container-fg">
          <Reveal className="mb-14 max-w-2xl">
            <p className="overline mb-5">What we stand for</p>
            <h2 className="font-display text-4xl sm:text-5xl tracking-tight text-brand-navy leading-tight">
              Engineered, local, and built for Florida storms.
            </h2>
          </Reveal>
          <RevealGroup className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {VALUES.map((v, i) => {
              const Icon = VALUE_ICONS[i];
              return (
                <RevealItem key={v.title} className="bg-card border border-border rounded-sm p-7">
                  <Icon className="text-brand-orange mb-6" size={28} />
                  <h3 className="font-display text-xl text-brand-navy tracking-tight">{v.title}</h3>
                  <p className="mt-3 text-brand-slate leading-relaxed">{v.body}</p>
                </RevealItem>
              );
            })}
          </RevealGroup>
        </div>
      </section>

      {/* Stats strip */}
      <section className="bg-brand-navy text-white">
        <div className="container-fg py-16 grid grid-cols-2 lg:grid-cols-4 gap-10">
          {STATS.map((s) => (
            <div key={s.label} className="border-l border-white/15 pl-5">
              <div className="font-display text-4xl">
                {s.value}{s.suffix}
              </div>
              <p className="mt-2 text-sm text-white/60 max-w-[15rem]">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      <FinalCTA />
    </>
  );
}
