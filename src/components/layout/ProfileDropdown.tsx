/**
 * ProfileDropdown — Avatar-based dropdown menu for mobile & desktop
 *
 * Menampilkan:
 * - User info (avatar, name, email)
 * - Menu: Profil, Kategori, Pengaturan
 * - Logout
 *
 * Behavior:
 * - Klik avatar → buka dropdown
 * - Klik luar → tutup
 * - Escape → tutup
 * - Klik menu → navigasi + tutup
 * - Touch target minimal 44px
 */

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { LogOut, ChevronDown, type LucideIcon, Loader2 } from 'lucide-react';
import { useAuthStore } from '../../store/useAuthStore';
import { useAppStore } from '../../store/useAppStore';
import { cn } from '../../lib/utils';
import { profileMenuNav } from '../../config/navigation';
import SuccessFeedbackOverlay from '../ui/SuccessFeedbackOverlay';
import Modal from '../ui/Modal';
import Button from '../ui/Button';

interface DropdownItem {
  label: string;
  icon: LucideIcon;
  href: string;
}

const menuItems: DropdownItem[] = profileMenuNav.map((item) => ({
  label: item.label,
  icon: item.icon,
  href: item.href,
}));

const LOGOUT_SUCCESS_FEEDBACK_DURATION_MS = 5000;

