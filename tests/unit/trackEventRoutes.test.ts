/**
 * Unit test: POST /api/ai-product/track — P10.2 frontend telemetry.
 *
 * Harness fake app (pola timelineApi.test.ts) + mock Turso + mock metricsService:
 *   - Route terdaftar DENGAN requireAuth (gate 401).
 *   - Whitelist event: ai_hub_view | recommendation_shown | recommendation_opened
 *     | ai_result_shown (P10.2i — denominator Feedback Rate).
 *   - Event tak dikenal → 400 VALIDATION_ERROR (fail-closed, tanpa insert).
 *   - Record non-PII: metricName = event, userId = session user, metadata
 *     { feature, itemId } — tanpa query/isi konten.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const executeMock = vi.fn();
vi.mock('../../server/lib/turso.js', () => ({
  getTurso: vi.fn(() => ({ execute: executeMock })),
}));

// metricsService di-mock agar observability tidak menyentuh DB di test.
const recordSystemMetricMock = vi.fn(() => Promise.resolve());
vi.mock('../../server/services/metricsService.js', () => ({
  default: {
    getMetricsClient: vi.fn(() => null),
    recordSystemMetric: (...args) => recordSystemMetricMock(...args),
  },
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

type ReqShape = { user?: unknown; body?: unknown };

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
      const [, handlers] = entry;
      const res = createRes();
      await handlers[handlers.length - 1]({ ...req }, res);
      return res;
    },
  };
  return { app, routes };
}

const { app, routes } = createApp();
registerAiProductRoutes(app as never);

const USER_A = { id: 'user-a' };

beforeEach(() => {
  vi.clearAllMocks();
  executeMock.mockReset();
  executeMock.mockResolvedValue({ rows: [] });
  recordSystemMetricMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('auth gate — POST /api/ai-product/track terpasang requireAuth', () => {
  it('middleware requireAuth terdaftar di route track', () => {
    const handlers = routes['POST /api/ai-product/track'];
    expect(handlers).toBeDefined();
    expect(handlers.length).toBeGreaterThanOrEqual(2);
    expect(handlers[handlers.length - 2]).toBe(requireAuth);
  });
});

describe('record event — whitelist + non-PII', () => {
  it('ai_hub_view → system_metrics direkam (metricName=event, userId, feature ai_hub)', async () => {
    const res = await app.invoke('POST', '/api/ai-product/track', {
      user: USER_A,
      body: { event: 'ai_hub_view' },
    });
    expect(res.statusCode).toBe(200);
    expect((res.body as { ok: boolean }).ok).toBe(true);

    expect(recordSystemMetricMock).toHaveBeenCalledTimes(1);
    const call = recordSystemMetricMock.mock.calls[0][0];
    expect(call.metricName).toBe('ai_hub_view');
    expect(call.userId).toBe('user-a');
    expect(call.feature).toBe('ai_hub'); // default saat tanpa feature
    // non-PII: metadata hanya feature/itemId/eventType (null saat tidak dikirim)
    expect(Object.keys(call.metadata).sort()).toEqual(['eventType', 'feature', 'itemId']);
  });

  it('recommendation_shown dengan feature+itemId → metadata dikirim persis', async () => {
    const res = await app.invoke('POST', '/api/ai-product/track', {
      user: USER_A,
      body: { event: 'recommendation_shown', feature: 'advisor', itemId: 'evt-123' },
    });
    expect(res.statusCode).toBe(200);
    const call = recordSystemMetricMock.mock.calls[0][0];
    expect(call.metricName).toBe('recommendation_shown');
    expect(call.feature).toBe('advisor');
    expect(call.metadata).toEqual({ feature: 'advisor', itemId: 'evt-123', eventType: null });
  });

  it('eventType valid (enum timeline) → metadata menyertakannya', async () => {
    const res = await app.invoke('POST', '/api/ai-product/track', {
      user: USER_A,
      body: { event: 'recommendation_shown', feature: 'advisor', itemId: 'evt-7', eventType: 'recommendation' },
    });
    expect(res.statusCode).toBe(200);
    const call = recordSystemMetricMock.mock.calls[0][0];
    expect(call.metadata).toEqual({ feature: 'advisor', itemId: 'evt-7', eventType: 'recommendation' });
  });

  it('eventType TIDAK valid → 400 VALIDATION_ERROR (fail-closed, tanpa metric)', async () => {
    const res = await app.invoke('POST', '/api/ai-product/track', {
      user: USER_A,
      body: { event: 'recommendation_shown', eventType: 'evil_type' },
    });
    expect(res.statusCode).toBe(400);
    expect((res.body as { errorCode: string }).errorCode).toBe('VALIDATION_ERROR');
    expect(recordSystemMetricMock).not.toHaveBeenCalled();
  });

  it('eventType berupa angka/bukan string → 400', async () => {
    const res = await app.invoke('POST', '/api/ai-product/track', {
      user: USER_A,
      body: { event: 'recommendation_shown', eventType: 123 },
    });
    expect(res.statusCode).toBe(400);
    expect(recordSystemMetricMock).not.toHaveBeenCalled();
  });

  it('recommendation_opened → direkam', async () => {
    await app.invoke('POST', '/api/ai-product/track', {
      user: USER_A,
      body: { event: 'recommendation_opened', itemId: 'evt-9' },
    });
    const call = recordSystemMetricMock.mock.calls[0][0];
    expect(call.metricName).toBe('recommendation_opened');
    expect(call.metadata.itemId).toBe('evt-9');
  });

  it('ai_result_shown → direkam (P10.2i — denominator Feedback Rate)', async () => {
    const res = await app.invoke('POST', '/api/ai-product/track', {
      user: USER_A,
      body: { event: 'ai_result_shown', feature: 'advisor', itemId: 'evt-11', eventType: 'recommendation' },
    });
    expect(res.statusCode).toBe(200);
    expect((res.body as { ok: boolean }).ok).toBe(true);
    const call = recordSystemMetricMock.mock.calls[0][0];
    expect(call.metricName).toBe('ai_result_shown');
    expect(call.metadata).toEqual({ feature: 'advisor', itemId: 'evt-11', eventType: 'recommendation' });
  });

  it('event tak dikenal → 400 VALIDATION_ERROR, TIDAK ada metric', async () => {
    const res = await app.invoke('POST', '/api/ai-product/track', {
      user: USER_A,
      body: { event: 'evil_hack_event' },
    });
    expect(res.statusCode).toBe(400);
    expect((res.body as { errorCode: string }).errorCode).toBe('VALIDATION_ERROR');
    expect(recordSystemMetricMock).not.toHaveBeenCalled();
  });

  it('body kosong / event absen → 400', async () => {
    const res = await app.invoke('POST', '/api/ai-product/track', { user: USER_A, body: {} });
    expect(res.statusCode).toBe(400);
    expect(recordSystemMetricMock).not.toHaveBeenCalled();
  });

  it('field tak dikenal di body dibuang (tidak sampai metadata)', async () => {
    const res = await app.invoke('POST', '/api/ai-product/track', {
      user: USER_A,
      body: { event: 'ai_hub_view', query: 'RAHASIA', email: 'pii@x.com', itemId: 'e1' },
    });
    expect(res.statusCode).toBe(200);
    const call = recordSystemMetricMock.mock.calls[0][0];
    expect(call.metadata.query).toBeUndefined();
    expect(call.metadata.email).toBeUndefined();
    expect(call.metadata.itemId).toBe('e1');
  });
});
