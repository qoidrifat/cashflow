/**
 * Unit test: server/routes/professionalSuiteRoutes.js — P0.12 wallet ownership
 * (IDOR) & semantic verification scoping.
 *
 * Pola reconciliationRoutes.test.ts: fake app + mock turso. Fokus P0.12:
 *   1. user_id SELALU dari req.user.id (session), TIDAK dari body request.
 *   2. Ownership: GET list, PUT, DELETE scoped `WHERE ... AND user_id = ?`.
 *   3. Client tidak dapat memalsukan `verified`/balance-anchor — field
 *      server-derived dibuang oleh skema (mass assignment).
 *   4. provider tak dikenal → 400 fail-closed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const executeMock = vi.fn();
vi.mock('../../server/lib/turso.js', () => ({
  getTurso: vi.fn(() => ({ execute: executeMock })),
}));

// pass-through provider catalog (benar-benar dari file sumber, bukan mock).
vi.mock('../../server/lib/providerCatalog.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/lib/providerCatalog.js')>();
  return actual;
});

// sse notifier — abaikan.
vi.mock('../../server/lib/sse.js', () => ({ notifyUser: vi.fn() }));

import { registerProfessionalSuiteRoutes } from '../../server/routes/professionalSuiteRoutes.js';
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

function createApp() {
  const routes: Record<string, Handler[]> = {};
  const register = (method: string) => (path: string, ...handlers: Handler[]) => {
    routes[`${method} ${path}`] = handlers;
  };
  const app = {
    get: register('GET'),
    post: register('POST'),
    put: register('PUT'),
    delete: register('DELETE'),
    invoke: async (method: string, path: string, req: Record<string, unknown>) => {
      // 1) exact match (route tanpa :id — list/create/health).
      const exact = Object.entries(routes).find(([key]) => key === `${method} ${path}`);
      // 2) fallback :id (update/delete) — ambil nilai id dari path nyata.
      const seg = path.split('/');
      const basename = seg.slice(0, -1).join('/');
      const entry = exact
        ?? Object.entries(routes).find(([key]) => key === `${method} ${basename}/:id`);
      if (!entry) throw new Error(`Route tidak terdaftar: ${method} ${path}`);
      const [, handlers] = entry;
      if (!exact) req.params = { id: seg[seg.length - 1] };
      const res = createRes();
      await handlers[handlers.length - 1](req, res);
      return res;
    },
  };
  return { app, routes };
}

const { app, routes } = createApp();
registerProfessionalSuiteRoutes(app as never);

const USER_A = { id: 'user-a' };
const USER_B = { id: 'user-b' };

function pathHasAuth(method: string, path: string) {
  const entry = Object.entries(routes).find(([key]) => key.startsWith(`${method} `) && key.split(' ')[1] === path);
  expect(entry).toBeDefined();
  expect(entry![1][0]).toBe(requireAuth);
}

beforeEach(() => executeMock.mockReset());
afterEach(() => vi.clearAllMocks());

describe('Auth gate — wallet endpoints requireAuth', () => {
  it('terdaftar dengan requireAuth (list, providers, create, update, delete)', () => {
    pathHasAuth('GET', '/api/wallets');
    pathHasAuth('GET', '/api/wallet-providers');
    pathHasAuth('POST', '/api/wallets');
    pathHasAuth('PUT', '/api/wallets/:id');
    pathHasAuth('DELETE', '/api/wallets/:id');
  });
});

describe('GET /api/wallets — ownership dari session', () => {
  it('query scoped user_id = req.user.id (User A hanya lihat wallet User A)', async () => {
    executeMock.mockResolvedValue({ rows: [] });
    const res = await app.invoke('GET', '/api/wallets', { user: USER_A });
    expect(executeMock).toHaveBeenCalledWith(expect.objectContaining({
      sql: expect.stringMatching(/WHERE user_id = \?/),
      args: ['user-a'],
    }));
    expect(res.statusCode).toBe(200);
  });
});

describe('GET /api/wallet-providers — capability metadata publik', () => {
  it('mengembalikan daftar provider; semua integration = manual', async () => {
    const res = await app.invoke('GET', '/api/wallet-providers', { user: USER_A });
    expect(res.statusCode).toBe(200);
    const list = res.body as Array<{ code: string; enabled: boolean; integration: string }>;
    const codes = list.map((p) => p.code);
    for (const expected of ['line_bank', 'blu', 'bank_jago', 'shopeepay', 'dana']) {
      expect(codes).toContain(expected);
    }
    for (const p of list) {
      expect(p.integration, p.code).toBe('manual');
      expect(p.enabled, p.code).toBe(true);
    }
  });
});

describe('POST /api/wallets — ownership session, provider fail-closed, mass-assignment', () => {
  it('user_id berasal dari session (req.user.id), bukan body; INSERT tidak ambil user_id client', async () => {
    executeMock.mockResolvedValue({ rows: [] });
    const res = await app.invoke('POST', '/api/wallets', {
      user: USER_A,
      body: {
        name: 'DANA utama', type: 'e-wallet', providerCode: 'dana', balance: 250000,
        user_id: 'user-attacker', userId: 'user-attacker',
        verified: true, balance_anchor_status: 'verified',
      },
    });
    expect(res.statusCode).toBe(200);
    const insertCall = executeMock.mock.calls.find(([c]) => String(c.sql).match(/INSERT INTO wallet_accounts/));
    expect(insertCall).toBeDefined();
    const args = insertCall![0].args as unknown[];
    // args[1] = user_id → harus user session, bukan user-attacker.
    expect(args[1]).toBe('user-a');
    expect(args).not.toContain('user-attacker');
    // Field verified tidak boleh sampai ke INSERT (server-derived dibuang).
    expect(String(insertCall![0].sql)).not.toMatch(/verified|verification_status/i);
  });

  it('provider tak dikenal → 400 fail-closed, tanpa INSERT', async () => {
    executeMock.mockReset();
    const res = await app.invoke('POST', '/api/wallets', {
      user: USER_A,
      body: { name: 'X', type: 'bank', providerCode: 'bank_ghost' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ errorCode: 'VALIDATION_ERROR' });
    expect(executeMock).not.toHaveBeenCalledWith(expect.objectContaining({ sql: expect.stringMatching(/INSERT INTO wallet_accounts/) }));
  });
});

describe('PUT /api/wallets/:id — ownership scoping (IDOR tertutup)', () => {
  it('UPDATE scoped id + user_id session', async () => {
    executeMock.mockResolvedValue({ rows: [] });
    const res = await app.invoke('PUT', '/api/wallets/wallet-of-a', { user: USER_A, body: { name: 'Renamed' } });
    expect(res.statusCode).toBe(200);
    expect(executeMock).toHaveBeenCalledWith(expect.objectContaining({
      sql: expect.stringMatching(/WHERE id = \? AND user_id = \?/),
      args: expect.arrayContaining(['wallet-of-a', 'user-a']),
    }));
  });

  it('User B mencoba update wallet User A → SQL tetap danai user_id = user-b (tidak tembus)', async () => {
    executeMock.mockResolvedValue({ rows: [] });
    const res = await app.invoke('PUT', '/api/wallets/wallet-of-a', { user: USER_B, body: { name: 'Hacked' } });
    expect(res.statusCode).toBe(200);
    const updateCall = executeMock.mock.calls.find(([c]) => String(c.sql).match(/UPDATE wallet_accounts/));
    expect(updateCall).toBeDefined();
    // WHERE selalu menyertakan user session — User B tidak bisa target wallet A.
    expect(updateCall![0].args).toContain('user-b');
  });
});

describe('DELETE /api/wallets/:id — ownership scoping (IDOR tertutup)', () => {
  it('DELETE scoped id + user_id session', async () => {
    executeMock.mockResolvedValue({ rows: [] });
    const res = await app.invoke('DELETE', '/api/wallets/wallet-of-a', { user: USER_A });
    expect(res.statusCode).toBe(200);
    expect(executeMock).toHaveBeenCalledWith(expect.objectContaining({
      sql: expect.stringMatching(/DELETE FROM wallet_accounts WHERE id = \? AND user_id = \?/),
      args: ['wallet-of-a', 'user-a'],
    }));
  });

  it('User B hapus wallet User A → SQL tetap scoped user-b (tidak menghapus wallet lain)', async () => {
    executeMock.mockResolvedValue({ rows: [] });
    await app.invoke('DELETE', '/api/wallets/wallet-of-a', { user: USER_B });
    const del = executeMock.mock.calls.find(([c]) => String(c.sql).match(/DELETE FROM wallet_accounts/));
    expect(del).toBeDefined();
    expect(del![0].args).toContain('user-b');
  });
});
