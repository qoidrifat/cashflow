/**
 * Unit test: view per-user admin monitoring (P10.2).
 *
 * Mengikuti pola feedbackRateApi.test.ts (fake app + req/res):
 *   - GET /api/admin/metrics/telemetry-users: 401 tanpa user, 403 non-admin,
 *     200 admin dengan shape { ok, users }, 500 kegagalan service.
 *   - userId passthrough: ?userId= diteruskan ke getRecommendationEngagement &
 *     getFeedbackRate; tanpa userId → null; userId tak valid (>191) → 400
 *     ADMIN_METRICS_400 (fail-closed, pola P1-2 G4).
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

const getRecommendationEngagementMock = vi.fn();
const getFeedbackRateMock = vi.fn();
const getTelemetryUsersMock = vi.fn();
vi.mock('../../server/services/metricsService.js', () => ({
  default: {
    getRecommendationEngagement: (...args) => getRecommendationEngagementMock(...args),
    getFeedbackRate: (...args) => getFeedbackRateMock(...args),
    getTelemetryUsers: (...args) => getTelemetryUsersMock(...args),
  },
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

const USERS_ENDPOINT = '/api/admin/metrics/telemetry-users';
const REC_ENDPOINT = '/api/admin/metrics/recommendation-engagement';
const FB_ENDPOINT = '/api/admin/metrics/feedback-rate';
const ADMIN_USER = { id: 'admin-1', email: 'admin@cashflow.test' };
const NON_ADMIN_USER = { id: 'user-1', email: 'bukan-admin@cashflow.test' };

beforeEach(() => {
  vi.clearAllMocks();
  getRecommendationEngagementMock.mockResolvedValue({ shown: 0, opened: 0, ctr: 0, byFeature: [], byDay: [], byEventType: [] });
  getFeedbackRateMock.mockResolvedValue({ feedback: 0, views: 0, rate: 0, byFeature: [] });
  getTelemetryUsersMock.mockResolvedValue({ users: [] });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /api/admin/metrics/telemetry-users — auth gate', () => {
  it('tanpa user → 401 ADMIN_METRICS_401, service tidak dipanggil', async () => {
    const res = await app.invoke(USERS_ENDPOINT, {});
    expect(res.statusCode).toBe(401);
    expect((res.body as { code: string }).code).toBe('ADMIN_METRICS_401');
    expect(getTelemetryUsersMock).not.toHaveBeenCalled();
  });

  it('non-admin → 403 ADMIN_METRICS_403, service tidak dipanggil', async () => {
    const res = await app.invoke(USERS_ENDPOINT, { user: NON_ADMIN_USER });
    expect(res.statusCode).toBe(403);
    expect((res.body as { code: string }).code).toBe('ADMIN_METRICS_403');
    expect(getTelemetryUsersMock).not.toHaveBeenCalled();
  });
});

describe('GET /api/admin/metrics/telemetry-users — shape + range', () => {
  it('admin → 200 { ok, users } dengan label dari tabel user', async () => {
    getTelemetryUsersMock.mockResolvedValue({
      users: [
        { userId: 'u1', name: 'Dafa', email: 'demo@cashflow.test', label: 'demo@cashflow.test', recommendations: 4, views: 2, feedback: 1, activity: 7 },
      ],
    });
    const res = await app.invoke(USERS_ENDPOINT, { user: ADMIN_USER, query: {} });
    expect(res.statusCode).toBe(200);
    const body = res.body as { ok: boolean; users: Array<{ userId: string; label: string; activity: number }> };
    expect(body.ok).toBe(true);
    expect(body.users).toHaveLength(1);
    expect(body.users[0]).toMatchObject({ userId: 'u1', label: 'demo@cashflow.test', activity: 7 });
    expect(getTelemetryUsersMock).toHaveBeenCalledTimes(1);
    const arg = getTelemetryUsersMock.mock.calls[0][0];
    expect(typeof arg.from).toBe('string');
    expect(typeof arg.to).toBe('string');
  });

  it('tanpa data → 200 users kosong (bukan error)', async () => {
    const res = await app.invoke(USERS_ENDPOINT, { user: ADMIN_USER, query: {} });
    expect(res.statusCode).toBe(200);
    expect((res.body as { users: unknown[] }).users).toEqual([]);
  });

  it('kegagalan service → 500 ADMIN_METRICS_500', async () => {
    getTelemetryUsersMock.mockRejectedValue(new Error('turso down'));
    const res = await app.invoke(USERS_ENDPOINT, { user: ADMIN_USER });
    expect(res.statusCode).toBe(500);
    expect((res.body as { code: string }).code).toBe('ADMIN_METRICS_500');
  });
});

describe('userId passthrough — recommendation-engagement & feedback-rate', () => {
  it('?userId= diteruskan ke getRecommendationEngagement', async () => {
    await app.invoke(REC_ENDPOINT, { user: ADMIN_USER, query: { userId: 'u-dafa' } });
    const arg = getRecommendationEngagementMock.mock.calls[0][0];
    expect(arg.userId).toBe('u-dafa');
  });

  it('?userId= diteruskan ke getFeedbackRate', async () => {
    await app.invoke(FB_ENDPOINT, { user: ADMIN_USER, query: { userId: 'u-dafa' } });
    const arg = getFeedbackRateMock.mock.calls[0][0];
    expect(arg.userId).toBe('u-dafa');
  });

  it('tanpa userId → null (semua user, perilaku lama)', async () => {
    await app.invoke(REC_ENDPOINT, { user: ADMIN_USER, query: {} });
    expect(getRecommendationEngagementMock.mock.calls[0][0].userId).toBeNull();
    await app.invoke(FB_ENDPOINT, { user: ADMIN_USER, query: {} });
    expect(getFeedbackRateMock.mock.calls[0][0].userId).toBeNull();
  });

  it('userId string kosong → null (dinormalisasi)', async () => {
    await app.invoke(REC_ENDPOINT, { user: ADMIN_USER, query: { userId: '   ' } });
    expect(getRecommendationEngagementMock.mock.calls[0][0].userId).toBeNull();
  });

  it('userId > 191 karakter → 400 ADMIN_METRICS_400 (fail-closed, service tidak dipanggil)', async () => {
    const long = 'x'.repeat(192);
    for (const endpoint of [REC_ENDPOINT, FB_ENDPOINT, USERS_ENDPOINT]) {
      const res = await app.invoke(endpoint, { user: ADMIN_USER, query: { userId: long } });
      expect(res.statusCode).toBe(400);
      expect((res.body as { code: string }).code).toBe('ADMIN_METRICS_400');
    }
    expect(getRecommendationEngagementMock).not.toHaveBeenCalled();
    expect(getFeedbackRateMock).not.toHaveBeenCalled();
  });
});
