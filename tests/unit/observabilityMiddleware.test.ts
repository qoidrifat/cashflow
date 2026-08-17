/**
 * Unit test: server/middleware/observabilityMiddleware.js — retention signal
 * `user_active` (P10.1 Closed Beta Instrumentation).
 *
 * Kontrak yang dikunci:
 *  - httpMetricsMiddleware memicu recordUserActive HANYA saat ada user (auth).
 *  - Skip health endpoint (/api/health) — tidak membanjiri system_metrics.
 *  - recordUserActive mencatat SATU baris user_active per user per hari UTC
 *    (dedupe via SELECT sebelum INSERT — sudah tercatat → tidak insert ulang).
 *  - non-blocking: getMetricsClient null / execute reject → diam (tidak throw).
 *  - non-PII: metadata hanya { day: YYYY-MM-DD }.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const executeMock = vi.fn();
vi.mock('../../server/lib/turso.js', () => ({
  getTurso: vi.fn(() => ({ execute: executeMock })),
}));

const recordSystemMetricMock = vi.fn(() => Promise.resolve());
vi.mock('../../server/services/metricsService.js', () => ({
  default: {
    getMetricsClient: vi.fn(() => ({ execute: executeMock })),
    recordSystemMetric: (...args) => recordSystemMetricMock(...args),
  },
}));

import { httpMetricsMiddleware, recordUserActive } from '../../server/middleware/observabilityMiddleware.js';

/** Emulasi respons Express yang memicu event 'finish'. */
function fireResponse(res: { statusCode: number }) {
  const listeners = (res as unknown as { listenersOf: Map<string, Array<() => void>> }).listenersOf;
  for (const fn of listeners.get('finish') || []) fn();
}

function makeRes(statusCode = 200) {
  const res = {
    statusCode,
    on: vi.fn((event: string, fn: () => void) => {
      if (!res.listenersOf.has(event)) res.listenersOf.set(event, []);
      res.listenersOf.get(event)!.push(fn);
      return res;
    }),
    listenersOf: new Map<string, Array<() => void>>(),
  };
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
  executeMock.mockReset();
  executeMock.mockResolvedValue({ rows: [] }); // default: belum tercatat → insert
  recordSystemMetricMock.mockReset();
  recordSystemMetricMock.mockResolvedValue(undefined);
});

describe('httpMetricsMiddleware → user_active', () => {
  it('request ber-auth → metric user_active direkam (satu baris per hari)', async () => {
    const res = makeRes(200);
    httpMetricsMiddleware(
      { path: '/api/transactions', user: { id: 'user-a' }, id: 'req_1' } as never,
      res as never,
      () => {},
    );
    fireResponse(res);

    // flush microtask recordUserActive (fire-and-forget)
    await new Promise((r) => setTimeout(r, 0));

    const userActiveCalls = recordSystemMetricMock.mock.calls.filter(
      (c) => (c[0] as { metricName: string }).metricName === 'user_active',
    );
    expect(userActiveCalls.length).toBe(1);
    const call = userActiveCalls[0][0] as { metricName: string; feature: string; userId: string; metadata: { day: string } };
    expect(call.feature).toBe('app');
    expect(call.userId).toBe('user-a');
    expect(call.metadata.day).toMatch(/^\d{4}-\d{2}-\d{2}$/); // YYYY-MM-DD UTC
    // tidak ada PII di metadata
    expect(Object.keys(call.metadata)).toEqual(['day']);
  });

  it('dedupe: sudah tercatat hari ini (SELECT mengembalikan 1 baris) → TIDAK insert ulang', async () => {
    executeMock.mockResolvedValueOnce({ rows: [{ x: 1 }] }); // dedupe hit
    await recordUserActive('user-a');

    expect(recordSystemMetricMock).not.toHaveBeenCalled();
    // query dedupe memang dijalankan — dedupe via batas hari UTC (created_at)
    const sql = executeMock.mock.calls[0][0].sql as string;
    expect(sql).toContain('user_active');
    expect(sql).toContain('user_id = ?');
    expect(sql).toContain('created_at >= ?');
    expect(executeMock.mock.calls[0][0].args[1]).toMatch(/^\d{4}-\d{2}-\d{2} 00:00:00$/);
  });

  it('health endpoint → TIDAK memicu user_active (skip polling)', async () => {
    const res = makeRes(200);
    httpMetricsMiddleware(
      { path: '/api/gemini/health', user: { id: 'user-a' }, id: 'req_1' } as never,
      res as never,
      () => {},
    );
    fireResponse(res);
    await new Promise((r) => setTimeout(r, 0));
    expect(recordSystemMetricMock).not.toHaveBeenCalled();
  });

  it('tanpa user (anonim) → TIDAK ada user_active, http metrics tetap direkam', async () => {
    const res = makeRes(200);
    httpMetricsMiddleware(
      { path: '/api/search', user: null, id: 'req_1' } as never,
      res as never,
      () => {},
    );
    fireResponse(res);
    await new Promise((r) => setTimeout(r, 0));
    const names = recordSystemMetricMock.mock.calls.map((c) => (c[0] as { metricName: string }).metricName);
    expect(names).toContain('http_2xx_total');
    expect(names).not.toContain('user_active');
  });
});

describe('recordUserActive — non-blocking & privasi', () => {
  it('getMetricsClient null → return tanpa throw (metrik tidak menggagalkan request)', async () => {
    // ganti mock: getMetricsClient null
    const { default: metricsService } = await import('../../server/services/metricsService.js');
    (metricsService.getMetricsClient as ReturnType<typeof vi.fn>).mockReturnValue(null);
    await expect(recordUserActive('user-a')).resolves.toBeUndefined();
  });

  it('query dedupe reject → diam (tidak throw), user_active tidak direkam', async () => {
    executeMock.mockRejectedValue(new Error('db down'));
    await expect(recordUserActive('user-a')).resolves.toBeUndefined();
    expect(recordSystemMetricMock).not.toHaveBeenCalled();
  });
});
