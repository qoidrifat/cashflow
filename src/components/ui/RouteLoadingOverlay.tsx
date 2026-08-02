import { useEffect, useState, useRef } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * RouteLoadingOverlay — Global loading overlay that appears on route changes.
 *
 * Displays the CashFlow icon with a subtle float animation and an expanding ring,
 * plus "Memuat halaman..." text. The overlay uses a near-solid background so content
 * behind is not distracting, but still feels light and premium.
 *
 * Behavior:
 * 1. Route change detected → overlay fades in with icon animation
 * 2. Minimum visible duration: 400ms to avoid flicker
 * 3. Safety timeout: 4000ms — overlay always recovers
 * 4. Respects prefers-reduced-motion (shows statically)
 */
export default function RouteLoadingOverlay() {
  const location = useLocation();
  const [isVisible, setIsVisible] = useState(false);
  const pathRef = useRef(location.pathname);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    // Skip if route hasn't actually changed
    if (location.pathname === pathRef.current) return;
    pathRef.current = location.pathname;

    // Clear any existing timers
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];

    // Show overlay
    setIsVisible(true);

    // Minimum visible duration: 1 detik
    const minTimer = setTimeout(() => {
      setIsVisible(false);
    }, 1000);

    // Safety timeout: 5000ms — overlay always disappears
    const safetyTimer = setTimeout(() => {
      setIsVisible(false);
    }, 5000);

    timersRef.current = [minTimer, safetyTimer];

    return () => {
      timersRef.current.forEach(clearTimeout);
    };
  }, [location.pathname]);

  if (!isVisible) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center
                 bg-white/95 text-slate-950
                 dark:bg-slate-950/95 dark:text-slate-50
                 transition-opacity duration-200"
      role="status"
      aria-live="polite"
      aria-label="Memuat halaman"
    >
      <div className="flex flex-col items-center gap-5">
        {/* Icon with ring */}
        <div className="relative flex h-20 w-20 items-center justify-center">
          {/* Expanding ring */}
          <span
            className="cashflow-loader-ring absolute h-20 w-20 rounded-full
                       bg-emerald-500/20 dark:bg-emerald-400/20"
            aria-hidden="true"
          />

          {/* Icon card */}
          <div
            className="relative flex h-16 w-16 items-center justify-center
                       rounded-3xl border border-slate-200
                       bg-white shadow-xl shadow-slate-900/10
                       dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/30"
          >
            <img
              src="/logo/cashflow-icon.webp"
              alt=""
              className="cashflow-loader-icon h-10 w-10 object-contain"
              draggable={false}
              loading="eager"
            />
          </div>
        </div>

        {/* Text */}
        <div className="text-center">
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            Memuat halaman...
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            CashFlow sedang menyiapkan tampilan terbaik
          </p>
        </div>
      </div>
    </div>
  );
}
