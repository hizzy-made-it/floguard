import { motion } from "framer-motion";
import { PROCESS } from "../data/site";
import { viewportOnce, EASE } from "../lib/animations";

export const ProcessTimeline = ({ dark = false }) => (
  <div data-testid="process-timeline" className="relative">
    {/* connecting line */}
    <div className={`absolute left-[27px] md:left-1/2 top-0 bottom-0 w-px ${dark ? "bg-white/15" : "bg-border"}`} />
    <div className="space-y-12 md:space-y-0">
      {PROCESS.map((p, i) => {
        const right = i % 2 === 1;
        return (
          <div
            key={p.step}
            data-testid={`process-step-${p.step}`}
            className={`relative md:grid md:grid-cols-2 md:gap-16 ${i > 0 ? "md:-mt-8" : ""}`}
          >
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={viewportOnce}
              transition={{ duration: 0.7, ease: EASE }}
              className={`pl-16 md:pl-0 ${right ? "md:col-start-2" : "md:text-right md:pr-16"}`}
            >
              <div className={`flex items-baseline gap-4 mb-3 ${right ? "" : "md:justify-end"}`}>
                <span className="font-display text-5xl text-brand-orange">{p.step}</span>
                <h3 className={`font-display text-2xl tracking-tight ${dark ? "text-white" : "text-brand-navy"}`}>
                  {p.title}
                </h3>
              </div>
              <p className={`leading-relaxed max-w-md ${right ? "" : "md:ml-auto"} ${dark ? "text-white/60" : "text-brand-slate"}`}>
                {p.body}
              </p>
            </motion.div>
            {/* node */}
            <div className="absolute left-[18px] md:left-1/2 top-1 md:-translate-x-1/2">
              <motion.span
                initial={{ scale: 0 }}
                whileInView={{ scale: 1 }}
                viewport={viewportOnce}
                transition={{ type: "spring", stiffness: 300, damping: 18 }}
                className="block w-5 h-5 rounded-full bg-brand-orange ring-4 ring-brand-orange/20"
              />
            </div>
          </div>
        );
      })}
    </div>
  </div>
);
