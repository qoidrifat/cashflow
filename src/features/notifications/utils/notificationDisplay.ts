import {
  AlertTriangle,
  CheckCircle2,
  CircleAlert,
  Info,
  Mail,
  PieChart,
  ReceiptText,
  Settings,
} from 'lucide-react';
import type { NotificationType } from '../types';

export const notificationTypeLabels: Record<NotificationType, string> = {
  transaction: 'Transaksi',
  budget: 'Budget',
  gmail: 'Gmail',
  system: 'Sistem',
  success: 'Sukses',
  warning: 'Peringatan',
  error: 'Error',
  info: 'Info',
};

export const notificationFilterOptions: Array<{ value: NotificationType | 'all'; label: string }> = [
  { value: 'all', label: 'Semua' },
  { value: 'transaction', label: 'Transaksi' },
  { value: 'budget', label: 'Budget' },
  { value: 'gmail', label: 'Gmail' },
  { value: 'system', label: 'Sistem' },
  { value: 'success', label: 'Sukses' },
  { value: 'warning', label: 'Warning' },
  { value: 'error', label: 'Error' },
  { value: 'info', label: 'Info' },
];

export const typeIconMap = {
  transaction: ReceiptText,
  budget: PieChart,
  gmail: Mail,
  system: Settings,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: CircleAlert,
  info: Info,
} satisfies Record<NotificationType, typeof ReceiptText>;

export const typeColorMap: Record<NotificationType, { bg: string; text: string; dot: string; border: string }> = {
  transaction: { bg: 'bg-primary-50 dark:bg-primary-500/12', text: 'text-primary-600 dark:text-primary-300', dot: 'bg-primary-500', border: 'border-primary-500' },
  budget: { bg: 'bg-amber-50 dark:bg-amber-500/12', text: 'text-amber-600 dark:text-amber-300', dot: 'bg-amber-500', border: 'border-amber-500' },
  gmail: { bg: 'bg-mint-50 dark:bg-mint-500/12', text: 'text-mint-600 dark:text-mint-300', dot: 'bg-mint-500', border: 'border-mint-500' },
  system: { bg: 'bg-slate-50 dark:bg-slate-500/12', text: 'text-slate-600 dark:text-slate-300', dot: 'bg-slate-500', border: 'border-slate-500' },
  success: { bg: 'bg-mint-50 dark:bg-mint-500/12', text: 'text-mint-600 dark:text-mint-300', dot: 'bg-mint-500', border: 'border-mint-500' },
  warning: { bg: 'bg-amber-50 dark:bg-amber-500/12', text: 'text-amber-600 dark:text-amber-300', dot: 'bg-amber-500', border: 'border-amber-500' },
  error: { bg: 'bg-red-50 dark:bg-red-500/12', text: 'text-red-600 dark:text-red-300', dot: 'bg-red-500', border: 'border-red-500' },
  info: { bg: 'bg-blue-50 dark:bg-blue-500/12', text: 'text-blue-600 dark:text-blue-300', dot: 'bg-blue-500', border: 'border-blue-500' },
};

export function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const date = new Date(dateStr).getTime();
  const diffMs = now - date;
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffMin < 1) return 'baru saja';
  if (diffMin < 60) return `${diffMin} menit lalu`;
  if (diffHour < 24) return `${diffHour} jam lalu`;
  if (diffDay === 1) return 'kemarin';
  if (diffDay < 7) return `${diffDay} hari lalu`;
  return new Date(dateStr).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
}

export function truncateActionLabel(label?: string): string | undefined {
  if (!label) return undefined;
  return label.length <= 30 ? label : `${label.slice(0, 30)}...`;
}
