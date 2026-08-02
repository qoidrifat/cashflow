import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { CURRENCY_SYMBOL } from '../config/constants';

/**
 * Merge Tailwind CSS classes with conflict resolution
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format number to Indonesian currency format
 */
export function formatCurrency(amount: number): string {
  return `${CURRENCY_SYMBOL}${Math.abs(amount).toLocaleString('id-ID')}`;
}

/**
 * Format number to compact currency format (e.g., Rp1,5jt)
 */
export function formatCurrencyCompact(amount: number): string {
  if (amount >= 1_000_000_000) {
    return `${CURRENCY_SYMBOL}${(amount / 1_000_000_000).toFixed(1)}M`;
  }
  if (amount >= 1_000_000) {
    return `${CURRENCY_SYMBOL}${(amount / 1_000_000).toFixed(1)}jt`;
  }
  if (amount >= 1_000) {
    return `${CURRENCY_SYMBOL}${(amount / 1_000).toFixed(0)}rb`;
  }
  return formatCurrency(amount);
}

/**
 * Responsive currency formatting for mobile/compact vs full display
 * - 'full': Always show full format (e.g., Rp1.250.000)
 * - 'compact': Always show compact format for small cards
 * - 'auto': Full if < 1jt, compact if >= 1jt (default)
 */
export function formatResponsiveCurrency(amount: number, variant: 'full' | 'compact' | 'auto' = 'auto'): string {
  if (variant === 'full') return formatCurrency(amount);
  if (variant === 'compact') return formatCurrencyCompact(amount);
  // auto: compact only for large numbers on small screens
  if (amount >= 1_000_000) return formatCurrencyCompact(amount);
  return formatCurrency(amount);
}

/**
 * Format date string to Indonesian locale
 */
export function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Format date string to Indonesian locale with time
 */
export function formatDateTime(date: Date): string {
  return new Date(date).toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Get month name in Indonesian
 */
export function getMonthName(month: number): string {
  const months = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
  ];
  return months[month - 1] || '';
}

/**
 * Get current month (1-12)
 */
export function getCurrentMonth(): number {
  return new Date().getMonth() + 1;
}

/**
 * Get current year
 */
export function getCurrentYear(): number {
  return new Date().getFullYear();
}

/**
 * Get today's date string (YYYY-MM-DD)
 */
export function getTodayString(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * Debounce function
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}

/**
 * Generate unique ID
 */
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Get percentage value
 */
export function getPercentage(value: number, total: number): number {
  if (total === 0) return 0;
  return (value / total) * 100;
}

/**
 * Get budget status based on usage percentage
 */
export function getBudgetStatus(used: number, total: number): 'safe' | 'warning' | 'overbudget' {
  if (total === 0) return 'safe';
  const percentage = (used / total) * 100;
  if (percentage >= 100) return 'overbudget';
  if (percentage >= 80) return 'warning';
  return 'safe';
}

/**
 * Get color for budget status
 */
export function getBudgetStatusColor(status: 'safe' | 'warning' | 'overbudget'): string {
  switch (status) {
    case 'safe': return 'text-mint-500';
    case 'warning': return 'text-amber-500';
    case 'overbudget': return 'text-red-500';
  }
}

/**
 * Get background color for budget status
 */
export function getBudgetStatusBgColor(status: 'safe' | 'warning' | 'overbudget'): string {
  switch (status) {
    case 'safe': return 'bg-mint-500';
    case 'warning': return 'bg-amber-500';
    case 'overbudget': return 'bg-red-500';
  }
}

/**
 * Format transaction type to readable text
 */
export function formatTransactionType(type: string): string {
  switch (type) {
    case 'income': return 'Pemasukan';
    case 'expense': return 'Pengeluaran';
    case 'transfer': return 'Transfer';
    case 'refund': return 'Refund';
    default: return type;
  }
}

/**
 * Format payment method to readable text
 */
export function formatPaymentMethod(method: string): string {
  switch (method) {
    case 'cash': return 'Cash';
    case 'transfer-bank': return 'Transfer Bank';
    case 'qris': return 'QRIS';
    case 'e-wallet': return 'E-Wallet';
    case 'kartu-debit': return 'Kartu Debit';
    case 'kartu-kredit': return 'Kartu Kredit';
    case 'lainnya-payment': return 'Lainnya';
    default: return method;
  }
}

/**
 * Format source to readable text
 */
export function formatSource(source: string): string {
  switch (source) {
    case 'manual': return 'Manual';
    case 'gmail': return 'Auto from Gmail';
    default: return source;
  }
}

/**
 * Get initial letters from name
 */
export function getInitials(name: string): string {
  return name
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}
