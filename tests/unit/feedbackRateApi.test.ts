/**
 * Unit test: GET /api/admin/metrics/feedback-rate (P10.2i — Feedback Rate).
 *
 * Endpoint admin — ai_feedback ÷ ai_result_shown. Mengikuti pola
 * adminFeedbackSummary.test.ts (fake app + req/res):
 *   - 401 tanpa user, 403 non-admin (gate resolveAdmin dipertahankan).
 *   - 200 admin: query ai_feedback + system_metrics ai_result_shown →
 *     aggregateFeedbackRate (agregasi murni).
 *   - Error Turso → 500 ADMIN_METRICS_500.
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

// metricsService di-mock agar import route tidak menarik dependensi berat;
// hanya getFeedbackRate yang di-invoke di suite ini.
const getFeedbackRateMock = vi.fn();
vi.mock('../../server/services/metricsService.js', () => ({
  default: { getFeedbackRate: (...args) => getFeedbackRateMock(...args) },
}));

import { registerAdminMetricsRoutes } from '../../server/routes/adminMetricsRoutes.js';

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

type Handler = (req: unknown, res: unknown) => Promise<unknown> | unknown;

function createApp() {
  const routes: Record<string, Handler> = {};
  const app = {
    get: (path: string, handler: Handler) => { routes[path] = handler; },
    post: (path: string, handler: Handler) => { routes[path] = handler; },
    invoke: async (path: string, req: { user?: unknown; query?: Record<string, unknown> }) => {
      const handler = routes[path];
      if (!handler) throw new Error(`Route tidak terdaftar: ${path}`);
      const res = createRes();
      await handler(req, res);
      return res;
    },
  };
  return app;
}

const app = createApp();
registerAdminMetricsRoutes(app as never);

const ENDPOINT = '/api/admin/metrics/feedback-rate';
const ADMIN_USER = { id: 'admin-1', email: 'admin@cashflow.test' };
const NON_ADMIN_USER = { id: 'user-1', email: 'bukan-admin@cashflow.test' };

beforeEach(() => {
  vi.clearAllMocks();
  getFeedbackRateMock.mockResolvedValue({ feedback: 0, views: 0, rate: 0, byFeature: [] });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /api/admin/metrics/feedback-rate — auth gate', () => {
  it('tanpa user → 401 ADMIN_METRICS_401, service tidak dipanggil', async () => {
    const res = await app.invoke(ENDPOINT, {});
    expect(res.statusCode).toBe(401);
    expect((res.body as { code: string }).code).toBe('ADMIN_METRICS_401');
    expect(getFeedbackRateMock).not.toHaveBeenCalled();
  });

  it('non-admin → 403 ADMIN_METRICS_403, service tidak dipanggil', async () => {
    const res = await app.invoke(ENDPOINT, { user: NON_ADMIN_USER });
    expect(res.statusCode).toBe(403);
    expect((res.body as { code: string }).code).toBe('ADMIN_METRICS_403');
    expect(getFeedbackRateMock).not.toHaveBeenCalled();
  });
});

describe('GET /api/admin/metrics/feedback-rate — agregasi + shape', () => {
  it('admin → 200 + shape lengkap dari aggregateFeedbackRate (feedback/views/rate/byFeature)', async () => {
    getFeedbackRateMock.mockResolvedValue({
      feedback: 3,
      views: 5,
      rate: 0.6,
      byFeature: [{ feature: 'advisor', feedback: 3, views: 5, rate: 0.6 }],
    });
    const res = await app.invoke(ENDPOINT, { user: ADMIN_USER, query: {} });
    expect(res.statusCode).toBe(200);
    const body = res.body as {
      ok: boolean;
      feedback: number;
      views: number;
      rate: number;
      byFeature: Array<{ feature: string; rate: number }>;
    };
    expect(body.ok).toBe(true);
    expect(body.feedback).toBe(3);
    expect(body.views).toBe(5);
    expect(body.rate).toBe(0.6);
    expect(body.byFeature).toHaveLength(1);
    expect(body.byFeature[0].feature).toBe('advisor');
    // from/to query diteruskan ke service (default window 7 hari saat tanpa query)
    expect(getFeedbackRateMock).toHaveBeenCalledTimes(1);
    const arg = getFeedbackRateMock.mock.calls[0][0];
    expect(typeof arg.from).toBe('string');
    expect(typeof arg.to).toBe('string');
  });

  it('tanpa data → 200 laporan kosong (bukan error)', async () => {
    getFeedbackRateMock.mockResolvedValue({ feedback: 0, views: 0, rate: 0, byFeature: [] });
    const res = await app.invoke(ENDPOINT, { user: ADMIN_USER, query: {} });
    expect(res.statusCode).toBe(200);
    expect((res.body as { feedback: number }).feedback).toBe(0);
    expect((res.body as { byFeature: unknown[] }).byFeature).toEqual([]);
  });
});

describe('GET /api/admin/metrics/feedback-rate — error path', () => {
  it('kegagalan service → 500 ADMIN_METRICS_500', async () => {
    getFeedbackRateMock.mockRejectedValue(new Error('turso down'));
    const res = await app.invoke(ENDPOINT, { user: ADMIN_USER });
    expect(res.statusCode).toBe(500);
    expect((res.body as { code: string }).code).toBe('ADMIN_METRICS_500');
    expect((res.body as { ok: boolean }).ok).toBe(false);
  });
});
