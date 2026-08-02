import { create } from 'zustand';

/**
 * CF-056: Centralized "session expired" state.
 *
 * A single source of truth that any layer (service code, HTTP error handlers,
 * auth listener) can flip when it detects that the user's session or
 * OAuth credentials are no longer valid. The flag is IDEMPOTENT — once the
 * expiry flow has started, repeated triggers are ignored so the pop-up and the
 * auto-logout only ever run ONCE even if many requests fail at the same time.
 */
interface SessionExpiryState {
  /** True while the "session expired" pop-up + auto-logout flow is active. */
  isExpiring: boolean;
  /** Start the expiry flow. No-op if already expiring (anti-duplicate guard). */
  trigger: () => void;
  /** Clear the flag (called after logout + redirect completes). */
  reset: () => void;
}

export const useSessionExpiryStore = create<SessionExpiryState>((set, get) => ({
  isExpiring: false,
  trigger: () => {
    if (get().isExpiring) return; // idempotent — only the first trigger wins
    set({ isExpiring: true });
  },
  reset: () => set({ isExpiring: false }),
}));

/**
 * Non-hook trigger for use in service / non-React code.
 * Safe to call from anywhere; idempotent.
 */
export function triggerSessionExpired(): void {
  useSessionExpiryStore.getState().trigger();
}

/** Read the current expiry flag outside React. */
export function isSessionExpiring(): boolean {
  return useSessionExpiryStore.getState().isExpiring;
}