export default function ProfileDropdown() {
  const { firebaseUser, logout, setLogoutAnimationActive } = useAuthStore();
  const { addToast } = useAppStore();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [logoutSuccess, setLogoutSuccess] = useState(false);
  const [avatarError, setAvatarError] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const logoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (logoutTimerRef.current) clearTimeout(logoutTimerRef.current);
      setLogoutAnimationActive(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };

    // Delay adding listener to avoid the same click that opened toggling it
    const timeoutId = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscape);
    }, 0);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  const handleNavigate = (href: string) => {
    setIsOpen(false);
    navigate(href);
  };

  const handleLogout = async () => {
    setIsOpen(false);
    setIsLoggingOut(true);
    setLogoutSuccess(false);
    setLogoutAnimationActive(true);

    try {
      await logout();

      // Logout sukses — tampilkan animasi checkmark
      setLogoutSuccess(true);

      // Tahan success logout 5 detik sebelum redirect.
      logoutTimerRef.current = setTimeout(() => {
        setLogoutSuccess(false);
        setIsLoggingOut(false);
        setLogoutAnimationActive(false);
        navigate('/login', { replace: true });
      }, LOGOUT_SUCCESS_FEEDBACK_DURATION_MS);
    } catch {
      // Logout gagal — jangan tampilkan animasi sukses
      setIsLoggingOut(false);
      setLogoutSuccess(false);
      setLogoutAnimationActive(false);
      addToast({ type: 'error', title: 'Logout gagal', message: 'Coba lagi.' });
    }
  };

  return (
    <>
    <div ref={dropdownRef} className="relative">
      {/* Avatar Button — hanya render jika user masih login */}
      {firebaseUser && (
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-1 p-0.5 rounded-full transition-all duration-200 hover:ring-2 hover:ring-primary-500/30 focus-visible:ring-2 focus-visible:ring-primary-500 outline-none"
          aria-label="Buka menu profil"
          aria-expanded={isOpen}
          aria-haspopup="true"
        >
          {avatarError || !firebaseUser.photoURL ? (
            <div className="w-8 h-8 rounded-full bg-primary-500 text-white flex items-center justify-center text-sm font-semibold ring-2 ring-app-border">
              {(firebaseUser.displayName || firebaseUser.email || 'U')[0].toUpperCase()}
            </div>
          ) : (
            <img
              key={firebaseUser.photoURL}
              src={firebaseUser.photoURL}
              alt={firebaseUser.displayName || 'User'}
              className="w-8 h-8 rounded-full object-cover ring-2 ring-app-border"
              onError={() => setAvatarError(true)}
            />
          )}
          <ChevronDown
            className={cn(
              'w-3.5 h-3.5 text-app-subtle transition-transform duration-200',
              isOpen && 'rotate-180'
            )}
          />
        </button>
      )}

      {/* Dropdown — hanya render jika user masih login */}
      {firebaseUser && (
        <AnimatePresence>
          {isOpen && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -4 }}
              transition={{ duration: 0.15, ease: 'easeOut' }}
              role="menu"
              className={cn(
                'absolute right-0 top-full mt-2 z-50',
                'w-64 rounded-2xl overflow-hidden',
                'bg-app-elevated/95 backdrop-blur-2xl',
                'border border-app-border shadow-xl shadow-black/10 dark:shadow-black/30',
              )}
            >
              {/* User Info */}
              <div className="px-4 py-3 border-b border-app-border">
                <div className="flex items-center gap-3">
                  {avatarError || !firebaseUser.photoURL ? (
                    <div className="w-10 h-10 rounded-full bg-primary-500 text-white flex items-center justify-center text-sm font-semibold ring-2 ring-primary-500/20 flex-shrink-0">
                      {(firebaseUser.displayName || firebaseUser.email || 'U')[0].toUpperCase()}
                    </div>
                  ) : (
                    <img
                      key={firebaseUser.photoURL}
                      src={firebaseUser.photoURL}
                      alt={firebaseUser.displayName || 'User'}
                      className="w-10 h-10 rounded-full object-cover ring-2 ring-primary-500/20"
                      onError={() => setAvatarError(true)}
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-app-text truncate">
                      {firebaseUser.displayName || 'User'}
                    </p>
                    <p className="text-xs text-app-subtle truncate">
                      {firebaseUser.email || ''}
                    </p>
                  </div>
                </div>
              </div>

              {/* Menu Items */}
              <div className="py-1">
                {menuItems.map((item) => (
                  <button
                    key={item.href}
                    onClick={() => handleNavigate(item.href)}
                    className={cn(
                      'w-full flex items-center gap-3 px-4 py-3 text-sm',
                      'text-app-text hover:bg-app-hover/80 transition-colors',
                      'min-h-[44px]'
                    )}
                    role="menuitem"
                  >
                    <item.icon className="w-4 h-4 text-app-subtle flex-shrink-0" />
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>

              {/* Divider */}
              <div className="border-t border-app-border" />

              {/* Logout */}
              <div className="py-1">
                <button
                  onClick={handleLogout}
                  disabled={isLoggingOut}
                  className={cn(
                    'w-full flex items-center gap-3 px-4 py-3 text-sm',
                    'text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/10 transition-colors',
                    'min-h-[44px]',
                    isLoggingOut && 'opacity-50 cursor-not-allowed'
                  )}
                  role="menuitem"
                >
                  {isLoggingOut ? (
                    <Loader2 className="w-4 h-4 flex-shrink-0 animate-spin" />
                  ) : (
                    <LogOut className="w-4 h-4 flex-shrink-0" />
                  )}
                  <span>{isLoggingOut ? 'Keluar...' : 'Logout'}</span>
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </div>

      {/* Logout Success Overlay — tetap render meskipun firebaseUser menjadi null setelah signOut */}
      <Modal isOpen={logoutSuccess} onClose={() => undefined} maxWidth="sm">
        <SuccessFeedbackOverlay
          title="Logout berhasil"
          description="Sampai ketemu lagi di CashFlow."
          detail="Sesi kamu sudah ditutup dengan aman."
        >
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              if (logoutTimerRef.current) clearTimeout(logoutTimerRef.current);
              setLogoutSuccess(false);
              setIsLoggingOut(false);
              setLogoutAnimationActive(false);
              navigate('/login', { replace: true });
            }}
            className="mt-2"
          >
            Ke halaman login
          </Button>
        </SuccessFeedbackOverlay>
      </Modal>
    </>
  );
}
