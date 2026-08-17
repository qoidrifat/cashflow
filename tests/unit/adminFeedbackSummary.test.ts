/**
 * Unit test: GET /api/admin/metrics/feedback-summary (Sprint 1.5).
 *
 * Endpoint admin — prioritas perbaikan prompt dari dataset ai_feedback.
 * Mengikuti pola harness adminMetricsValidation.test.ts (fake app + req/res):
 *   - 401 tanpa user, 403 non-admin (gate resolveAdmin dipertahankan).
 *   - 200 admin: query ai_feedback → buildFeedbackPriorityReport (agregasi murni).
 *   - Error Turso → 500 ADMIN_METRICS_500 (bukan bentuk lain).
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
// route lain tidak di-invoke di suite ini.
vi.mock('../../server/services/metricsService.js', () => ({
  default: {},
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

const ENDPOINT = '/api/admin/metrics/feedback-summary';
const ADMIN_USER = { id: 'admin-1', email: 'admin@cashflow.test' };
const NON_ADMIN_USER = { id: 'user-1', email: 'bukan-admin@cashflow.test' };

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /api/admin/metrics/feedback-summary — auth gate', () => {
  it('tanpa user → 401 ADMIN_METRICS_401, Turso tidak dipanggil', async () => {
    const res = await app.invoke(ENDPOINT, {});
    expect(res.statusCode).toBe(401);
    expect((res.body as { code: string }).code).toBe('ADMIN_METRICS_401');
    expect(executeMock).not.toHaveBeenCalled();
  });

  it('non-admin → 403 ADMIN_METRICS_403, Turso tidak dipanggil', async () => {
    const res = await app.invoke(ENDPOINT, { user: NON_ADMIN_USER });
    expect(res.statusCode).toBe(403);
    expect((res.body as { code: string }).code).toBe('ADMIN_METRICS_403');
    expect(executeMock).not.toHaveBeenCalled();
  });
});

describe('GET /api/admin/metrics/feedback-summary — agregasi', () => {
  it('admin → 200 dengan report lengkap dari buildFeedbackPriorityReport', async () => {
    executeMock.mockResolvedValue({
      rows: [
        { feature: 'advisor', rating: 'not_helpful' },
        { feature: 'advisor', rating: 'not_helpful' },
        { feature: 'advisor', rating: 'helpful' },
        { feature: 'insight', rating: 'helpful' },
      ],
    });
    const res = await app.invoke(ENDPOINT, { user: ADMIN_USER });
    expect(res.statusCode).toBe(200);
    const body = res.body as {
      ok: boolean;
      totalFeedback: number;
      features: Array<{ feature: string; priorityScore: number }>;
      actionPlan: Array<{ feature: string; direction: string }>;
      topPriority: { feature: string } | null;
    };
    expect(body.ok).toBe(true);
    expect(body.totalFeedback).toBe(4);
    expect(body.features).toHaveLength(2);
    expect(body.features[0].feature).toBe('advisor');
    expect(body.features[0].priorityScore).toBe(67);
    expect(body.actionPlan[0].feature).toBe('advisor');
    expect(body.actionPlan[0].direction).toContain('generik');
    expect(body.topPriority?.feature).toBe('advisor');
    // Query user-scoped tidak relevan di sini — endpoint admin membaca SEMUA feedback.
    expect(executeMock).toHaveBeenCalledTimes(1);
  });

  it('tanpa data → 200 laporan kosong (bukan error)', async () => {
    executeMock.mockResolvedValue({ rows: [] });
    const res = await app.invoke(ENDPOINT, { user: ADMIN_USER });
    expect(res.statusCode).toBe(200);
    expect((res.body as { totalFeedback: number }).totalFeedback).toBe(0);
    expect((res.body as { features: unknown[] }).features).toEqual([]);
    expect((res.body as { topPriority: unknown }).topPriority).toBeNull();
  });
});

describe('GET /api/admin/metrics/feedback-summary — error path', () => {
  it('kegagalan query Turso → 500 ADMIN_METRICS_500', async () => {
    executeMock.mockRejectedValue(new Error('turso down'));
    const res = await app.invoke(ENDPOINT, { user: ADMIN_USER });
    expect(res.statusCode).toBe(500);
    expect((res.body as { code: string }).code).toBe('ADMIN_METRICS_500');
    expect((res.body as { ok: boolean }).ok).toBe(false);
  });
});
