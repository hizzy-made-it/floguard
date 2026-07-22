import { RevealGroup } from "./Reveal";
import { STATS } from "../data/site";

/**
 * Static stat values in the DOM — no count-up from 0.
 * Animated counters previously left "0★" visible for users, crawlers, and
 * anyone who never triggered IntersectionObserver (trust + SEO damage).
 */
export const StatsBar = () => (
  <section data-testid="stats-bar" className="relative bg-brand-ink border-y border-white/10 grain">
    <RevealGroup className="container-fg relative z-10 py-10 sm:py-14 grid grid-cols-2 sm:grid-cols-4 gap-y-8 gap-x-6 sm:gap-x-8">
      {STATS.map((s) => {
        const decimals = s.decimals || 0;
        const display = Number(s.value).toFixed(decimals);
        return (
          <div key={s.label} className="flex flex-col gap-2 border-l border-white/10 pl-4 sm:pl-5">
            <span className="font-display text-4xl sm:text-5xl text-white tracking-tight tabular-nums">
              <span>{display}</span>
              <span className="text-brand-orange">{s.suffix}</span>
            </span>
            <p className="text-xs sm:text-sm text-white/55 leading-snug max-w-[15rem]">{s.label}</p>
          </div>
        );
      })}
    </RevealGroup>
  </section>
);
