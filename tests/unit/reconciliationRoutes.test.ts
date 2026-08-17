/**
 * Unit test: /api/reconciliation/* (P2.6) — assisted ledger reconciliation.
 *
 * Pola transactionSummaryRoute.test.ts: fake app + mock engine. Verifikasi:
 *   1. Auth gate: seluruh endpoint terdaftar dengan requireAuth.
 *   2. User scoping: userId dari req.user.id — TIDAK dari body/query.
 *   3. Validasi fail-closed: body invalid → 400 (bukan crash/500).
 *   4. Delegasi: argumen diteruskan benar; hasil dikembalikan apa adanya.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const executeMock = vi.fn();
vi.mock('../../server/lib/turso.js', () => ({
  getTurso: vi.fn(() => ({ execute: executeMock })),
}));

const recordSystemMetricMock = vi.fn();
vi.mock('../../server/services/metricsService.js', () => ({
  // Route memanggil `.catch()` pada hasilnya — mock harus kembalikan Promise.
  default: { recordSystemMetric: (...args) => { recordSystemMetricMock(...args); return Promise.resolve(); } },
}));

const engine = vi.hoisted(() => ({
  buildReconciliationState: vi.fn(),
  classifyTransactions: vi.fn(),
  classifyBySuggestion: vi.fn(),
  rejectBySuggestion: vi.fn(),
  rejectTransferCandidate: vi.fn(),
  pairTransfer: vi.fn(),
  verifyAccountBalance: vi.fn(),
}));
vi.mock('../../server/lib/reconciliationEngine.js', () => engine);

import { registerReconciliationRoutes } from '../../server/routes/reconciliationRoutes.js';
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

type ReqShape = { user?: unknown; body?: unknown; query?: Record<string, unknown>; id?: string };

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
registerReconciliationRoutes(app as never);

const USER_A = { id: 'user-a' };

function pathHasAuth(method: string, path: string) {
  const entry = Object.entries(routes).find(([key]) => key.startsWith(`${method} `) && key.split(' ')[1] === path);
  expect(entry).toBeDefined();
  expect(entry![1][0]).toBe(requireAuth);
}

beforeEach(() => {
  executeMock.mockReset();
  recordSystemMetricMock.mockReset();
  for (const fn of Object.values(engine)) fn.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('Auth gate — semua endpoint reconcile requireAuth', () => {
  it('terdaftar dengan requireAuth', () => {
    pathHasAuth('GET', '/api/reconciliation/state');
    pathHasAuth('POST', '/api/reconciliation/classify');
    pathHasAuth('POST', '/api/reconciliation/classify-bulk');
    pathHasAuth('POST', '/api/reconciliation/classify-by-suggestion');
    pathHasAuth('POST', '/api/reconciliation/classify-reject');
    pathHasAuth('POST', '/api/reconciliation/transfer-pair');
    pathHasAuth('POST', '/api/reconciliation/transfer-reject');
    pathHasAuth('POST', '/api/reconciliation/verify-balance');
  });
});

describe('GET /api/reconciliation/state', () => {
  it('memanggil engine dengan userId session; respons state apa adanya', async () => {
    engine.buildReconciliationState.mockResolvedValue({
      status: 'unknown', accounts: [], transactions: { unlinked: 0 }, transfers: { ungrouped: 0 },
    });
    const res = await app.invoke('GET', '/api/reconciliation/state', { user: USER_A, id: 'req-1' });
    expect(engine.buildReconciliationState).toHaveBeenCalledWith(expect.anything(), 'user-a');
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('unknown');
    expect(recordSystemMetricMock).toHaveBeenCalledWith(expect.objectContaining({ metricName: 'reconciliation_completed' }));
  });

  it('error engine → 500 + reconciliation_failed', async () => {
    engine.buildReconciliationState.mockRejectedValue(new Error('db down'));
    const res = await app.invoke('GET', '/api/reconciliation/state', { user: USER_A, id: 'req-1' });
    expect(res.statusCode).toBe(500);
    expect(recordSystemMetricMock).toHaveBeenCalledWith(expect.objectContaining({ metricName: 'reconciliation_failed' }));
  });
});

describe('POST /api/reconciliation/classify', () => {
  it('valid → delegasi dengan userId session (bukan body)', async () => {
    engine.classifyTransactions.mockResolvedValue({ applied: 1, skipped: 0 });
    const res = await app.invoke('POST', '/api/reconciliation/classify', {
      user: USER_A,
      body: { transactionId: 't1', accountId: 'acc-1' },
    });
    expect(engine.classifyTransactions).toHaveBeenCalledWith(expect.anything(), 'user-a', [{ transactionId: 't1', accountId: 'acc-1' }]);
    expect(res.statusCode).toBe(200);
    expect(res.body.applied).toBe(1);
  });

  it('body invalid → 400 fail-closed (bukan 500)', async () => {
    const res = await app.invoke('POST', '/api/reconciliation/classify', { user: USER_A, body: {} });
    expect(res.statusCode).toBe(400);
    expect(engine.classifyTransactions).not.toHaveBeenCalled();
  });
});

describe('POST /api/reconciliation/classify-by-suggestion', () => {
  it('delegasi accountId + confidence; confidence invalid → 400', async () => {
    engine.classifyBySuggestion.mockResolvedValue({ applied: 3, skipped: 0 });
    const ok = await app.invoke('POST', '/api/reconciliation/classify-by-suggestion', {
      user: USER_A,
      body: { accountId: 'acc-1', confidence: 'high' },
    });
    expect(engine.classifyBySuggestion).toHaveBeenCalledWith(expect.anything(), 'user-a', { accountId: 'acc-1', confidence: 'high' });
    expect(ok.statusCode).toBe(200);
    expect(ok.body.applied).toBe(3);

    const bad = await app.invoke('POST', '/api/reconciliation/classify-by-suggestion', {
      user: USER_A,
      body: { accountId: 'acc-1', confidence: 'very-high' },
    });
    expect(bad.statusCode).toBe(400);
    expect(engine.classifyBySuggestion).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/reconciliation/transfer-pair & verify-balance', () => {
  it('transfer-pair: ok → 200; ditolak engine → 400', async () => {
    engine.pairTransfer.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false, error: 'bukan transfer' });
    const ok = await app.invoke('POST', '/api/reconciliation/transfer-pair', {
      user: USER_A,
      body: { transferId: 'tr', incomeId: 'inc' },
    });
    expect(ok.statusCode).toBe(200);
    const bad = await app.invoke('POST', '/api/reconciliation/transfer-pair', {
      user: USER_A,
      body: { transferId: 'tr', incomeId: 'inc' },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('verify-balance: verified → balance_verified metric; mismatch → balance_mismatch', async () => {
    engine.verifyAccountBalance
      .mockResolvedValueOnce({ ok: true, status: 'verified', difference: 0 })
      .mockResolvedValueOnce({ ok: true, status: 'mismatch', difference: -120500 });
    const ok = await app.invoke('POST', '/api/reconciliation/verify-balance', {
      user: USER_A,
      body: { accountId: 'acc-1', actualBalance: 1500000 },
    });
    expect(ok.statusCode).toBe(200);
    expect(recordSystemMetricMock).toHaveBeenCalledWith(expect.objectContaining({ metricName: 'balance_verified' }));

    const mis = await app.invoke('POST', '/api/reconciliation/verify-balance', {
      user: USER_A,
      body: { accountId: 'acc-1', actualBalance: 100 },
    });
    expect(recordSystemMetricMock).toHaveBeenCalledWith(expect.objectContaining({ metricName: 'balance_mismatch' }));
  });

  it('verify-balance: actualBalance bukan angka → 400', async () => {
    const res = await app.invoke('POST', '/api/reconciliation/verify-balance', {
      user: USER_A,
      body: { accountId: 'acc-1', actualBalance: 'abc' },
    });
    expect(res.statusCode).toBe(400);
    expect(engine.verifyAccountBalance).not.toHaveBeenCalled();
  });
});

describe('POST /api/reconciliation/classify-reject — P2.8 §13 [Abaikan]', () => {
  it('delegasi accountId + confidence dengan userId session; 200', async () => {
    engine.rejectBySuggestion.mockResolvedValue({ rejected: 2, skipped: 0 });
    const res = await app.invoke('POST', '/api/reconciliation/classify-reject', {
      user: USER_A,
      body: { accountId: 'acc-1', confidence: 'high' },
    });
    expect(engine.rejectBySuggestion).toHaveBeenCalledWith(expect.anything(), 'user-a', { accountId: 'acc-1', confidence: 'high' });
    expect(res.statusCode).toBe(200);
    expect(res.body.rejected).toBe(2);
  });

  it('body invalid / confidence tidak dikenal → 400 fail-closed', async () => {
    const missing = await app.invoke('POST', '/api/reconciliation/classify-reject', { user: USER_A, body: {} });
    expect(missing.statusCode).toBe(400);
    const badConfidence = await app.invoke('POST', '/api/reconciliation/classify-reject', {
      user: USER_A,
      body: { accountId: 'acc-1', confidence: 'insane' },
    });
    expect(badConfidence.statusCode).toBe(400);
    expect(engine.rejectBySuggestion).not.toHaveBeenCalled();
  });
});

describe('POST /api/reconciliation/transfer-reject — P2.8 §17 [Reject]', () => {
  it('delegasi transferId; 200', async () => {
    engine.rejectTransferCandidate.mockResolvedValue({ ok: true, alreadyRejected: false });
    const res = await app.invoke('POST', '/api/reconciliation/transfer-reject', {
      user: USER_A,
      body: { transferId: 'tr-1' },
    });
    expect(engine.rejectTransferCandidate).toHaveBeenCalledWith(expect.anything(), 'user-a', { transferId: 'tr-1' });
    expect(res.statusCode).toBe(200);
  });

  it('ditolak engine → 400; body invalid → 400 tanpa delegasi', async () => {
    engine.rejectTransferCandidate.mockResolvedValue({ ok: false, reason: 'bukan transfer' });
    const rejected = await app.invoke('POST', '/api/reconciliation/transfer-reject', {
      user: USER_A,
      body: { transferId: 'e1' },
    });
    expect(rejected.statusCode).toBe(400);

    const missing = await app.invoke('POST', '/api/reconciliation/transfer-reject', { user: USER_A, body: {} });
    expect(missing.statusCode).toBe(400);
    expect(engine.rejectTransferCandidate).toHaveBeenCalledTimes(1);
  });
});
