// CF-056: Session-expired pop-up with a 5-second countdown → auto-logout.
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Hourglass, LogOut } from 'lucide-react';
import { useSessionExpiryStore } from '../store/useSessionExpiryStore';
import { useAuthStore } from '../store/useAuthStore';
import { router } from '../app/router';

const COUNTDOWN_SECONDS = 5;

export default function SessionExpiredDialog() {
  const isExpiring = useSessionExpiryStore((s) => s.isExpiring);
  const reset = useSessionExpiryStore((s) => s.reset);
  const [secondsLeft, setSecondsLeft] = useState(COUNTDOWN_SECONDS);
  const loggingOut = useRef(false);

  // Single logout sequence: sign out → clear local auth state → redirect.
  // Guarded so it can only run once even if the timer and the button race.
  const performLogout = useCallback(async () => {
    if (loggingOut.current) return;
    loggingOut.current = true;
    try {
      await useAuthStore.getState().logout();
    } catch {
      // Ignore logout errors — we must leave the dead session regardless.
    } finally {
      try {
        await router.navigate('/login?reason=session_expired', { replace: true });
      } catch {
        // noop — navigation best-effort
      }
      useAuthStore.getState().setLogoutAnimationActive(false);
      reset();
      loggingOut.current = false;
    }
  }, [reset]);

  useEffect(() => {
    if (!isExpiring) {
      setSecondsLeft(COUNTDOWN_SECONDS);
      return undefined;
    }

    // Prevent AuthGuard from redirecting out from under the pop-up while the
    // countdown is visible.
    useAuthStore.getState().setLogoutAnimationActive(true);
    setSecondsLeft(COUNTDOWN_SECONDS);

    const interval = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          void performLogout();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isExpiring, performLogout]);

  const dialog = (
    <AnimatePresence>
      {isExpiring && (
        <div
          className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="session-expired-title"
          aria-describedby="session-expired-desc"
        >
          {/* Non-dismissable backdrop (no onClick — the session is dead, no escape). */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 app-overlay backdrop-blur-sm"
          />

          <motion.div
            initial={{ opacity: 0, y: 60, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 60, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 300, damping: 28 }}
            className="app-elevated relative w-full max-w-md rounded-t-2xl p-6 sm:rounded-2xl"
          >
            <div className="flex flex-col items-center text-center">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/12 text-amber-500">
                <Hourglass className="h-7 w-7" />
              </div>

              <h2 id="session-expired-title" className="text-lg font-black text-app-text">
                Sesi Anda telah berakhir
              </h2>

              <p id="session-expired-desc" className="mt-2 text-sm text-app-muted" aria-live="polite">
                Demi keamanan, Anda akan keluar secara otomatis dalam{' '}
                <span className="font-black text-app-text tabular-nums">{secondsLeft}</span> detik.
              </p>

              {/* Visual countdown bar */}
              <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-app-hover">
                <div
                  className="h-full rounded-full bg-amber-500 transition-[width] duration-1000 ease-linear"
                  style={{ width: `${(secondsLeft / COUNTDOWN_SECONDS) * 100}%` }}
                />
              </div>

              <button
                type="button"
                autoFocus
                onClick={() => void performLogout()}
                className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-red-500 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
              >
                <LogOut className="h-4 w-4" />
                Keluar sekarang
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );

  if (typeof document === 'undefined') return dialog;
  return createPortal(dialog, document.body);
}
