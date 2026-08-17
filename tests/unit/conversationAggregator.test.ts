/**
 * Unit test — P8 Natural Conversation (Sprint 1.5).
 *
 * Memverifikasi logika DETERMINISTIK percakapan finansial:
 *   - computeDateRange / label periode
 *   - aggregateConversationStats (split current/previous, daily, kategori,
 *     merchant, transaksi terbesar)
 *   - buildConversationFallback (narasi rule-based, tanpa data & dengan data)
 *   - normalizeConversationNarrative (sanitasi output AI, whitelist href,
 *     cap, enum severity)
 *   - buildConversationPrompt (memuat data tersanitasi)
 *   - CONVERSATION_CREATE_SCHEMA (validasi body route)
 *   - route 500 → next(err) → global handler (shape §0: errorCode + requestId)
 *
 * Lib murni — tanpa DB, tanpa Gemini. Bagian route memakai mock Turso
 * (execute reject) + mock metricsService (pola trackEventRoutes.test.ts).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { validateBody } from '../../server/lib/validation.js';
import {
  computeDateRange,
  conversationPeriodLabel,
  aggregateConversationStats,
  sanitizeConversationName,
  buildConversationPrompt,
  buildConversationFallback,
  normalizeConversationNarrative,
  DEFAULT_PERIOD_DAYS,
} from '../../server/lib/conversationAggregator.js';
import {
  CONVERSATION_CREATE_SCHEMA,
  registerConversationRoutes,
  attachConversationError,
  CONVERSATION_ERROR_CODE,
  CONVERSATION_ERROR_MESSAGE,
} from '../../server/routes/conversationRoutes.js';
import { handleServerError } from '../../server/middleware/errorHandler.js';

// ── Mock untuk bagian route (chain 500) ─────────────────────────────────────
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

beforeEach(() => {
  vi.clearAllMocks();
  executeMock.mockReset();
  executeMock.mockResolvedValue({ rows: [] });
  recordSystemMetricMock.mockReset();
});

/** Buat baris transaksi helper. */
function tx({ id, date, type, amount, category = 'Makanan', merchant = '', note = '' }) {
  return { id, date, type, amount, category_name: category, merchant, note };
}

describe('computeDateRange & label', () => {
  it('default 30 hari bila period tidak dikenal', () => {
    const r = computeDateRange(45, new Date('2026-08-07T10:00:00'));
    expect(r.periodDays).toBe(DEFAULT_PERIOD_DAYS);
    expect(r.startDate).toBe('2026-07-09');
    expect(r.endDate).toBe('2026-08-07');
  });

  it('periode 7 hari & periode sebelumnya saling menempel tanpa overlap', () => {
    const r = computeDateRange(7, new Date('2026-08-07T10:00:00'));
    expect(r.startDate).toBe('2026-08-01');
    expect(r.endDate).toBe('2026-08-07');
    expect(r.prevStartDate).toBe('2026-07-25');
    expect(r.prevEndDate).toBe('2026-07-31');
  });

  it('periode 90 hari (3 bulan)', () => {
    const r = computeDateRange(90, new Date('2026-08-07T10:00:00'));
    expect(r.periodDays).toBe(90);
    expect(r.startDate).toBe('2026-05-10');
  });

  it('label periode ramah user', () => {
    expect(conversationPeriodLabel(7)).toBe('7 hari terakhir');
    expect(conversationPeriodLabel(30)).toBe('30 hari terakhir');
    expect(conversationPeriodLabel(90)).toBe('3 bulan terakhir');
  });
});

describe('sanitizeConversationName', () => {
  it('buang control character & normalisasi spasi', () => {
    expect(sanitizeConversationName('  GoFood\u0000 \t Delivery  ')).toBe('GoFood Delivery');
  });

  it('cap panjang & fallback Lainnya', () => {
    expect(sanitizeConversationName('a'.repeat(100), 10)).toBe('a'.repeat(10));
    expect(sanitizeConversationName('', 10)).toBe('Lainnya');
    expect(sanitizeConversationName(undefined, 10)).toBe('Lainnya');
  });
});

