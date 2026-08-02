import { useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';

interface PageTransitionProps {
  children: React.ReactNode;
}

/**
 * PageTransition — Wraps page content with smooth fade + slide-up animation
 * on route change. Uses Framer Motion for GPU-accelerated transform/opacity.
 *
 * Uses a key-based motion.div (no AnimatePresence) so the new page animates in
 * immediately without waiting for an exit animation — avoids a blank gap.
 *
 * Respects prefers-reduced-motion via framer-motion's built-in support.
 */
export default function PageTransition({ children }: PageTransitionProps) {
  const location = useLocation();

  return (
    <motion.div
      key={location.pathname}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.2,
        ease: [0.22, 1, 0.36, 1], // custom cubic-bezier: smooth ease-out
      }}
    >
      {children}
    </motion.div>
  );
}
