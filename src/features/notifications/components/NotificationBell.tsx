import { AnimatePresence, motion } from 'framer-motion';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Bell, BellOff, WifiOff } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { useNotifications } from '../hooks/useNotifications';
import NotificationDropdown from './NotificationDropdown';

function NotificationBell() {
  const [isOpen, setIsOpen] = useState(false);
  const bellRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const { unreadCount, markAllNotificationsRead, realtimeConnected, loading } = useNotifications();

  const displayCount = unreadCount > 9 ? '9+' : String(unreadCount);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onClickOutside = (event: MouseEvent) => {
      if (bellRef.current && !bellRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    const timer = setTimeout(() => document.addEventListener('mousedown', onClickOutside), 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', onClickOutside);
    };
  }, [isOpen]);

  const handleToggle = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

  const handleClose = useCallback(() => {
    setIsOpen(false);
    buttonRef.current?.focus();
  }, []);

  const ariaLabel = isOpen
    ? `Tutup notifikasi, ${unreadCount} belum dibaca`
    : `Buka notifikasi, ${unreadCount} belum dibaca`;

  return (
    <div ref={bellRef} className="relative">
      <button
        ref={buttonRef}
        onClick={handleToggle}
        className="relative flex min-h-[44px] min-w-[44px] items-center justify-center app-icon-button"
        aria-label={ariaLabel}
        aria-expanded={isOpen}
        aria-haspopup="menu"
      >
        {unreadCount > 0 || loading ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}

        {!realtimeConnected && (
          <span className="absolute bottom-1 right-1 rounded-full bg-app-elevated">
            <WifiOff className="h-3 w-3 text-amber-500" />
          </span>
        )}

        <AnimatePresence>
          {unreadCount > 0 && (
            <motion.span
              key="badge"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
              transition={{ type: 'spring', stiffness: 500, damping: 20 }}
              aria-live="polite"
              data-testid="notification-badge"
              className={cn(
                'absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full',
                // P2.1 contrast: putih di atas red-500 (#ef4444) = 3.76:1 (gagal
                // AA 4.5:1) → red-600 (#dc2626) = 4.83:1. Badge 9px bold = text
                // kecil, threshold 4.5:1.
                'bg-red-600 px-1 text-[10px] font-bold leading-none text-white shadow-sm shadow-red-600/30',
              )}
            >
              {displayCount}
            </motion.span>
          )}
        </AnimatePresence>
      </button>

      <AnimatePresence>
        {isOpen && (
          <NotificationDropdown
            unreadCount={unreadCount}
            onMarkAllRead={markAllNotificationsRead}
            onClose={handleClose}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

export default memo(NotificationBell);
