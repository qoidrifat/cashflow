import { NavLink } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard,
  ArrowLeftRight,
  PiggyBank,
  BarChart3,
  Mail,
  UserCircle,
  ChevronLeft,
  Tags,
  Settings,
  RefreshCw,
  BriefcaseBusiness,
  Sparkles,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { useAppStore } from '../../store/useAppStore';
import { useAuthStore } from '../../store/useAuthStore';
import { APP_NAME } from '../../config/constants';

const navLinks = [
  { to: '/dashboard', label: 'Beranda', icon: LayoutDashboard },
  { to: '/transactions', label: 'Transaksi', icon: ArrowLeftRight },
  { to: '/budgets', label: 'Budget', icon: PiggyBank },
  { to: '/recurring', label: 'Rutin', icon: RefreshCw },
  { to: '/reports', label: 'Laporan', icon: BarChart3 },
  { to: '/professional', label: 'Suite', icon: BriefcaseBusiness },
  { to: '/suite/ai-search', label: 'AI Search', icon: Sparkles },
  { to: '/gmail-sync', label: 'Gmail Sync', icon: Mail },
  { to: '/categories', label: 'Kategori', icon: Tags },
  { to: '/settings', label: 'Pengaturan', icon: Settings },
  { to: '/profile', label: 'Profil', icon: UserCircle },
];

export default function Sidebar() {
  const { sidebarOpen, setSidebarOpen } = useAppStore();
  const { firebaseUser } = useAuthStore();

  return (
    <AnimatePresence mode="wait">
      <motion.aside
        initial={{ width: sidebarOpen ? 240 : 72 }}
        animate={{ width: sidebarOpen ? 240 : 72 }}
        transition={{ duration: 0.2, ease: 'easeInOut' }}
        className={cn(
          'fixed left-0 top-0 z-30 h-screen',
          'bg-app-elevated/88 backdrop-blur-2xl',
          'border-r border-app-border',
          'hidden lg:flex flex-col',
          'shadow-sm'
        )}
      >
        {/* Logo */}
        <div className={cn(
          'flex items-center h-16 px-4 border-b border-app-border',
          sidebarOpen ? 'justify-between' : 'justify-center'
        )}>
          {sidebarOpen && (
            <div className="flex items-center gap-2">
              <img src="/logo/cashflow-icon.webp" alt={APP_NAME} className="h-8 w-8 rounded-lg object-contain" />
              <span className="font-semibold text-app-text text-sm">
                {APP_NAME}
              </span>
            </div>
          )}
          {!sidebarOpen && (
            <img src="/logo/cashflow-icon.webp" alt={APP_NAME} className="h-8 w-8 rounded-lg object-contain" />
          )}
          {sidebarOpen && (
            <button
              onClick={() => setSidebarOpen(false)}
              className="p-1 app-icon-button"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-4 px-2 space-y-1 overflow-y-auto">
          {navLinks.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              onClick={() => {
                if (window.innerWidth < 1024) setSidebarOpen(false);
              }}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200',
                  'text-sm font-medium group',
                  isActive
                    ? 'bg-primary-50 dark:bg-primary-500/12 text-primary-600 dark:text-primary-300 shadow-sm dark:shadow-primary-950/20'
                    : 'text-app-muted hover:bg-app-hover/70 hover:text-app-text'
                )
              }
            >
              <link.icon className={cn(
                'w-5 h-5 flex-shrink-0 transition-colors',
                'group-hover:text-primary-500 dark:group-hover:text-primary-300'
              )} />
              {sidebarOpen && (
                <span>{link.label}</span>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Collapse button */}
        {!sidebarOpen && (
          <div className="p-2 border-t border-app-border">
            <button
              onClick={() => setSidebarOpen(true)}
              className="w-full p-2 app-icon-button flex items-center justify-center"
            >
              <ChevronLeft className="w-4 h-4 rotate-180" />
            </button>
          </div>
        )}

        {/* User info */}
        {sidebarOpen && firebaseUser && (
          <div className="p-4 border-t border-app-border">
            <div className="flex items-center gap-3">
              <img
                src={firebaseUser.photoURL || ''}
                alt={firebaseUser.displayName || 'User'}
                className="w-8 h-8 rounded-full object-cover ring-2 ring-app-border"
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-app-text truncate">
                  {firebaseUser.displayName || 'User'}
                </p>
                <p className="text-xs text-app-subtle truncate">
                  {firebaseUser.email || ''}
                </p>
              </div>
            </div>
          </div>
        )}
      </motion.aside>
    </AnimatePresence>
  );
}
