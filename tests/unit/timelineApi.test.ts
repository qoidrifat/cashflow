/**
 * Unit test: GET/PATCH/POST /api/ai-product/timeline* (P9 — AI Timeline).
 *
 * Harness fake app (pola adminFeedbackSummary.test.ts) + mock Turso:
 *   - Semua endpoint terdaftar DENGAN requireAuth (gate 401 terpasang).
 *   - User scoping: setiap query menyertakan user_id terautentikasi.
 *   - Pagination keyset (limit clamp, hasMore, before cursor, eventType filter).
 *   - Detail event + feedback terkait; event user lain → 404 (bukan leak).
 *   - PATCH status: state machine deterministik (P9 §12) — transisi valid 200,
 *     transisi tidak valid 400 VALIDATION_ERROR.
 *   - Wiring: feedback tanpa itemId timeline → event 'feedback'; feedback dengan
 *     itemId timeline → tanpa duplikat; memory upsert → event 'memory_update'.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../server/config/metricsConfig.js', () => ({
  getAdminEmails: vi.fn(() => ['admin@cashflow.test']),
  FEATURES: [],
}));

const executeMock = vi.fn();
vi.mock('../../server/lib/turso.js', () => ({
  getTurso: vi.fn(() => ({ execute: executeMock })),
}));

// metricsService di-mock agar observability tidak menyentuh DB di test.
vi.mock('../../server/services/metricsService.js', () => ({
  default: { recordSystemMetric: vi.fn(() => Promise.resolve()) },
}));

import { registerAiProductRoutes } from '../../server/routes/aiProductRoutes.js';
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

type ReqShape = { user?: unknown; query?: Record<string, unknown>; body?: unknown; params?: Record<string, string> };

function createApp() {
  const routes: Record<string, Handler[]> = {};
  const register = (method: string) => (path: string, ...handlers: Handler[]) => {
    routes[`${method} ${path}`] = handlers;
  };
  const app = {
    get: register('GET'),
    post: register('POST'),
    patch: register('PATCH'),
    put: register('PUT'),
    delete: register('DELETE'),
    /**
     * invoke(method, path, req) — cocokkan path pattern ':param' dengan path
     * nyata, ekstrak params, panggil handler terakhir (skip middleware auth —
     * gate requireAuth diverifikasi terpisah).
     */
    invoke: async (method: string, path: string, req: ReqShape) => {
      const entry = Object.entries(routes).find(([key]) => {
        const [m, p] = key.split(' ');
        if (m !== method) return false;
        const pattern = new RegExp(`^${p.replace(/:[^/]+/g, '([^/]+)')}$`);
        return pattern.test(path);
      });
      if (!entry) throw new Error(`Route tidak terdaftar: ${method} ${path}`);
      const [key, handlers] = entry;
      const [, pattern] = key.split(' ');
      const match = path.match(new RegExp(`^${pattern.replace(/:[^/]+/g, '([^/]+)')}$`));
      const params: Record<string, string> = {};
      if (match) {
        pattern.split('/').filter((s) => s.startsWith(':')).forEach((name, i) => {
          params[name.slice(1)] = match[i + 1];
        });
      }
      const res = createRes();
      await handlers[handlers.length - 1]({ ...req, params: { ...params, ...(req.params || {}) } }, res);
      return res;
    },
  };
  return { app, routes };
}

const { app, routes } = createApp();
registerAiProductRoutes(app as never);

const USER_A = { id: 'user-a' };
const USER_B = { id: 'user-b' };

