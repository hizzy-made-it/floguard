import { useState } from "react";
import { SERVICE_AREAS } from "../data/site";

// Infinite service-area ticker — a premium, editorial touch.
// Slowed on mobile + pauses on touch/hold.
export const Marquee = () => {
  const [paused, setPaused] = useState(false);
  const items = [...SERVICE_AREAS, "Serving Central Florida"];
  const doubled = [...items, ...items];

  const pause = () => setPaused(true);
  const resume = () => setPaused(false);

  return (
    <div
      data-testid="area-marquee"
      className="relative bg-brand-ink border-b border-white/10 py-5 overflow-hidden group"
      onTouchStart={pause}
      onTouchEnd={resume}
      onTouchCancel={resume}
    >
      <div
        className={`flex whitespace-nowrap marquee-track group-hover:[animation-play-state:paused] ${paused ? "[animation-play-state:paused]" : ""}`}
      >
        {doubled.map((a, i) => (
          <span key={i} className="mx-6 inline-flex items-center gap-6 text-sm uppercase tracking-[0.2em] text-white/40">
            {a}
            <span className="w-1.5 h-1.5 rounded-full bg-brand-orange" />
          </span>
        ))}
      </div>
      <div className="pointer-events-none absolute inset-y-0 left-0 w-24 bg-gradient-to-r from-brand-ink to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-24 bg-gradient-to-l from-brand-ink to-transparent" />
    </div>
  );
};
