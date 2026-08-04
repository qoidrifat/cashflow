/**
 * Unit test: server/routes/adminMetricsRoutes.js — P1-2 G4 (admin metrics gap-fill).
 *
 * Menguji gap-fill validasi shared library (server/lib/validation.js) tanpa
 * Express nyata / DB: route didaftarkan ke fake app, handler dipanggil langsung
 * dengan req/res tiruan (user + query + params).
 *
 * Kontrak yang dipaku (HARD RULES Task #42):
 *   - Validasi gagal → 400 bentuk DOMAIN { ok:false, code:'ADMIN_METRICS_400',
 *     message } via sendAdminError — BUKAN bentuk generik sendValidationError,
 *     dan JANGAN PERNAH 401 (401 tetap khusus auth: resolveAdmin).
 *   - Perilaku lama dipertahankan: parseDateRange from/to, whitelist FEATURES,
 *     whitelist status ['all','success','failed'], clamp page/page_size,
 *     role admin (401 tanpa user, 403 non-admin).
 *   - Gap-fill baru: metric_name (/system) divalidasi; page/page_size
 *     non-integer kini 400 fail-closed (tadinya diam-diam jadi default).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../server/services/metricsService.js', () => ({
  default: {
    getSystemMetrics: vi.fn(),
    getFeatureCalls: vi.fn(),
    getFeatureHealth: vi.fn(),
    getAIUsageSummary: vi.fn(),
    getCostTrend: vi.fn(),
    checkAlerts: vi.fn(),
  },
}));

vi.mock('../../server/config/metricsConfig.js', () => ({
  getAdminEmails: vi.fn(() => ['admin@cashflow.test']),
  FEATURES: ['gmail_sync', 'agent_search', 'ocr_receipt', 'insight_generator'],
}));

vi.mock('../../server/lib/aiCache.js', () => ({
  getAICacheStats: vi.fn(() => ({ hits: 0, misses: 0 })),
}));

import { registerAdminMetricsRoutes } from '../../server/routes/adminMetricsRoutes.js';
import metricsService from '../../server/services/metricsService.js';

// ---------------------------------------------------------------------------
// Harness: fake app + req/res tiruan.
// ---------------------------------------------------------------------------

interface FakeRes {
  statusCode: number;
  body: unknown;
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
}

function createRes(): FakeRes {
  // Express default: res.json() tanpa .status() → 200.
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
    invoke: async (path: string, req: { user?: unknown; query?: Record<string, unknown>; params?: Record<string, string> }) => {
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

const ADMIN_USER = { id: 'admin-1', email: 'admin@cashflow.test' };
const NON_ADMIN_USER = { id: 'user-1', email: 'bukan-admin@cashflow.test' };

const SYSTEM = '/api/admin/metrics/system';
const AI_USAGE = '/api/admin/metrics/ai-usage';
const FEATURE_HEALTH = '/api/admin/metrics/feature-health';
const FEATURE_CALLS = '/api/admin/metrics/feature/:feature/calls';

/** Bentuk domain error admin metrics yang wajib dipenuhi setiap 400 validasi. */
function expectAdmin400Shape(res: FakeRes) {
  expect(res.statusCode, 'status harus 400 — JANGAN PERNAH 401').toBe(400);
  const body = res.body as { ok?: boolean; code?: string; message?: string };
  expect(body.ok).toBe(false);
  expect(body.code).toBe('ADMIN_METRICS_400');
  expect(typeof body.message).toBe('string');
  expect((body.message as string).length).toBeGreaterThan(0);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(metricsService.getSystemMetrics).mockResolvedValue({ data: [], summary: { total: 0 } });
  vi.mocked(metricsService.getFeatureCalls).mockResolvedValue({ page: 1, pageSize: 20, total: 0, items: [] });
  vi.mocked(metricsService.getFeatureHealth).mockResolvedValue({ feature: 'x', status: 'ok' });
  vi.mocked(metricsService.getAIUsageSummary).mockResolvedValue({ costIdr: 0, tokens: 0, calls: 0, avgTimeMs: 0, features: [] });
  vi.mocked(metricsService.getCostTrend).mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Gate auth tetap dipertahankan (401 tanpa user, 403 non-admin) — bukan 400
// ---------------------------------------------------------------------------

describe('auth gate tidak berubah oleh validasi', () => {
  it('tanpa user → 401 ADMIN_METRICS_401 bahkan bila query invalid', async () => {
    const res = await app.invoke(SYSTEM, { query: { metric_name: ['a', 'b'] } });
    expect(res.statusCode).toBe(401);
    expect((res.body as { code: string }).code).toBe('ADMIN_METRICS_401');
    expect(metricsService.getSystemMetrics).not.toHaveBeenCalled();
  });

  it('non-admin → 403 ADMIN_METRICS_403 bahkan bila query invalid', async () => {
    const res = await app.invoke(FEATURE_CALLS, {
      user: NON_ADMIN_USER,
      query: { page: 'abc' },
      params: { feature: 'agent_search' },
    });
    expect(res.statusCode).toBe(403);
    expect((res.body as { code: string }).code).toBe('ADMIN_METRICS_403');
    expect(metricsService.getFeatureCalls).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// GET /api/admin/metrics/system — gap-fill metric_name
// ---------------------------------------------------------------------------

describe('GET /system — validasi metric_name', () => {
  it('metric_name valid diteruskan ke service (trim)', async () => {
    const res = await app.invoke(SYSTEM, { user: ADMIN_USER, query: { metric_name: '  agent_search_count  ' } });
    expect(res.statusCode).toBe(200);
    expect((res.body as { ok: boolean }).ok).toBe(true);
    expect(metricsService.getSystemMetrics).toHaveBeenCalledWith(
      expect.objectContaining({ metricName: 'agent_search_count' }),
    );
  });

  it('metric_name absen / kosong → null (tanpa filter, perilaku lama)', async () => {
    for (const query of [{}, { metric_name: '' }, { metric_name: '   ' }]) {
      const res = await app.invoke(SYSTEM, { user: ADMIN_USER, query });
      expect(res.statusCode).toBe(200);
      expect(metricsService.getSystemMetrics).toHaveBeenLastCalledWith(
        expect.objectContaining({ metricName: null }),
      );
    }
  });

  it('metric_name non-string (array — ?metric_name=a&metric_name=b) → 400 ADMIN_METRICS_400', async () => {
    const res = await app.invoke(SYSTEM, { user: ADMIN_USER, query: { metric_name: ['a', 'b'] } });
    expectAdmin400Shape(res);
    expect(metricsService.getSystemMetrics).not.toHaveBeenCalled();
  });

  it('metric_name > 191 karakter → 400 ADMIN_METRICS_400', async () => {
    const res = await app.invoke(SYSTEM, { user: ADMIN_USER, query: { metric_name: 'm'.repeat(192) } });
    expectAdmin400Shape(res);
    expect(metricsService.getSystemMetrics).not.toHaveBeenCalled();
  });

  it('from/to invalid tetap 400 via parseDateRange (perilaku lama dipertahankan)', async () => {
    const res = await app.invoke(SYSTEM, { user: ADMIN_USER, query: { from: 'bukan-tanggal' } });
    expectAdmin400Shape(res);
    expect(metricsService.getSystemMetrics).not.toHaveBeenCalled();
  });

  it('feature di luar whitelist → null, BUKAN error (perilaku lama dipertahankan)', async () => {
    const res = await app.invoke(SYSTEM, { user: ADMIN_USER, query: { feature: 'hacked' } });
    expect(res.statusCode).toBe(200);
    expect(metricsService.getSystemMetrics).toHaveBeenCalledWith(
      expect.objectContaining({ feature: null }),
    );
  });
});

// ---------------------------------------------------------------------------
// GET /api/admin/metrics/ai-usage — from/to + feature whitelist (sudah ada)
// ---------------------------------------------------------------------------

describe('GET /ai-usage — perilaku validasi lama tetap', () => {
  it('from/to invalid → 400 ADMIN_METRICS_400 (parseDateRange)', async () => {
    const res = await app.invoke(AI_USAGE, { user: ADMIN_USER, query: { to: 'junk' } });
    expectAdmin400Shape(res);
    expect(metricsService.getAIUsageSummary).not.toHaveBeenCalled();
  });

  it('feature whitelist lolos → diteruskan; di luar whitelist → null', async () => {
    await app.invoke(AI_USAGE, { user: ADMIN_USER, query: { feature: 'gmail_sync' } });
    expect(metricsService.getAIUsageSummary).toHaveBeenCalledWith(
      expect.objectContaining({ feature: 'gmail_sync' }),
    );
    await app.invoke(AI_USAGE, { user: ADMIN_USER, query: { feature: 'hacked' } });
    expect(metricsService.getAIUsageSummary).toHaveBeenLastCalledWith(
      expect.objectContaining({ feature: null }),
    );
  });
});

// ---------------------------------------------------------------------------
// GET /api/admin/metrics/feature-health — feature whitelist (sudah ada)
// ---------------------------------------------------------------------------

describe('GET /feature-health — whitelist feature', () => {
  it('feature invalid → 400 ADMIN_METRICS_400', async () => {
    const res = await app.invoke(FEATURE_HEALTH, { user: ADMIN_USER, query: { feature: 'sideways' } });
    expectAdmin400Shape(res);
    expect(metricsService.getFeatureHealth).not.toHaveBeenCalled();
  });

  it('feature valid → 200; tanpa feature → semua FEATURES (perilaku lama)', async () => {
    const one = await app.invoke(FEATURE_HEALTH, { user: ADMIN_USER, query: { feature: 'agent_search' } });
    expect(one.statusCode).toBe(200);
    expect(metricsService.getFeatureHealth).toHaveBeenCalledTimes(1);

    const all = await app.invoke(FEATURE_HEALTH, { user: ADMIN_USER, query: {} });
    expect(all.statusCode).toBe(200);
    expect(metricsService.getFeatureHealth).toHaveBeenCalledTimes(1 + 4); // 4 = panjang FEATURES
  });
});

// ---------------------------------------------------------------------------
// GET /api/admin/metrics/feature/:feature/calls — status + page/page_size
// ---------------------------------------------------------------------------

describe('GET /feature/:feature/calls — validasi page/page_size', () => {
  const invokeCalls = (query: Record<string, unknown>, feature = 'agent_search') =>
    app.invoke(FEATURE_CALLS, { user: ADMIN_USER, query, params: { feature } });

  it('feature di luar whitelist → 400 ADMIN_METRICS_400', async () => {
    const res = await invokeCalls({}, 'hacked');
    expectAdmin400Shape(res);
    expect(metricsService.getFeatureCalls).not.toHaveBeenCalled();
  });

  it('page non-integer ("abc") → 400 fail-closed (gap-fill; tadinya diam-diam default)', async () => {
    const res = await invokeCalls({ page: 'abc' });
    expectAdmin400Shape(res);
    expect(metricsService.getFeatureCalls).not.toHaveBeenCalled();
  });

  it('page_size non-integer → 400 ADMIN_METRICS_400', async () => {
    const res = await invokeCalls({ page_size: 'xyz' });
    expectAdmin400Shape(res);
    expect(metricsService.getFeatureCalls).not.toHaveBeenCalled();
  });

  it('page pecahan ("2.5") → 400 ADMIN_METRICS_400', async () => {
    const res = await invokeCalls({ page: '2.5' });
    expectAdmin400Shape(res);
  });

  it('page/page_size numeric string valid dikoersi dan diteruskan', async () => {
    const res = await invokeCalls({ page: '3', page_size: '50' });
    expect(res.statusCode).toBe(200);
    expect(metricsService.getFeatureCalls).toHaveBeenCalledWith(
      expect.objectContaining({ page: 3, pageSize: 50 }),
    );
  });

  it('page/page_size di luar rentang DI-CLAMP, bukan ditolak (pola lama)', async () => {
    await invokeCalls({ page: '999999', page_size: '500' });
    expect(metricsService.getFeatureCalls).toHaveBeenCalledWith(
      expect.objectContaining({ page: 100000, pageSize: 100 }),
    );
    await invokeCalls({ page: '-5', page_size: '0' });
    expect(metricsService.getFeatureCalls).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 1, pageSize: 1 }),
    );
  });

  it('page/page_size absen → default 1/20 (perilaku lama)', async () => {
    await invokeCalls({});
    expect(metricsService.getFeatureCalls).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, pageSize: 20 }),
    );
  });

  it('status whitelist dipertahankan: valid diteruskan, invalid → "all"', async () => {
    await invokeCalls({ status: 'failed' });
    expect(metricsService.getFeatureCalls).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' }),
    );
    await invokeCalls({ status: 'hacked' });
    expect(metricsService.getFeatureCalls).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'all' }),
    );
  });

  it('from/to invalid tetap 400 via parseDateRange', async () => {
    const res = await invokeCalls({ from: 'bukan-tanggal' });
    expectAdmin400Shape(res);
    expect(metricsService.getFeatureCalls).not.toHaveBeenCalled();
  });
});
