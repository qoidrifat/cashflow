import { useCallback, useMemo, useState } from 'react';
import { useAppStore } from '../../../store/useAppStore';
import { useAuthStore } from '../../../store/useAuthStore';
import type { AppNotification, NotificationType } from '../types';
import { fetchNotifications } from '../services/notificationService';

export interface NotificationFilters {
  type?: NotificationType | 'all';
  unreadOnly?: boolean;
}

export function useNotifications(filters: NotificationFilters = {}) {
  const authUser = useAuthStore((s) => s.authUser);
  const notifications = useAppStore((state) => state.notifications);
  const notificationLoading = useAppStore((state) => state.notificationLoading);
  const realtimeConnected = useAppStore((state) => state.realtimeConnected);
  const markNotificationRead = useAppStore((state) => state.markNotificationRead);
  const markAllNotificationsRead = useAppStore((state) => state.markAllNotificationsRead);
  const removeNotification = useAppStore((state) => state.removeNotification);
  const setNotifications = useAppStore((state) => state.setNotifications);
  const [error, setError] = useState<string | null>(null);
  const [refetching, setRefetching] = useState(false);

  const filteredNotifications = useMemo(() => {
    return notifications.filter((notification) => {
      if (filters.type && filters.type !== 'all' && notification.type !== filters.type) return false;
      if (filters.unreadOnly && notification.read) return false;
      return true;
    });
  }, [filters.type, filters.unreadOnly, notifications]);

  const unreadCount = useMemo(
    () => notifications.filter((notification) => !notification.read).length,
    [notifications],
  );

  const refetch = useCallback(async () => {
    if (!authUser?.uid) return;
    setRefetching(true);
    setError(null);
    try {
      // limit 100: server dulu mengabaikan limit & mengembalikan maks 100 baris;
      // bell badge menghitung unread dari seluruh daftar → semantik dipertahankan.
      const next = await fetchNotifications(authUser.uid, { limit: 100 });
      setNotifications(next);
    } catch (refetchError) {
      setError(refetchError instanceof Error ? refetchError.message : 'Gagal memuat notifikasi.');
    } finally {
      setRefetching(false);
    }
  }, [authUser?.uid, setNotifications]);

  const handleMarkRead = useCallback((id: string) => {
    if (authUser?.uid) markNotificationRead(authUser.uid, id);
  }, [authUser?.uid, markNotificationRead]);

  const handleMarkAllRead = useCallback(() => {
    if (authUser?.uid) markAllNotificationsRead(authUser.uid);
  }, [authUser?.uid, markAllNotificationsRead]);

  const handleRemove = useCallback((id: string) => {
    if (authUser?.uid) removeNotification(authUser.uid, id);
  }, [authUser?.uid, removeNotification]);

  return {
    notifications: filteredNotifications as AppNotification[],
    allNotifications: notifications,
    unreadCount,
    loading: notificationLoading || refetching,
    error,
    realtimeConnected,
    refetch,
    markNotificationRead: handleMarkRead,
    markAllNotificationsRead: handleMarkAllRead,
    removeNotification: handleRemove,
  };
}
