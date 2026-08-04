/**
 * API Helper for CashFlow Frontend
 * Calls backend Express endpoints with credentials (cookies)
 */

import { triggerSessionExpired } from '../store/useSessionExpiryStore';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5181';

export function getApiBaseUrl(): string {
  return API_BASE;
}

/**
 * P1-1: Global 401 handler — centralized session-expiry detection.
 *
 * A 401 from a protected app endpoint (server `requireAuth` →
 * `{ error: 'Unauthorized — silakan login terlebih dahulu.' }`) means the
 * Better Auth session cookie died mid-use. Route it through the existing
 * CF-056 session-expiry flow (`triggerSessionExpired()` → SessionExpiredDialog
 * → `/login?reason=session_expired`). No redirect logic is duplicated here —
 * the store trigger is IDEMPOTENT, so N parallel failing requests produce
 * exactly one dialog (see `useSessionExpiryStore.trigger`).
 *
 * Carve-outs (401 here does NOT mean app-session expiry):
 *  - `/api/gmail/token` — 401 `{ error: 'token_expired' }` is GOOGLE provider
 *    token expiry; `authService.requestGmailAccessToken` already clears its
 *    cache and falls back to Google re-sign-in. Hijacking it would show the
 *    session-expired dialog instead of the Gmail re-auth flow.
 *  - `/api/auth/*` — Better Auth endpoints (e.g. get-session polling); an
 *    unauthenticated response is a NORMAL state check, never a redirect trigger.
 *  - Health endpoints — intentionally public; never an auth signal.
 */
const SESSION_EXPIRY_EXEMPT_PATHS = ['/api/gmail/token'];
const SESSION_EXPIRY_EXEMPT_PREFIXES = ['/api/auth/', '/api/health', '/api/agent-search/health'];

/** True when a 401 on this path must NOT trigger the session-expired flow. */
export function isSessionExpiryExemptPath(path: string): boolean {
  const clean = path.split('?')[0];
  return (
    SESSION_EXPIRY_EXEMPT_PATHS.includes(clean) ||
    SESSION_EXPIRY_EXEMPT_PREFIXES.some((prefix) => clean.startsWith(prefix))
  );
}

/**
 * Invoke the CF-056 session-expiry flow on an HTTP 401 from a protected
 * route. Callers still receive the thrown error afterwards — existing
 * catch/toast behavior is preserved; the dialog runs on top of it.
 */
export function handleUnauthorizedResponse(path: string, status: number): void {
  if (status !== 401) return;
  if (isSessionExpiryExemptPath(path)) return;
  triggerSessionExpired();
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
    },
    credentials: 'include',
  });

  if (!res.ok) {
    handleUnauthorizedResponse(path, res.status);
    const errorText = await res.text();
    throw new Error(errorText || `API GET ${path} failed with status ${res.status}`);
  }

  return res.json();
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    credentials: 'include',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    handleUnauthorizedResponse(path, res.status);
    const errorText = await res.text();
    throw new Error(errorText || `API POST ${path} failed with status ${res.status}`);
  }

  return res.json();
}

export async function apiPut<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    credentials: 'include',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    handleUnauthorizedResponse(path, res.status);
    const errorText = await res.text();
    throw new Error(errorText || `API PUT ${path} failed with status ${res.status}`);
  }

  return res.json();
}

export async function apiDelete<T = { success: boolean }>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'DELETE',
    headers: {
      'Accept': 'application/json',
    },
    credentials: 'include',
  });

  if (!res.ok) {
    handleUnauthorizedResponse(path, res.status);
    const errorText = await res.text();
    throw new Error(errorText || `API DELETE ${path} failed with status ${res.status}`);
  }

  return res.json();
}
