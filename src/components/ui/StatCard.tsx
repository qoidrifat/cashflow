import { motion } from 'framer-motion';
import { cn, formatCurrency } from '../../lib/utils';
import { TrendingUp, TrendingDown } from 'lucide-react';

interface StatCardProps {
  title: string;
  value: number;
  icon: React.ReactNode;
  variant?: 'default' | 'income' | 'expense';
  change?: number;
  changeLabel?: string;
  delay?: number;
}

export default function StatCard({
  title,
  value,
  icon,
  variant = 'default',
  change,
  changeLabel,
  delay = 0,
}: StatCardProps) {
  const isPositive = change && change >= 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: delay * 0.1 }}
      className={cn(
        'rounded-2xl p-4 sm:p-5',
        'app-surface hover:app-surface-hover transition-all duration-200'
      )}
    >
      <div className="flex items-start justify-between mb-3">
        <div className={cn(
          'w-10 h-10 rounded-xl flex items-center justify-center',
          variant === 'default' && 'bg-primary-50 dark:bg-primary-500/12 text-primary-600 dark:text-primary-300',
          variant === 'income' && 'bg-mint-50 dark:bg-mint-500/12 text-mint-600 dark:text-mint-300',
          variant === 'expense' && 'bg-red-50 dark:bg-red-500/12 text-red-500 dark:text-red-300'
        )}>
          {icon}
        </div>
        {change !== undefined && (
          <div className={cn(
            'flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full',
            isPositive
              ? 'bg-mint-50 dark:bg-mint-500/12 text-mint-600 dark:text-mint-300'
              : 'bg-red-50 dark:bg-red-500/12 text-red-500 dark:text-red-300'
          )}>
            {isPositive ? (
              <TrendingUp className="w-3 h-3" />
            ) : (
              <TrendingDown className="w-3 h-3" />
            )}
            <span>{Math.abs(change)}%</span>
          </div>
        )}
      </div>

      <p className="text-sm text-app-subtle mb-1">{title}</p>
      <p className={cn(
        'text-xl font-bold tabular-nums',
        variant === 'default' && 'text-app-text',
        variant === 'income' && 'text-mint-600 dark:text-mint-300',
        variant === 'expense' && 'text-red-500 dark:text-red-300'
      )}>
        {formatCurrency(value)}
      </p>
      {changeLabel && (
        <p className="text-xs text-app-subtle mt-1">{changeLabel}</p>
      )}
    </motion.div>
  );
}
