// Reusable Framer Motion animation system for FloGuard.
export const EASE = [0.22, 1, 0.36, 1];
export const EASE_IN_OUT = [0.65, 0, 0.35, 1];

export const springSoft = { type: "spring", stiffness: 220, damping: 28, mass: 0.9 };
export const springSnappy = { type: "spring", stiffness: 400, damping: 30 };

export const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.8, ease: EASE } },
};

export const fadeIn = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.9, ease: EASE } },
};

export const blurIn = {
  hidden: { opacity: 0, filter: "blur(12px)", y: 16 },
  visible: { opacity: 1, filter: "blur(0px)", y: 0, transition: { duration: 0.9, ease: EASE } },
};

export const clipReveal = {
  hidden: { opacity: 0, clipPath: "inset(0 0 100% 0)" },
  visible: { opacity: 1, clipPath: "inset(0 0 0% 0)", transition: { duration: 1, ease: EASE } },
};

export const scaleIn = {
  hidden: { opacity: 0, scale: 0.96 },
  visible: { opacity: 1, scale: 1, transition: { duration: 0.7, ease: EASE } },
};

export const slideInLeft = {
  hidden: { opacity: 0, x: -40 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.8, ease: EASE } },
};

export const slideInRight = {
  hidden: { opacity: 0, x: 40 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.8, ease: EASE } },
};

export const staggerContainer = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.12, delayChildren: 0.08 } },
};

export const staggerFast = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.06 } },
};

// Word-by-word hero reveal
export const wordContainer = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.08, delayChildren: 0.1 } },
};
export const wordChild = {
  hidden: { opacity: 0, y: "110%" },
  visible: { opacity: 1, y: "0%", transition: { duration: 0.9, ease: EASE } },
};

export const pageTransition = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE } },
  exit: { opacity: 0, y: -8, transition: { duration: 0.3, ease: EASE } },
};

export const viewportOnce = { once: true, margin: "-80px" };

// Premium award-level additions
export const magneticHover = {
  rest: { scale: 1, transition: { duration: 0.2, ease: EASE } },
  hover: { scale: 1.015, transition: { duration: 0.2, ease: EASE } },
};

export const editorialStagger = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.09, delayChildren: 0.06 },
  },
};

export const subtleLift = {
  hidden: { opacity: 0, y: 18 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.85, ease: EASE } },
};

export const cardTilt = {
  rest: { rotateX: 0, rotateY: 0, scale: 1 },
  hover: { rotateX: 2, rotateY: -3, scale: 1.005, transition: { duration: 0.25, ease: EASE } },
};
