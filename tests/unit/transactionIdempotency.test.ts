/**
 * Unit test: POST /api/transactions — Idempotency-Key create-once (2026-08-09).
 *
 * Menutup gap TURSO_RUNTIME_RETRY_AUDIT: INSERT tanpa ON CONFLICT → retry
 * serentak dari klien mana pun (tab lain, request langsung, server restart)
 * bisa double-commit. Kini: key (header `Idempotency-Key` ATAU body
 * `idempotencyKey`) + unique partial index (user_id, idempotency_key) →
 * create-once di SERVER. Tanpa key → perilaku lama (backward-compatible).
 *
 * Mengikuti harness transactionSummaryRoute.test.ts (fake app + mock Turso):
 *   1. Create pertama key K → pre-SELECT kosong → INSERT (args memuat key).
 *   2. Replay key K → pre-SELECT menemukan → { id, replayed: true }, TANPA
 *      INSERT kedua (SSE/fraud tidak di-fire ulang).
 *   3. Race TOCTOU (pre-SELECT lolos, INSERT kena unique) → re-SELECT →
 *      replay, bukan 500.
 *   4. Key berbeda → create terpisah.
 *   5. Key > 191 char → 400 VALIDATION_ERROR (fail-closed).
 *   6. Tanpa key → perilaku lama (tanpa pre-SELECT, idempotency_key NULL).
 *   7. Header mendominasi body field.
 *   8. Constraint error tanpa row hasil re-SELECT → 500 (tidak disembunyikan).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const executeMock = vi.fn();

vi.mock('../../server/lib/turso.js', () => ({
  getTurso: vi.fn(() => ({ execute: executeMock })),
}));
vi.mock('../../server/lib/sse.js', () => ({
  notifyUser: vi.fn(),
}));
vi.mock('../../server/lib/financialSummary.js', () => ({
  computeFinancialSummary: vi.fn(),
}));
vi.mock('../../server/services/fraudDetectionService.js', () => ({
  runFraudDetection: vi.fn(),
  isFraudDetectionEnabled: () => false,
}));

import { registerTransactionRoutes } from '../../server/routes/transactionRoutes.js';
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

type ReqShape = {
  user?: unknown;
  body?: Record<string, unknown>;
  get?: (name: string) => string | undefined;
};

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
registerTransactionRoutes(app as never);

const USER_A = { id: 'user-a' };

const VALID_BODY: Record<string, unknown> = {
  type: 'expense',
  amount: 25000,
  categoryId: 'c1',
  categoryName: 'Makanan',
  merchant: 'Warung',
  paymentMethod: 'cash',
  note: '',
  date: '2026-08-09',
  source: 'manual',
};

/** Kunci hasil SELECT idempotency (return queue) untuk mensimulasi urutan DB. */
let selectResults: Array<Array<{ id: string }>>;
let insertThrowNext = false;
const insertCalls: Array<{ sql: string; args: unknown[] }> = [];
const selectCalls: Array<{ sql: string; args: unknown[] }> = [];

beforeEach(() => {
  vi.clearAllMocks();
  executeMock.mockReset();
  selectResults = [];
  insertThrowNext = false;
  insertCalls.length = 0;
  selectCalls.length = 0;

  executeMock.mockImplementation(async ({ sql, args }: { sql: string; args: unknown[] }) => {
    const s = String(sql);
    if (s.includes('SELECT id FROM transactions WHERE user_id = ? AND idempotency_key = ?')) {
      selectCalls.push({ sql: s, args });
      return { rows: selectResults.shift() ?? [] };
    }
    if (s.includes('INSERT INTO transactions')) {
      insertCalls.push({ sql: s, args });
      if (insertThrowNext) {
        insertThrowNext = false;
        throw new Error('UNIQUE constraint failed: transactions.user_id, transactions.idempotency_key');
      }
      return { rows: [] };
    }
    return { rows: [] };
  });
});

/**
 * Guard drift SQL (regresi 2026-08-09): INSERT pernah punya 19 placeholder
 * untuk 18 kolom (idempotency_key ditambah ke daftar kolom, VALUES kelebihan
 * satu `?`) → SETIAP POST /api/transactions 500 `19 values for 18 columns`
 * (hanya ketahuan saat E2E jalur nyata — harness mock tidak memvalidasi SQL
 * terhadap schema). Assertion di sini mengunci INVARIANT: jumlah kolom di
 * daftar kolom == jumlah placeholder `?` == jumlah arg. Harness mock tetap
 * tidak menjalankan SQL nyata (catat sebagai remaining debt: integration
 * test jalur nyata ada di E2E isolated — transactionRoutes.js INSERT diuji
 * terhadap schema riil turso-schema.sql).
 */
function assertInsertShape(call: { sql: string; args: unknown[] }): void {
  const m = call.sql.match(/INSERT INTO transactions\s*\(([^)]+)\)/);
  expect(m, 'INSERT harus memuat daftar kolom').toBeTruthy();
  const columns = (m as RegExpMatchArray)[1].split(',').map((c) => c.trim()).filter(Boolean);
  const placeholders = (call.sql.match(/\?/g) || []).length;
  expect(placeholders).toBe(columns.length); // VALUES harus 1:1 dengan kolom
  expect(call.args.length).toBe(columns.length); // dan args harus 1:1 dengan placeholder
}

const postTx = (req: ReqShape) => app.invoke('POST', '/api/transactions', { user: USER_A, ...req });

describe('auth gate', () => {
  it('POST /api/transactions terdaftar dengan requireAuth', () => {
    const handlers = routes['POST /api/transactions'];
    expect(handlers).toBeDefined();
    expect(handlers.length).toBeGreaterThanOrEqual(2);
    expect(handlers[handlers.length - 2]).toBe(requireAuth);
  });
});

