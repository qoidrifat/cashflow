import { cn } from '../../lib/utils';

interface SkeletonProps {
  className?: string;
  variant?: 'text' | 'circular' | 'rectangular' | 'card';
}

export default function Skeleton({ className, variant = 'text' }: SkeletonProps) {
  return (
    <div
      className={cn(
        'animate-pulse bg-app-hover/80',
        variant === 'text' && 'h-4 rounded',
        variant === 'circular' && 'rounded-full',
        variant === 'rectangular' && 'rounded-xl',
        variant === 'card' && 'rounded-2xl h-32',
        className
      )}
    />
  );
}

export function StatCardSkeleton() {
  return (
    <div className="rounded-2xl p-5 app-surface">
      <div className="flex items-start justify-between mb-3">
        <Skeleton variant="rectangular" className="w-10 h-10" />
        <Skeleton variant="text" className="w-16 h-6" />
      </div>
      <Skeleton variant="text" className="w-24 h-4 mb-2" />
      <Skeleton variant="text" className="w-32 h-7" />
    </div>
  );
}

export function TransactionSkeleton() {
  return (
    <div className="flex items-center gap-3 p-4">
      <Skeleton variant="circular" className="w-10 h-10" />
      <div className="flex-1 space-y-2">
        <Skeleton variant="text" className="w-32" />
        <Skeleton variant="text" className="w-24 h-3" />
      </div>
      <Skeleton variant="text" className="w-20" />
    </div>
  );
}

export function ChartSkeleton() {
  return (
    <div className="rounded-2xl p-5 app-surface">
      <Skeleton variant="text" className="w-40 h-5 mb-4" />
      <Skeleton variant="rectangular" className="w-full h-[200px]" />
    </div>
  );
}
