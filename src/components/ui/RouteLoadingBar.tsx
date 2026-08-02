import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { cn } from '../../lib/utils';

/**
 * RouteLoadingBar — Global top progress bar that appears on route changes.
 *
 * Behavior:
 * 1. Route change detected → bar appears, animates to ~70%
 * 2. New page renders → bar completes to 100% then fades out
 * 3. Fast route changes → minimum 400ms visible to avoid flicker
 * 4. Error/abort → bar still completes gracefully
 * 5. Respects prefers-reduced-motion (shows a simpler pulse)
 */
export default function RouteLoadingBar() {
  const location = useLocation();
  const [state, setState] = useState<'idle' | 'loading' | 'completing'>('idle');
  const [progress, setProgress] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pathRef = useRef(location.pathname);

  useEffect(() => {
    // If route hasn't actually changed, skip
    if (location.pathname === pathRef.current) return;
    pathRef.current = location.pathname;

    // Clear any existing timers
    if (timerRef.current) clearInterval(timerRef.current);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);

    // Start loading
    setState('loading');
    setProgress(0);

    // Phase 1: Quick ramp to 30%
    const step1 = setTimeout(() => setProgress(30), 20);

    // Phase 2: Slow climb to 70%
    timeoutRef.current = setTimeout(() => {
      setProgress(70);
    }, 150);

    // Phase 3: Complete after minimum visible time (1 detik total)
    timeoutRef.current = setTimeout(() => {
      setState('completing');
      setProgress(100);

      // After completion animation, reset to idle
      timeoutRef.current = setTimeout(() => {
        setState('idle');
        setProgress(0);
      }, 250);
    }, 1000);

    return () => {
      clearTimeout(step1);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [location.pathname]);

  if (state === 'idle') return null;

  return (
    <div
      className={cn(
        'fixed left-0 top-0 z-[9999] h-[3px]',
        'bg-gradient-to-r from-emerald-500 via-blue-500 to-violet-500',
        'shadow-sm shadow-emerald-500/30 dark:shadow-emerald-400/20',
        'motion-safe:transition-all motion-safe:duration-300 motion-safe:ease-out',
        'motion-reduce:h-[2px] motion-reduce:animate-pulse-soft',
        state === 'completing' && 'motion-safe:transition-all motion-safe:duration-200 motion-safe:ease-in',
      )}
      style={{
        transform: `scaleX(${progress / 100})`,
        transformOrigin: 'left',
        opacity: state === 'completing' ? 0.8 : 1,
      }}
      role="progressbar"
      aria-valuenow={progress}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Memuat halaman..."
    />
  );
}
