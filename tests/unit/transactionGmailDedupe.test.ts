/**
 * Unit test: POST /api/transactions — Gmail dedupe server-side PENUH (2026-08-11).
 *
 * Menutup temuan P0 audit FINANCIAL_CALCULATION_INTEGRITY §10.2: cek duplikat
 * klien (findDuplicateTransaction) hanya memeriksa window 100 transaksi
 * terbaru → pesan LAMA (mis. Maret) di luar window lolos dan di-import ulang
 * setiap sync ulang batch (631 baris duplikat historis di DB dev).
 *
 * Fix: POST /api/transactions kini melakukan pre-SELECT gmail_message_id penuh
 * (user-scoped, via index idx_transactions_gmail_msg) saat source === 'gmail'
 * dan gmailMessageId hadir → bila baris sudah ada, replay { id, replayed: true }
 * TANPA INSERT kedua. Ini menutup baris LAMA (idempotency_key NULL, sebelum
 * 2026-08-09) yang tidak tertutup Idempotency-Key.
 *
 * Kasus:
 *   1. Pesan gmail sudah pernah di-import → replay, tanpa INSERT.
 *   2. Pesan gmail baru → INSERT normal.
 *   3. User isolation: gmail_message_id milik user LAIN → tetap INSERT.
 *   4. source='gmail' tanpa gmailMessageId → perilaku lama (tanpa pre-SELECT gmail).
 *   5. source != gmail dengan gmailMessageId → perilaku lama (cek gmail tidak aktif).
 *   6. Idempotency-Key replay tetap mendominasi (cek idempotency sebelum cek gmail).
 *   7. Race TOCTOU antar request gmail identik → unique partial index
 *      (user_id, idempotency_key) menangkap → re-SELECT → replay (bukan 500).
 *   8. Race TOCTOU gmail TANPA Idempotency-Key → unique partial index
 *      (user_id, gmail_message_id) [idx_transactions_gmail_msg_unique,
 *      2026-08-11] menangkap → replay via gmail lookup (bukan 500).
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

const GMAIL_BODY: Record<string, unknown> = {
  type: 'expense',
  amount: 25000,
  categoryId: 'c1',
  categoryName: 'Makanan',
  merchant: 'Bank Jago',
  paymentMethod: 'cash',
  note: '',
  date: '2026-03-06',
  source: 'gmail',
  gmailMessageId: 'msg-abc-123',
};

/** Query queues per tipe SELECT — di-reset tiap test. */
let idemResults: Array<Array<{ id: string }>>;
let gmailResults: Array<Array<{ id: string }>>;
let insertThrowNext = false;
const insertCalls: Array<{ sql: string; args: unknown[] }> = [];
const gmailSelectCalls: Array<{ sql: string; args: unknown[] }> = [];
const idemSelectCalls: Array<{ sql: string; args: unknown[] }> = [];