describe('aggregateConversationStats', () => {
  const range = computeDateRange(7, new Date('2026-08-07T10:00:00'));
  // current: 1-7 Agu; previous: 25-31 Jul
  const rows = [
    tx({ id: 't1', date: '2026-08-01', type: 'expense', amount: 50000, category: 'Makanan', merchant: 'GoFood' }),
    tx({ id: 't2', date: '2026-08-03', type: 'expense', amount: 200000, category: 'Transport', merchant: 'MyPertamina' }),
    tx({ id: 't3', date: '2026-08-05', type: 'income', amount: 3000000, category: 'Gaji' }),
    tx({ id: 't4', date: '2026-08-07', type: 'expense', amount: 150000, category: 'Makanan', merchant: 'GoFood' }),
    // previous period
    tx({ id: 't5', date: '2026-07-28', type: 'expense', amount: 100000, category: 'Makanan', merchant: 'KFC' }),
    tx({ id: 't6', date: '2026-07-30', type: 'income', amount: 2500000, category: 'Gaji' }),
  ];

  const stats = aggregateConversationStats(rows, range);

  it('jumlah total & net benar (hanya periode current)', () => {
    expect(stats.income).toBe(3000000);
    expect(stats.expense).toBe(400000);
    expect(stats.net).toBe(2600000);
    expect(stats.transactionCount).toBe(4);
  });

  it('nilai periode sebelumnya & delta % benar', () => {
    expect(stats.prevIncome).toBe(2500000);
    expect(stats.prevExpense).toBe(100000);
    // expense: (400000-100000)/100000 = +300%
    expect(stats.expenseDeltaPct).toBe(300);
    // income: (3000000-2500000)/2500000 = +20%
    expect(stats.incomeDeltaPct).toBe(20);
  });

  it('delta null bila periode sebelumnya nol', () => {
    const noPrev = aggregateConversationStats([tx({ id: 'x', date: '2026-08-01', type: 'expense', amount: 1000 })], range);
    expect(noPrev.expenseDeltaPct).toBeNull();
  });

  it('seri harian lengkap 7 hari dengan 0 untuk hari kosong', () => {
    expect(stats.daily).toHaveLength(7);
    expect(stats.daily[0]).toEqual({ date: '2026-08-01', income: 0, expense: 50000 });
    expect(stats.daily[1]).toEqual({ date: '2026-08-02', income: 0, expense: 0 });
    expect(stats.daily[4]).toEqual({ date: '2026-08-05', income: 3000000, expense: 0 });
  });

  it('kategori pengeluaran teratas dengan pct & count', () => {
    expect(stats.categories).toHaveLength(2);
    expect(stats.categories[0]).toMatchObject({ name: 'Makanan', amount: 200000, count: 2 });
    expect(stats.categories[0].pct).toBe(50);
    expect(stats.categories[1]).toMatchObject({ name: 'Transport', amount: 200000, count: 1 });
  });

  it('merchant teratas diurutkan & exclude kosong', () => {
    expect(stats.topMerchants).toHaveLength(2);
    expect(stats.topMerchants[0]).toMatchObject({ merchant: 'GoFood', amount: 200000, count: 2 });
  });

  it('transaksi terbesar diurutkan turun & disanitasi', () => {
    expect(stats.topTransactions).toHaveLength(3);
    expect(stats.topTransactions[0]).toMatchObject({ merchant: 'MyPertamina', amount: 200000, date: '2026-08-03' });
    expect(stats.topTransactions[0].categoryName).toBe('Transport');
  });

  it('hasData false bila tidak ada transaksi', () => {
    expect(aggregateConversationStats([], range).hasData).toBe(false);
  });

  it('abaikan baris tanpa tanggal & tipe tak dikenal tidak masuk total', () => {
    const weird = [
      { id: 'a', type: 'expense', amount: 100, category_name: 'X', merchant: '', note: '', date: '' },
      { id: 'b', type: 'transfer', amount: 500, category_name: 'X', merchant: '', note: '', date: '2026-08-02' },
    ];
    const s = aggregateConversationStats(weird, range);
    expect(s.transactionCount).toBe(1);
    expect(s.expense).toBe(0);
    expect(s.income).toBe(0);
  });
});

