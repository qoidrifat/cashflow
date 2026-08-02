import { create } from 'zustand';
import type { AppUser } from '../types';
import {
  onAuthStateChanged,
  signInWithGoogle,
  signOutUser,
} from '../services/authService';

interface AuthState {
  /** Authenticated Supabase user mapped to legacy app shape */
  firebaseUser: AppUser | null;
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
  /** Login with Google via Supabase Auth */
  login: () => Promise<void>;
  /** Logout */
  logout: () => Promise<void>;
  /** Clear error */
  clearError: () => void;
  /** Set logout animation state — keeps AuthGuard from redirecting during animation */
  setLogoutAnimationActive: (active: boolean) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  firebaseUser: null,
  isLoading: true,
  error: null,
  isAuthenticated: false,
  logoutAnimationActive: false,

  init: () => {
    // Subscribe to Supabase Auth state changes
    const unsubscribe = onAuthStateChanged((user) => {
      set({
        firebaseUser: user,
        isAuthenticated: !!user,
        isLoading: false,
        error: null,
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
      set({
        firebaseUser: null,
        isAuthenticated: false,
        isLoading: false,
        error: null,
        logoutAnimationActive: true,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Gagal logout';
      set({ error: message, logoutAnimationActive: false });
      throw error; // Re-throw agar caller (ProfileDropdown) bisa membedakan sukses vs gagal
    }
  },

  clearError: () => set({ error: null }),

  setLogoutAnimationActive: (active: boolean) => set({ logoutAnimationActive: active }),
}));