/** Tunggu microtask fire-and-forget (recordFeedbackEvent / recordMemoryEvent). */
const flush = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
  vi.clearAllMocks();
  // mockReset: bersihkan implementasi sisa antar-test (restoreAllMocks di
  // afterEach menghapus default) — lalu set default baru.
  executeMock.mockReset();
  executeMock.mockResolvedValue({ rows: [] });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('auth gate — semua endpoint timeline terpasang requireAuth', () => {
  it('GET/POST timeline, GET detail, PATCH status, feedback, memory: middleware requireAuth terdaftar', () => {
    const expects: Array<[string, string]> = [
      ['GET', '/api/ai-product/timeline'],
      ['POST', '/api/ai-product/timeline'],
      ['GET', '/api/ai-product/timeline/:id'],
      ['PATCH', '/api/ai-product/timeline/:id/status'],
      ['POST', '/api/ai-product/feedback'],
      ['POST', '/api/ai-product/memory'],
      ['DELETE', '/api/ai-product/memory/:id'],
    ];
    for (const [method, path] of expects) {
      const handlers = routes[`${method} ${path}`];
      expect(handlers, `${method} ${path} harus terdaftar`).toBeDefined();
      expect(handlers.length).toBeGreaterThanOrEqual(2);
      expect(handlers[handlers.length - 2], `${path} harus pakai requireAuth`).toBe(requireAuth);
    }
  });
});

describe('GET /api/ai-product/timeline — pagination & scoping', () => {
  it('mengembalikan { items, hasMore } dan query user-scoped', async () => {
    executeMock.mockResolvedValue({
      rows: [{ id: 'e1', feature: 'insight', event_type: 'insight', status: 'new', title: 't', body: '', confidence: 0.8, payload: '{}', created_at: '2026-08-05 10:00:00' }],
    });
    const res = await app.invoke('GET', '/api/ai-product/timeline', { user: USER_A, query: {} });
    expect(res.statusCode).toBe(200);
    const body = res.body as { items: unknown[]; hasMore: boolean };
    expect(body.items).toHaveLength(1);
    expect(body.hasMore).toBe(false);
    const call = executeMock.mock.calls[0][0];
    expect(call.sql).toContain('WHERE user_id = ?');
    expect(call.sql).toContain('ORDER BY created_at DESC, id DESC');
    expect(call.args[0]).toBe('user-a');
  });

  it('hasMore=true saat baris > limit; items dipotong ke limit (default 20)', async () => {
    const rows = Array.from({ length: 21 }, (_, i) => ({
      id: `e${i}`, feature: 'insight', event_type: 'insight', status: 'new',
      title: 't', body: '', confidence: null, payload: '{}', created_at: `2026-08-05 10:00:${i}`,
    }));
    executeMock.mockResolvedValue({ rows });
    const res = await app.invoke('GET', '/api/ai-product/timeline', { user: USER_A, query: {} });
    const body = res.body as { items: unknown[]; hasMore: boolean };
    expect(body.items).toHaveLength(20);
    expect(body.hasMore).toBe(true);
    expect(executeMock.mock.calls[0][0].args.at(-1)).toBe(21); // limit+1
  });

  it('eventType & before+beforeId cursor masuk ke SQL (keyset komposit)', async () => {
    await app.invoke('GET', '/api/ai-product/timeline', {
      user: USER_A,
      query: { eventType: 'conversation', before: '2026-08-05 10:00:00', beforeId: 'e-last', limit: '5' },
    });
    const sql = executeMock.mock.calls[0][0].sql;
    const args = executeMock.mock.calls[0][0].args;
    expect(sql).toContain('event_type = ?');
    expect(sql).toContain('(created_at < ? OR (created_at = ? AND id < ?))');
    expect(sql).toContain('LIMIT ?');
    expect(args[0]).toBe('user-a');
    expect(args[1]).toBe('conversation');
    expect(args[2]).toBe('2026-08-05 10:00:00'); // before (created_at)
    expect(args[3]).toBe('2026-08-05 10:00:00'); // before (created_at, klausa ke-2)
    expect(args[4]).toBe('e-last'); // beforeId — tie-break id BENAR (bukan datetime)
    expect(args.at(-1)).toBe(6); // 5+1
  });

  it('before TANPA beforeId → fallback created_at < ? (tanpa tie-break rusak)', async () => {
    await app.invoke('GET', '/api/ai-product/timeline', {
      user: USER_A,
      query: { before: '2026-08-05 10:00:00' },
    });
    const sql = executeMock.mock.calls[0][0].sql;
    expect(sql).toContain('created_at < ?');
    expect(sql).not.toContain('AND id < ?');
  });

  it('limit invalid di-clamp ke [1,100] — tidak sampai SQL sebagai negatif/0', async () => {
    await app.invoke('GET', '/api/ai-product/timeline', { user: USER_A, query: { limit: '-5' } });
    expect(executeMock.mock.calls[0][0].args.at(-1)).toBe(2); // clamp ke 1 → 1+1
    await app.invoke('GET', '/api/ai-product/timeline', { user: USER_A, query: { limit: '9999' } });
    expect(executeMock.mock.calls[1][0].args.at(-1)).toBe(101); // clamp 100+1
  });

  it('timeline kosong → { items: [], hasMore: false } (bukan error)', async () => {
    executeMock.mockResolvedValue({ rows: [] });
    const res = await app.invoke('GET', '/api/ai-product/timeline', { user: USER_A, query: {} });
    expect(res.statusCode).toBe(200);
    expect((res.body as { items: unknown[] }).items).toEqual([]);
    expect((res.body as { hasMore: boolean }).hasMore).toBe(false);
  });
});

