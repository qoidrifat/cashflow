import { useState, useEffect, useRef } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { primaryMobileNav, moreMenuNav } from '../../config/navigation';
import { env } from '../../config/env';

// P0.14 — AI Knowledge hanya tampil di menu "Lainnya" bila build-time flag aktif
// (runtime gate tetap config server GOOGLE_AGENT_PLATFORM_ENABLED).
const visibleMoreNav = moreMenuNav.filter(
  (item) => item.href !== '/suite/ai-knowledge' || env.aiKnowledge.enabled,
);

export default function BottomNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const [showMoreSheet, setShowMoreSheet] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);

  // Check if current path matches any "Lainnya" route
  const isLainnyaActive = visibleMoreNav.some((item) =>
    location.pathname.startsWith(item.href)
  );

  // Close on outside click and escape
  useEffect(() => {
    if (!showMoreSheet) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (sheetRef.current && !sheetRef.current.contains(e.target as Node)) {
        setShowMoreSheet(false);
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowMoreSheet(false);
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [showMoreSheet]);

  const handleMoreNavigate = (href: string) => {
    setShowMoreSheet(false);
    navigate(href);
  };

  return (
    <>
      {/* Bottom Navigation */}
      <nav
        className={cn(
          'fixed bottom-0 left-0 right-0 z-30',
          'bg-app-elevated/88 backdrop-blur-2xl',
          'border-t border-app-border',
          'lg:hidden',
          'safe-area-bottom'
        )}
      >
        <div className="flex items-center justify-around px-1 py-1.5">
          {primaryMobileNav.map((item) => (
            <NavLink
              key={item.href}
              to={item.href}
              className={({ isActive }) =>
                cn(
                  'flex flex-col items-center gap-0.5 py-1.5 px-2 rounded-xl transition-all duration-200',
                  'min-w-[56px]',
                  'min-h-[44px]',
                  isActive
                    ? 'text-primary-600 dark:text-primary-300'
                    : 'text-app-subtle hover:text-app-muted'
                )
              }
              aria-label={item.label}
            >
              {({ isActive }) => (
                <div className="flex flex-col items-center gap-0.5">
                  <div className={cn(
                    'p-1 rounded-lg transition-colors',
                    isActive && 'bg-primary-50 dark:bg-primary-500/12'
                  )}>
                    <item.icon className="w-[20px] h-[20px]" />
                  </div>
                  <span className="text-[11px] font-medium leading-none">{item.label}</span>
                  {isActive && (
                    <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-5 h-0.5 rounded-full bg-primary-500" />
                  )}
                </div>
              )}
            </NavLink>
          ))}

          {/* "Lainnya" button */}
          <button
            onClick={() => setShowMoreSheet(true)}
            className={cn(
              'flex flex-col items-center gap-0.5 py-1.5 px-2 rounded-xl transition-all duration-200',
              'min-w-[56px] min-h-[44px]',
              isLainnyaActive
                ? 'text-primary-600 dark:text-primary-300'
                : 'text-app-subtle hover:text-app-muted'
            )}
            aria-label="Menu lainnya"
          >
            <div className={cn(
              'p-1 rounded-lg transition-colors',
              isLainnyaActive && 'bg-primary-50 dark:bg-primary-500/12'
            )}>
              <ChevronDown className="w-[20px] h-[20px]" />
            </div>
            <span className="text-[11px] font-medium leading-none">Lainnya</span>
            {isLainnyaActive && (
              <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-5 h-0.5 rounded-full bg-primary-500" />
            )}
          </button>
        </div>
      </nav>

      {/* "Lainnya" Bottom Sheet */}
      <AnimatePresence>
        {showMoreSheet && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm lg:hidden"
          >
            <motion.div
              ref={sheetRef}
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className={cn(
                'absolute bottom-0 left-0 right-0',
                'rounded-t-3xl overflow-hidden',
                'bg-app-elevated/98 backdrop-blur-2xl',
                'border-t border-app-border',
                'shadow-2xl shadow-black/20',
                'pb-safe',
                'max-h-[60vh]',
              )}
            >
              {/* Sheet header */}
              <div className="flex items-center justify-between px-5 pt-4 pb-2">
                <h3 className="text-sm font-semibold text-app-text">Menu Lainnya</h3>
                <button
                  onClick={() => setShowMoreSheet(false)}
                  className="p-2 rounded-xl text-app-subtle hover:text-app-text hover:bg-app-hover transition-colors"
                  aria-label="Tutup menu"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Divider */}
              <div className="mx-5 border-t border-app-border" />

              {/* Menu items */}
              <div className="py-2 px-2 space-y-0.5">
                {visibleMoreNav.map((item) => {
                  const Icon = item.icon;
                  const isActive = window.location.pathname.startsWith(item.href);

                  return (
                    <button
                      key={item.href}
                      onClick={() => handleMoreNavigate(item.href)}
                      className={cn(
                        'w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all',
                        'min-h-[48px]',
                        isActive
                          ? 'bg-primary-50 dark:bg-primary-500/12 text-primary-600 dark:text-primary-300'
                          : 'text-app-text hover:bg-app-hover/80'
                      )}
                    >
                      <div className={cn(
                        'p-1.5 rounded-lg',
                        isActive ? 'bg-primary-100 dark:bg-primary-500/20' : ''
                      )}>
                        <Icon className={cn(
                          'w-5 h-5',
                          isActive ? 'text-primary-500' : 'text-app-subtle'
                        )} />
                      </div>
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* Spacer for safe area */}
              <div className="h-2" />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
