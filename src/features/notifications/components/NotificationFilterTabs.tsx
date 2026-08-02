import type { NotificationType } from '../types';
import { cn } from '../../../lib/utils';
import { notificationFilterOptions } from '../utils/notificationDisplay';

interface NotificationFilterTabsProps {
  activeType: NotificationType | 'all';
  unreadOnly: boolean;
  onTypeChange: (type: NotificationType | 'all') => void;
  onUnreadOnlyChange: (value: boolean) => void;
}

export default function NotificationFilterTabs({
  activeType,
  unreadOnly,
  onTypeChange,
  onUnreadOnlyChange,
}: NotificationFilterTabsProps) {
  return (
    <nav aria-label="Filter notifikasi" className="space-y-3">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {notificationFilterOptions.map((option) => (
          <button
            key={option.value}
            onClick={() => onTypeChange(option.value)}
            className={cn(
              'min-h-[36px] whitespace-nowrap rounded-xl border px-3 text-xs font-semibold transition-colors',
              activeType === option.value
                ? 'border-primary-500 bg-primary-50 text-primary-600 dark:bg-primary-500/12 dark:text-primary-300'
                : 'border-app-border text-app-muted hover:bg-app-hover hover:text-app-text',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      <label className="inline-flex min-h-[36px] cursor-pointer items-center gap-2 text-xs font-medium text-app-muted">
        <input
          type="checkbox"
          checked={unreadOnly}
          onChange={(event) => onUnreadOnlyChange(event.target.checked)}
          className="h-4 w-4 rounded border-app-border text-primary-500 focus:ring-primary-500"
        />
        Hanya belum dibaca
      </label>
    </nav>
  );
}
