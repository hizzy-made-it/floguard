import { motion } from "framer-motion";
import { CloudRain, Layers, Waves, Container, ArrowRightToLine, ChevronRight } from "lucide-react";
import { FLOW_PATH } from "../data/site";
import { viewportOnce, EASE } from "../lib/animations";

const ICONS = [CloudRain, Layers, Waves, Container, ArrowRightToLine];

// Visual explanation: surface water -> gravel -> pipe -> sump -> discharge
export const FlowPath = ({ dark = false }) => (
  <div data-testid="flow-path" className="relative">
    <div className="grid gap-4 md:grid-cols-5">
      {FLOW_PATH.map((node, i) => {
        const Icon = ICONS[i];
        return (
          <div key={node.label} className="relative">
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={viewportOnce}
              transition={{ duration: 0.6, ease: EASE, delay: i * 0.12 }}
              className={`h-full rounded-sm border p-5 ${
                dark ? "border-white/12 bg-white/[0.03]" : "border-border bg-card"
              }`}
            >
              <div className="flex items-center gap-3">
                <Icon size={22} className="text-brand-orange" />
                <span className={`text-xs font-bold ${dark ? "text-white/40" : "text-brand-slate/50"}`}>
                  0{i + 1}
                </span>
              </div>
              <h4 className={`mt-4 font-display text-lg tracking-tight ${dark ? "text-white" : "text-brand-navy"}`}>
                {node.label}
              </h4>
              <p className={`mt-1.5 text-sm leading-relaxed ${dark ? "text-white/55" : "text-brand-slate"}`}>
                {node.desc}
              </p>
            </motion.div>
            {i < FLOW_PATH.length - 1 && (
              <ChevronRight
                className="hidden md:block absolute top-1/2 -right-3 -translate-y-1/2 text-brand-orange/60 z-10"
                size={22}
              />
            )}
          </div>
        );
      })}
    </div>
  </div>
);
