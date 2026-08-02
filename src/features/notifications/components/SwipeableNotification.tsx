import { Trash2 } from 'lucide-react';
import type { AppNotification } from '../types';
import NotificationItem from './NotificationItem';

interface SwipeableNotificationProps {
  notification: AppNotification;
  onClick: () => void;
  onDelete: () => void;
}

export default function SwipeableNotification({
  notification,
  onClick,
  onDelete,
}: SwipeableNotificationProps) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-app-border bg-app-elevated">
      <div className="absolute inset-y-0 right-0 flex w-20 items-center justify-center bg-red-500/10 text-red-500 opacity-100 sm:hidden">
        <Trash2 className="h-4 w-4" />
      </div>
      <div className="relative bg-app-elevated">
        <NotificationItem notification={notification} onClick={onClick} />
      </div>
      <button
        onClick={onDelete}
        className="absolute right-2 top-2 hidden min-h-[36px] min-w-[36px] items-center justify-center rounded-xl text-app-subtle transition-colors hover:bg-red-500/10 hover:text-red-500 sm:flex"
        aria-label={`Hapus notifikasi ${notification.title}`}
      >
        <Trash2 className="h-4 w-4" />
      </button>
      <button
        onClick={onDelete}
        className="absolute bottom-2 right-2 min-h-[36px] rounded-xl bg-red-500 px-3 text-xs font-semibold text-white sm:hidden"
      >
        Hapus
      </button>
    </div>
  );
}