describe('buildConversationFallback', () => {
  const range = computeDateRange(7, new Date('2026-08-07T10:00:00'));

  it('tanpa data → ajak catat transaksi', () => {
    const f = buildConversationFallback({ query: 'kenapa habis?', periodDays: 7, stats: aggregateConversationStats([], range) });
    expect(f.summary).toContain('Belum ada transaksi');
    expect(f.insights).toHaveLength(0);
    expect(f.recommendations[0].href).toBe('/transactions');
  });

  it('dengan data → sebut nominal & insight kategori dominan', () => {
    const rows = [
      tx({ id: 't1', date: '2026-08-01', type: 'expense', amount: 80000, category: 'Makanan', merchant: 'GoFood' }),
      tx({ id: 't2', date: '2026-08-02', type: 'expense', amount: 20000, category: 'Makanan', merchant: 'KFC' }),
      tx({ id: 't3', date: '2026-08-03', type: 'income', amount: 2000000 }),
    ];
    const f = buildConversationFallback({ query: 'kenapa habis?', periodDays: 7, stats: aggregateConversationStats(rows, range) });
    expect(f.summary).toContain('Rp');
    expect(f.insights.length).toBeGreaterThan(0);
    // kategori 100% → severity high
    expect(f.insights[0].severity).toBe('high');
    expect(f.recommendations.length).toBeLessThanOrEqual(3);
    expect(f.recommendations[0].href).toBeDefined();
  });
});

describe('normalizeConversationNarrative', () => {
  it('sanitasi output AI: cap, collapse whitespace, default', () => {
    const n = normalizeConversationNarrative({
      summary: '  halo   dunia  '.repeat(200),
      insights: [{ title: '  Judul  ', detail: 'detail', severity: 'HIGH' }, { title: 'x', detail: 'y', severity: 'critical' }],
      recommendations: [
        { title: 'A', action: 'aksi', href: 'https://evil.example', impact: 'dampak' },
        { title: 'B', action: 'b', href: '/budgets', impact: 'i' },
      ],
    });
    expect(n.summary.length).toBeLessThanOrEqual(700);
    expect(n.summary.includes('  ')).toBe(false);
    // severity dinormalisasi ke low, bukan HIGH/critical
    expect(n.insights[0].severity).toBe('low');
    // href di luar whitelist → /advisor
    expect(n.recommendations[0].href).toBe('/advisor');
    expect(n.recommendations[1].href).toBe('/budgets');
  });

  it('array dipotong maksimal 3 & input non-object aman', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ title: `t${i}`, detail: 'd', severity: 'medium' }));
    const n = normalizeConversationNarrative({ summary: 's', insights: many, recommendations: many });
    expect(n.insights).toHaveLength(3);
    expect(n.recommendations).toHaveLength(3);
    expect(normalizeConversationNarrative(null).summary.length).toBeGreaterThan(0);
    expect(normalizeConversationNarrative('bukan objek').insights).toEqual([]);
  });
});

describe('buildConversationPrompt', () => {
  it('memuat query & label periode, tanpa data mentah berlebihan', () => {
    const range = computeDateRange(7, new Date('2026-08-07T10:00:00'));
    const rows = [tx({ id: 't1', date: '2026-08-01', type: 'expense', amount: 50000, category: 'Makanan', merchant: 'GoFood' })];
    const stats = aggregateConversationStats(rows, range);
    const p = buildConversationPrompt({ query: 'Kenapa habis?', periodDays: 7, stats, periodLabel: '7 hari terakhir' });
    expect(p).toContain('Kenapa habis?');
    expect(p).toContain('7 hari terakhir');
    expect(p).toContain('"summary"');
    expect(p).toContain('"recommendations"');
    // data disanitasi: merchant GoFood ada, tapi id transaksi tidak
    expect(p).toContain('GoFood');
    expect(p).not.toContain('"id":"t1"');
  });
});

describe('CONVERSATION_CREATE_SCHEMA', () => {
  it('menerima query valid + periodDays opsional', () => {
    expect(validateBody({ query: 'Kenapa uangku habis?' }, CONVERSATION_CREATE_SCHEMA).ok).toBe(true);
    const r = validateBody({ query: 'q', periodDays: 7 }, CONVERSATION_CREATE_SCHEMA);
    expect(r.ok).toBe(true);
    expect(r.value.periodDays).toBe(7);
  });

  it('menolak query kosong / terlalu panjang', () => {
    expect(validateBody({}, CONVERSATION_CREATE_SCHEMA).ok).toBe(false);
    expect(validateBody({ query: '   ' }, CONVERSATION_CREATE_SCHEMA).ok).toBe(false);
    expect(validateBody({ query: 'x'.repeat(201) }, CONVERSATION_CREATE_SCHEMA).ok).toBe(false);
  });

  it('periodDays hanya 7 | 30 | 90', () => {
    expect(validateBody({ query: 'q', periodDays: 30 }, CONVERSATION_CREATE_SCHEMA).ok).toBe(true);
    expect(validateBody({ query: 'q', periodDays: 90 }, CONVERSATION_CREATE_SCHEMA).ok).toBe(true);
    expect(validateBody({ query: 'q', periodDays: 10 }, CONVERSATION_CREATE_SCHEMA).ok).toBe(false);
    expect(validateBody({ query: 'q', periodDays: '30' }, CONVERSATION_CREATE_SCHEMA).ok).toBe(false);
  });
});

