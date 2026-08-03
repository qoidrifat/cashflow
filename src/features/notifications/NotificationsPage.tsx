import { useEffect, useMemo, useState } from 'react';
import { CheckCheck, Loader2, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import Header from '../../components/layout/Header';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import { useAppStore } from '../../store/useAppStore';
import { useAuthStore } from '../../store/useAuthStore';
import type { AppNotification, NotificationType } from './types';
import { fetchNotifications } from './services/notificationService';
import NotificationEmptyState from './components/NotificationEmptyState';
import NotificationFilterTabs from './components/NotificationFilterTabs';
import SwipeableNotification from './components/SwipeableNotification';

const PAGE_SIZE = 20;

export default function NotificationsPage() {
  const navigate = useNavigate();
  const { authUser } = useAuthStore();
  const {
    addToast,
    markAllNotificationsRead,
    markNotificationRead,
    removeNotification,
  } = useAppStore();

  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [activeType, setActiveType] = useState<NotificationType | 'all'>('all');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  const loadPage = async (offset = 0) => {
    if (!authUser?.uid) return;
    if (offset === 0) setLoading(true);
    else setLoadingMore(true);

    try {
      const rows = await fetchNotifications(authUser.uid, {
        limit: PAGE_SIZE + 1,
        offset,
        type: activeType,
        unreadOnly,
      });
      const pageRows = rows.slice(0, PAGE_SIZE);
      setHasMore(rows.length > PAGE_SIZE);
      setNotifications((prev) => offset === 0 ? pageRows : [...prev, ...pageRows]);
    } catch (error) {
      addToast({
        type: 'error',
        title: 'Gagal memuat notifikasi',
        message: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    setNotifications([]);
    void loadPage(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser?.uid, activeType, unreadOnly]);

  const unreadCount = useMemo(
    () => notifications.filter((notification) => !notification.read).length,
    [notifications],
  );

  const emptyMessage = unreadOnly
    ? 'Tidak ada notifikasi belum dibaca untuk filter ini.'
    : activeType === 'all'
      ? 'Aktivitas penting CashFlow akan muncul di sini.'
      : 'Tidak ada notifikasi untuk tipe yang dipilih.';

  const handleItemClick = (notification: AppNotification) => {
    if (!notification.read) {
      markNotificationRead(notification.id);
      setNotifications((prev) => prev.map((item) => item.id === notification.id ? { ...item, read: true } : item));
    }
    if (notification.actionHref) navigate(notification.actionHref);
  };

  const handleMarkAll = () => {
    markAllNotificationsRead();
    setNotifications((prev) => prev.map((notification) => ({ ...notification, read: true })));
  };

  const handleDelete = (notification: AppNotification) => {
    const confirmed = window.confirm(`Hapus notifikasi "${notification.title}"?`);
    if (!confirmed) return;
    removeNotification(notification.id);
    setNotifications((prev) => prev.filter((item) => item.id !== notification.id));
  };

  return (
    <div>
      <Header title="Notifikasi" />

      <main className="mx-auto max-w-4xl space-y-4 p-4 pb-24 lg:p-6">
        <Card className="fintech-surface">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary-600 dark:text-primary-300">
                Notification center
              </p>
              <h1 className="mt-2 text-2xl font-bold text-app-text">Semua Notifikasi</h1>
              <p className="mt-1 text-sm text-app-muted">
                Pantau transaksi, budget, Gmail Sync, dan pesan sistem dari satu tempat.
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => loadPage(0)}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Refresh
              </Button>
              {unreadCount > 0 && (
                <Button variant="primary" size="sm" onClick={handleMarkAll}>
                  <CheckCheck className="mr-2 h-4 w-4" />
                  Tandai dibaca
                </Button>
              )}
            </div>
          </div>
        </Card>

        <Card>
          <NotificationFilterTabs
            activeType={activeType}
            unreadOnly={unreadOnly}
            onTypeChange={setActiveType}
            onUnreadOnlyChange={setUnreadOnly}
          />
        </Card>

        <section aria-label="Daftar notifikasi" className="space-y-3">
          {loading ? (
            <Card>
              <div className="flex items-center justify-center py-12 text-app-muted">
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Memuat notifikasi...
              </div>
            </Card>
          ) : notifications.length === 0 ? (
            <Card>
              <NotificationEmptyState message={emptyMessage} />
            </Card>
          ) : (
            notifications.map((notification) => (
              <SwipeableNotification
                key={notification.id}
                notification={notification}
                onClick={() => handleItemClick(notification)}
                onDelete={() => handleDelete(notification)}
              />
            ))
          )}
        </section>

        {hasMore && (
          <div className="flex justify-center">
            <Button
              variant="secondary"
              size="sm"
              disabled={loadingMore}
              onClick={() => loadPage(notifications.length)}
            >
              {loadingMore && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Muat lebih banyak
            </Button>
          </div>
        )}
      </main>
    </div>
  );
}
