import { cn } from '../../lib/utils';

interface SuccessCheckAnimationProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  showParticles?: boolean;
}

/**
 * SuccessCheckAnimation — A fun, smooth, and professional success checkmark animation.
 *
 * Uses only CSS keyframes (no external dependencies):
 * - Circle pops in with a bounce
 * - Checkmark stroke draws in from left to right
 * - Optional subtle particle burst in 4 directions
 *
 * Respects prefers-reduced-motion.
 */
export default function SuccessCheckAnimation({
  size = 'lg',
  className = '',
  showParticles = true,
}: SuccessCheckAnimationProps) {
  const sizeClass =
    size === 'sm' ? 'h-14 w-14' : size === 'md' ? 'h-20 w-20' : 'h-24 w-24';

  return (
    <div className={cn('relative flex items-center justify-center', className)}>
      {/* Particles — subtle burst in 4 directions */}
      {showParticles && (
        <div className="pointer-events-none absolute inset-0" aria-hidden="true">
          <span className="success-particle success-particle-1" />
          <span className="success-particle success-particle-2" />
          <span className="success-particle success-particle-3" />
          <span className="success-particle success-particle-4" />
        </div>
      )}

      {/* Circle with checkmark */}
      <div
        className={cn(
          sizeClass,
          'success-check-circle',
          'relative flex items-center justify-center',
          'rounded-full bg-emerald-500',
          'shadow-xl shadow-emerald-500/25',
          'dark:bg-emerald-400 dark:shadow-emerald-400/20',
        )}
      >
        {/* Checkmark SVG */}
        <svg
          viewBox="0 0 52 52"
          className="h-2/3 w-2/3"
          aria-hidden="true"
        >
          <path
            className="success-check-path"
            fill="none"
            stroke="white"
            strokeWidth="6"
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M14 27l8 8 17-19"
          />
        </svg>
      </div>
    </div>
  );
}