beforeEach(() => {
  vi.clearAllMocks();
  executeMock.mockReset();
  idemResults = [];
  gmailResults = [];
  insertThrowNext = false;
  insertCalls.length = 0;
  gmailSelectCalls.length = 0;
  idemSelectCalls.length = 0;

  executeMock.mockImplementation(async ({ sql, args }: { sql: string; args: unknown[] }) => {
    const s = String(sql);
    if (s.includes('AND idempotency_key = ?')) {
      idemSelectCalls.push({ sql: s, args });
      return { rows: idemResults.shift() ?? [] };
    }
    if (s.includes('AND gmail_message_id = ?')) {
      gmailSelectCalls.push({ sql: s, args });
      return { rows: gmailResults.shift() ?? [] };
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

const postTx = (req: ReqShape) => app.invoke('POST', '/api/transactions', { user: USER_A, ...req });

describe('auth gate', () => {
  it('POST /api/transactions terdaftar dengan requireAuth', () => {
    const handlers = routes['POST /api/transactions'];
    expect(handlers).toBeDefined();
    expect(handlers[handlers.length - 2]).toBe(requireAuth);
  });
});

describe('POST /api/transactions — Gmail dedupe server-side penuh', () => {
  it('pesan gmail sudah pernah di-import (baris lama) → replay { id, replayed:true }, TANPA INSERT', async () => {
    // Idempotency pre-SELECT kosong (baris lama idempotency_key NULL)…
    idemResults = [[]];
    // …tapi gmail pre-SELECT menemukan baris lama.
    gmailResults = [[{ id: 'tx-lama' }]];

    const res = await postTx({ body: GMAIL_BODY });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ id: 'tx-lama', replayed: true });
    expect(insertCalls).toHaveLength(0); // tidak ada baris kedua
    expect(gmailSelectCalls).toHaveLength(1);
    expect(gmailSelectCalls[0].args).toEqual(['user-a', 'msg-abc-123']); // user-scoped
  });

  it('pesan gmail BARU → INSERT normal (pre-SELECT gmail kosong)', async () => {
    idemResults = [[]];
    gmailResults = [[]];

    const res = await postTx({ body: GMAIL_BODY });

    expect(res.statusCode).toBe(200);
    expect((res.body as { replayed?: boolean }).replayed).toBeUndefined();
    expect(insertCalls).toHaveLength(1);
    expect(gmailSelectCalls).toHaveLength(1);
  });

  it('user isolation: gmail_message_id milik user LAIN → tetap INSERT (WHERE user_id)', async () => {
    idemResults = [[]];
    // gmail pre-SELECT user-scoped → kosong walau pesan ada di user lain.
    gmailResults = [[]];

    const res = await postTx({ body: GMAIL_BODY });

    expect(res.statusCode).toBe(200);
    expect(insertCalls).toHaveLength(1);
    expect(gmailSelectCalls[0].args).toEqual(['user-a', 'msg-abc-123']);
  });

  it('source=gmail TANPA gmailMessageId → perilaku lama, tanpa pre-SELECT gmail', async () => {
    idemResults = [[]];
    const body = { ...GMAIL_BODY, gmailMessageId: undefined };

    const res = await postTx({ body });

    expect(res.statusCode).toBe(200);
    expect(insertCalls).toHaveLength(1);
    expect(gmailSelectCalls).toHaveLength(0); // cek gmail tidak aktif
  });

  it('P3.2 §12 — source != gmail dengan gmailMessageId SUDAH ADA → replay, BUKAN 500 (index unconditional)', async () => {
    // Index (user_id, gmail_message_id) unconditional → replay berlaku untuk
    // SEMUA source. Sebelumnya: non-gmail jatuh ke INSERT mentah → 500 UNIQUE.
    idemResults = [[]];
    gmailResults = [[{ id: 'tx-lama' }]];
    const body = { ...GMAIL_BODY, source: 'manual', gmailMessageId: 'msg-abc-123' };

    const res = await postTx({ body });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ id: 'tx-lama', replayed: true });
    expect(insertCalls).toHaveLength(0); // tidak ada baris kedua — dedupe tetap
    expect(gmailSelectCalls).toHaveLength(1);
  });

  it('P3.2 §12 — source != gmail dengan gmailMessageId BARU → INSERT normal', async () => {
    idemResults = [[]];
    gmailResults = [[]];
    const body = { ...GMAIL_BODY, source: 'manual', gmailMessageId: 'msg-baru-456' };

    const res = await postTx({ body });

    expect(res.statusCode).toBe(200);
    expect((res.body as { replayed?: boolean }).replayed).toBeUndefined();
    expect(insertCalls).toHaveLength(1);
    expect(gmailSelectCalls).toHaveLength(1);
  });

  it('Idempotency-Key replay tetap mendominasi (cek idempotency berjalan lebih dulu)', async () => {
    // Idempotency pre-SELECT MENEMUKAN → replay lewat idempotency, gmail tidak dicapai.
    idemResults = [[{ id: 'tx-idem' }]];
    gmailResults = [[]];

    const res = await postTx({ body: GMAIL_BODY, get: (n) => (n === 'Idempotency-Key' ? 'gmail::user-a::msg-abc-123' : undefined) });

    expect(res.body).toEqual({ id: 'tx-idem', replayed: true });
    expect(insertCalls).toHaveLength(0);
    expect(gmailSelectCalls).toHaveLength(0); // short-circuit di idempotency
  });

  it('race TOCTOU gmail identik → unique idempotency menangkap → re-SELECT → replay, bukan 500', async () => {
    // Kedua request lolos pre-SELECT idempotency (kosong) & gmail (kosong);
    // INSERT kedua kena unique partial index (user_id, idempotency_key).
    idemResults = [[], [{ id: 'tx-winner' }]];
    gmailResults = [[]];
    insertThrowNext = true;

    const res = await postTx({
      body: GMAIL_BODY,
      get: (n) => (n === 'Idempotency-Key' ? 'gmail::user-a::msg-abc-123' : undefined),
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ id: 'tx-winner', replayed: true });
    expect(insertCalls).toHaveLength(1);
    expect(idemSelectCalls).toHaveLength(2); // pre-SELECT + re-SELECT
  });

  it('race TOCTOU gmail TANPA Idempotency-Key → unique gmail index menangkap → replay via gmail lookup, bukan 500', async () => {
    // Hardening final (2026-08-11, idx_transactions_gmail_msg_unique): request
    // gmail langsung tanpa header Idempotency-Key (direct API / importer batch
    // masa depan). Kedua request lolos pre-SELECT gmail (kosong); INSERT kedua
    // kena unique partial index (user_id, gmail_message_id) → catch harus
    // re-SELECT by gmail_message_id → replay (bukan 500).
    idemResults = []; // tanpa key → tidak ada pre-SELECT idempotency
    gmailResults = [[], [{ id: 'tx-winner' }]]; // pre-SELECT kosong + re-SELECT menemukan winner
    insertThrowNext = true;

    const res = await postTx({ body: GMAIL_BODY }); // tanpa get() → tanpa header

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ id: 'tx-winner', replayed: true });
    expect(insertCalls).toHaveLength(1);
    expect(gmailSelectCalls).toHaveLength(2); // pre-SELECT + re-SELECT gmail
    expect(idemSelectCalls).toHaveLength(0); // tanpa key → idempotency tidak dipanggil
  });

  it('constraint error manual-source TANPA Idempotency-Key → tetap 500 (tidak di-replay/ditelan)', async () => {
    // Guard restrukturisasi catch (2026-08-11): branch idempotency nonaktif
    // (tanpa key), branch gmail nonaktif (bukan source gmail) → constraint
    // error harus naik ke outer catch → 500 JUJUR, bukan replay / ditelan.
    idemResults = [];
    gmailResults = [];
    insertThrowNext = true;

    const res = await postTx({ body: { ...GMAIL_BODY, source: 'manual', gmailMessageId: undefined } });

    expect(res.statusCode).toBe(500);
    expect(insertCalls).toHaveLength(1);
    expect(gmailSelectCalls).toHaveLength(0);
    expect(idemSelectCalls).toHaveLength(0);
  });
});
