import type { Budget, CreateNotificationInput } from '../../../types';
import { formatCurrency } from '../../../lib/utils';

export function getBudgetUsagePercentage(budget: Pick<Budget, 'amount' | 'usedAmount'>): number {
  if (!budget.amount) return 0;
  return Math.round((budget.usedAmount / budget.amount) * 100);
}

export function buildBudgetWarningKey(categoryId: string, month: number, year: number): string {
  return `budget-warning-${categoryId}-${month}-${year}`;
}

export function buildBudgetOverKey(categoryId: string, month: number, year: number): string {
  return `budget-over-${categoryId}-${month}-${year}`;
}

export function buildBudgetWarningNotification(
  budget: Budget,
  month: number,
  year: number,
): CreateNotificationInput {
  const usage = getBudgetUsagePercentage(budget);
  const remaining = Math.max(0, budget.amount - budget.usedAmount);

  return {
    type: 'budget',
    priority: 'normal',
    title: `Budget ${budget.categoryName} hampir penuh`,
    message: `Pemakaian sudah ${usage}% dari batas. Sisa budget ${formatCurrency(remaining)}.`,
    actionHref: '/budgets',
    actionLabel: 'Lihat Budget',
    dedupeKey: buildBudgetWarningKey(budget.categoryId, month, year),
    metadata: {
      categoryId: budget.categoryId,
      month,
      year,
      usage,
    },
  };
}

export function buildBudgetOverNotification(
  budget: Budget,
  month: number,
  year: number,
): CreateNotificationInput {
  const overage = Math.max(0, budget.usedAmount - budget.amount);

  return {
    type: 'budget',
    priority: 'high',
    title: `Budget ${budget.categoryName} terlampaui`,
    message: `${budget.categoryName} sudah melewati batas sebesar ${formatCurrency(overage)}. Total pengeluaran ${formatCurrency(budget.usedAmount)}.`,
    actionHref: '/budgets',
    actionLabel: 'Lihat Budget',
    dedupeKey: buildBudgetOverKey(budget.categoryId, month, year),
    metadata: {
      categoryId: budget.categoryId,
      month,
      year,
      overage,
    },
  };
}
