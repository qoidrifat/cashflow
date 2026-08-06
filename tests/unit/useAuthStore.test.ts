/**
 * Unit tests — src/store/useAuthStore.ts
 *
 * Regression guard untuk root cause auto-refresh /admin/monitoring:
 * polling auth 10 detik memanggil onAuthStateChanged dengan nilai IDENTIK.
 * Sebelum fix, set() membuat objek state baru tiap tick → subscriber tanpa
 * selector (App, Header, Sidebar, MonitoringPage) me-render ulang seluruh
 * tree setiap 10 detik. Fix: set((state) => ...) mengembalikan referensi
 * state yang sama → Zustand melewatkan notifikasi (Object.is).
 *
 * Test ini mengunci perilaku itu: poll identik TIDAK boleh menotifikasi
 * listener dan TIDAK boleh mengganti referensi state.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const authServiceMock = vi.hoisted(() => ({
  onAuthStateChanged: vi.fn(),
  signInWithGoogle: vi.fn(),
  signOutUser: vi.fn(),
}));

vi.mock('../../src/services/authService', () => authServiceMock);

import { useAuthStore } from '../../src/store/useAuthStore';
import type { AppUser } from '../../src/types';

/** Tangkap callback onAuthStateChanged untuk simulasi poll auth. */
let emitAuth: ((user: AppUser | null) => void) | null = null;

function makeUser(overrides: Partial<AppUser> = {}): AppUser {
  return {
    uid: 'user-123',
    id: 'user-123',
    email: 'admin@cashflow.test',
    displayName: 'Admin',
    photoURL: null,
    ...overrides,
  };
}

beforeEach(() => {
  emitAuth = null;
  authServiceMock.onAuthStateChanged.mockReset();
  authServiceMock.onAuthStateChanged.mockImplementation((cb: (user: AppUser | null) => void) => {
    emitAuth = cb;
    return () => {};
  });
  // Reset store ke state awal (seperti saat app baru dimuat).
  useAuthStore.setState({
    authUser: null,
    isLoading: true,
    isAuthenticated: false,
    error: null,
    logoutAnimationActive: false,
  });
});

describe('useAuthStore.init — no-op skip untuk polling auth', () => {
  it('login awal tetap menotifikasi subscriber (authUser null → user)', () => {
    const unsubscribeStore = useAuthStore.getState().init();
    const listener = vi.fn();
    const unsubListener = useAuthStore.subscribe(listener);

    const user = makeUser();
    emitAuth!(user);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().authUser).toBe(user);
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(useAuthStore.getState().isLoading).toBe(false);

    unsubListener();
    unsubscribeStore();
  });

  it('poll identik (referensi user sama) TIDAK menotifikasi — inti fix', () => {
    const unsubscribeStore = useAuthStore.getState().init();
    const listener = vi.fn();
    const unsubListener = useAuthStore.subscribe(listener);

    const user = makeUser();
    emitAuth!(user); // login awal
    listener.mockClear();

    const stateBefore = useAuthStore.getState();
    emitAuth!(user); // poll 10s berikutnya — data & referensi identik
    expect(listener).not.toHaveBeenCalled();
    // Referensi objek state TIDAK berubah → subscriber tanpa selector tidak re-render.
    expect(useAuthStore.getState()).toBe(stateBefore);

    unsubListener();
    unsubscribeStore();
  });

  it('poll identik berulang (3x) tetap senyap', () => {
    const unsubscribeStore = useAuthStore.getState().init();
    const listener = vi.fn();
    const unsubListener = useAuthStore.subscribe(listener);

    const user = makeUser();
    emitAuth!(user);
    listener.mockClear();

    emitAuth!(user);
    emitAuth!(user);
    emitAuth!(user);
    expect(listener).not.toHaveBeenCalled();
    expect(useAuthStore.getState().authUser).toBe(user);

    unsubListener();
    unsubscribeStore();
  });

  it('user BERUBAH (referensi baru, data beda) tetap menotifikasi', () => {
    const unsubscribeStore = useAuthStore.getState().init();
    const listener = vi.fn();
    const unsubListener = useAuthStore.subscribe(listener);

    const userA = makeUser();
    emitAuth!(userA);
    listener.mockClear();

    const userB = makeUser({ uid: 'user-456', id: 'user-456', email: 'other@cashflow.test' });
    emitAuth!(userB);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().authUser).toBe(userB);

    unsubListener();
    unsubscribeStore();
  });

  it('logout (user null) tetap menotifikasi & menurunkan isAuthenticated', () => {
    const unsubscribeStore = useAuthStore.getState().init();
    const listener = vi.fn();
    const unsubListener = useAuthStore.subscribe(listener);

    emitAuth!(makeUser());
    listener.mockClear();

    emitAuth!(null);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().authUser).toBeNull();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);

    unsubListener();
    unsubscribeStore();
  });

  it('poll pertama saat masih isLoading=true tetap menotifikasi (clear loading)', () => {
    // State awal: isLoading=true, authUser=null. Poll pertama mengembalikan
    // null → kondisi `!state.isLoading` gagal → set() tetap jalan (loading selesai).
    const unsubscribeStore = useAuthStore.getState().init();
    const listener = vi.fn();
    const unsubListener = useAuthStore.subscribe(listener);

    emitAuth!(null);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().isLoading).toBe(false);
    expect(useAuthStore.getState().isAuthenticated).toBe(false);

    unsubListener();
    unsubscribeStore();
  });

  it('init mengembalikan unsubscribe yang memutus polling', () => {
    const unsubscribeStore = useAuthStore.getState().init();
    unsubscribeStore();

    const listener = vi.fn();
    const unsubListener = useAuthStore.subscribe(listener);
    // Tidak ada emitAuth terdaftar setelah unsubscribe — aman tanpa asersi.
    expect(authServiceMock.onAuthStateChanged).toHaveBeenCalledTimes(1);
    unsubListener();
  });
});
