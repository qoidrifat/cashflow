import { cn } from '../../lib/utils';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  variant?: 'default' | 'gradient' | 'outlined';
  onClick?: () => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  role?: string;
  tabIndex?: number;
  'aria-label'?: string;
}

export default function Card({
  children,
  className,
  variant = 'default',
  onClick,
  onKeyDown,
  role,
  tabIndex,
  'aria-label': ariaLabel,
}: CardProps) {
  return (
    <div
      onClick={onClick}
      onKeyDown={onKeyDown}
      role={role}
      tabIndex={tabIndex}
      aria-label={ariaLabel}
      className={cn(
        'rounded-2xl p-4 sm:p-5 transition-all duration-200',
        variant === 'default' && [
          'app-surface hover:app-surface-hover',
        ],
        variant === 'gradient' && [
          'bg-gradient-to-br from-primary-500 via-soft-purple to-mint-500 dark:from-primary-500 dark:via-violet-500 dark:to-mint-500',
          'text-white',
          'shadow-lg shadow-primary-500/20 dark:shadow-primary-950/40',
        ],
        variant === 'outlined' && [
          'bg-app-surface/35 dark:bg-app-surface/35',
          'border border-app-border',
          'hover:border-primary-500/70 dark:hover:border-primary-400/60',
        ],
        onClick && 'cursor-pointer',
        className
      )}
    >
      {children}
    </div>
  );
}
