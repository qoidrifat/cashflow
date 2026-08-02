import { cn } from '../../lib/utils';
import { Inbox } from 'lucide-react';

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export default function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div className={cn(
      'flex flex-col items-center justify-center py-16 px-6',
      'text-center',
      className
    )}>
      <div className="relative mb-4">
        <div className="absolute inset-0 rounded-3xl bg-primary-500/10 blur-xl" />
        <div className="relative w-16 h-16 rounded-3xl border border-app-border bg-app-elevated flex items-center justify-center text-primary-500 dark:text-primary-300 shadow-sm">
          {icon || <Inbox className="w-8 h-8" />}
        </div>
      </div>
      <h3 className="text-base font-bold text-app-text mb-1">
        {title}
      </h3>
      {description && (
        <p className="text-sm leading-relaxed text-app-muted max-w-sm mb-4">
          {description}
        </p>
      )}
      {action && (
        <div className="mt-2">
          {action}
        </div>
      )}
    </div>
  );
}