describe('POST /api/transactions — Idempotency-Key create-once', () => {
  it('create pertama (key via body) → pre-SELECT kosong, INSERT dengan idempotency_key, respon { id } tanpa replayed', async () => {
    selectResults = [[]];
    const res = await postTx({ body: { ...VALID_BODY, idempotencyKey: 'K1' } });

    expect(res.statusCode).toBe(200);
    const body = res.body as { id: string; replayed?: boolean };
    expect(typeof body.id).toBe('string');
    expect(body.replayed).toBeUndefined();

    expect(selectCalls).toHaveLength(1); // satu pre-SELECT
    expect(selectCalls[0].args).toEqual(['user-a', 'K1']);
    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0].args[15]).toBe('K1'); // posisi idempotency_key di kolom INSERT
    expect(insertCalls[0].args[1]).toBe('user-a'); // user-scoped
    assertInsertShape(insertCalls[0]); // kolom == placeholder == args (regresi 19/18)
  });

  it('replay key sama → pre-SELECT menemukan → { id, replayed: true }, TANPA INSERT kedua', async () => {
    selectResults = [[{ id: 'tx-existing' }]];
    const res = await postTx({ body: { ...VALID_BODY, idempotencyKey: 'K1' } });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ id: 'tx-existing', replayed: true });
    expect(insertCalls).toHaveLength(0); // create-once: tidak ada insert baru
    expect(selectCalls).toHaveLength(1); // berhenti di pre-SELECT (SSE/fraud tak di-fire)
  });

  it('race TOCTOU: pre-SELECT lolos, INSERT kena unique → re-SELECT → replay, bukan 500', async () => {
    // Pre-SELECT kosong → INSERT constraint throw → re-SELECT menemukan row pemenang.
    selectResults = [[], [{ id: 'tx-winner' }]];
    insertThrowNext = true;
    const res = await postTx({ body: { ...VALID_BODY, idempotencyKey: 'K1' } });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ id: 'tx-winner', replayed: true });
    expect(insertCalls).toHaveLength(1); // satu INSERT yang kalah race (throw)
    expect(selectCalls).toHaveLength(2); // pre-SELECT + re-SELECT
    assertInsertShape(insertCalls[0]);
  });

  it('key berbeda → dua create terpisah (dua INSERT)', async () => {
    selectResults = [[], []];
    await postTx({ body: { ...VALID_BODY, idempotencyKey: 'K1' } });
    await postTx({ body: { ...VALID_BODY, idempotencyKey: 'K2' } });

    expect(insertCalls).toHaveLength(2);
    expect(insertCalls[0].args[15]).toBe('K1');
    expect(insertCalls[1].args[15]).toBe('K2');
    for (const call of insertCalls) assertInsertShape(call);
  });

  it('key > 191 karakter → 400 VALIDATION_ERROR (fail-closed, tanpa query DB)', async () => {
    const res = await postTx({ body: { ...VALID_BODY, idempotencyKey: 'x'.repeat(192) } });

    expect(res.statusCode).toBe(400);
    expect((res.body as { errorCode: string }).errorCode).toBe('VALIDATION_ERROR');
    expect(executeMock).not.toHaveBeenCalled();
  });

  it('header Idempotency-Key > 191 karakter → 400 (header tidak bypass batas body)', async () => {
    const res = await postTx({
      body: VALID_BODY,
      get: (name) => (name === 'Idempotency-Key' ? 'x'.repeat(192) : undefined),
    });

    expect(res.statusCode).toBe(400);
    expect((res.body as { errorCode: string }).errorCode).toBe('VALIDATION_ERROR');
    expect(executeMock).not.toHaveBeenCalled();
  });

  it('header kosong (hanya spasi) → dianggap absen → perilaku lama', async () => {
    const res = await postTx({
      body: VALID_BODY,
      get: (name) => (name === 'Idempotency-Key' ? '   ' : undefined),
    });

    expect(res.statusCode).toBe(200);
    expect(selectCalls).toHaveLength(0); // tanpa pre-SELECT
    expect(insertCalls[0].args[15]).toBeNull();
    assertInsertShape(insertCalls[0]);
  });

  it('tanpa key → perilaku lama: tanpa pre-SELECT, idempotency_key NULL di INSERT', async () => {
    const res = await postTx({ body: VALID_BODY });

    expect(res.statusCode).toBe(200);
    expect((res.body as { replayed?: boolean }).replayed).toBeUndefined();
    expect(selectCalls).toHaveLength(0); // tidak ada pre-SELECT
    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0].args[15]).toBeNull(); // idempotency_key NULL = tanpa jaminan
    assertInsertShape(insertCalls[0]);
  });

  it('header Idempotency-Key mendominasi body field', async () => {
    selectResults = [[{ id: 'tx-from-header' }]];
    const res = await postTx({
      body: { ...VALID_BODY, idempotencyKey: 'BODY-KEY' },
      get: (name) => (name === 'Idempotency-Key' ? 'HEADER-KEY' : undefined),
    });

    expect(res.body).toEqual({ id: 'tx-from-header', replayed: true });
    expect(selectCalls[0].args[1]).toBe('HEADER-KEY'); // header yang dipakai
  });

  it('constraint error tapi re-SELECT kosong → 500 (error tidak disembunyikan)', async () => {
    selectResults = [[], []];
    insertThrowNext = true;
    const res = await postTx({ body: { ...VALID_BODY, idempotencyKey: 'K1' } });

    expect(res.statusCode).toBe(500);
  });
});
