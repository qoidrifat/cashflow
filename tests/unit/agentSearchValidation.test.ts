/**
 * Unit test: server/routes/agentSearchRoutes.js — P1-2 G4 (agent-search validation).
 *
 * Menguji gate validasi POST /api/agent-search/query & /answer yang memakai
 * shared library server/lib/validation.js, TANPA Express nyata / jaringan:
 * route didaftarkan ke fake app, handler dipanggil langsung dengan req/res tiruan.
 *
 * Kontrak yang dipaku (HARD RULES Task #42):
 *   - Validasi gagal → HTTP 400 dengan BENTUK DOMAIN
 *     { ok:false, code:'AGENT_SEARCH_INVALID_REQUEST', message, detail? }
 *     (BUKAN bentuk generik sendValidationError, dan JANGAN PERNAH 401).
 *   - Urutan lama dipertahankan: auth gate dulu — tab user-scoped tanpa login
 *     → 401 bahkan bila body juga invalid (konsisten e2e/agent-search-auth.spec.ts).
 *   - tab absen → default 'help'; query di-trim; field tak dikenal dibuang.
 *   - Success path tak berubah: hasil service diteruskan via res.json apa adanya.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../server/services/metricsService.js', () => ({
  default: {
    recordAIUsage: vi.fn(() => Promise.resolve()),
    recordSystemMetric: vi.fn(() => Promise.resolve()),
  },
}));

vi.mock('../../server/services/agentSearchService.js', () => ({
  queryAgentSearch: vi.fn(),
  answerAgentSearch: vi.fn(),
  checkAgentSearchHealth: vi.fn(async () => ({ ok: true })),
  getPublicAgentSearchConfig: vi.fn(() => ({ enabled: true })),
  syncCashFlowDocs: vi.fn(),
  syncTransactionsForUser: vi.fn(),
  syncGmailLogsForUser: vi.fn(),
  syncReceiptsForUser: vi.fn(),
  classifyAgentSearchError: vi.fn((error: { code?: string; message?: string }) => ({
    code: error?.code || 'AGENT_SEARCH_INTERNAL_ERROR',
    message: error?.message || 'Terjadi error.',
    detail: error?.message,
  })),
}));

vi.mock('../../server/middleware/authMiddleware.js', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('../../server/lib/vertexContext.js', () => ({
  isProduction: vi.fn(() => false),
}));

import { registerAgentSearchRoutes } from '../../server/routes/agentSearchRoutes.js';
import {
  queryAgentSearch,
  answerAgentSearch,
} from '../../server/services/agentSearchService.js';

// ---------------------------------------------------------------------------
// Harness: fake app menampung handler; invoke memanggil handler langsung.
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
  const routes: Record<string, Record<string, Handler>> = { get: {}, post: {} };
  const app = {
    get: (path: string, handler: Handler) => { routes.get[path] = handler; },
    post: (path: string, handler: Handler) => { routes.post[path] = handler; },
    invoke: async (method: 'get' | 'post', path: string, req: unknown) => {
      const handler = routes[method][path];
      if (!handler) throw new Error(`Route tidak terdaftar: ${method} ${path}`);
      const res = createRes();
      await handler(req, res);
      return res;
    },
  };
  return app;
}

const app = createApp();
registerAgentSearchRoutes(app as never);

const postQuery = (body: unknown, user?: { id?: string; email?: string }) =>
  app.invoke('post', '/api/agent-search/query', { body, user });
const postAnswer = (body: unknown, user?: { id?: string; email?: string }) =>
  app.invoke('post', '/api/agent-search/answer', { body, user });

/** Bentuk domain error agent-search yang wajib dipenuhi setiap 400 validasi. */
function expectDomainErrorShape(res: FakeRes) {
  expect(res.statusCode, 'status harus 400 — JANGAN PERNAH 401').toBe(400);
  const body = res.body as { ok?: boolean; code?: string; message?: string };
  expect(body.ok).toBe(false);
  expect(body.code).toBe('AGENT_SEARCH_INVALID_REQUEST');
  expect(typeof body.message).toBe('string');
  expect((body.message as string).length).toBeGreaterThan(0);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(queryAgentSearch).mockResolvedValue({ ok: true, results: [], diagnostics: { resultCount: 1 } });
  vi.mocked(answerAgentSearch).mockResolvedValue({ ok: true, answer: { text: 'jawaban' }, diagnostics: { resultCount: 1 } });
});

