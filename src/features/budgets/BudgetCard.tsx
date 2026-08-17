/**
 * BudgetCard — kartu budget per kategori (diekstrak dari BudgetsPage, P1.6).
 *
 * P1.6: widget budget di-ekstrak menjadi komponen tersendiri agar perilaku
 * user-visible (status, persentase progress, tombol hapus) bisa di-test tanpa
 * mock seluruh halaman. TIDAK ada perubahan perilaku: JSX dipindah apa adanya
 * dari BudgetsPage (motion wrapper ikut pindah agar animasi identik).
 *
 * Props:
 *   - budget  : Budget dengan `usedAmount` & `status` yang SUDAH dihitung
 *               pemanggil (getBudgetStatus) — kartu murni presentasi.
 *   - onDelete: dipanggil dengan budget.id saat tombol hapus diklik.
 *   - index   : delay animasi (pola list existing, default 0).
 */
import { motion } from 'framer-motion';
import { AlertTriangle } from 'lucide-react';
import CategoryIcon from '../../components/ui/CategoryIcon';
import Card from '../../components/ui/Card';
import { cn, formatCurrency, getBudgetStatusColor, getBudgetStatusBgColor } from '../../lib/utils';
import type { Budget } from '../../types';

export interface BudgetCardProps {
  budget: Budget;
  onDelete: (budgetId: string) => void;
  index?: number;
}

const STATUS_LABELS: Record<Budget['status'], string> = {
  safe: 'Aman',
  warning: 'Waspada',
  overbudget: 'Overbudget',
};

/**
 * Persentase progress bar (murni — di-test P1.6). Business rule existing:
 * clamp ke 100 (UI tidak pernah overflow); amount 0 → 0 (guard pembagian nol).
 */
export function budgetProgressPercent(usedAmount: number, amount: number): number {
  return amount > 0 ? Math.min((usedAmount / amount) * 100, 100) : 0;
}

export default function BudgetCard({ budget, onDelete, index = 0 }: BudgetCardProps) {
  const percentage = budgetProgressPercent(budget.usedAmount, budget.amount);
  const statusColor = getBudgetStatusColor(budget.status);
  const statusBg = getBudgetStatusBgColor(budget.status);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
    >
      <Card className="relative overflow-hidden">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            <CategoryIcon
              name={budget.categoryName}
              type="expense"
              size="sm"
              animated
              animationVariant={budget.status !== 'safe' ? 'warning' : 'soft'}
            />
            <div>
              <h3 className="text-sm font-semibold text-app-text">
                {budget.categoryName}
              </h3>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs text-app-subtle">
                  {formatCurrency(budget.usedAmount)} / {formatCurrency(budget.amount)}
                </span>
                {budget.status === 'overbudget' && (
                  <AlertTriangle className="w-3 h-3 text-red-500" />
                )}
              </div>
            </div>
            <span className={cn('text-xs font-medium', statusColor)}>
              {STATUS_LABELS[budget.status]}
            </span>
          </div>
        </div>

        {/* Progress bar */}
        <div className="h-2 bg-app-hover/80 rounded-full overflow-hidden">
          <motion.div
            data-testid="budget-progress-bar"
            initial={{ width: 0 }}
            animate={{ width: `${percentage}%` }}
            transition={{ duration: 0.5, delay: index * 0.1 }}
            className={cn('h-full rounded-full transition-all', statusBg)}
          />
        </div>

        <button
          onClick={() => onDelete(budget.id)}
          aria-label={`Hapus budget ${budget.categoryName}`}
          className="absolute top-3 right-3 p-1 app-icon-button hover:text-red-500 dark:hover:text-red-300 opacity-0 group-hover:opacity-100"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </Card>
    </motion.div>
  );
}
