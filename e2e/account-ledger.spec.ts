/**
 * E2E P2.5 — ACCOUNT-BASED LEDGER FLOW.
 *
 * Membuktikan rantai SQL = ledger engine = API = persistence untuk konsep
 * baru yang membedakan Current Balance dari Net Cash Flow:
 *
 *   1. Tanpa akun → /api/transactions/summary.ledger.currentBalance =
 *      { status: 'unknown', reason: 'no_accounts' } — JANGAN menebak Rp0.
 *   2. Buat rekening + opening balance via POST /api/wallets → summary
 *      currentBalance.status = 'known' dengan amount = opening balance.
 *   3. Transaksi ter-link (account_id) → amount = opening + movement.
 *   4. Transfer internal (2 leg, transfer_group_id + role out/in) → net 0
 *      pada aggregate owned accounts.
 *   5. Persistence: GET /api/wallets mengembalikan opening_balance/date
 *      (refresh tidak menghilangkan saldo awal).
 *   6. IDOR: user lain TIDAK bisa membaca/menghapus akun user ini.
 *
 * ISOLASI: memakai user DEDIKASI (e2e-ledger@cashflow.test) yang dibuat saat
 * mint — TIDAK menyentuh dataset pinned seed-admin, jadi spec ini aman
 * berjalan paralel dengan dashboard/transactions spec (masing-masing user).
 *
 * Menjalankan (DB lokal terisolasi, fresh per run):
 *   npx playwright test -c playwright.e2e-local.config.mjs e2e/account-ledger.spec.ts
 */
import { test, expect } from 'playwright/test';
import {
  mintSessionCookieForEmail,
  cleanupTestSessions,
  createE2eTursoClient,
  type MintedSession,
} from './helpers/mintSession';

const COOKIE_NAME = 'better-auth.session_token';
const LEDGER_EMAIL = 'e2e-ledger@cashflow.test';
const OTHER_EMAIL = 'e2e-ledger-other@cashflow.test';

interface ApiOptions {
  method?: string;
  body?: unknown;
  cookie?: string;
}

