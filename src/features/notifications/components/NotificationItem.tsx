import { motion } from 'framer-motion';
import type { AppNotification } from '../types';
import { cn } from '../../../lib/utils';
import {
  formatRelativeTime,
  notificationTypeLabels,
  truncateActionLabel,
  typeColorMap,
  typeIconMap,
} from '../utils/notificationDisplay';

interface NotificationItemProps {
  notification: AppNotification;
  onClick: () => void;
  compact?: boolean;
}

export default function NotificationItem({ notification, onClick, compact = false }: NotificationItemProps) {
  const colors = typeColorMap[notification.type] || typeColorMap.info;
  const Icon = typeIconMap[notification.type] || typeIconMap.info;
  const priority = notification.priority || 'normal';
  const actionLabel = truncateActionLabel(notification.actionLabel);

  return (
    <motion.button
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      onClick={onClick}
      role="menuitem"
      aria-label={`${notification.title}, ${notificationTypeLabels[notification.type]}, ${notification.read ? 'sudah dibaca' : 'belum dibaca'}`}
      className={cn(
        'min-h-[64px] w-full border-l-[3px] text-left transition-colors duration-150',
        'flex items-start gap-3 px-4 py-3 hover:bg-app-hover/70',
        notification.read ? 'bg-transparent' : 'bg-primary-50 dark:bg-slate-800/60',
        priority === 'high' ? colors.border : 'border-transparent',
        priority === 'low' && 'opacity-70',
        compact && 'px-3 py-2.5',
      )}
    >
      <div className={cn('mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl', colors.bg, colors.text)}>
        <Icon className="h-4 w-4" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className={cn('text-xs leading-snug text-app-text', notification.read ? 'font-medium' : 'font-semibold')}>
            {notification.title}
          </p>
          {!notification.read && (
            <span
              className={cn(
                'mt-1 flex-shrink-0 rounded-full',
                priority === 'high' ? 'h-2.5 w-2.5' : 'h-1.5 w-1.5',
                colors.dot,
              )}
            />
          )}
        </div>
        <p className="mt-0.5 line-clamp-2 text-[11px] leading-5 text-app-muted">
          {notification.message}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <span className="text-[10px] text-app-subtle">{formatRelativeTime(notification.createdAt)}</span>
          {actionLabel && (
            <span className="text-[10px] font-medium text-app-muted">{actionLabel}</span>
          )}
        </div>
      </div>
    </motion.button>
  );
}
