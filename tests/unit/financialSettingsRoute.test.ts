/**
 * Unit test: GET/PUT /api/financial/settings — konfigurasi akun milik sendiri
 * (transfer internal netral, FINANCIAL_CALCULATION_INTEGRITY §10.13).
 *
 * Verifikasi:
 *   1. Auth gate: kedua endpoint terdaftar dengan requireAuth.
 *   2. User scoping: userId = req.user.id (bukan dari body/query).
 *   3. GET: default [] saat belum ada settings / tabel belum ada (legacy).
 *   4. PUT: validasi fail-closed (bukan array / non-string / >100 akun / >191 char).
 *   5. PUT: upsert benar (INSERT → UPDATE pada konflik user_id).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const executeMock = vi.fn();
vi.mock('../../server/lib/turso.js', () => ({
  getTurso: vi.fn(() => ({ execute: executeMock })),
}));

import { registerFinancialSettingsRoutes } from '../../server/routes/financialSettingsRoutes.js';
import { requireAuth } from '../../server/middleware/authMiddleware.js';

type Handler = (req: unknown, res: unknown) => Promise<unknown> | unknown;

interface FakeRes {
  statusCode: number;
  body: unknown;
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
}

function createRes(): FakeRes {
  const res: FakeRes = { statusCode: 200, body: undefined, status: vi.fn(), json: vi.fn() };
  res.status.mockImplementation((code: number) => { res.statusCode = code; return res; });
  res.json.mockImplementation((body: unknown) => { res.body = body; return res; });
  return res;
}

type ReqShape = { user?: unknown; body?: unknown; query?: Record<string, unknown> };

function createApp() {
  const routes: Record<string, Handler[]> = {};
  const register = (method: string) => (path: string, ...handlers: Handler[]) => {
    routes[`${method} ${path}`] = handlers;
  };
  const app = {
    get: register('GET'),
    put: register('PUT'),
    invoke: async (method: string, path: string, req: ReqShape) => {
      const entry = Object.entries(routes).find(([key]) => key.startsWith(`${method} `) && key.split(' ')[1] === path);
      if (!entry) throw new Error(`Route tidak terdaftar: ${method} ${path}`);
      const [, handlers] = entry;
      const res = createRes();
      await handlers[handlers.length - 1](req, res);
      return res;
    },
  };
  return { app, routes };
}

const { app, routes } = createApp();
registerFinancialSettingsRoutes(app as never);

const USER_A = { id: 'user-a' };

beforeEach(() => {
  vi.clearAllMocks();
  executeMock.mockReset();
  executeMock.mockResolvedValue({ rows: [] });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('auth gate', () => {
  it('GET /api/financial/settings terdaftar dengan requireAuth', () => {
    const handlers = routes['GET /api/financial/settings'];
    expect(handlers).toBeDefined();
    expect(handlers[handlers.length - 2]).toBe(requireAuth);
  });

  it('PUT /api/financial/settings terdaftar dengan requireAuth', () => {
    const handlers = routes['PUT /api/financial/settings'];
    expect(handlers).toBeDefined();
    expect(handlers[handlers.length - 2]).toBe(requireAuth);
  });
});

describe('GET /api/financial/settings', () => {
  it('belum ada settings → { ownAccounts: [] } (perilaku legacy)', async () => {
    executeMock.mockResolvedValue({ rows: [] });
    const res = await app.invoke('GET', '/api/financial/settings', { user: USER_A });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ownAccounts: [] });
    // user-scoped: query memakai user terautentikasi.
    const call = executeMock.mock.calls[0][0];
    expect(call.sql).toContain('user_id = ?');
    expect(call.args).toEqual(['user-a']);
  });

  it('rows ada → parse JSON own_accounts (trim + duplikat)', async () => {
    executeMock.mockResolvedValue({ rows: [{ own_accounts: '["LINE Bank", " blu ", "LINE Bank"]' }] });
    const res = await app.invoke('GET', '/api/financial/settings', { user: USER_A });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ownAccounts: ['LINE Bank', 'blu'] });
  });

  it('tabel settings belum ada (SQL error) → { ownAccounts: [] } TANPA 500', async () => {
    executeMock.mockRejectedValue(new Error('no such table: user_financial_settings'));
    const res = await app.invoke('GET', '/api/financial/settings', { user: USER_A });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ownAccounts: [] });
  });
});

describe('PUT /api/financial/settings', () => {
  it('simpan ownAccounts → upsert (INSERT ON CONFLICT UPDATE) + response echo', async () => {
    executeMock.mockResolvedValue({ rows: [] });
    const res = await app.invoke('PUT', '/api/financial/settings', {
      user: USER_A,
      body: { ownAccounts: ['LINE Bank', 'blu'] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ownAccounts: ['LINE Bank', 'blu'] });
    const call = executeMock.mock.calls[0][0];
    expect(call.sql).toContain('INSERT INTO user_financial_settings');
    expect(call.sql).toContain('ON CONFLICT(user_id) DO UPDATE');
    expect(call.args[0]).toBe('user-a'); // userId = req.user.id
    expect(JSON.parse(call.args[1])).toEqual(['LINE Bank', 'blu']);
  });

  it('body bukan objek → 400 VALIDATION_ERROR', async () => {
    const res = await app.invoke('PUT', '/api/financial/settings', { user: USER_A, body: 'abc' });
    expect(res.statusCode).toBe(400);
    expect((res.body as { errorCode: string }).errorCode).toBe('VALIDATION_ERROR');
    expect(executeMock).not.toHaveBeenCalled();
  });

  it('ownAccounts bukan array → 400', async () => {
    const res = await app.invoke('PUT', '/api/financial/settings', { user: USER_A, body: { ownAccounts: 'LINE Bank' } });
    expect(res.statusCode).toBe(400);
    expect(executeMock).not.toHaveBeenCalled();
  });

  it('ownAccounts berisi non-string → 400', async () => {
    const res = await app.invoke('PUT', '/api/financial/settings', { user: USER_A, body: { ownAccounts: ['LINE Bank', 123] } });
    expect(res.statusCode).toBe(400);
    expect(executeMock).not.toHaveBeenCalled();
  });

  it('nama akun > 191 karakter → 400', async () => {
    const res = await app.invoke('PUT', '/api/financial/settings', { user: USER_A, body: { ownAccounts: ['x'.repeat(192)] } });
    expect(res.statusCode).toBe(400);
    expect(executeMock).not.toHaveBeenCalled();
  });

  it('> 100 akun → 400', async () => {
    const many = Array.from({ length: 101 }, (_, i) => `akun-${i}`);
    const res = await app.invoke('PUT', '/api/financial/settings', { user: USER_A, body: { ownAccounts: many } });
    expect(res.statusCode).toBe(400);
    expect(executeMock).not.toHaveBeenCalled();
  });

  it('trim + buang kosong + buang duplikat sebelum simpan', async () => {
    executeMock.mockResolvedValue({ rows: [] });
    const res = await app.invoke('PUT', '/api/financial/settings', {
      user: USER_A,
      body: { ownAccounts: [' LINE Bank ', '', 'blu', 'line bank', 'blu'] },
    });
    expect(res.statusCode).toBe(200);
    // case-sensitive: 'line bank' ≠ 'LINE Bank' → keduanya dipertahankan; '' dibuang; 'blu' dedupe
    expect(res.body).toEqual({ ownAccounts: ['LINE Bank', 'blu', 'line bank'] });
  });

  it('user scoping: userId dari autentikasi, bukan body', async () => {
    executeMock.mockResolvedValue({ rows: [] });
    const res = await app.invoke('PUT', '/api/financial/settings', {
      user: USER_A,
      body: { ownAccounts: ['blu'], userId: 'user-malicious' },
    });
    expect(res.statusCode).toBe(200);
    const call = executeMock.mock.calls[0][0];
    expect(call.args[0]).toBe('user-a');
    expect(call.args[0]).not.toBe('user-malicious');
  });
});