describe('attachConversationError — metadata error 500 (audit API)', () => {
  it('mount errorCode CONVERSATION_FAILED + userMessage spesifik + requestId', () => {
    const err = new Error('db down');
    attachConversationError(err, 'req_1');
    expect(err.errorCode).toBe(CONVERSATION_ERROR_CODE);
    expect(err.userMessage).toBe(CONVERSATION_ERROR_MESSAGE);
    expect(err.requestId).toBe('req_1');
  });

  it('preserve errorCode yang sudah ter-set (TIDAK menimpa)', () => {
    const err = new Error('db down');
    (err as { errorCode?: string }).errorCode = 'TURSO_DOWN';
    attachConversationError(err, 'req_2');
    expect(err.errorCode).toBe('TURSO_DOWN');
    expect(err.userMessage).toBe(CONVERSATION_ERROR_MESSAGE);
  });
});

describe('route 500 → next(err) → global handler (shape §0)', () => {
  type Handler = (req: unknown, res: unknown, next: (err?: unknown) => void) => unknown;

  function registerApp() {
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
    };
    registerConversationRoutes(app as never);
    return { routes };
  }

  function makeRes() {
    const res: { statusCode: number; body: unknown; status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> } = {
      statusCode: 200, body: undefined, status: vi.fn(), json: vi.fn(),
    };
    res.status.mockImplementation((code: number) => { res.statusCode = code; return res; });
    res.json.mockImplementation((body: unknown) => { res.body = body; return res; });
    return res;
  }

  function conversationHandler() {
    const { routes } = registerApp();
    const handlers = routes['POST /api/ai-product/conversation'];
    expect(handlers).toBeDefined();
    return handlers[handlers.length - 1];
  }

  it('Turso gagal → handler memanggil next(err) dengan errorCode + userMessage + requestId', async () => {
    const handler = conversationHandler();
    executeMock.mockRejectedValue(new Error('db down'));

    const nextErr: unknown[] = [];
    await handler(
      { id: 'req_conv_1', user: { id: 'user-a' }, body: { query: 'Kenapa uangku habis?' } } as never,
      makeRes() as never,
      (err) => { nextErr.push(err); },
    );

    expect(nextErr).toHaveLength(1);
    const err = nextErr[0] as { errorCode: string; userMessage: string; requestId: string };
    expect(err.errorCode).toBe(CONVERSATION_ERROR_CODE);
    expect(err.userMessage).toBe(CONVERSATION_ERROR_MESSAGE);
    expect(err.requestId).toBe('req_conv_1');
    // telemetry failed tetap direkam sebelum menyerahkan ke handler
    expect(recordSystemMetricMock.mock.calls.some((c) => (c[0] as { metricName: string }).metricName === 'ai_conversation_failed')).toBe(true);
  });

  it('full chain: handleServerError(err) → 500 { success:false, error, errorCode, requestId, message }', async () => {
    const handler = conversationHandler();
    executeMock.mockRejectedValue(new Error('db down'));

    const nextErr: unknown[] = [];
    await handler(
      { id: 'req_conv_2', user: { id: 'user-a' }, body: { query: 'Kenapa uangku habis?' } } as never,
      makeRes() as never,
      (err) => { nextErr.push(err); },
    );

    const res = makeRes();
    handleServerError(nextErr[0] as never, { id: 'req_conv_2' } as never, res as never, () => {});
    expect(res.statusCode).toBe(500);
    const body = res.body as { success: boolean; error: string; errorCode: string; requestId: string; message: string };
    expect(body.success).toBe(false);
    expect(body.error).toBe(CONVERSATION_ERROR_MESSAGE);
    expect(body.message).toBe(CONVERSATION_ERROR_MESSAGE);
    expect(body.errorCode).toBe(CONVERSATION_ERROR_CODE);
    expect(body.requestId).toBe('req_conv_2');
  });
});
