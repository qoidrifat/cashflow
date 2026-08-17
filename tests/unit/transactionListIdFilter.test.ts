/**
 * Unit test: GET /api/transactions — filter id OPSIONAL (query point, 2026-08-09).
 *
 * Menutup bug laten roadmap FINANCIAL_CALCULATION_INTEGRITY §9: client
 * getTransaction(id) memakai window 500 baris terbaru → transaksi lama null.
 * Kini client query langsung `?limit=1&id=<id>`; server memfilter user-scoped
 * `AND id = ?` — `[]` = tidak ada (tanpa ambiguitas 404).
 *
 * Mengikuti harness transactionSummaryRoute.test.ts (fake app + mock Turso):
 *   1. id hadir → SQL memuat `AND id = ?`, args [user, id, limit].
 *   2. id absen → perilaku lama (tanpa filter), args [user, limit].
 *   3. id > 191 char → 400 VALIDATION_ERROR (fail-closed).
 *   4. limit clamp tetap bekerja bersama id.
 *   5. Auth gate: terdaftar dengan requireAuth.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const executeMock = vi.fn();

vi.mock('../../server/lib/turso.js', () => ({
  getTurso: vi.fn(() => ({ execute: executeMock })),
}));

import { registerTransactionRoutes } from '../../server/routes/transactionRoutes.js';
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

type ReqShape = { user?: unknown; query?: Record<string, unknown> };

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
registerTransactionRoutes(app as never);

const USER_A = { id: 'user-a' };

let lastCall: { sql: string; args: unknown[] } | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  executeMock.mockReset();
  lastCall = null;
  executeMock.mockImplementation(async ({ sql, args }: { sql: string; args: unknown[] }) => {
    lastCall = { sql: String(sql), args };
    return { rows: [] };
  });
});

const getList = (query: Record<string, unknown> = {}) =>
  app.invoke('GET', '/api/transactions', { user: USER_A, query });

describe('auth gate', () => {
  it('GET /api/transactions terdaftar dengan requireAuth', () => {
    const handlers = routes['GET /api/transactions'];
    expect(handlers).toBeDefined();
    expect(handlers.length).toBeGreaterThanOrEqual(2);
    expect(handlers[handlers.length - 2]).toBe(requireAuth);
  });
});

describe('GET /api/transactions — filter id opsional (query point)', () => {
  it('id hadir → SQL memuat AND id = ?, args [user, id, limit default 50]', async () => {
    await getList({ id: 'tx-42' });

    expect(lastCall?.sql).toContain('AND id = ?');
    expect(lastCall?.args).toEqual(['user-a', 'tx-42', 50]);
    // Tetap user-scoped.
    expect(lastCall?.sql).toContain('WHERE user_id = ?');
  });

  it('id absen → perilaku lama: tanpa filter id, args [user, limit 50]', async () => {
    await getList({});

    expect(lastCall?.sql).not.toContain('AND id = ?');
    expect(lastCall?.args).toEqual(['user-a', 50]);
  });

  it('id + limit eksplisit → args [user, id, limit]', async () => {
    await getList({ id: 'tx-7', limit: '5' });

    expect(lastCall?.args).toEqual(['user-a', 'tx-7', 5]);
  });

  it('id > 191 karakter → 400 VALIDATION_ERROR, tanpa query DB', async () => {
    const res = await getList({ id: 'x'.repeat(192) });

    expect(res.statusCode).toBe(400);
    expect((res.body as { errorCode: string }).errorCode).toBe('VALIDATION_ERROR');
    expect(executeMock).not.toHaveBeenCalled();
  });

  it('id kosong (hanya spasi) → dianggap absen (perilaku lama)', async () => {
    await getList({ id: '   ' });

    expect(lastCall?.sql).not.toContain('AND id = ?');
    expect(lastCall?.args).toEqual(['user-a', 50]);
  });

  it('limit clamp tetap berlaku bersama id (limit 999999 → clamp 5000)', async () => {
    await getList({ id: 'tx-1', limit: '999999' });

    expect(lastCall?.args).toEqual(['user-a', 'tx-1', 5000]);
  });
});
