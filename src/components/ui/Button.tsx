import { motion } from 'framer-motion';
import { cn } from '../../lib/utils';
import { Loader2 } from 'lucide-react';

interface ButtonProps
  extends Omit<
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    'onDrag' | 'onDragStart' | 'onDragEnd' | 'onAnimationStart' | 'onAnimationEnd' | 'onAnimationIteration'
  > {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: React.ReactNode;
  fullWidth?: boolean;
}

export default function Button({
  children,
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  fullWidth = false,
  className,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      whileHover={{ scale: 1.01 }}
      className={cn(
        'inline-flex items-center justify-center gap-2 font-medium rounded-xl transition-all duration-200',
        'focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-app-bg',
        'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100',
        
        // Variants
        variant === 'primary' && [
          'bg-gradient-to-r from-primary-500 to-soft-purple',
          'text-white shadow-sm shadow-primary-500/25',
          'hover:shadow-md hover:shadow-primary-500/30 dark:shadow-primary-950/40',
          'focus:ring-primary-500 dark:focus:ring-primary-400',
        ],
        variant === 'secondary' && [
          'bg-app-hover/80',
          'text-app-text',
          'hover:bg-app-hover',
          'focus:ring-app-subtle',
        ],
        variant === 'outline' && [
          'border-2 border-app-border',
          'text-app-text',
          'hover:border-primary-500 hover:text-primary-600 dark:hover:border-primary-400 dark:hover:text-primary-300',
          'focus:ring-primary-500 dark:focus:ring-primary-400',
        ],
        variant === 'ghost' && [
          'text-app-muted',
          'hover:bg-app-hover/70 hover:text-app-text',
          'focus:ring-app-subtle',
        ],
        variant === 'danger' && [
          // P2.3.2 — white on red-500 = 3.92:1 (gagal AA utk teks normal) →
          // red-600 (#dc2626) = 4.83:1 (lolos). Perubahan design-token shared.
          'bg-red-600 text-white',
          'hover:bg-red-700 shadow-sm dark:shadow-red-950/30 disabled:hover:bg-red-600',
          'focus:ring-red-600',
        ],

        // Sizes
        size === 'sm' && 'px-3 py-1.5 text-xs',
        size === 'md' && 'px-4 py-2.5 text-sm',
        size === 'lg' && 'px-6 py-3 text-base',

        fullWidth && 'w-full',

        className
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : icon ? (
        icon
      ) : null}
      {children}
    </motion.button>
  );
}
