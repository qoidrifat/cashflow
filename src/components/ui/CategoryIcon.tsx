/**
 * CategoryIcon
 *
 * Reusable component for displaying category icons with soft background,
 * consistent sizing, dark/light mode support, and contextual animations.
 *
 * Usage:
 *   <CategoryIcon name="Makanan & Minuman" />
 *   <CategoryIcon name="Gaji" type="income" size="lg" />
 *   <CategoryIcon name="Makanan" animated animationVariant="hover" interactive />
 */

import { type LucideIcon } from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
import { getCategoryMeta } from '../../config/categoryIcons';
import { cn } from '../../lib/utils';

export type IconSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
export type AnimationVariant = 'none' | 'soft' | 'hover' | 'selected' | 'success' | 'warning' | 'review';

interface CategoryIconProps {
  /** Category name (case-insensitive) */
  name?: string | null;
  /** 'expense' | 'income' — used for color fallback */
  type?: 'expense' | 'income';
  /** Icon size variant */
  size?: IconSize;
  /** Additional class names */
  className?: string;
  /** Show as a circle (default: rounded-xl/rounded-2xl) */
  circle?: boolean;
  /** Override icon component */
  iconOverride?: LucideIcon;
  /** No background — just the icon */
  noBackground?: boolean;
  /** Enable animations (default: false for performance) */
  animated?: boolean;
  /** Animation variant based on UI context */
  animationVariant?: AnimationVariant;
  /** Enable hover/tap interactions (only when animated) */
  interactive?: boolean;
}

const sizeMap: Record<IconSize, { container: string; icon: string }> = {
  xs: { container: 'w-6 h-6', icon: 'w-3 h-3' },
  sm: { container: 'w-7 h-7', icon: 'w-3.5 h-3.5' },
  md: { container: 'w-9 h-9', icon: 'w-[18px] h-[18px]' },
  lg: { container: 'w-10 h-10', icon: 'w-5 h-5' },
  xl: { container: 'w-12 h-12', icon: 'w-6 h-6' },
};

// ===================== Animation Variants =====================

const containerVariants = {
  initial: (variant: AnimationVariant) => {
    switch (variant) {
      case 'soft':
      case 'hover':
      case 'selected':
        return { opacity: 0, scale: 0.92 };
      case 'success':
        return { opacity: 0, scale: 0.8 };
      case 'review':
        return { opacity: 0, scale: 0.95 };
      default:
        return { opacity: 1, scale: 1 };
    }
  },
  animate: (variant: AnimationVariant) => {
    switch (variant) {
      default:
        return { opacity: 1, scale: 1 };
    }
  },
};

const transition = {
  type: 'spring' as const,
  stiffness: 300,
  damping: 20,
  mass: 0.8,
  duration: 0.25,
};

const warningPulse = {
  scale: [1, 1.04, 1],
  transition: {
    duration: 2,
    repeat: Infinity,
    ease: 'easeInOut' as const,
  },
};

const reviewBreathing = {
  opacity: [1, 0.7, 1],
  scale: [1, 0.98, 1],
  transition: {
    duration: 2.5,
    repeat: 3,
    ease: 'easeInOut' as const,
  },
};

const hoverScale = { scale: 1.05, rotate: 1.5 };
const tapScale = { scale: 0.96 };

export default function CategoryIcon({
  name,
  type,
  size = 'md',
  className,
  circle = false,
  iconOverride,
  noBackground = false,
  animated = false,
  animationVariant = 'soft',
  interactive = false,
}: CategoryIconProps) {
  const prefersReducedMotion = useReducedMotion();
  const meta = getCategoryMeta(name, type);
  const IconComponent = iconOverride || meta.icon;
  const dims = sizeMap[size];

  // Respect reduced motion — only allow opacity changes
  const shouldAnimate = animated && !prefersReducedMotion;
  const variant = shouldAnimate ? animationVariant : 'none';

  const iconContent = (
    <IconComponent
      className={cn(dims.icon, meta.textLight, meta.textDark)}
      aria-label={name || 'Category'}
    />
  );

  if (noBackground) {
    if (!shouldAnimate) {
      return (
        <IconComponent
          className={cn(dims.icon, meta.textLight, meta.textDark, className)}
          aria-label={name || 'Category'}
        />
      );
    }

    return (
      <motion.div
        initial="initial"
        animate="animate"
        variants={containerVariants}
        custom={variant}
        transition={transition}
        whileHover={interactive ? hoverScale : undefined}
        whileTap={interactive ? tapScale : undefined}
        // P2.3.2 — saat `interactive`, framer membuat motion.div focusable
        // (tabindex=0) → wajib punya accessible name agar tidak jadi focus
        // stop kosong (nama dari prop name).
        aria-label={name || 'Category'}
        className="inline-flex"
        style={{ willChange: shouldAnimate ? 'transform' : undefined }}
      >
        {iconContent}
      </motion.div>
    );
  }

  // Build animation-specific classes for selected state glow
  const selectedClasses = animationVariant === 'selected' && shouldAnimate
    ? 'ring-2 ring-primary-300 dark:ring-primary-400/40 shadow-sm shadow-primary-200/30 dark:shadow-primary-900/20'
    : '';

  const baseClasses = cn(
    'flex items-center justify-center flex-shrink-0 transition-colors',
    dims.container,
    circle ? 'rounded-full' : 'rounded-xl',
    meta.bgLight,
    meta.bgDark,
    selectedClasses,
    className,
  );

  if (!shouldAnimate) {
    return (
      <div className={baseClasses} aria-label={name || 'Category'}>
        {iconContent}
      </div>
    );
  }

  // Create custom animate for warning/review that includes the looping animation
  const customAnimate = variant === 'warning'
    ? warningPulse
    : variant === 'review'
    ? reviewBreathing
    : 'animate';

  return (
    <motion.div
      initial="initial"
      animate={customAnimate}
      variants={containerVariants}
      custom={variant}
      transition={transition}
      whileHover={interactive ? hoverScale : undefined}
      whileTap={interactive ? tapScale : undefined}
      className={cn(baseClasses, 'will-change-transform')}
      aria-label={name || 'Category'}
    >
      {iconContent}
    </motion.div>
  );
}