describe('GET /api/ai-product/timeline/:id — detail + feedback', () => {
  it('200: event + feedback terkait (join via item_id), query user-scoped', async () => {
    executeMock
      .mockResolvedValueOnce({
        rows: [{ id: 'e1', feature: 'advisor', event_type: 'recommendation', status: 'viewed', title: 't', body: 'b', confidence: 0.7, payload: '{}', created_at: '2026-08-05 10:00:00' }],
      })
      .mockResolvedValueOnce({
        rows: [{ rating: 'helpful', reason: 'Bagus', created_at: '2026-08-05 11:00:00' }],
      });
    const res = await app.invoke('GET', '/api/ai-product/timeline/e1', { user: USER_A });
    expect(res.statusCode).toBe(200);
    const body = res.body as { id: string; feedback: Array<{ rating: string }> };
    expect(body.id).toBe('e1');
    expect(body.feedback).toHaveLength(1);
    expect(body.feedback[0].rating).toBe('helpful');
    const [detailCall, feedbackCall] = executeMock.mock.calls;
    expect(detailCall[0].sql).toContain('WHERE id = ? AND user_id = ?');
    expect(detailCall[0].args).toEqual(['e1', 'user-a']);
    expect(feedbackCall[0].sql).toContain('WHERE item_id = ? AND user_id = ?');
  });

  it('event user lain (tidak ditemukan) → 404, bukan bocor', async () => {
    executeMock.mockResolvedValue({ rows: [] });
    const res = await app.invoke('GET', '/api/ai-product/timeline/e1', { user: USER_B });
    expect(res.statusCode).toBe(404);
  });
});

