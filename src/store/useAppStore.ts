import { create } from 'zustand';
import type { ThemeMode, ToastMessage, AppNotification } from '../types';
import { STORAGE_KEYS } from '../config/constants';
import { generateId } from '../lib/utils';
import { applyTheme, getStoredTheme } from '../lib/theme';
import { useAuthStore } from './useAuthStore';
import {
  createNotification,
  deleteNotification,
  markAllNotificationsAsRead,
  markNotificationAsRead,
} from '../services/notificationService';

interface AppState {
  theme: ThemeMode;
  sidebarOpen: boolean;
  toasts: ToastMessage[];
  firebaseReady: boolean;
  firebaseError: string | null;
  gmailSyncEnabled: boolean;
  gmailAutoConfirm: boolean;
  defaultCurrency: string;
  notifications: AppNotification[];
  notificationLoading: boolean;
  realtimeConnected: boolean;

  setTheme: (theme: ThemeMode) => void;
  setSidebarOpen: (open: boolean) => void;
  addToast: (toast: Omit<ToastMessage, 'id'>) => void;
  removeToast: (id: string) => void;
  setFirebaseReady: (ready: boolean) => void;
  setFirebaseError: (error: string | null) => void;
  setGmailSyncEnabled: (enabled: boolean) => void;
  setGmailAutoConfirm: (confirm: boolean) => void;
  setDefaultCurrency: (currency: string) => void;
  addNotification: (notification: Omit<AppNotification, 'id' | 'createdAt'>, userId?: string) => void;
  setNotifications: (notifications: AppNotification[]) => void;
  prependNotification: (notification: AppNotification) => void;
  updateNotification: (notification: AppNotification) => void;
  removeNotificationLocal: (id: string) => void;
  setNotificationLoading: (loading: boolean) => void;
  setRealtimeConnected: (connected: boolean) => void;
  markNotificationRead: (id: string, userId?: string) => void;
  markAllNotificationsRead: (userId?: string) => void;
  removeNotification: (id: string, userId?: string) => void;
  clearNotifications: () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  theme: getStoredTheme(),
  sidebarOpen: window.innerWidth >= 1024,
  toasts: [],
  notifications: [],
  notificationLoading: false,
  realtimeConnected: false,
  firebaseReady: true,
  firebaseError: null,
  gmailSyncEnabled: localStorage.getItem(STORAGE_KEYS.GMAIL_SYNC_ENABLED) === 'true',
  gmailAutoConfirm: localStorage.getItem(STORAGE_KEYS.GMAIL_AUTO_CONFIRM) === 'true',
  defaultCurrency: localStorage.getItem(STORAGE_KEYS.DEFAULT_CURRENCY) || 'IDR',

  setTheme: (theme) => {
    localStorage.setItem(STORAGE_KEYS.THEME, theme);
    set({ theme });
    applyTheme(theme);
  },

  setSidebarOpen: (open) => set({ sidebarOpen: open }),

  addToast: (toast) => {
    const id = generateId();
    const newToast: ToastMessage = { ...toast, id };
    set((state) => ({ toasts: [...state.toasts, newToast] }));

    const duration = toast.duration || 4000;
    setTimeout(() => {
      get().removeToast(id);
    }, duration);
  },

  removeToast: (id) => {
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    }));
  },

  setFirebaseReady: (ready) => set({ firebaseReady: ready }),
  setFirebaseError: (error) => set({ firebaseError: error }),

  setGmailSyncEnabled: (enabled) => {
    localStorage.setItem(STORAGE_KEYS.GMAIL_SYNC_ENABLED, String(enabled));
    set({ gmailSyncEnabled: enabled });
  },

  setGmailAutoConfirm: (confirm) => {
    localStorage.setItem(STORAGE_KEYS.GMAIL_AUTO_CONFIRM, String(confirm));
    set({ gmailAutoConfirm: confirm });
  },

  setDefaultCurrency: (currency) => {
    localStorage.setItem(STORAGE_KEYS.DEFAULT_CURRENCY, currency);
    set({ defaultCurrency: currency });
  },

  addNotification: (notif, optionalUserId) => {
    const userId = optionalUserId || useAuthStore.getState().firebaseUser?.uid;
    const { notifications } = get();
    const now = new Date().toISOString();

    if (notif.dedupeKey) {
      const existingIndex = notifications.findIndex(
        (n) => n.dedupeKey === notif.dedupeKey
      );
      if (existingIndex >= 0) {
        const updated = [...notifications];
        updated[existingIndex] = {
          ...updated[existingIndex],
          ...notif,
          id: updated[existingIndex].id,
          createdAt: now,
          read: false,
        };
        set({ notifications: updated });
        if (userId) void createNotification(userId, { ...updated[existingIndex], ...notif, read: false });
        return;
      }
    }

    const newNotif: AppNotification = {
      ...notif,
      id: generateId(),
      createdAt: now,
    };
    set({
      notifications: [newNotif, ...notifications].slice(0, 30),
    });
    if (userId) void createNotification(userId, newNotif);
  },

  setNotifications: (notifications) => set({
    notifications: [...notifications]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 30),
  }),

  prependNotification: (notification) => set((state) => {
    const withoutDuplicate = state.notifications.filter((item) => item.id !== notification.id);
    return {
      notifications: [notification, ...withoutDuplicate]
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 30),
    };
  }),

  updateNotification: (notification) => set((state) => ({
    notifications: state.notifications
      .map((item) => item.id === notification.id ? notification : item)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 30),
  })),

  removeNotificationLocal: (id) => set((state) => ({
    notifications: state.notifications.filter((n) => n.id !== id),
  })),

  setNotificationLoading: (loading) => set({ notificationLoading: loading }),
  setRealtimeConnected: (connected) => set({ realtimeConnected: connected }),

  markNotificationRead: (id, optionalUserId) => {
    const userId = optionalUserId || useAuthStore.getState().firebaseUser?.uid;
    const previous = get().notifications;
    const current = previous.find((notification) => notification.id === id);
    if (current?.read) return;

    set((state) => ({
      notifications: state.notifications.map((n) =>
        n.id === id ? { ...n, read: true } : n
      ),
    }));
    if (userId) void markNotificationAsRead(userId, id).catch(() => set({ notifications: previous }));
  },

  markAllNotificationsRead: (optionalUserId) => {
    const userId = optionalUserId || useAuthStore.getState().firebaseUser?.uid;
    const previous = get().notifications;
    set((state) => ({
      notifications: state.notifications.map((n) => ({ ...n, read: true })),
    }));
    if (userId) void markAllNotificationsAsRead(userId).catch(() => set({ notifications: previous }));
  },

  removeNotification: (id, optionalUserId) => {
    const userId = optionalUserId || useAuthStore.getState().firebaseUser?.uid;
    const previous = get().notifications;
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id),
    }));
    if (userId) void deleteNotification(userId, id).catch(() => set({ notifications: previous }));
  },

  clearNotifications: () => {
    set({ notifications: [] });
  },
}));
