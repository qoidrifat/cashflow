import { apiDelete, apiGet, apiPost, apiPut } from '../config/api';
import { logger } from '../lib/logger';
import { onSSE, onSSEStatus } from '../lib/sse';
import type { AppNotification, CreateNotificationInput, NotificationType, NotificationPriority } from '../types';
import { mapNotification } from './mappers';

export interface NotificationQueryOptions {
  limit?: number;
  offset?: number;
  type?: NotificationType | 'all';
  unreadOnly?: boolean;
  read?: boolean;
}

export interface NotificationRealtimeCallbacks {
  onInsert?: (notification: AppNotification) => void;
  onUpdate?: (notification: AppNotification) => void;
  onDelete?: (notificationId: string) => void;
  onError?: (error: Error) => void;
  onStatus?: (connected: boolean) => void;
}

export async function fetchNotifications(
  userId: string,
  options: NotificationQueryOptions = {},
): Promise<AppNotification[]> {
  if (!userId) return [];
  const limit = options.limit || 50;
  const offset = options.offset && options.offset > 0 ? options.offset : 0;
  const query = new URLSearchParams({ limit: String(limit) });
  if (offset > 0) query.set('offset', String(offset));
  // Filter dikirim ke server agar diterapkan SEBELUM LIMIT/OFFSET — filter
  // client-side setelah paging memotong hasil diam-diam & memicu duplikat.
  if (options.type && options.type !== 'all') query.set('type', options.type);
  if (options.unreadOnly) query.set('unreadOnly', '1');
  // Errors are propagated — callers (NotificationsPage, App, useNotifications)
  // all handle rejection explicitly; silently returning [] hid pagination failures.
  const rows = await apiGet<any[]>(`/api/notifications?${query.toString()}`);
  return (rows || []).map(mapNotification);
}

export async function fetchUnreadNotificationCount(userId: string): Promise<number> {
  // limit 100 matches the server's max page size (previous behavior counted
  // up to 100 rows since the old endpoint ignored the limit param).
  const notifications = await fetchNotifications(userId, { unreadOnly: true, limit: 100 });
  return notifications.length;
}

export async function createNotification(
  userId: string,
  input: CreateNotificationInput,
): Promise<AppNotification> {
  if (!userId) throw new Error('User ID required');
  const res = await apiPost<{ id: string }>('/api/notifications', input);
  return {
    id: res.id,
    type: input.type,
    priority: input.priority || 'normal',
    title: input.title,
    message: input.message,
    read: input.read || false,
    actionLabel: input.actionLabel,
    actionHref: input.actionHref,
    dedupeKey: input.dedupeKey,
    metadata: input.metadata || {},
    createdAt: new Date().toISOString(),
  };
}

export async function upsertNotificationByDedupeKey(
  userId: string,
  input: CreateNotificationInput,
): Promise<AppNotification> {
  return createNotification(userId, input);
}

export async function notificationExistsByDedupeKey(
  userId: string,
  dedupeKey: string,
): Promise<boolean> {
  // Gagal cek dedupe tidak boleh menolak trigger fire-and-forget
  // (notificationTriggers dipanggil `void ...()` dari GmailSyncPage &
  // transactionService) — degrade graceful: anggap belum ada (false).
  try {
    const notifications = await fetchNotifications(userId, { limit: 100 });
    return notifications.some((n) => n.dedupeKey === dedupeKey);
  } catch (error) {
    logger.warn('[notificationService] dedupe check failed, assuming absent', error);
    return false;
  }
}

export async function adoptNotificationDedupeKey(_userId: string, _oldKey: string, _newKey: string): Promise<void> {
  // no-op stub
}

export async function createSystemNotification(
  userId: string,
  input: CreateNotificationInput,
): Promise<AppNotification> {
  return createNotification(userId, input);
}

export async function markNotificationAsRead(userId: string, notificationId: string): Promise<void> {
  try {
    await apiPut(`/api/notifications/${notificationId}/read`);
  } catch {}
}

export async function markAllNotificationsAsRead(_userId: string): Promise<void> {
  try {
    await apiPut('/api/notifications/read-all');
  } catch {}
}

export async function deleteNotification(userId: string, notificationId: string): Promise<void> {
  try {
    await apiDelete(`/api/notifications/${notificationId}`);
  } catch {}
}

export function subscribeToNotifications(
  userId: string,
  callbacks: NotificationRealtimeCallbacks,
): () => void {
  if (!userId) return () => {};

  callbacks.onStatus?.(true);
  const unsubStatus = onSSEStatus((connected) => callbacks.onStatus?.(connected));

  const unsub = onSSE('notification:new', (raw) => {
    const data = raw as { id?: string; type?: string; priority?: string; title?: string; message?: string };
    if (data && data.id) {
      const ALLOWED: ReadonlyArray<NotificationType> = ['transaction', 'budget', 'gmail', 'system', 'success', 'warning', 'error', 'info'];
      const t: NotificationType = (ALLOWED as ReadonlyArray<string>).includes(data.type || '') ? (data.type as NotificationType) : 'system';
      const PRIORITY: ReadonlyArray<NotificationPriority> = ['low', 'normal', 'high'];
      const p: NotificationPriority = (PRIORITY as ReadonlyArray<string>).includes(data.priority || '') ? (data.priority as NotificationPriority) : 'normal';
      callbacks.onInsert?.({
        id: data.id,
        type: t,
        priority: p,
        title: data.title || 'Notifikasi',
        message: data.message || '',
        read: false,
        createdAt: new Date().toISOString(),
      });
    }
  });

  return () => {
    callbacks.onStatus?.(false);
    unsub();
    unsubStatus();
  };
}
