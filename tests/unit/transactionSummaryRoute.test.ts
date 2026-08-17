/**
 * Unit test: GET /api/transactions/summary — ringkasan keuangan windowless.
 *
 * Mengikuti harness timelineApi.test.ts: fake app + mock Turso. Verifikasi:
 *   1. Auth gate: endpoint terdaftar dengan requireAuth.
 *   2. User scoping: query memakai user_id terautentikasi (bukan param client).
 *   3. month/year query opsional → diteruskan ke computeFinancialSummary;
 *      nilai invalid → 400 VALIDATION_ERROR.
 *   4. Response shape: { month, year, lifetime, monthly, monthlyByCategory }.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const executeMock = vi.fn();
vi.mock('../../server/lib/turso.js', () => ({
  getTurso: vi.fn(() => ({ execute: executeMock })),
}));

// computeFinancialSummary dites terpisah (financialSummary.test.ts) — di sini
// di-spy agar route diteruskan dengan benar tanpa menyentuh DB.
const computeFinancialSummaryMock = vi.fn();
vi.mock('../../server/lib/financialSummary.js', () => ({
  computeFinancialSummary: (...args) => computeFinancialSummaryMock(...args),
}));

// Observability (audit 2026-08-10): financial_summary_* dicatat non-blocking —
// di-spy agar assertion deterministik (tanpa env metrics DB).
const recordSystemMetricMock = vi.fn();
vi.mock('../../server/services/metricsService.js', () => ({
  default: { recordSystemMetric: (...args) => recordSystemMetricMock(...args) },
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

beforeEach(() => {
  vi.clearAllMocks();
  executeMock.mockReset();
  computeFinancialSummaryMock.mockReset();
  recordSystemMetricMock.mockReset();
  recordSystemMetricMock.mockResolvedValue(undefined);
  computeFinancialSummaryMock.mockResolvedValue({
    month: 8,
    year: 2026,
    lifetime: { totalIncome: 51554047.42, totalExpense: 57866289.04, balance: -6312241.62, count: 778 },
    monthly: { totalIncome: 135394, totalExpense: 261326, balance: -125932, count: 54 },
    monthlyByCategory: [],
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('auth gate', () => {
  it('GET /api/transactions/summary terdaftar dengan requireAuth', () => {
    const handlers = routes['GET /api/transactions/summary'];
    expect(handlers).toBeDefined();
    expect(handlers.length).toBeGreaterThanOrEqual(2);
    expect(handlers[handlers.length - 2]).toBe(requireAuth);
  });
});

describe('GET /api/transactions/summary', () => {
  it('200 + response shape windowless; user-scoped (user_id terautentikasi)', async () => {
    const res = await app.invoke('GET', '/api/transactions/summary', { user: USER_A, query: {} });
    expect(res.statusCode).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body).toHaveProperty('lifetime');
    expect(body).toHaveProperty('monthly');
    expect(body).toHaveProperty('monthlyByCategory');
    expect((body.lifetime as { balance: number }).balance).toBe(-6312241.62);

    // computeFinancialSummary dipanggil dengan getTurso() client + user terautentikasi
    expect(computeFinancialSummaryMock).toHaveBeenCalledTimes(1);
    const [client, userId, opts] = computeFinancialSummaryMock.mock.calls[0];
    expect(userId).toBe('user-a');
    expect(client).toBeDefined();
    expect(opts.month).toBe(8); // default = bulan server berjalan (Agustus 2026)
    expect(opts.year).toBe(2026);
  });

  it('observability: financial_summary_requested + _completed dicatat (tanpa nominal)', async () => {
    await app.invoke('GET', '/api/transactions/summary', { user: USER_A, query: {} });
    const names = recordSystemMetricMock.mock.calls.map((c) => c[0].metricName);
    expect(names).toContain('financial_summary_requested');
    expect(names).toContain('financial_summary_completed');
    // metadata TIDAK memuat payload finansial — hanya requestId/duration.
    const completed = recordSystemMetricMock.mock.calls.find((c) => c[0].metricName === 'financial_summary_completed');
    expect(Object.keys(completed[0].metadata)).toEqual(expect.arrayContaining(['requestId', 'durationMs']));
    expect(completed[0].userId).toBe('user-a');
  });

  it('observability: financial_summary_failed dicatat saat compute gagal (500)', async () => {
    computeFinancialSummaryMock.mockRejectedValueOnce(new Error('DB down'));
    const res = await app.invoke('GET', '/api/transactions/summary', { user: USER_A, query: {} });
    expect(res.statusCode).toBe(500);
    const names = recordSystemMetricMock.mock.calls.map((c) => c[0].metricName);
    expect(names).toContain('financial_summary_failed');
  });

  it('month/year query diteruskan ke computeFinancialSummary', async () => {
    await app.invoke('GET', '/api/transactions/summary', { user: USER_A, query: { month: '3', year: '2025' } });
    const [, , opts] = computeFinancialSummaryMock.mock.calls[0];
    expect(opts.month).toBe(3);
    expect(opts.year).toBe(2025);
  });

  it('month non-numeric → 400 VALIDATION_ERROR (fail-closed, bukan clamp)', async () => {
    for (const month of ['abc', '12.5', '9,5']) {
      const res = await app.invoke('GET', '/api/transactions/summary', { user: USER_A, query: { month } });
      expect(res.statusCode, `month=${month}`).toBe(400);
      const body = res.body as { errorCode: string };
      expect(body.errorCode).toBe('VALIDATION_ERROR');
      expect(computeFinancialSummaryMock).not.toHaveBeenCalled();
    }
  });

  it('month/year di luar rentang di-clamp (semantik validateInt clamp:true — pola limit GET)', async () => {
    // month 0 → 1; month 13 → 12; year 1900 → 2000; year 9999 → 2100
    await app.invoke('GET', '/api/transactions/summary', { user: USER_A, query: { month: '0', year: '1900' } });
    expect(computeFinancialSummaryMock).toHaveBeenCalledTimes(1);
    const [, , opts0] = computeFinancialSummaryMock.mock.calls[0];
    expect(opts0.month).toBe(1);
    expect(opts0.year).toBe(2000);

    await app.invoke('GET', '/api/transactions/summary', { user: USER_A, query: { month: '13', year: '9999' } });
    const [, , opts13] = computeFinancialSummaryMock.mock.calls[1];
    expect(opts13.month).toBe(12);
    expect(opts13.year).toBe(2100);
  });

  it('500 bila computeFinancialSummary gagal (tidak menyembunyikan error)', async () => {
    computeFinancialSummaryMock.mockRejectedValueOnce(new Error('DB down'));
    const res = await app.invoke('GET', '/api/transactions/summary', { user: USER_A, query: {} });
    expect(res.statusCode).toBe(500);
  });
});