// ---------------------------------------------------------------------------
// POST /api/agent-search/query — validasi body
// ---------------------------------------------------------------------------

describe('POST /api/agent-search/query — validasi query', () => {
  it('query absen → 400 bentuk domain, service tidak dipanggil', async () => {
    const res = await postQuery({ tab: 'help' });
    expectDomainErrorShape(res);
    expect(queryAgentSearch).not.toHaveBeenCalled();
  });

  it('query kosong / hanya-whitespace → 400 bentuk domain', async () => {
    for (const query of ['', '   \t\n']) {
      const res = await postQuery({ query, tab: 'help' });
      expectDomainErrorShape(res);
    }
    expect(queryAgentSearch).not.toHaveBeenCalled();
  });

  it('query non-string (number/object/array/boolean) → 400 bentuk domain', async () => {
    for (const query of [42, {}, ['q'], true]) {
      const res = await postQuery({ query, tab: 'help' });
      expectDomainErrorShape(res);
    }
    expect(queryAgentSearch).not.toHaveBeenCalled();
  });

  it('query < 2 karakter → 400 (kontrak service: Query minimal 2 karakter)', async () => {
    const res = await postQuery({ query: 'a', tab: 'help' });
    expectDomainErrorShape(res);
    expect(queryAgentSearch).not.toHaveBeenCalled();
  });

  it('query > 2000 karakter → 400 bentuk domain', async () => {
    const res = await postQuery({ query: 'x'.repeat(2001), tab: 'help' });
    expectDomainErrorShape(res);
    expect(queryAgentSearch).not.toHaveBeenCalled();
  });

  it('query tepat 2000 karakter lolos (batas inklusif)', async () => {
    const res = await postQuery({ query: 'x'.repeat(2000), tab: 'help' });
    expect(res.statusCode).not.toBe(400);
    expect(queryAgentSearch).toHaveBeenCalledTimes(1);
  });

  it('query valid di-trim sebelum diteruskan ke service', async () => {
    await postQuery({ query: '  cara bayar  ', tab: 'help' });
    expect(queryAgentSearch).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'cara bayar', tab: 'help' }),
    );
  });
});

describe('POST /api/agent-search/query — validasi tab', () => {
  it('tab di luar whitelist → 400 bentuk domain menyebut daftar tab', async () => {
    const res = await postQuery({ query: 'halo dunia', tab: 'sideways' });
    expectDomainErrorShape(res);
    const body = res.body as { message: string };
    expect(body.message).toContain('tab');
    expect(body.message).toContain('help');
    expect(queryAgentSearch).not.toHaveBeenCalled();
  });

  it('tab non-string (object) → 400 bentuk domain', async () => {
    const res = await postQuery({ query: 'halo dunia', tab: { evil: true } });
    expectDomainErrorShape(res);
    expect(queryAgentSearch).not.toHaveBeenCalled();
  });

  it('tab absen → default help (perilaku lama dipertahankan)', async () => {
    const res = await postQuery({ query: 'halo dunia' });
    expect(res.statusCode).not.toBe(400);
    expect(queryAgentSearch).toHaveBeenCalledWith(expect.objectContaining({ tab: 'help' }));
  });

  it('semua tab whitelist lolos validasi', async () => {
    const user = { id: 'user-1', email: 'u@x.test' };
    for (const tab of ['help', 'transactions', 'insight', 'gmail', 'receipts']) {
      const res = await postQuery({ query: 'halo dunia', tab }, user);
      expect(res.statusCode, `tab=${tab}`).not.toBe(400);
    }
    expect(queryAgentSearch).toHaveBeenCalledTimes(5);
  });
});

