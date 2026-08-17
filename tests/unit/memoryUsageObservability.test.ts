/**
 * Unit test: server/routes/geminiRoutes.js — observability memory → prompt
 * `ai_memory_used` (P10.1). Numerator memory_utilization_rate.
 *
 * Kontrak yang dikunci:
 *  - POST /api/gemini/monthly-report (valid) memuat ai_memory user → mencatat
 *    `ai_memory_used` (metricValue = jumlah item, metadata { context, used }).
 *  - POST /api/gemini/advisor (valid) → mencatat `ai_memory_used` (context advisor).
 *  - User-scoped: query ai_memory menyertakan user_id terautentikasi.
 *  - Fire-and-forget: loadUserMemory gagal → memory [] → tetap generate (gagal
 *    aman), observability tetap direkam dengan count 0.
 *  - non-PII: metadata hanya context + used (tanpa isi memory).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const executeMock = vi.fn();
vi.mock('../../server/lib/turso.js', () => ({
  getTurso: vi.fn(() => ({ execute: executeMock })),
}));

const recordSystemMetricMock = vi.fn(() => Promise.resolve());
vi.mock('../../server/services/metricsService.js', () => ({
  default: {
    getMetricsClient: vi.fn(() => null),
    recordSystemMetric: (...args) => recordSystemMetricMock(...args),
  },
}));

// Vertex DIKONFIGURASI (geminiReady: true) agar route melewati guard 503 dan
// mencapai loadUserMemory → observability memory. generateGeminiText di-mock
// reject → route selesai di catch (classifyVertexError → 500). Observability
// memory DIREKAM SEBELUM generate — itulah yang diuji.
vi.mock('../../server/lib/vertexContext.js', () => ({
  getVertexState: vi.fn(() => ({ geminiReady: true, vertexAI: {} })),
  isProduction: vi.fn(() => false),
  buildExtractionPrompt: vi.fn(),
  buildReceiptExtractionPrompt: vi.fn(),
  buildMonthlyReportPrompt: vi.fn(() => 'prompt-report'),
  buildAdvisorPrompt: vi.fn(() => 'prompt-advisor'),
  parseGeminiResponse: vi.fn(() => ({ success: true, data: {} })),
  normalizeReceiptResult: vi.fn(),
  generateGeminiText: vi.fn(() => Promise.reject(new Error('gemini down'))),
  generateGeminiVision: vi.fn(),
  generateVertexContent: vi.fn(),
  createRequestId: vi.fn(() => 'req_test'),
  classifyVertexError: vi.fn(() => ({ code: 'VERTEX_UNKNOWN_ERROR', httpStatus: 500, message: 'err', retryable: false })),
  sendGeminiError: vi.fn(),
}));

import { registerGeminiRoutes } from '../../server/routes/geminiRoutes.js';

type Handler = (req: unknown, res: unknown, next?: (err?: unknown) => void) => unknown;

interface FakeRes {
  statusCode: number;
  body: unknown;
  status(code: number): FakeRes;
  json(payload: unknown): FakeRes;
}

function makeRes(): FakeRes {
  const res: FakeRes = {
    statusCode: 200,
    body: undefined,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; },
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
  { body = {}, user = { id: 'user-mem' } } = {} as never,
): Promise<FakeRes> {
  const fns = routes.get(`${method} ${path}`);
  if (!fns) throw new Error(`Route tidak terdaftar: ${method} ${path}`);
  const req = { body, user } as never;
  const res = makeRes();
  for (let i = 0; i < fns.length - 1; i++) {
    let nextCalled = false;
    fns[i](req, res, () => { nextCalled = true; });
    if (!nextCalled) return res;
  }
  await fns[fns.length - 1](req, res);
  return res;
}

registerGeminiRoutes(fakeApp as never);

function memoryUsedCalls() {
  return recordSystemMetricMock.mock.calls
    .map((c) => c[0] as { metricName: string; metricValue: number; feature: string; userId: string; metadata: { context: string; used: boolean } })
    .filter((c) => c.metricName === 'ai_memory_used');
}

const validMetrics = { totalIncome: 1_000_000, totalExpense: 500_000 };

beforeEach(() => {
  vi.clearAllMocks();
  executeMock.mockReset();
  executeMock.mockResolvedValue({ rows: [] }); // default: tidak ada memory
  recordSystemMetricMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ai_memory_used — monthly-report', () => {
  it('memory ada → metric direkam dengan count item & used=true, query user-scoped', async () => {
    executeMock.mockResolvedValue({
      rows: [
        { category: 'spending_habit', key: 'makanan', value: 'jarang jajan' },
        { category: 'goal', key: 'darurat', value: 'target 3 bulan' },
      ],
    });
    const res = await invoke('POST', '/api/gemini/monthly-report', {
      body: { month: 8, year: 2026, metrics: validMetrics },
    });
    // Gemini di-mock reject → catch → 500 (pipeline Vertex tidak dieksekusi)
    expect(res.statusCode).toBe(500);

    const calls = memoryUsedCalls();
    expect(calls.length).toBe(1);
    expect(calls[0].metricValue).toBe(2);
    expect(calls[0].feature).toBe('ai_memory');
    expect(calls[0].userId).toBe('user-mem');
    expect(calls[0].metadata.context).toBe('monthly-report');
    expect(calls[0].metadata.used).toBe(true);
    expect(Object.keys(calls[0].metadata).sort()).toEqual(['context', 'used']); // tanpa isi memory

    // query ai_memory user-scoped — cari panggilan execute yang menyentuh tabel
    const memoryQuery = executeMock.mock.calls.map((c) => c[0]).find((c) => {
      const sql = typeof c?.sql === 'string' ? c.sql : '';
      return sql.includes('FROM ai_memory');
    });
    expect(memoryQuery).toBeDefined();
    expect((memoryQuery.sql as string).includes('user_id = ?')).toBe(true);
    expect(memoryQuery.args[0]).toBe('user-mem');
  });

  it('tanpa memory → metric direkam count=0, used=false (gagal aman)', async () => {
    const res = await invoke('POST', '/api/gemini/monthly-report', {
      body: { month: 8, year: 2026, metrics: validMetrics },
    });
    expect(res.statusCode).toBe(500);
    const calls = memoryUsedCalls();
    expect(calls.length).toBe(1);
    expect(calls[0].metricValue).toBe(0);
    expect(calls[0].metadata.used).toBe(false);
  });

  it('loadUserMemory gagal (DB error) → diam → tetap lanjut pipeline, metric count=0', async () => {
    executeMock.mockRejectedValue(new Error('db down'));
    const res = await invoke('POST', '/api/gemini/monthly-report', {
      body: { month: 8, year: 2026, metrics: validMetrics },
    });
    expect(res.statusCode).toBe(500); // bukan crash — memory tidak menggagalkan generate
    const calls = memoryUsedCalls();
    expect(calls.length).toBe(1);
    expect(calls[0].metricValue).toBe(0);
  });
});

describe('ai_memory_used — advisor', () => {
  it('advisor valid → metric direkam dengan context advisor', async () => {
    executeMock.mockResolvedValue({
      rows: [{ category: 'payment_preference', key: 'metode', value: 'cash' }],
    });
    const res = await invoke('POST', '/api/gemini/advisor', {
      body: { metrics: validMetrics, subscriptions: [] },
    });
    expect(res.statusCode).toBe(500); // Gemini reject → catch

    const calls = memoryUsedCalls();
    expect(calls.length).toBe(1);
    expect(calls[0].metricValue).toBe(1);
    expect(calls[0].metadata.context).toBe('advisor');
    expect(calls[0].metadata.used).toBe(true);
  });
});
