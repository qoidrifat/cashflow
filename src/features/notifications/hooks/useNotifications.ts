import { useCallback, useMemo, useRef, useState } from 'react';
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
  const seqRef = useRef(0);

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
    const seq = ++seqRef.current;
    setRefetching(true);
    setError(null);
    try {
      const next = await fetchNotifications(authUser.uid, { limit: 100 });
      if (seq !== seqRef.current) return; // out-of-order: abaikan
      setNotifications(next);
    } catch (refetchError) {
      if (seq !== seqRef.current) return;
      setError(refetchError instanceof Error ? refetchError.message : 'Gagal memuat notifikasi.');
    } finally {
      if (seq === seqRef.current) setRefetching(false);
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
