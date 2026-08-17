import { motion } from 'framer-motion';
import { CheckCheck, WifiOff } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useMemo } from 'react';
import { cn } from '../../../lib/utils';
import { useNotifications } from '../hooks/useNotifications';
import NotificationEmptyState from './NotificationEmptyState';
import NotificationItem from './NotificationItem';

interface NotificationDropdownProps {
  unreadCount: number;
  onMarkAllRead: () => void;
  onClose: () => void;
}

export default function NotificationDropdown({
  unreadCount,
  onMarkAllRead,
  onClose,
}: NotificationDropdownProps) {
  const navigate = useNavigate();
  const {
    notifications,
    markNotificationRead,
    realtimeConnected,
  } = useNotifications();

  const latestNotifications = useMemo(
    () => [...notifications]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 15),
    [notifications],
  );

  const handleItemClick = (id: string, actionHref?: string, read?: boolean) => {
    if (!read) markNotificationRead(id);
    if (actionHref) navigate(actionHref);
    onClose();
  };

  const handleViewAll = () => {
    navigate('/notifications');
    onClose();
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -8, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.96 }}
      transition={{ duration: 0.15, ease: 'easeOut' }}
      role="menu"
      className={cn(
        // Mobile: fixed viewport positioning — prevents clipping by parent containers
        'fixed left-3 right-3 top-16 max-h-[calc(100vh-5rem)] overflow-y-auto',
        // Tablet/Desktop: absolute positioning relative to bell parent
        'sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:max-h-none',
        'z-[60]',
        'w-auto sm:w-96',
        'rounded-2xl border border-slate-200 dark:border-slate-800',
        'bg-white text-slate-950 dark:bg-slate-950 dark:text-slate-50',
        'shadow-2xl shadow-slate-900/15 dark:shadow-black/40',
        'origin-top-right',
      )}
    >
      <div className="flex items-center justify-between border-b border-app-border px-4 py-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-app-text">Notifikasi</h3>
          {!realtimeConnected && (
            <span title="Realtime sedang mencoba tersambung ulang">
              <WifiOff className="h-3.5 w-3.5 text-amber-500" />
            </span>
          )}
          {unreadCount > 0 && (
            <span className="rounded-full bg-app-hover/80 px-1.5 py-0.5 text-[10px] font-medium text-app-subtle">
              {unreadCount} baru
            </span>
          )}
        </div>
        {unreadCount > 0 && (
          <button
            onClick={onMarkAllRead}
            className="flex min-h-[32px] items-center gap-1 rounded-lg px-1 text-[11px] font-medium text-primary-500 transition-colors hover:text-primary-600"
          >
            <CheckCheck className="h-3 w-3" />
            Tandai dibaca
          </button>
        )}
      </div>

      <div className="max-h-[360px] overflow-y-auto" role="listbox">
        {latestNotifications.length === 0 ? (
          <NotificationEmptyState />
        ) : (
          <div className="divide-y divide-app-border/50">
            {latestNotifications.map((notification) => (
              <NotificationItem
                key={notification.id}
                notification={notification}
                onClick={() => handleItemClick(notification.id, notification.actionHref, notification.read)}
              />
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-app-border p-2">
        <button
          onClick={handleViewAll}
          className="min-h-[36px] w-full rounded-xl text-xs font-semibold text-primary-600 transition-colors hover:bg-app-hover dark:text-primary-300"
        >
          Lihat semua notifikasi
        </button>
      </div>
    </motion.div>
  );
}
