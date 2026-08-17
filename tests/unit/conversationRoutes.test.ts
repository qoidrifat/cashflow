/**
 * Unit test: POST /api/ai-product/conversation — telemetry + fallback (P8 + audit).
 *
 * Harness fake app (pola timelineApi.test.ts / adminFeedbackSummary.test.ts) +
 * mock Turso + mock metricsService + mock vertexContext:
 *   - Route terdaftar DENGAN requireAuth (gate 401 terpasang).
 *   - Telemetry kontrak PRODUCT_METRICS: `ai_conversation_started` setelah
 *     validasi lolos; `ai_conversation_completed` (metadata source + fallback)
 *     pada sukses; `ai_conversation_failed` pada 500.
 *   - 500 route → `next(err)` ke global handler (shape §0: errorCode
 *     CONVERSATION_FAILED + requestId) — audit API.
 *   - Fallback deterministik: Gemini gagal → 200 rule-based (bukan raw error);
 *     validasi gagal → 400 VALIDATION_ERROR (tanpa event started).
 *   - Data user-scoped: query transaksi menyertakan user_id terautentikasi.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const executeMock = vi.fn();
vi.mock('../../server/lib/turso.js', () => ({
  getTurso: vi.fn(() => ({ execute: executeMock })),
}));

// metricsService di-mock agar observability tidak menyentuh DB di test.
const recordSystemMetricMock = vi.fn(() => Promise.resolve());
vi.mock('../../server/services/metricsService.js', () => ({
  default: { recordSystemMetric: (...args) => recordSystemMetricMock(...args) },
}));

// vertexContext di-mock: default Gemini down → jalur fallback rule-based.
// isProduction dipakai errorHandler (detail dev/prod) — default dev di test.
vi.mock('../../server/lib/vertexContext.js', () => ({
  createRequestId: vi.fn(() => 'req_test'),
  parseGeminiResponse: vi.fn(() => ({ success: false })),
  generateGeminiText: vi.fn(() => Promise.reject(new Error('gemini down'))),
  isProduction: vi.fn(() => false),
}));

// Normalisasi narasi di-mock (default = real) untuk test jalur "Gemini sukses
// tapi narasi gagal dinormalisasi → source tetap rule-based".
const normalizeNarrativeMock = vi.fn();
vi.mock('../../server/lib/conversationAggregator.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    normalizeConversationNarrative: (...args) => normalizeNarrativeMock(...args),
  };
});

import { normalizeConversationNarrative } from '../../server/lib/conversationAggregator.js';

import { registerConversationRoutes, CONVERSATION_ERROR_CODE } from '../../server/routes/conversationRoutes.js';
import { requireAuth } from '../../server/middleware/authMiddleware.js';
import { handleServerError } from '../../server/middleware/errorHandler.js';
import { generateGeminiText, parseGeminiResponse } from '../../server/lib/vertexContext.js';

type Handler = (req: unknown, res: unknown, next?: (err?: unknown) => void) => Promise<unknown> | unknown;

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

type ReqShape = { id?: string; user?: unknown; query?: Record<string, unknown>; body?: unknown; params?: Record<string, string> };

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
      // next diteruskan (pola Express): route menyerahkan 500 via next(err) →
      // global handler handleServerError menghasilkan respons (shape §0).
      let nextErr: unknown;
      const next = (err?: unknown) => { nextErr = err; };
      await handlers[handlers.length - 1]({ ...req, params: { ...params, ...(req.params || {}) } }, res, next);
      if (nextErr) {
        handleServerError(nextErr as never, { id: req.id } as never, res as never, () => {});
      }
      return res;
    },
  };
  return { app, routes };
}

const { app, routes } = createApp();
registerConversationRoutes(app as never);

const USER_A = { id: 'user-a' };

/**
 * Tanggal relatif (YYYY-MM-DD, waktu lokal) — n hari yang lalu. Dipakai fixture
 * transaksi agar SELALU berada dalam window periode (computeDateRange(7) =
 * hari ini − 6..hari ini). LATEN BUG (fix 2026-08-08): fixture hard-coded
 * '2026-08-01' membuat test bergantung tanggal — begitu window rotasi melewati
 * tanggal itu, row jatuh ke bucket periode-sebelumnya → hasData=false → jalur
 * Gemini tidak pernah dijalankan → 2 test gagal (generateGeminiText 0×,
 * source rule-based bukan gemini). Test kini deterministik lintas tanggal.
 */
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Nama-nama metric telemetry yang dipanggil (urutan pemanggilan). */
function recordedMetricNames(): string[] {
  return recordSystemMetricMock.mock.calls.map((c) => (c[0] as { metricName: string }).metricName);
}

