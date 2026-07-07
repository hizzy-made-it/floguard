import { motion, useScroll, useSpring } from "framer-motion";

export const ScrollProgress = () => {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 120, damping: 30, mass: 0.4 });
  return (
    <motion.div
      data-testid="scroll-progress"
      style={{ scaleX }}
      className="fixed top-0 left-0 right-0 h-[3px] bg-brand-orange origin-left z-[60]"
    />
  );
};
