import { create } from 'zustand';
import type { AppUser } from '../types';
import {
  onAuthStateChanged,
  signInWithGoogle,
  signOutUser,
} from '../services/authService';
import { disconnectSSE } from '../lib/sse';
interface AuthState {
  /** Authenticated user (Better Auth session) */
  authUser: AppUser | null;
  /** Whether auth is still loading */
  isLoading: boolean;
  /** Error message if any */
  error: string | null;
  /** Whether user is authenticated */
  isAuthenticated: boolean;
  /** Whether a logout animation is currently showing — prevents AuthGuard from immediately redirecting */
  logoutAnimationActive: boolean;

  /** Initialize auth listener (returns unsubscribe function) */
  init: () => () => void;
  /** Login with Google */
  login: () => Promise<void>;
  /** Logout */
  logout: () => Promise<void>;
  /** Clear error */
  clearError: () => void;
  /** Set logout animation state — keeps AuthGuard from redirecting during animation */
  setLogoutAnimationActive: (active: boolean) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  authUser: null,
  isLoading: true,
  error: null,
  isAuthenticated: false,
  logoutAnimationActive: false,

  init: () => {
    // Subscribe to auth state changes
    const unsubscribe = onAuthStateChanged((user) => {
      // Minimal fix (root cause /admin/monitoring auto-refresh): polling auth
      // 10 detik memanggil set() dengan nilai IDENTIK tiap tick → objek state
      // baru dibuat → subscriber tanpa selector (App, Header, Sidebar,
      // MonitoringPage, …) me-render ulang seluruh tree setiap 10 detik.
      // Mengembalikan referensi state yang sama membuat Zustand melewatkan
      // notifikasi (Object.is) → nol re-render untuk data yang tidak berubah.
      set((state) => {
        if (
          state.authUser === user
          && state.isAuthenticated === !!user
          && !state.isLoading
          && state.error === null
        ) {
          return state;
        }
        return {
          authUser: user,
          isAuthenticated: !!user,
          isLoading: false,
          error: null,
        };
      });
    });

    return unsubscribe;
  },

  login: async () => {
    set({ isLoading: true, error: null });
    try {
      await signInWithGoogle();
      // Auth state will be updated automatically by onAuthStateChanged
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Terjadi kesalahan saat login';
      set({ isLoading: false, error: message });
    }
  },

  logout: async () => {
    set({ logoutAnimationActive: true });
    try {
      await signOutUser();
      // H-3 fix: putus SSE agar EventSource tidak auto-reconnect dengan cookie invalid.
      disconnectSSE();
      set({
        authUser: null,
        isAuthenticated: false,
        isLoading: false,
        error: null,
        logoutAnimationActive: true,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Gagal logout';
      set({ error: message, logoutAnimationActive: false });
      throw error;
    }
  },

  clearError: () => set({ error: null }),

  setLogoutAnimationActive: (active: boolean) => set({ logoutAnimationActive: active }),
}));
