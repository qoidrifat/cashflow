import { useEffect, useRef } from 'react';
import { RouterProvider } from 'react-router-dom';
import { router } from './router';
import { useAuthStore } from '../store/useAuthStore';
import { useAppStore } from '../store/useAppStore';
import { applyTheme } from '../lib/theme';
import { processDueRecurringTransactions } from '../services/recurringService';
import { logger } from '../lib/logger';
import { fetchNotifications, subscribeToNotifications } from '../services/notificationService';
import SessionExpiredDialog from '../components/SessionExpiredDialog';


export default function App() {
  const init = useAuthStore((state) => state.init);
  const { authUser } = useAuthStore();
  const {
    prependNotification,
    removeNotificationLocal,
    setAuthReady,
    setAuthError,
    setNotificationLoading,
    setNotifications,
    setRealtimeConnected,
    updateNotification,
    theme,
  } = useAppStore();

  // Initialize app and auth
  useEffect(() => {
    setAuthReady(true);
    setAuthError(null);

    // Initialize auth listener
    const unsubscribe = init();


    return unsubscribe;
  }, [init, setAuthReady, setAuthError]);

  // Apply theme on mount and keep "system" synced with OS preference changes.
  useEffect(() => {
    applyTheme(theme);

    if (theme !== 'system') return undefined;

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => applyTheme('system');
    media.addEventListener('change', handleChange);

    return () => media.removeEventListener('change', handleChange);
  }, [theme]);

  // Auto-process due recurring transactions on mount and auth change
  // Use processedUid ref to prevent double-processing for the same user
  // while allowing processing when switching to a different user
  const processedUid = useRef<string | null>(null);
  useEffect(() => {
    if (!authUser?.uid) return;
    if (processedUid.current === authUser.uid) return;
    processedUid.current = authUser.uid;

    // Give auth/session time to settle, then process dues
    const timer = setTimeout(() => {
      processDueRecurringTransactions(authUser.uid).catch((err) =>
        logger.error('[App] Failed to process recurring', err)
      );
    }, 3000);

    return () => clearTimeout(timer);
  }, [authUser?.uid]);

  useEffect(() => {
    if (!authUser?.uid) {
      setNotifications([]);
      setRealtimeConnected(false);
      return undefined;
    }

    setNotificationLoading(true);
    fetchNotifications(authUser.uid, { limit: 100 })
      .then(setNotifications)
      .catch((error) => logger.warn('[App] Initial notifications fetch failed', error))
      .finally(() => setNotificationLoading(false));

    const refetchOnFocus = () => {
      fetchNotifications(authUser.uid, { limit: 100 })
        .then(setNotifications)
        .catch((error) => logger.warn('[App] Notification focus refetch failed', error));
    };

    window.addEventListener('focus', refetchOnFocus);

    const unsubscribe = subscribeToNotifications(authUser.uid, {
      onInsert: prependNotification,
      onUpdate: updateNotification,
      onDelete: removeNotificationLocal,
      onStatus: setRealtimeConnected,
      onError: (error: Error) => logger.warn('[App] Notification realtime failed', error),
    });


    return () => {
      window.removeEventListener('focus', refetchOnFocus);
      unsubscribe();
    };
  }, [
    authUser?.uid,
    prependNotification,
    removeNotificationLocal,
    setNotificationLoading,
    setNotifications,
    setRealtimeConnected,
    updateNotification,
  ]);

  return (
    <>
      <RouterProvider router={router} />
      <SessionExpiredDialog />
    </>
  );
}
