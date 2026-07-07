import { motion } from "framer-motion";
import { fadeUp, staggerContainer, viewportOnce } from "../lib/animations";

// Scroll-reveal wrapper. `as` lets you pick the element; children receive stagger.
export const Reveal = ({ children, className = "", variants = fadeUp, delay = 0, as: Tag = motion.div }) => (
  <Tag
    className={className}
    initial="hidden"
    whileInView="visible"
    viewport={viewportOnce}
    variants={variants}
    transition={{ delay }}
  >
    {children}
  </Tag>
);

export const RevealGroup = ({ children, className = "", stagger = staggerContainer }) => (
  <motion.div
    className={className}
    initial="hidden"
    whileInView="visible"
    viewport={viewportOnce}
    variants={stagger}
  >
    {children}
  </motion.div>
);

export const RevealItem = ({ children, className = "", variants = fadeUp }) => (
  <motion.div className={className} variants={variants}>
    {children}
  </motion.div>
);
