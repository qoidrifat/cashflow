import { memo, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowDownRight,
  ArrowUpRight,
  RefreshCw,
  Undo2,
  Mail,
  ShieldAlert,
} from 'lucide-react';
import type { Transaction } from '../../types';
import { cn, formatCurrency, formatDate } from '../../lib/utils';
import CategoryIcon from './CategoryIcon';

interface TransactionItemProps {
  transaction: Transaction;
  onClick?: (transaction: Transaction) => void;
  delay?: number;
}

const typeConfig: Record<Transaction['type'], { icon: typeof ArrowDownRight; color: string; bg: string; label: string }> = {
  income: { icon: ArrowDownRight, color: 'text-mint-500 dark:text-mint-300', bg: 'bg-mint-50 dark:bg-mint-500/12', label: 'Pemasukan' },
  expense: { icon: ArrowUpRight, color: 'text-red-500 dark:text-red-300', bg: 'bg-red-50 dark:bg-red-500/12', label: 'Pengeluaran' },
  transfer: { icon: RefreshCw, color: 'text-primary-500 dark:text-primary-300', bg: 'bg-primary-50 dark:bg-primary-500/12', label: 'Transfer' },
  refund: { icon: Undo2, color: 'text-soft-purple dark:text-violet-300', bg: 'bg-purple-50 dark:bg-violet-500/12', label: 'Refund' },
};

const sourceLabel: Record<string, string> = {
  gmail: 'Gmail',
  fallback: 'Fallback',
  ai: 'AI',
  import: 'Import',
};

function TransactionItemInner({ transaction, onClick, delay = 0 }: TransactionItemProps): ReactNode {
  const config = typeConfig[transaction.type] || typeConfig.expense;
  const isAutomatedSource = transaction.source !== 'manual';
  const label = sourceLabel[transaction.source] || transaction.source;
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: delay * 0.05 }}
      onClick={() => onClick?.(transaction)}
      className={cn(
        'flex items-center gap-3 p-4',
        'hover:bg-app-hover/55',
        'transition-colors duration-150',
        'cursor-pointer',
        'border-b border-app-border/70 last:border-b-0'
      )}
    >
      {/* Icon */}
      <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0', config.bg)}>
        {isAutomatedSource ? (
          <Mail className={cn('w-5 h-5', config.color)} />
        ) : (
          <CategoryIcon
            name={transaction.categoryName}
            type={transaction.type === 'income' ? 'income' : 'expense'}
            size="lg"
            noBackground
            animated
            animationVariant="soft"
            // P2.3.2 — TANPA `interactive`: ikon di list adalah dekoratif; tanpa
            // whileHover/whileTap framer tidak menambah tabindex="0" → tidak
            // ada focus stop tanpa nama di tab order (terbukti keyboard walk:
            // tiap item transaksi menyumbang satu DIV fokus kosong).
          />
        )}
      </div>

      {/* Details */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-app-text truncate">
            {transaction.merchant || transaction.categoryName}
          </p>
          {isAutomatedSource && (
            <span className="text-[10px] font-medium text-primary-600 dark:text-primary-300 bg-primary-50 dark:bg-primary-500/12 px-1.5 py-0.5 rounded-full">
              {label}
            </span>
          )}
          {/* P2.9 §31 — indikator penautan akun: transaksi yang belum dikaitkan
              ke rekening terlihat jelas (tidak disembunyikan). */}
          {transaction.accountId == null && (
            <span className="text-[10px] font-medium text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/12 px-1.5 py-0.5 rounded-full">
              Belum ditautkan
            </span>
          )}
          {transaction.fraudFlag && (
            <span
              className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-500/15 px-1.5 py-0.5 rounded-full"
              title={transaction.fraudFlag === 'blocked'
                ? 'Aktivitas berisiko tinggi — segera verifikasi'
                : 'Transaksi terdeteksi mencurigakan oleh sistem anti-fraud'}
            >
              <ShieldAlert className="w-3 h-3" aria-hidden="true" />
              {transaction.fraudFlag === 'blocked' ? 'Risiko tinggi' : 'Mencurigakan'}
            </span>
          )}
        </div>
        <p className="text-xs text-app-subtle mt-0.5">
          {transaction.categoryName} &middot; {formatDate(transaction.date)}
        </p>
        {transaction.note && (
          <p className="text-[11px] text-app-subtle/70 mt-0.5 truncate max-w-[180px] sm:max-w-[240px]">
            {transaction.note}
          </p>
        )}
      </div>

      {/* Amount */}
      <div className="text-right">
        <p className={cn(
          'text-sm font-semibold tabular-nums',
          transaction.type === 'income' || transaction.type === 'refund'
            ? 'text-mint-600 dark:text-mint-300'
            : 'text-red-500 dark:text-red-300'
        )}>
          {transaction.type === 'income' || transaction.type === 'refund' ? '+' : '-'}
          {formatCurrency(transaction.amount)}
        </p>
        <p className="text-[10px] text-app-subtle mt-0.5">
          {config.label}
        </p>
      </div>
    </motion.div>
  );
}

/**
 * Sprint 1.8: React.memo — item list transaksi (dashboard + transactions page)
 * hanya re-render saat props-nya berubah. Sebelumnya setiap SSE update
 * (transaction:created/updated/deleted) memicu re-render SEMUA item list.
 */
const TransactionItem = memo(TransactionItemInner);

export default TransactionItem;
