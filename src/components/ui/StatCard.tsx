import { motion } from 'framer-motion';
import { cn, formatCurrency } from '../../lib/utils';
import { TrendingUp, TrendingDown } from 'lucide-react';

interface StatCardProps {
  title: string;
  value: number;
  icon: React.ReactNode;
  variant?: 'default' | 'income' | 'expense';
  /**
   * Tandai nilai negatif (balance < 0): nilai ditampilkan merah + prefix minus
   * — pola sama dengan ProfilePage (text-red-600 dark:text-red-400).
   * formatCurrency global TIDAK diubah (Math.abs di dalamnya) — indikasi
   * negatif sepenuhnya tanggung jawab pemakai prop ini.
   */
  negative?: boolean;
  /**
   * Display prefix MURNI (tanpa efek warna) — bahasa tanda TransactionItem
   * (income/refund → '+', expense/transfer → '-'):
   *   'plus'  → '+'
   *   'minus' → '-'
   *   'none'  → tanpa tanda (eksplisit)
   * Warna TIDAK terpengaruh — urusan `variant` (income → mint, expense →
   * merah) dan `negative` (merah).
   * API 2026-08-09: prop `positive` (prefix '+' + mint di variant default)
   * DIHAPUS — peran warna mint diambil alih `variant="income"`, peran
   * prefix diambil `sign`. `sign` murni display (bukan asersi nilai).
   * Prioritas: `negative` SELALU menang atas `sign` (peringatan mendominasi).
   * Pola rekomendasi (hindari "+Rp0"/"-Rp0") — `sign` hanya prefix:
   *   sign={value > 0 ? 'plus' : value < 0 ? 'minus' : 'none'}
   * Bila nilai benar-benar negatif dan perlu WARNA merah, sertakan
   * `negative={value < 0}` (atau pakai variant income/expense untuk warna
   * semantik) — `sign='minus'` di variant default TIDAK memberi warna.
   */
  sign?: 'plus' | 'minus' | 'none';
  change?: number;
  changeLabel?: string;
  delay?: number;
}

export default function StatCard({
  title,
  value,
  icon,
  variant = 'default',
  negative = false,
  sign,
  change,
  changeLabel,
  delay = 0,
}: StatCardProps) {
  const isPositive = change && change >= 0;
  // Prioritas: negative (peringatan) > sign. sign='none'/undefined → tanpa tanda.
  const prefix = negative ? '-' : sign === 'plus' ? '+' : sign === 'minus' ? '-' : '';

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
        variant === 'default' && (negative
          ? 'text-red-600 dark:text-red-400'
          : 'text-app-text'),
        variant === 'income' && 'text-mint-600 dark:text-mint-300',
        variant === 'expense' && 'text-red-500 dark:text-red-300'
      )}>
        {prefix}{formatCurrency(value)}
      </p>
      {changeLabel && (
        <p className="text-xs text-app-subtle mt-1">{changeLabel}</p>
      )}
    </motion.div>
  );
}