async function api(rel: string, { method = 'GET', body, cookie }: ApiOptions = {}) {
  const headers: Record<string, string> = {};
  if (cookie) headers.Cookie = `${COOKIE_NAME}=${cookie}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${process.env.API_BASE_URL || 'http://127.0.0.1:5191'}${rel}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

test.describe('Account-based ledger (P2.5)', () => {
  let session: MintedSession;
  let accountA: string;
  let accountB: string;

  test.beforeAll(async () => {
    session = await mintSessionCookieForEmail(LEDGER_EMAIL);
    // Sinkronkan `users` (plural — FK tabel bisnis), idempoten TERHADAP
    // email: retry worker TIDAK boleh gagal UNIQUE(email) bila baris lama
    // masih ada (id berbeda dari mint baru).
    const turso = await createE2eTursoClient();
    try {
      await turso.execute({
        sql: `INSERT INTO users (id, email, name, display_name)
              SELECT ?, ?, 'E2E Ledger', 'E2E Ledger'
              WHERE NOT EXISTS (SELECT 1 FROM users WHERE email = ?)`,
        args: [session.userId, LEDGER_EMAIL, LEDGER_EMAIL],
      });
    } finally {
      turso.close();
    }
  });

  test.afterAll(async () => {
    await cleanupTestSessions();
  });

  test('1. tanpa akun → currentBalance unknown (reason no_accounts), BUKAN Rp0', async () => {
    const { status, json } = await api('/api/transactions/summary', { cookie: session.cookie });
    expect(status).toBe(200);
    const body = json as Record<string, any>;
    expect(body.ledger).toBeTruthy();
    expect(body.ledger.currentBalance.status).toBe('unknown');
    expect(body.ledger.currentBalance.reason).toBe('no_accounts');
    expect(body.ledger.currentBalance.amount).toBeNull();
    // Net cash flow tetap ada (terpisah, Mode B legacy).
    expect(typeof body.ledger.netCashFlow.amount).toBe('number');
  });

  test('2. buat rekening + opening balance → currentBalance known = opening', async () => {
    const { status, json } = await api('/api/wallets', {
      method: 'POST',
      cookie: session.cookie,
      body: {
        name: 'LINE Bank E2E',
        type: 'bank',
        institution: 'LINE Bank',
        balance: 0,
        color: '#8b5cf6',
        openingBalance: 2500000,
        openingBalanceDate: '2026-01-01',
        currency: 'IDR',
      },
    });
    expect(status).toBe(200);
    accountA = (json as { id: string }).id;

    const { json: summary } = await api('/api/transactions/summary', { cookie: session.cookie });
    const ledger = (summary as Record<string, any>).ledger;
    expect(ledger.currentBalance.status).toBe('known');
    expect(ledger.currentBalance.amount).toBe(2500000);
    expect(ledger.accounts).toHaveLength(1);
    expect(ledger.accounts[0].openingBalance).toBe(2500000);
    expect(ledger.accounts[0].closingBalance).toBe(2500000);
    expect(ledger.reconciliationStatus).toBe('balanced');
  });

  test('3. transaksi ter-link → currentBalance = opening + movement', async () => {
    const { status, json } = await api('/api/transactions', {
      method: 'POST',
      cookie: session.cookie,
      body: {
        type: 'income',
        amount: 500000,
        categoryId: 'gaji',
        categoryName: 'Gaji',
        merchant: 'Gaji E2E',
        date: '2026-08-05',
        source: 'manual',
        accountId: accountA,
      },
    });
    expect(status).toBe(200);

    const { json: summary } = await api('/api/transactions/summary', { cookie: session.cookie });
    const ledger = (summary as Record<string, any>).ledger;
    expect(ledger.currentBalance.status).toBe('known');
    expect(ledger.currentBalance.amount).toBe(3000000); // 2.500.000 + 500.000
    expect(ledger.unclassified.count).toBe(0);
  });

  test('4. transfer internal (2 leg, group + role) → aggregate TIDAK berubah', async () => {
    const createAcc = await api('/api/wallets', {
      method: 'POST',
      cookie: session.cookie,
      body: { name: 'DANA E2E', type: 'e-wallet', balance: 0, openingBalance: 1000000, openingBalanceDate: '2026-01-01' },
    });
    expect(createAcc.status).toBe(200);
    accountB = (createAcc.json as { id: string }).id;

    const groupId = `grp-${Date.now()}`;
    const legOut = await api('/api/transactions', {
      method: 'POST',
      cookie: session.cookie,
      body: {
        type: 'transfer',
        amount: 200000,
        categoryId: 'transfer',
        categoryName: 'Transfer',
        merchant: 'DANA E2E',
        date: '2026-08-06',
        accountId: accountA,
        transferGroupId: groupId,
        metadata: { transferRole: 'out' },
      },
    });
    const legIn = await api('/api/transactions', {
      method: 'POST',
      cookie: session.cookie,
      body: {
        type: 'transfer',
        amount: 200000,
        categoryId: 'transfer',
        categoryName: 'Transfer',
        merchant: 'DANA E2E',
        date: '2026-08-06',
        accountId: accountB,
        transferGroupId: groupId,
        metadata: { transferRole: 'in' },
      },
    });
    expect(legOut.status).toBe(200);
    expect(legIn.status).toBe(200);

    const { json: summary } = await api('/api/transactions/summary', { cookie: session.cookie });
    const ledger = (summary as Record<string, any>).ledger;
    // A: 2.500.000 + 500.000 − 200.000 = 2.800.000 · B: 1.000.000 + 200.000 = 1.200.000
    // Aggregate = 4.000.000 (opening total 3.500.000 + income 500.000) — transfer netral.
    expect(ledger.currentBalance.amount).toBe(4000000);
    expect(ledger.currentBalance.status).toBe('known');
    const byName = Object.fromEntries(ledger.accounts.map((a: any) => [a.name, a.closingBalance]));
    expect(byName['LINE Bank E2E']).toBe(2800000);
    expect(byName['DANA E2E']).toBe(1200000);
  });

  test('5. persistence — opening balance tersimpan di GET /api/wallets', async () => {
    const { json } = await api('/api/wallets', { cookie: session.cookie });
    const rows = (json as Array<Record<string, any>>).filter((r) => r.id === accountA || r.id === accountB);
    expect(rows).toHaveLength(2);
    const a = rows.find((r) => r.id === accountA);
    expect(a).toBeTruthy();
    expect(a!.opening_balance).toBe(2500000);
    expect(a!.opening_balance_date).toBe('2026-01-01');
    expect(a!.currency).toBe('IDR');
  });

  test('6. IDOR — user lain TIDAK bisa baca/hapus akun ini', async () => {
    const other = await mintSessionCookieForEmail(OTHER_EMAIL);
    const turso = await createE2eTursoClient();
    try {
      await turso.execute({
        sql: `INSERT INTO users (id, email, name, display_name)
              SELECT ?, ?, 'E2E Ledger Other', 'E2E Ledger Other'
              WHERE NOT EXISTS (SELECT 1 FROM users WHERE email = ?)`,
        args: [other.userId, OTHER_EMAIL, OTHER_EMAIL],
      });
    } finally {
      turso.close();
    }

    const { json } = await api('/api/wallets', { cookie: other.cookie });
    const rows = json as Array<Record<string, any>>;
    expect(rows.some((r) => r.id === accountA)).toBe(false);

    // DELETE oleh user lain → user-scoped, TIDAK menghapus akun milik user ini.
    const del = await api(`/api/wallets/${accountA}`, { method: 'DELETE', cookie: other.cookie });
    expect(del.status).toBe(200);
    const after = await api('/api/wallets', { cookie: session.cookie });
    expect((after.json as Array<Record<string, any>>).some((r) => r.id === accountA)).toBe(true);
  });
});
