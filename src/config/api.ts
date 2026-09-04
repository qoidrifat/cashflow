/**
 * API Helper for CashFlow Frontend
 * Calls backend Express endpoints with credentials (cookies).
 */
import { triggerSessionExpired } from '../store/useSessionExpiryStore';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5181';
const DEFAULT_TIMEOUT_MS = 30_000;

export function getApiBaseUrl(): string {
  return API_BASE;
}

const SESSION_EXPIRY_EXEMPT_PATHS = ['/api/gmail/token'];
const SESSION_EXPIRY_EXEMPT_PREFIXES = ['/api/auth/', '/api/health', '/api/agent-search/health'];

export function isSessionExpiryExemptPath(path: string): boolean {
  const clean = path.split('?')[0];
  return (
    SESSION_EXPIRY_EXEMPT_PATHS.includes(clean) ||
    SESSION_EXPIRY_EXEMPT_PREFIXES.some((prefix) => clean.startsWith(prefix))
  );
}

export function handleUnauthorizedResponse(path: string, status: number): void {
  if (status !== 401) return;
  if (isSessionExpiryExemptPath(path)) return;
  triggerSessionExpired();
}

type ApiOptions = { signal?: AbortSignal; timeoutMs?: number };

/**
 * Core fetch wrapper dengan AbortController + timeout.
 * Forward `signal` eksternal agar useEffect cleanup bisa abort mid-flight.
 */
export async function apiFetch(
  path: string,
  init: RequestInit & ApiOptions = {},
): Promise<Response> {
  const { signal: externalSignal, timeoutMs = DEFAULT_TIMEOUT_MS, ...rest } = init;
  const ac = new AbortController();
  const onExternalAbort = () => ac.abort(externalSignal?.reason);
  if (externalSignal) {
    if (externalSignal.aborted) ac.abort(externalSignal.reason);
    else externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }
  const timer = setTimeout(() => ac.abort(new Error('Request timeout')), timeoutMs);
  try {
    return await fetch(`${API_BASE}${path}`, { ...rest, credentials: 'include', signal: ac.signal });
  } finally {
    clearTimeout(timer);
    if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
  }
}

async function readError(res: Response, fallback: string): Promise<Error> {
  const text = await res.text();
  return new Error(text || `${fallback} (status ${res.status})`);
}

export async function apiGet<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const res = await apiFetch(path, { method: 'GET', headers: { Accept: 'application/json' }, ...options });
  if (!res.ok) {
    handleUnauthorizedResponse(path, res.status);
    throw await readError(res, `API GET ${path} failed`);
  }
  return res.json();
}

export async function apiPost<T>(
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
  options: ApiOptions = {},
): Promise<T> {
  const res = await apiFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    ...options,
  });
  if (!res.ok) {
    handleUnauthorizedResponse(path, res.status);
    throw await readError(res, `API POST ${path} failed`);
  }
  return res.json();
}

export async function apiPut<T>(path: string, body?: unknown, options: ApiOptions = {}): Promise<T> {
  const res = await apiFetch(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    ...options,
  });
  if (!res.ok) {
    handleUnauthorizedResponse(path, res.status);
    throw await readError(res, `API PUT ${path} failed`);
  }
  return res.json();
}

export async function apiDelete<T = { success: boolean }>(
  path: string,
  options: { body?: unknown } & ApiOptions = {},
): Promise<T> {
  const hasBody = options.body !== undefined;
  const res = await apiFetch(path, {
    method: 'DELETE',
    headers: {
      Accept: 'application/json',
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
    },
    body: hasBody ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
    timeoutMs: options.timeoutMs,
  });
  if (!res.ok) {
    handleUnauthorizedResponse(path, res.status);
    throw await readError(res, `API DELETE ${path} failed`);
  }
  return res.json();
}
