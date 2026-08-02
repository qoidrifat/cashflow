import { BellOff } from 'lucide-react';

interface NotificationEmptyStateProps {
  title?: string;
  message?: string;
}

export default function NotificationEmptyState({
  title = 'Belum ada notifikasi',
  message = 'Aktivitas penting CashFlow akan muncul di sini.',
}: NotificationEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-app-hover/80">
        <BellOff className="h-5 w-5 text-app-subtle" />
      </div>
      <p className="text-sm font-semibold text-app-text">{title}</p>
      <p className="mt-1 max-w-[240px] text-xs leading-5 text-app-muted">{message}</p>
    </div>
  );
}
