import { useState, useCallback, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '../../store/useAppStore';
import { cn } from '../../lib/utils';
import Sidebar from './Sidebar';
import BottomNav from './BottomNav';
import ToastContainer from '../ui/ToastContainer';
import OnboardingWalkthrough from '../ui/OnboardingWalkthrough';
import QuickAddSheet from '../../features/transactions/QuickAddSheet';
import RouteLoadingBar from '../ui/RouteLoadingBar';
import RouteLoadingOverlay from '../ui/RouteLoadingOverlay';
import PageTransition from '../ui/PageTransition';

/** Scroll to top of page on route change */
function ScrollToTopOnRouteChange() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

export default function AppLayout() {
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const location = useLocation();
  const [quickAddOpen, setQuickAddOpen] = useState(false);

  const hideFab = location.pathname === '/gmail-sync' || location.pathname === '/settings' || location.pathname === '/profile';

  const openQuickAdd = useCallback(() => setQuickAddOpen(true), []);
  const closeQuickAdd = useCallback(() => setQuickAddOpen(false), []);

  return (
    <div className="min-h-screen bg-transparent">
      {/* Global Route Loading Bar — appears on every page transition */}
      <RouteLoadingBar />

      {/* Global Route Loading Overlay — cashflow icon animation on route change */}
      <RouteLoadingOverlay />

      {/* Scroll to top on route change */}
      <ScrollToTopOnRouteChange />

      {/* Sidebar - Desktop */}
      <Sidebar />

      {/* Main content */}
      <div
        className={cn(
          'transition-all duration-200 ease-in-out',
          'lg:ml-[72px]',
          sidebarOpen && 'lg:ml-60'
        )}
      >
        {/* Page content with fade/slide transition */}
        <main className="pb-24 lg:pb-8 min-h-screen">
          <PageTransition>
            <Outlet />
          </PageTransition>
        </main>
      </div>

      {/* Bottom Navigation - Mobile */}
      <BottomNav />

      {/* FAB — Quick Add Transaction */}
      <AnimatePresence>
        {!hideFab && (
          <motion.button
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 25 }}
            onClick={openQuickAdd}
            className={cn(
              'fixed z-40',
              'bottom-20 lg:bottom-6 right-4 lg:right-6',
              'w-14 h-14 rounded-2xl',
              'bg-gradient-to-br from-primary-500 to-soft-purple',
              'text-white shadow-lg shadow-primary-500/30',
              'hover:shadow-xl hover:shadow-primary-500/40 hover:scale-105',
              'active:scale-95',
              'transition-all duration-200',
              'flex items-center justify-center',
            )}
            aria-label="Tambah transaksi cepat"
          >
            <Plus className="w-6 h-6" />
          </motion.button>
        )}
      </AnimatePresence>

      {/* Quick Add Sheet */}
      <QuickAddSheet isOpen={quickAddOpen} onClose={closeQuickAdd} />

      {/* Toast notifications */}
      <ToastContainer />

      {/* First-run onboarding */}
      <OnboardingWalkthrough />
    </div>
  );
}
