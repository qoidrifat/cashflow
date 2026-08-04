/**
 * P1-1: Unit test untuk global 401 handler di src/config/api.ts.
 *
 * Decision matrix yang diuji:
 *  - 401 dari route terproteksi (mis. /api/transactions) → trigger
 *    session-expired flow SEKALI (idempotent meski banyak request gagal paralel).
 *  - 401 dari /api/gmail/token (Google token_expired) → TIDAK trigger
 *    (ditangani authService.requestGmailAccessToken → re-sign-in Google).
 *  - 401 dari /api/auth/* (Better Auth state check) → TIDAK trigger.
 *  - Non-401 (403/500) → TIDAK trigger.
 *  - Error tetap di-throw setelah trigger → catch/toast caller tidak rusak.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  apiGet,
  apiPost,
  handleUnauthorizedResponse,
  isSessionExpiryExemptPath,
} from '../../src/config/api';
import { useSessionExpiryStore } from '../../src/store/useSessionExpiryStore';

function makeResponse(status: number, body = ''): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
    json: async () => JSON.parse(body || '{}'),
  } as unknown as Response;
}

function stubFetch(status: number, body = ''): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => makeResponse(status, body));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('isSessionExpiryExemptPath', () => {
  it('mengecualikan /api/gmail/token (Google token expiry, bukan sesi app)', () => {
    expect(isSessionExpiryExemptPath('/api/gmail/token')).toBe(true);
    expect(isSessionExpiryExemptPath('/api/gmail/token?x=1')).toBe(true);
  });

  it('mengecualikan Better Auth endpoints (/api/auth/*)', () => {
    expect(isSessionExpiryExemptPath('/api/auth/get-session')).toBe(true);
    expect(isSessionExpiryExemptPath('/api/auth/sign-out')).toBe(true);
  });

  it('mengecualikan health endpoints publik', () => {
    expect(isSessionExpiryExemptPath('/api/health')).toBe(true);
    expect(isSessionExpiryExemptPath('/api/agent-search/health')).toBe(true);
  });

  it('TIDAK mengecualikan route terproteksi', () => {
    expect(isSessionExpiryExemptPath('/api/transactions')).toBe(false);
    expect(isSessionExpiryExemptPath('/api/notifications?page=1')).toBe(false);
    expect(isSessionExpiryExemptPath('/api/gmail/runs')).toBe(false);
    expect(isSessionExpiryExemptPath('/api/admin/metrics/summary')).toBe(false);
  });
});

describe('handleUnauthorizedResponse', () => {
  beforeEach(() => {
    useSessionExpiryStore.getState().reset();
  });

  it('memicu session-expired hanya untuk status 401 di route terproteksi', () => {
    handleUnauthorizedResponse('/api/transactions', 401);
    expect(useSessionExpiryStore.getState().isExpiring).toBe(true);
  });

  it('tidak memicu untuk status non-401', () => {
    handleUnauthorizedResponse('/api/transactions', 403);
    expect(useSessionExpiryStore.getState().isExpiring).toBe(false);
    handleUnauthorizedResponse('/api/transactions', 500);
    expect(useSessionExpiryStore.getState().isExpiring).toBe(false);
  });

  it('tidak memicu untuk path yang dikecualikan', () => {
    handleUnauthorizedResponse('/api/gmail/token', 401);
    expect(useSessionExpiryStore.getState().isExpiring).toBe(false);
    handleUnauthorizedResponse('/api/auth/get-session', 401);
    expect(useSessionExpiryStore.getState().isExpiring).toBe(false);
  });
});

describe('apiGet/apiPost integration — global 401 handler', () => {
  beforeEach(() => {
    useSessionExpiryStore.getState().reset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    useSessionExpiryStore.getState().reset();
  });

  it('401 route terproteksi → trigger session-expired lalu tetap throw error', async () => {
    stubFetch(401, 'Unauthorized — silakan login terlebih dahulu.');

    await expect(apiGet('/api/transactions')).rejects.toThrow('silakan login');
    expect(useSessionExpiryStore.getState().isExpiring).toBe(true);
  });

  it('401 /api/gmail/token (token_expired) → TIDAK trigger, tetap throw', async () => {
    stubFetch(401, JSON.stringify({ error: 'token_expired' }));

    await expect(apiGet('/api/gmail/token')).rejects.toThrow('token_expired');
    expect(useSessionExpiryStore.getState().isExpiring).toBe(false);
  });

  it('401 /api/auth/* (state check Better Auth) → TIDAK trigger', async () => {
    stubFetch(401, '');

    await expect(apiPost('/api/auth/get-session')).rejects.toThrow();
    expect(useSessionExpiryStore.getState().isExpiring).toBe(false);
  });

  it('error non-401 → TIDAK trigger, tetap throw (preserve catch/toast caller)', async () => {
    stubFetch(500, 'Terjadi error saat memuat data monitoring.');

    await expect(apiGet('/api/admin/metrics/summary')).rejects.toThrow('monitoring');
    expect(useSessionExpiryStore.getState().isExpiring).toBe(false);
  });

  it('N request gagal 401 bersamaan → dialog dipicu TEPAT SATU kali (idempotent)', async () => {
    stubFetch(401, 'Unauthorized');

    // Hitung transisi isExpiring false→true: itulah jumlah dialog yang muncul.
    let dialogTriggers = 0;
    const unsub = useSessionExpiryStore.subscribe((state, prev) => {
      if (state.isExpiring && !prev.isExpiring) dialogTriggers += 1;
    });

    const results = await Promise.allSettled([
      apiGet('/api/transactions'),
      apiGet('/api/notifications'),
      apiGet('/api/budgets'),
      apiPost('/api/gmail/runs'),
    ]);

    unsub();
    expect(results.every((r) => r.status === 'rejected')).toBe(true);
    expect(dialogTriggers).toBe(1);
    expect(useSessionExpiryStore.getState().isExpiring).toBe(true);
  });
});
