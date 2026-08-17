import { Moon, Sun, Search } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { useAuthStore } from '../../store/useAuthStore';
import { useShallow } from 'zustand/react/shallow';
import { cn } from '../../lib/utils';
import NotificationBell from '../notifications/NotificationBell';
import ProfileDropdown from './ProfileDropdown';

interface HeaderProps {
  title: string;
  showSearch?: boolean;
  onSearchChange?: (value: string) => void;
}

export default function Header({ title, showSearch, onSearchChange }: HeaderProps) {
  const { theme, setTheme } = useAppStore(
    useShallow((s) => ({ theme: s.theme, setTheme: s.setTheme })),
  );
  const { authUser, logoutAnimationActive } = useAuthStore(
    useShallow((s) => ({ authUser: s.authUser, logoutAnimationActive: s.logoutAnimationActive })),
  );

  const toggleTheme = () => {
    const themes: Array<'light' | 'dark' | 'system'> = ['light', 'dark', 'system'];
    const currentIndex = themes.indexOf(theme);
    const nextTheme = themes[(currentIndex + 1) % themes.length];
    setTheme(nextTheme);
  };

  return (
    <header className={cn(
      'sticky top-0 z-20',
      'bg-app-elevated/78',
      'backdrop-blur-2xl',
      'border-b border-app-border',
      'shadow-sm shadow-black/[0.02] dark:shadow-black/20'
    )}>
      <div className="flex items-center justify-between h-16 px-4 lg:px-6">
        {/* Left side — page title */}
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold text-app-text">
            {title}
          </h1>
        </div>

        {/* Right side */}
        <div className="flex items-center gap-2">
          {showSearch && (
            <div className="relative hidden sm:block">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-app-subtle" />
              <input
                type="text"
                placeholder="Cari..."
                onChange={(e) => onSearchChange?.(e.target.value)}
                className={cn(
                  'w-48 lg:w-64 pl-9 pr-3 py-2 text-sm rounded-xl',
                  'app-field bg-app-hover/70',
                  'outline-none transition-all duration-200'
                )}
              />
            </div>
          )}

          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            className="p-2 app-icon-button"
            aria-label={theme === 'dark' ? 'Ubah ke tema terang' : 'Ubah ke tema gelap'}
            title={theme === 'dark' ? 'Ubah ke tema terang' : 'Ubah ke tema gelap'}
          >
            {theme === 'dark' ? (
              <Sun className="w-4 h-4" />
            ) : (
              <Moon className="w-4 h-4" />
            )}
          </button>

          {/* Notification bell */}
          <NotificationBell />

          {/* Profile Dropdown (mobile & desktop) — menggantikan avatar sederhana */}
          {(authUser || logoutAnimationActive) && <ProfileDropdown />}
        </div>
      </div>
    </header>
  );
}