describe('PATCH /api/ai-product/timeline/:id/status — state machine (P9 §12)', () => {
  it('transisi valid new→completed → 200 + UPDATE user-scoped', async () => {
    executeMock
      .mockResolvedValueOnce({ rows: [{ status: 'new', feature: 'insight', event_type: 'insight' }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await app.invoke('PATCH', '/api/ai-product/timeline/e1/status', {
      user: USER_A,
      body: { status: 'completed' },
    });
    expect(res.statusCode).toBe(200);
    expect((res.body as { status: string }).status).toBe('completed');
    const updateCall = executeMock.mock.calls[1][0];
    expect(updateCall.sql).toContain('UPDATE ai_timeline SET status = ? WHERE id = ? AND user_id = ?');
    expect(updateCall.args).toEqual(['completed', 'e1', 'user-a']);
  });

  it('transisi tidak valid (completed→viewed) → 400 VALIDATION_ERROR', async () => {
    executeMock.mockResolvedValueOnce({ rows: [{ status: 'completed', feature: 'x', event_type: 'other' }] });
    const res = await app.invoke('PATCH', '/api/ai-product/timeline/e1/status', {
      user: USER_A,
      body: { status: 'viewed' },
    });
    expect(res.statusCode).toBe(400);
    expect((res.body as { errorCode: string }).errorCode).toBe('VALIDATION_ERROR');
    expect(executeMock).toHaveBeenCalledTimes(1); // tidak ada UPDATE
  });

  it('status invalid → 400; event tak ada → 404', async () => {
    const bad = await app.invoke('PATCH', '/api/ai-product/timeline/e1/status', {
      user: USER_A,
      body: { status: 'bogus' },
    });
    expect(bad.statusCode).toBe(400);

    executeMock.mockReset();
    executeMock.mockResolvedValueOnce({ rows: [] });
    const missing = await app.invoke('PATCH', '/api/ai-product/timeline/e1/status', {
      user: USER_B,
      body: { status: 'completed' },
    });
    expect(missing.statusCode).toBe(404);
  });
});

describe('POST /api/ai-product/feedback — wiring event feedback (P9 §13)', () => {
  it('feedback TANPA itemId → event timeline feedback direkam (tanpa cek referensi)', async () => {
    const res = await app.invoke('POST', '/api/ai-product/feedback', {
      user: USER_A,
      body: { feature: 'advisor', rating: 'not_helpful', reason: 'Generik' },
    });
    expect(res.statusCode).toBe(201);
    await flush();
    // INSERT ai_feedback + INSERT ai_timeline (itemId kosong → skip cek referensi)
    expect(executeMock).toHaveBeenCalledTimes(2);
    const timelineInsert = executeMock.mock.calls[1][0];
    expect(timelineInsert.sql).toContain('INSERT INTO ai_timeline');
    expect(timelineInsert.args[3]).toBe('feedback'); // event_type
    expect(timelineInsert.args[1]).toBe('user-a');
  });

  it('feedback dengan itemId yang MERUJUK timeline → tanpa duplikat (hanya feedback)', async () => {
    executeMock
      .mockResolvedValueOnce({ rows: [] }) // INSERT ai_feedback
      .mockResolvedValueOnce({ rows: [{ x: 1 }] }); // SELECT 1 FROM ai_timeline → related
    await app.invoke('POST', '/api/ai-product/feedback', {
      user: USER_A,
      body: { feature: 'insight', rating: 'helpful', itemId: 'e1' },
    });
    await flush();
    expect(executeMock).toHaveBeenCalledTimes(2);
    const sqls = executeMock.mock.calls.map((c) => c[0].sql);
    expect(sqls.some((s) => s.includes('INSERT INTO ai_feedback'))).toBe(true);
    expect(sqls.some((s) => s.includes('INSERT INTO ai_timeline'))).toBe(false);
  });
});

describe('POST /api/ai-product/memory — wiring event memory_update (P9 §14)', () => {
  it('upsert → event memory_update direkam', async () => {
    executeMock
      .mockResolvedValueOnce({ rows: [] }) // INSERT ai_memory upsert
      .mockResolvedValueOnce({ rows: [{ id: 'm1' }] }); // SELECT id
    const res = await app.invoke('POST', '/api/ai-product/memory', {
      user: USER_A,
      body: { category: 'payment_preference', key: 'Metode', value: 'QRIS' },
    });
    expect(res.statusCode).toBe(200);
    await flush();
    expect(executeMock).toHaveBeenCalledTimes(3);
    const timelineInsert = executeMock.mock.calls[2][0];
    expect(timelineInsert.sql).toContain('INSERT INTO ai_timeline');
    expect(timelineInsert.args[3]).toBe('memory_update');
  });
});

describe('POST /api/ai-product/timeline — event_type dari feature (server-side)', () => {
  it('feature advisor → event_type recommendation; response mencerminkannya', async () => {
    const res = await app.invoke('POST', '/api/ai-product/timeline', {
      user: USER_A,
      body: { feature: 'advisor', title: 'Rekomendasi', body: 'x', confidence: 0.6, payload: { a: 1 } },
    });
    expect(res.statusCode).toBe(201);
    expect((res.body as { event_type: string }).event_type).toBe('recommendation');
    const insert = executeMock.mock.calls[0][0];
    expect(insert.args[3]).toBe('recommendation');
    expect(insert.sql).toContain("'new'");
  });

  it('payload invalid → 400 VALIDATION_ERROR (bukan 500)', async () => {
    const res = await app.invoke('POST', '/api/ai-product/timeline', {
      user: USER_A,
      body: { feature: 'insight', title: 't', payload: [1, 2] },
    });
    expect(res.statusCode).toBe(400);
    expect((res.body as { errorCode: string }).errorCode).toBe('VALIDATION_ERROR');
    expect(executeMock).not.toHaveBeenCalled();
  });
});