beforeEach(() => {
  vi.clearAllMocks();
  executeMock.mockReset();
  executeMock.mockResolvedValue({ rows: [] });
  recordSystemMetricMock.mockReset();
  normalizeNarrativeMock.mockReset();
  // Default: narasi ternormalisasi valid (real behavior) — edge test override ke null.
  normalizeNarrativeMock.mockReturnValue({
    summary: 'Analisis selesai',
    insights: [],
    recommendations: [],
  });
  // Default: Gemini down (fallback path) — tiap test bisa override.
  (generateGeminiText as ReturnType<typeof vi.fn>).mockReset();
  (generateGeminiText as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('gemini down'));
  (parseGeminiResponse as ReturnType<typeof vi.fn>).mockReset();
  (parseGeminiResponse as ReturnType<typeof vi.fn>).mockReturnValue({ success: false });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('auth gate — route conversation terpasang requireAuth', () => {
  it('POST /api/ai-product/conversation: middleware requireAuth terdaftar', () => {
    const handlers = routes['POST /api/ai-product/conversation'];
    expect(handlers).toBeDefined();
    expect(handlers.length).toBeGreaterThanOrEqual(2);
    expect(handlers[handlers.length - 2]).toBe(requireAuth);
  });
});

describe('telemetry — ai_conversation_started / completed / failed', () => {
  it('tanpa data transaksi → 200 fallback + started & completed (source rule-based, fallback=true)', async () => {
    const res = await app.invoke('POST', '/api/ai-product/conversation', {
      user: USER_A,
      body: { query: 'Kenapa uangku habis?' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.body as { success: boolean; trust: { source: string; fallbackReason?: string } };
    expect(body.success).toBe(true);
    expect(body.trust.source).toBe('rule-based');
    expect(body.trust.fallbackReason).toBeDefined();
    // Gemini tidak dipanggil (tidak ada data) — fallback murni
    expect(generateGeminiText).not.toHaveBeenCalled();

    const names = recordedMetricNames();
    expect(names).toContain('ai_conversation_started');
    expect(names).toContain('ai_conversation_completed');
    expect(names).not.toContain('ai_conversation_failed');

    const started = recordSystemMetricMock.mock.calls.find((c) => c[0].metricName === 'ai_conversation_started')[0];
    expect(started.feature).toBe('conversation');
    expect(started.userId).toBe('user-a');
    expect(started.metadata.periodDays).toBe(30); // default

    const completed = recordSystemMetricMock.mock.calls.find((c) => c[0].metricName === 'ai_conversation_completed')[0];
    expect(completed.metadata.source).toBe('rule-based');
    expect(completed.metadata.fallback).toBe(true);
    expect(completed.metadata.periodDays).toBe(30);
  });

  it('Gemini gagal dengan data → 200 fallback rule-based (bukan raw error) + completed source=rule-based', async () => {
    executeMock.mockResolvedValue({
      rows: [
        { id: 't1', date: daysAgo(1), type: 'expense', amount: 50000, category_name: 'Makanan', merchant: 'GoFood', note: '' },
      ],
    });
    const res = await app.invoke('POST', '/api/ai-product/conversation', {
      user: USER_A,
      body: { query: 'kenapa habis?', periodDays: 7 },
    });
    expect(res.statusCode).toBe(200);
    expect((res.body as { trust: { source: string } }).trust.source).toBe('rule-based');
    expect(generateGeminiText).toHaveBeenCalledTimes(1);

    const completed = recordSystemMetricMock.mock.calls.find((c) => c[0].metricName === 'ai_conversation_completed')[0];
    expect(completed.metadata.source).toBe('rule-based');
    expect(completed.metadata.fallback).toBe(true);
    expect(completed.metadata.periodDays).toBe(7);
    // Query transaksi user-scoped
    const txCall = executeMock.mock.calls[0][0];
    expect(txCall.sql).toContain('WHERE user_id = ?');
    expect(txCall.args[0]).toBe('user-a');
  });

  it('Gemini sukses → 200 source gemini + completed source=gemini, fallback=false', async () => {
    executeMock.mockResolvedValue({
      rows: [
        { id: 't1', date: daysAgo(1), type: 'expense', amount: 50000, category_name: 'Makanan', merchant: 'GoFood', note: '' },
      ],
    });
    (generateGeminiText as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: '{"summary":"Ringkasan baik","insights":[],"recommendations":[]}',
      modelUsed: 'gemini-2.5-flash',
    });
    (parseGeminiResponse as ReturnType<typeof vi.fn>).mockReturnValue({
      success: true,
      data: { summary: 'Ringkasan baik', insights: [], recommendations: [] },
    });

    const res = await app.invoke('POST', '/api/ai-product/conversation', {
      user: USER_A,
      body: { query: 'kenapa habis?', periodDays: 7 },
    });
    expect(res.statusCode).toBe(200);
    expect((res.body as { trust: { source: string; model?: string } }).trust.source).toBe('gemini');

    const completed = recordSystemMetricMock.mock.calls.find((c) => c[0].metricName === 'ai_conversation_completed')[0];
    expect(completed.metadata.source).toBe('gemini');
    expect(completed.metadata.fallback).toBe(false);
  });

  it('Gemini parses tapi narasi gagal dinormalisasi → source rule-based (bukan gemini) + fallback=true', async () => {
    executeMock.mockResolvedValue({
      rows: [
        { id: 't1', date: daysAgo(1), type: 'expense', amount: 50000, category_name: 'Makanan', merchant: 'GoFood', note: '' },
      ],
    });
    (generateGeminiText as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: '{"summary":"x"}',
      modelUsed: 'gemini-2.5-flash',
    });
    (parseGeminiResponse as ReturnType<typeof vi.fn>).mockReturnValue({
      success: true,
      data: { summary: 'x' },
    });
    // Skenario edge: normalisasi mengembalikan falsy → fallback rule-based,
    // dan `source` HARUS dilaporkan rule-based (telemetry + trust meta akurat).
    normalizeNarrativeMock.mockReturnValue(null);

    const res = await app.invoke('POST', '/api/ai-product/conversation', {
      user: USER_A,
      body: { query: 'kenapa habis?', periodDays: 7 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.body as { trust: { source: string; fallbackReason?: string } };
    expect(body.trust.source).toBe('rule-based');
    expect(body.trust.fallbackReason).toBeDefined();

    const completed = recordSystemMetricMock.mock.calls.find((c) => c[0].metricName === 'ai_conversation_completed')[0];
    expect(completed.metadata.source).toBe('rule-based');
    expect(completed.metadata.fallback).toBe(true);
  });

  it('validasi gagal → 400 VALIDATION_ERROR, TIDAK ada event started', async () => {
    const res = await app.invoke('POST', '/api/ai-product/conversation', {
      user: USER_A,
      body: { query: '' },
    });
    expect(res.statusCode).toBe(400);
    expect((res.body as { errorCode: string }).errorCode).toBe('VALIDATION_ERROR');
    expect(recordedMetricNames()).toEqual([]);
    expect(executeMock).not.toHaveBeenCalled();
  });

  it('error DB → next(err) → global handler 500 shape §0 (errorCode + requestId) + ai_conversation_failed', async () => {
    executeMock.mockRejectedValue(new Error('db down'));
    const res = await app.invoke('POST', '/api/ai-product/conversation', {
      id: 'req_test',
      user: USER_A,
      body: { query: 'kenapa habis?' },
    });
    expect(res.statusCode).toBe(500);
    const body = res.body as { error: string; message: string; errorCode: string; requestId: string; success: boolean };
    expect(body.success).toBe(false);
    expect(body.error).toContain('Coba lagi');
    expect(body.message).toContain('Coba lagi');
    expect(body.errorCode).toBe(CONVERSATION_ERROR_CODE);
    expect(body.requestId).toBe('req_test');
    expect(recordedMetricNames()).toContain('ai_conversation_started');
    expect(recordedMetricNames()).toContain('ai_conversation_failed');
    expect(recordedMetricNames()).not.toContain('ai_conversation_completed');

    const failed = recordSystemMetricMock.mock.calls.find((c) => c[0].metricName === 'ai_conversation_failed')[0];
    expect(failed.userId).toBe('user-a');
    expect(failed.metadata.periodDays).toBe(30);
  });
});
