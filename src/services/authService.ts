import { createAuthClient } from 'better-auth/react';
import { apiGet, apiPost, getApiBaseUrl } from '../config/api';
import type { AppUser } from '../types';

export const authClient = createAuthClient({
  baseURL: getApiBaseUrl(),
});

// P0-3: the Google provider token is cached in-memory ONLY (page lifetime).
// sessionStorage caching was removed — XSS-readable storage of provider tokens
// is the risk being closed. Legacy cached values are purged once on load.
let gmailAccessToken: string | null = null;
const LEGACY_GMAIL_PROVIDER_TOKEN_KEY = 'cashflow-google-provider-token';
try {
  sessionStorage.removeItem(LEGACY_GMAIL_PROVIDER_TOKEN_KEY);
} catch {
  /* sessionStorage unavailable (e.g. privacy mode) — nothing to purge */
}

// Cached user reference — prevents creating a new object every 10s poll
// when user data hasn't changed, which would cause Zustand to trigger
// unnecessary re-renders across the entire component tree.
let _cachedUser: AppUser | null = null;

export async function getCurrentUser(): Promise<AppUser | null> {
  try {
    const session = await authClient.getSession();
    if (session?.data?.user) {
      const user = session.data.user;
      const candidate: AppUser = {
        uid: user.id,
        id: user.id,
        email: user.email ?? null,
        displayName: (user as any).displayName || user.name || user.email || 'User',
        photoURL: (user as any).photoUrl || (user as any).avatarUrl || user.image || null,
      };
      // Return cached reference if data hasn't changed — prevents Zustand
      // from treating every poll as a new state (Object.is comparison).
      if (
        _cachedUser
        && _cachedUser.uid === candidate.uid
        && _cachedUser.email === candidate.email
        && _cachedUser.displayName === candidate.displayName
        && _cachedUser.photoURL === candidate.photoURL
      ) {
        return _cachedUser;
      }
      _cachedUser = candidate;
      return candidate;
    }
    _cachedUser = null;
    return null;
  } catch {
    _cachedUser = null;
    return null;
  }
}

export function onAuthStateChanged(callback: (user: AppUser | null) => void): () => void {
  getCurrentUser().then(callback);

  // Poll current session every 10 seconds or on focus
  const interval = setInterval(() => {
    getCurrentUser().then(callback);
  }, 10000);

  const onFocus = () => {
    getCurrentUser().then(callback);
  };
  window.addEventListener('focus', onFocus);

  return () => {
    clearInterval(interval);
    window.removeEventListener('focus', onFocus);
  };
}

export async function signInWithGoogle(_redirectPath = '/auth/callback'): Promise<void> {
  await authClient.signIn.social({
    provider: 'google',
    callbackURL: `${window.location.origin}/auth/callback`,
  });
}

export async function signOutUser(): Promise<void> {
  gmailAccessToken = null;
  await authClient.signOut();
}

export async function requestGmailAccessToken(): Promise<string> {
  if (gmailAccessToken) return gmailAccessToken;

  try {
    const data = await apiGet<{ accessToken: string }>('/api/gmail/token');
    if (data?.accessToken) {
      gmailAccessToken = data.accessToken;
      return data.accessToken;
    }
  } catch {
    // 401 { error: 'token_expired' } or 404 (no token stored): drop any stale
    // in-memory cache and fall through to re-sign-in with Gmail scope.
    gmailAccessToken = null;
  }

  // Re-trigger sign in with Gmail scope if token not cached/expired
  await signInWithGoogleGmail();
  throw new Error('Mengarahkan ke Google untuk mengizinkan akses Gmail...');
}

export function clearGmailAccessToken(): void {
  gmailAccessToken = null;
}

export async function signInWithGoogleGmail(): Promise<void> {
  await authClient.signIn.social({
    provider: 'google',
    callbackURL: `${window.location.origin}/auth/callback?next=/gmail-sync`,
  });
}
