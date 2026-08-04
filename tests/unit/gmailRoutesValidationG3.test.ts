/**
 * Unit test: server/routes/gmailRoutes.js — P1-2 Validation Layer (Group G3).
 *
 * Menguji lapisan validasi CRUD Gmail sync (logs, settings, runs) yang memakai
 * shared library server/lib/validation.js. Handler diuji langsung lewat fake
 * Express app (tanpa HTTP) dengan Turso di-mock, sehingga:
 *  - kegagalan validasi → 400 { error, errorCode: 'VALIDATION_ERROR', details }
 *  - payload caller riil (GmailSyncPage upsert & seed e2e) TETAP lolos 200
 *  - hardening GET /api/gmail/token (fail-closed expiry, tanpa refreshToken)
 *    tetap terjaga.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

const mockExecute = vi.hoisted(() => vi.fn());

vi.mock('../../server/lib/turso.js', () => ({
  getTurso: () => ({ execute: mockExecute }),
  isTursoReady: () => true,
  closeTurso: () => {},
}));

// sse.notifyUser: noop agar test tidak menyentuh registry client riil.
vi.mock('../../server/lib/sse.js', () => ({
  notifyUser: () => {},
  registerSSERoute: () => {},
  closeSSEClients: () => {},
}));

import { registerGmailRoutes } from '../../server/routes/gmailRoutes.js';

type Handler = (req: any, res: any, next?: (err?: unknown) => void) => unknown;

interface FakeRes {
  statusCode: number;
  body: any;
  status(code: number): FakeRes;
  json(payload: any): FakeRes;
}

function makeRes(): FakeRes {
  const res: FakeRes = {
    statusCode: 200,
    body: undefined,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: any) { this.body = payload; return this; },
  };
  return res;
}

const routes = new Map<string, Handler[]>();
const fakeApp = {
  get: (path: string, ...fns: Handler[]) => { routes.set(`GET ${path}`, fns); },
  post: (path: string, ...fns: Handler[]) => { routes.set(`POST ${path}`, fns); },
  put: (path: string, ...fns: Handler[]) => { routes.set(`PUT ${path}`, fns); },
};

async function invoke(
  method: string,
  path: string,
  { params = {}, query = {}, body = {}, user = { id: 'user-test' } } = {} as any,
): Promise<FakeRes> {
  const fns = routes.get(`${method} ${path}`);
  if (!fns) throw new Error(`Route tidak terdaftar: ${method} ${path}`);
  const req: any = { params, query, body, user };
  const res = makeRes();
  for (let i = 0; i < fns.length - 1; i++) {
    let nextCalled = false;
    fns[i](req, res, () => { nextCalled = true; });
    if (!nextCalled) return res; // middleware menghentikan request (mis. 401)
  }
  await fns[fns.length - 1](req, res);
  return res;
}

beforeAll(() => {
  registerGmailRoutes(fakeApp as any);
});

// Mock state leak fix (Phase-1 hardening audit): mockExecute adalah mock
// SHARED antar test dalam file ini, dan beberapa test membaca
// `mockExecute.mock.calls[0]` (panggilan pertama SELURUH file = test #1),
// bukan panggilan test yang sedang berjalan. Tanpa reset, 8 test membaca
// args panggilan pertama dan gagal (mis. metadata test #1 bocor ke test
// prototype-pollution). mockClear menghapus riwayat calls antar test tanpa
// menghapus implementasi/queue mockResolvedValueOnce.
beforeEach(() => {
  mockExecute.mockClear();
});

describe('POST /api/gmail/logs (G3)', () => {
  it('payload caller riil (bentuk GmailSyncPage upsert) lolos → 200 { id }', async () => {
    mockExecute.mockResolvedValueOnce({ rows: [] });
    const res = await invoke('POST', '/api/gmail/logs', {
      body: {
        userId: 'user-test', // field ekstra: di-strip, bukan error
        messageId: 'msg-real-1',
        syncRunId: 'run-1',
        subject: 'Pembayaran berhasil',
        sender: 'noreply@merchant.com',
        emailDate: '2026-08-01T10:00:00.000Z',
        prefilterStatus: 'send_to_ai',
        aiCalled: true,
        aiParsed: true,
        finalStatus: 'auto_accepted',
        status: 'auto_accepted',
        confidenceScore: 0.93,
        metadata: {
          errorCode: undefined,
          fallbackUsed: false,
          finalStatus: 'auto_accepted',
          candidate: { merchant: 'Toko', amount: 50000 },
        },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(typeof res.body.id).toBe('string');
    expect(mockExecute).toHaveBeenCalledTimes(1);
    const call = mockExecute.mock.calls[0][0];
    expect(call.args[2]).toBe('msg-real-1'); // message_id tersimpan
    expect(JSON.parse(call.args[19])).toMatchObject({ candidate: { amount: 50000 } });
  });

  it('payload seed e2e (gmailReview.ts) lolos → 200', async () => {
    mockExecute.mockResolvedValueOnce({ rows: [] });
    const res = await invoke('POST', '/api/gmail/logs', {
      body: {
        messageId: 'e2e-review-1',
        subject: 'E2E Gmail Review',
        sender: 'e2e-gmail@example.com',
        emailDate: '2026-08-01T00:00:00.000Z',
        status: 'needs_review',
        finalStatus: 'needs_review',
        confidenceScore: 0.7,
        metadata: { candidate: { amount: 125000, confidence: 0.7 } },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(typeof res.body.id).toBe('string');
  });

  it('messageId absen → 400 VALIDATION_ERROR (bukan 401)', async () => {
    const callsBefore = mockExecute.mock.calls.length;
    const res = await invoke('POST', '/api/gmail/logs', { body: { subject: 'tanpa messageId' } });
    expect(res.statusCode).toBe(400);
    expect(res.body.errorCode).toBe('VALIDATION_ERROR');
    expect(res.body.error).toContain('messageId');
    expect(Array.isArray(res.body.details)).toBe(true);
    expect(mockExecute.mock.calls.length).toBe(callsBefore);
  });

  it('status di luar enum → 400; semua error dikumpulkan (tidak fail-fast)', async () => {
    const res = await invoke('POST', '/api/gmail/logs', {
      body: { messageId: 'msg-x', status: 'hacked', confidenceScore: -0.5 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.body.errorCode).toBe('VALIDATION_ERROR');
    expect(res.body.details.length).toBeGreaterThanOrEqual(2);
  });

  it('emailDate bukan tanggal valid → 400 (fail-closed)', async () => {
    const res = await invoke('POST', '/api/gmail/logs', {
      body: { messageId: 'msg-x', emailDate: 'bukan-tanggal' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain('emailDate');
  });

  it('confidenceScore > 1 → 400 (rentang 0..1)', async () => {
    const res = await invoke('POST', '/api/gmail/logs', {
      body: { messageId: 'msg-x', confidenceScore: 1.2 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('metadata bukan objek (array/string) → 400', async () => {
    for (const metadata of [['a'], 'metadata', 42]) {
      const res = await invoke('POST', '/api/gmail/logs', {
        body: { messageId: 'msg-x', metadata },
      });
      expect(res.statusCode, JSON.stringify(metadata)).toBe(400);
    }
  });

  it('metadata dengan key prototype-pollution di-strip sebelum disimpan', async () => {
    mockExecute.mockResolvedValueOnce({ rows: [] });
    const res = await invoke('POST', '/api/gmail/logs', {
      body: {
        messageId: 'msg-pollute',
        metadata: JSON.parse('{"__proto__":{"admin":true},"finalStatus":"needs_review"}'),
      },
    });
    expect(res.statusCode).toBe(200);
    const stored = JSON.parse(mockExecute.mock.calls[0][0].args[19]);
    expect(stored).toEqual({ finalStatus: 'needs_review' });
    expect(Object.prototype.hasOwnProperty.call(stored, '__proto__')).toBe(false);
  });

  it('tanpa metadata → tersimpan sebagai {} (perilaku lama)', async () => {
    mockExecute.mockResolvedValueOnce({ rows: [] });
    const res = await invoke('POST', '/api/gmail/logs', { body: { messageId: 'msg-min' } });
    expect(res.statusCode).toBe(200);
    expect(mockExecute.mock.calls[0][0].args[19]).toBe('{}');
  });
});

describe('PUT /api/gmail/settings (G3)', () => {
  it('payload valid tersimpan → 200 { success: true }', async () => {
    mockExecute.mockResolvedValueOnce({ rows: [] });
    const res = await invoke('PUT', '/api/gmail/settings', {
      body: { autoSyncEnabled: true, syncIntervalMinutes: 30, maxEmailsPerSync: 50, autoApproveThreshold: 0.9 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true });
    const args = mockExecute.mock.calls[0][0].args;
    expect(args[1]).toBe(1); // auto_sync_enabled
    expect(args[2]).toBe(30);
    expect(args[3]).toBe(50);
    expect(args[4]).toBe(0.9);
  });

  it('field ekstra caller riil (lastSyncedAt/lastStatus/...) di-strip tanpa error', async () => {
    mockExecute.mockResolvedValueOnce({ rows: [] });
    const res = await invoke('PUT', '/api/gmail/settings', {
      body: {
        autoSyncEnabled: false,
        syncIntervalMinutes: 60,
        lastSyncedAt: '2026-08-04T10:00:00.000Z',
        lastStatus: 'success',
        lastErrorCode: undefined,
        lastErrorMessage: undefined,
        lastResultSummary: '10 email',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true });
  });

  it('syncIntervalMinutes 0 / 1441 → 400', async () => {
    for (const syncIntervalMinutes of [0, 1441]) {
      const res = await invoke('PUT', '/api/gmail/settings', { body: { syncIntervalMinutes } });
      expect(res.statusCode, String(syncIntervalMinutes)).toBe(400);
      expect(res.body.errorCode).toBe('VALIDATION_ERROR');
    }
  });

  it('maxEmailsPerSync 0 → 400; autoApproveThreshold 1.5 / negatif → 400', async () => {
    for (const body of [{ maxEmailsPerSync: 0 }, { autoApproveThreshold: 1.5 }, { autoApproveThreshold: -0.1 }]) {
      const res = await invoke('PUT', '/api/gmail/settings', { body });
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
    }
  });

  it('autoSyncEnabled bukan boolean → 400; string "true" diterima (koersi)', async () => {
    const bad = await invoke('PUT', '/api/gmail/settings', { body: { autoSyncEnabled: 'yes' } });
    expect(bad.statusCode).toBe(400);

    mockExecute.mockResolvedValueOnce({ rows: [] });
    const ok = await invoke('PUT', '/api/gmail/settings', { body: { autoSyncEnabled: 'true' } });
    expect(ok.statusCode).toBe(200);
    expect(mockExecute.mock.calls[0][0].args[1]).toBe(1);
  });

  it('lastSyncAt bukan tanggal ISO → 400', async () => {
    const res = await invoke('PUT', '/api/gmail/settings', { body: { lastSyncAt: 'besok' } });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /api/gmail/runs — limit clamp (G3 quick win)', () => {
  it('limit=999999 di-clamp ke 100', async () => {
    mockExecute.mockResolvedValueOnce({ rows: [] });
    const res = await invoke('GET', '/api/gmail/runs', { query: { limit: '999999' } });
    expect(res.statusCode).toBe(200);
    expect(mockExecute.mock.calls[0][0].args[1]).toBe(100);
  });

  it('limit absen → default lama 20', async () => {
    mockExecute.mockResolvedValueOnce({ rows: [] });
    const res = await invoke('GET', '/api/gmail/runs', { query: {} });
    expect(res.statusCode).toBe(200);
    expect(mockExecute.mock.calls[0][0].args[1]).toBe(20);
  });

  it('limit=0 di-clamp ke 1; limit non-numerik → 400', async () => {
    mockExecute.mockResolvedValueOnce({ rows: [] });
    const zero = await invoke('GET', '/api/gmail/runs', { query: { limit: '0' } });
    expect(zero.statusCode).toBe(200);
    expect(mockExecute.mock.calls[0][0].args[1]).toBe(1);

    const bad = await invoke('GET', '/api/gmail/runs', { query: { limit: 'abc' } });
    expect(bad.statusCode).toBe(400);
    expect(bad.body.errorCode).toBe('VALIDATION_ERROR');
  });
});

describe('PUT /api/gmail/runs/:id (G3)', () => {
  it('patch valid (status + counter) → 200; field tak dikenal di-strip', async () => {
    mockExecute.mockResolvedValueOnce({ rows: [] });
    const res = await invoke('PUT', '/api/gmail/runs/:id', {
      params: { id: 'run-123' },
      body: {
        status: 'completed',
        completedAt: '2026-08-04T10:00:00.000Z',
        totalEmails: 10,
        processed: 10,
        accepted: 7,
        rejected: 1,
        skipped: 2,
        failed: 0,
        // Field camelCase frontend (tidak dipakai server) — di-strip, bukan error
        totalFound: 10,
        autoAcceptedCount: 7,
        metadata: { progress: { done: true } },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true });
    const sql = mockExecute.mock.calls[0][0].sql as string;
    expect(sql).not.toContain('metadata');
    expect(sql).not.toContain('totalFound');
  });

  it('status di luar enum run → 400', async () => {
    const callsBefore = mockExecute.mock.calls.length;
    const res = await invoke('PUT', '/api/gmail/runs/:id', {
      params: { id: 'run-123' },
      body: { status: 'hacked' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.body.errorCode).toBe('VALIDATION_ERROR');
    expect(mockExecute.mock.calls.length).toBe(callsBefore);
  });

  it('counter negatif → 400', async () => {
    const res = await invoke('PUT', '/api/gmail/runs/:id', {
      params: { id: 'run-123' },
      body: { processed: -1 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('completedAt bukan ISO → 400; errorMessage terlalu panjang → 400', async () => {
    const badDate = await invoke('PUT', '/api/gmail/runs/:id', {
      params: { id: 'run-123' },
      body: { completedAt: 'not-a-date' },
    });
    expect(badDate.statusCode).toBe(400);

    const longMsg = await invoke('PUT', '/api/gmail/runs/:id', {
      params: { id: 'run-123' },
      body: { errorMessage: 'x'.repeat(1001) },
    });
    expect(longMsg.statusCode).toBe(400);
  });
});

describe('GET /api/gmail/token — hardening tetap terjaga (G3)', () => {
  it('token tanpa expiry → 200 accessToken; refreshToken TIDAK pernah dibocorkan', async () => {
    mockExecute.mockResolvedValueOnce({ rows: [{ accessToken: 'tok-1', accessTokenExpiresAt: null }] });
    const res = await invoke('GET', '/api/gmail/token', {});
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ accessToken: 'tok-1' });
    // SELECT hanya mengambil accessToken + accessTokenExpiresAt
    expect(mockExecute.mock.calls[0][0].sql).not.toContain('refreshToken');
  });

  it('expiry ISO sudah lewat → 401 token_expired', async () => {
    mockExecute.mockResolvedValueOnce({
      rows: [{ accessToken: 'tok-1', accessTokenExpiresAt: '2020-01-01T00:00:00.000Z' }],
    });
    const res = await invoke('GET', '/api/gmail/token', {});
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'token_expired' });
  });

  it('expiry tidak bisa diparse → FAIL CLOSED 401 token_expired', async () => {
    mockExecute.mockResolvedValueOnce({ rows: [{ accessToken: 'tok-1', accessTokenExpiresAt: 'garbage' }] });
    const res = await invoke('GET', '/api/gmail/token', {});
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'token_expired' });
  });

  it('tanpa baris account → 404', async () => {
    mockExecute.mockResolvedValueOnce({ rows: [] });
    const res = await invoke('GET', '/api/gmail/token', {});
    expect(res.statusCode).toBe(404);
  });
});