describe('POST /api/agent-search/query — urutan auth vs validasi', () => {
  it('tab user-scoped tanpa login → 401 bahkan bila body juga invalid (auth gate dulu)', async () => {
    // e2e/agent-search-auth.spec.ts memaku 401 untuk kasus ini — jangan jadi 400.
    const res = await postQuery({ query: '', tab: 'transactions' });
    expect(res.statusCode).toBe(401);
    expect(queryAgentSearch).not.toHaveBeenCalled();
  });

  it('tab help tanpa login + body valid → lolos (anonim diizinkan)', async () => {
    const res = await postQuery({ query: 'halo dunia', tab: 'help' });
    expect(res.statusCode).not.toBe(400);
    expect(res.statusCode).not.toBe(401);
    expect(queryAgentSearch).toHaveBeenCalledWith(expect.objectContaining({ tab: 'help' }));
  });

  it('body bukan objek JSON (null/array) → 400 bentuk domain (fail-closed)', async () => {
    for (const body of [null, ['a'], 'str']) {
      const res = await postQuery(body);
      expectDomainErrorShape(res);
    }
    expect(queryAgentSearch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// POST /api/agent-search/answer — validasi body
// ---------------------------------------------------------------------------

describe('POST /api/agent-search/answer — validasi body', () => {
  it('query kosong → 400 bentuk domain, service tidak dipanggil', async () => {
    const res = await postAnswer({ query: '  ', tab: 'help' });
    expectDomainErrorShape(res);
    expect(answerAgentSearch).not.toHaveBeenCalled();
  });

  it('query terlalu panjang (> 2000) → 400 bentuk domain', async () => {
    const res = await postAnswer({ query: 'x'.repeat(2001) });
    expectDomainErrorShape(res);
    expect(answerAgentSearch).not.toHaveBeenCalled();
  });

  it('tab invalid → 400 bentuk domain', async () => {
    const res = await postAnswer({ query: 'halo dunia', tab: 'hacked' });
    expectDomainErrorShape(res);
    expect(answerAgentSearch).not.toHaveBeenCalled();
  });

  it('tab user-scoped tanpa login → 401 (auth gate dulu, bukan 400)', async () => {
    const res = await postAnswer({ query: 'x', tab: 'insight' });
    expect(res.statusCode).toBe(401);
    expect(answerAgentSearch).not.toHaveBeenCalled();
  });

  it('body valid → query trim & tab default help diteruskan ke service', async () => {
    await postAnswer({ query: '  hutang saya  ' });
    expect(answerAgentSearch).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'hutang saya', tab: 'help' }),
    );
  });
});

// ---------------------------------------------------------------------------
// Success path tidak berubah (kontrak dipaku)
// ---------------------------------------------------------------------------

describe('success path tidak berubah', () => {
  it('hasil service diteruskan via res.json apa adanya (query)', async () => {
    const serviceResult = { ok: true, results: [{ title: 'doc' }], diagnostics: { resultCount: 1 } };
    vi.mocked(queryAgentSearch).mockResolvedValue(serviceResult);
    const res = await postQuery({ query: 'halo dunia', tab: 'help' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(serviceResult);
  });

  it('field tak dikenal di body dibuang (tidak diteruskan ke service)', async () => {
    await postQuery({ query: 'halo dunia', tab: 'help', hackerField: 'evil', __proto__: { x: 1 } });
    expect(queryAgentSearch).toHaveBeenCalledWith({
      query: 'halo dunia',
      tab: 'help',
      userId: null,
    });
  });

  it('userId user login diteruskan untuk tab user-scoped', async () => {
    await postQuery({ query: 'halo dunia', tab: 'gmail' }, { id: 'user-7' });
    expect(queryAgentSearch).toHaveBeenCalledWith(
      expect.objectContaining({ tab: 'gmail', userId: 'user-7' }),
    );
  });

  it('GET /config & /health tetap publik (tanpa user) dan mengembalikan hasil service', async () => {
    const cfgRes = await app.invoke('get', '/api/agent-search/config', {});
    expect(cfgRes.body).toEqual({ ok: true, config: { enabled: true } });
    const healthRes = await app.invoke('get', '/api/agent-search/health', {});
    expect(healthRes.statusCode).toBe(200);
    expect(healthRes.body).toEqual({ ok: true });
  });
});
