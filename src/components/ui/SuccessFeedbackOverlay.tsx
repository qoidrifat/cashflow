import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';
import SuccessCheckAnimation from './SuccessCheckAnimation';

interface SuccessFeedbackOverlayProps {
  title: string;
  description: string;
  detail?: string;
  children?: ReactNode;
  className?: string;
}

export default function SuccessFeedbackOverlay({
  title,
  description,
  detail,
  children,
  className,
}: SuccessFeedbackOverlayProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-4 py-6 text-center',
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <SuccessCheckAnimation size="lg" showParticles />

      <div>
        <h3 className="text-lg font-semibold text-slate-950 dark:text-slate-50">
          {title}
        </h3>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          {description}
        </p>
        {detail && (
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-500">
            {detail}
          </p>
        )}
      </div>

      {children}
    </div>
  );
}
