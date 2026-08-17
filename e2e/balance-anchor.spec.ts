/**
 * E2E P2.7 — VERIFIED BALANCE ANCHOR FLOW.
 *
 * Membuktikan rantai: anchor (saldo aktual user, TANPA paksa opening balance)
 * → current balance VERIFIED → post-anchor roll-forward → transfer netral →
 * mismatch tanpa auto-fix → IDOR. User DEDIKASI, DB lokal terisolasi.
 *
 *   Flow A/B : tanpa akun → unknown (jujur)
 *   Flow C/D : buat akun TANPA opening + anchor via verify-balance (no baseline)
 *   Flow E/F : confirm → reload → balance tetap (persistence)
 *   Flow H/I : transaksi post-anchor → saldo update
 *   Flow J/K : transfer internal post-anchor → net-netral
 *   Flow L   : mismatch → status mismatch, TANPA adjustment otomatis
 *   Flow M   : user B tidak bisa akses akun user A
 *
 * Menjalankan: npx playwright test -c playwright.e2e-local.config.mjs e2e/balance-anchor.spec.ts
 */
import { test, expect } from 'playwright/test';
import {
  mintSessionCookieForEmail,
  cleanupTestSessions,
  createE2eTursoClient,
  type MintedSession,
} from './helpers/mintSession';

const COOKIE_NAME = 'better-auth.session_token';
const ANCHOR_EMAIL = 'e2e-anchor@cashflow.test';
const OTHER_EMAIL = 'e2e-anchor-other@cashflow.test';

interface ApiOptions { method?: string; body?: unknown; cookie?: string; }

async function api(rel: string, { method = 'GET', body, cookie }: ApiOptions = {}) {
  const headers: Record<string, string> = {};
  if (cookie) headers.Cookie = `${COOKIE_NAME}=${cookie}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${process.env.API_BASE_URL || 'http://127.0.0.1:5191'}${rel}`, {
    method, headers, body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json: unknown = null;
  try { json = await res.json(); } catch { json = null; }
  return { status: res.status, json };
}

async function ensureUser(session: MintedSession, email: string, name: string) {
  const turso = await createE2eTursoClient();
  try {
    await turso.execute({
      sql: `INSERT INTO users (id, email, name, display_name)
            SELECT ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM users WHERE email = ?)`,
      args: [session.userId, email, name, name, email],
    });
  } finally { turso.close(); }
}

test.describe('Verified balance anchor (P2.7)', () => {
  let session: MintedSession;
  let accountId: string;

  test.beforeAll(async () => {
    session = await mintSessionCookieForEmail(ANCHOR_EMAIL);
    await ensureUser(session, ANCHOR_EMAIL, 'E2E Anchor');
  });

  test.afterAll(async () => { await cleanupTestSessions(); });

  test('Flow A/B: tanpa akun → currentBalance unknown, BUKAN Rp0/Rp996193', async () => {
    const { json } = await api('/api/transactions/summary', { cookie: session.cookie });
    const ledger = (json as Record<string, any>).ledger;
    expect(ledger.currentBalance.status).toBe('unknown');
    expect(ledger.currentBalance.amount).toBeNull();
    expect(ledger.currentBalance.anchorDate).toBeNull();
  });

  test('Flow C/D: buat akun TANPA opening + anchor saldo aktual (no baseline) → VERIFIED', async () => {
    // Akun TANPA opening balance — user tidak dipaksa tahu saldo Januari (§3).
    const acc = await api('/api/wallets', {
      method: 'POST', cookie: session.cookie,
      body: { name: 'blu', type: 'e-wallet', institution: 'blu', balance: 0, color: '#0ea5e9', currency: 'IDR' },
    });
    expect(acc.status).toBe(200);
    accountId = (acc.json as { id: string }).id;

    // Anchor: saldo aktual user per tanggal, tanpa baseline → diterima sebagai
    // kebenaran (REAL MONEY > derived). Audit balance_anchor_created.
    const anchor = await api('/api/reconciliation/verify-balance', {
      method: 'POST', cookie: session.cookie,
      body: { accountId, actualBalance: 2500000, date: '2026-08-11' },
    });
    expect(anchor.status).toBe(200);
    expect((anchor.json as any).status).toBe('verified');
    expect((anchor.json as any).difference).toBeNull(); // no baseline

    const { json } = await api('/api/transactions/summary', { cookie: session.cookie });
    const ledger = (json as Record<string, any>).ledger;
    expect(ledger.currentBalance.status).toBe('verified');
    expect(ledger.currentBalance.amount).toBe(2500000);
    expect(ledger.currentBalance.anchorDate).toBe('2026-08-11');
    expect(ledger.accounts[0].anchor).toEqual({ amount: 2500000, date: '2026-08-11', verifiedAt: expect.any(String) });
  });

  test('Flow E/F: reload/persistence — anchor tersimpan di GET /api/wallets', async () => {
    const { json } = await api('/api/wallets', { cookie: session.cookie });
    const row = (json as Array<Record<string, any>>).find((r) => r.id === accountId);
    expect(row).toBeTruthy();
    expect(row!.real_balance).toBe(2500000);
    expect(row!.real_balance_date).toBe('2026-08-11');
    expect(row!.balance_anchor_status).toBe('verified');
  });

  test('Flow H/I: transaksi post-anchor → current balance roll-forward', async () => {
    // Transaksi PADA tanggal anchor TIDAK boleh double-count.
    const onAnchor = await api('/api/transactions', {
      method: 'POST', cookie: session.cookie,
      body: { type: 'income', amount: 999999, categoryId: 'gaji', categoryName: 'Gaji', merchant: 'X', date: '2026-08-11', accountId },
    });
    expect(onAnchor.status).toBe(200);

    const after = await api('/api/transactions', {
      method: 'POST', cookie: session.cookie,
      body: { type: 'income', amount: 500000, categoryId: 'gaji', categoryName: 'Gaji', merchant: 'X', date: '2026-08-12', accountId },
    });
    expect(after.status).toBe(200);

    const { json } = await api('/api/transactions/summary', { cookie: session.cookie });
    const ledger = (json as Record<string, any>).ledger;
    // Hanya transaksi SETELAH anchor (12 Agu) yang dihitung — 11 Agu sudah
    // tercakup dalam anchor (anti double-count).
    expect(ledger.currentBalance.amount).toBe(3000000);
    expect(ledger.currentBalance.status).toBe('verified');
  });

  test('Flow J/K: transfer internal post-anchor → net-netral, tanpa double-count', async () => {
    const accB = await api('/api/wallets', {
      method: 'POST', cookie: session.cookie,
      body: { name: 'Bank Jago', type: 'bank', balance: 0, currency: 'IDR' },
    });
    const accountB = (accB.json as { id: string }).id;
    // Anchor akun B juga.
    await api('/api/reconciliation/verify-balance', {
      method: 'POST', cookie: session.cookie,
      body: { accountId: accountB, actualBalance: 2000000, date: '2026-08-11' },
    });

    const groupId = `grp-${Date.now()}`;
    const legOut = await api('/api/transactions', {
      method: 'POST', cookie: session.cookie,
      body: { type: 'transfer', amount: 200000, categoryId: 'transfer', categoryName: 'Transfer', merchant: 'Bank Jago', date: '2026-08-13', accountId, transferGroupId: groupId, metadata: { transferRole: 'out' } },
    });
    const legIn = await api('/api/transactions', {
      method: 'POST', cookie: session.cookie,
      body: { type: 'transfer', amount: 200000, categoryId: 'transfer', categoryName: 'Transfer', merchant: 'Bank Jago', date: '2026-08-13', accountId: accountB, transferGroupId: groupId, metadata: { transferRole: 'in' } },
    });
    expect(legOut.status).toBe(200);
    expect(legIn.status).toBe(200);

    const { json } = await api('/api/transactions/summary', { cookie: session.cookie });
    const ledger = (json as Record<string, any>).ledger;
    // blu: 2.500.000 + 500.000 − 200.000 = 2.800.000 · Bank Jago: 2.000.000 + 200.000 = 2.200.000
    // Aggregate = 5.000.000 (anchor total 4.500.000 + income 500.000) — transfer netral.
    expect(ledger.currentBalance.amount).toBe(5000000);
    expect(ledger.currentBalance.status).toBe('verified');
    const byName = Object.fromEntries(ledger.accounts.map((a: any) => [a.name, a.closingBalance]));
    expect(byName.blu).toBe(2800000);
    expect(byName['Bank Jago']).toBe(2200000);
  });

  test('Flow L: mismatch → status mismatch, TANPA adjustment otomatis', async () => {
    // Actual berbeda dari sistem (2.800.000) → mismatch dicatat, anchor tetap
    // disimpan sebagai kebenaran user; TIDAK ada transaksi koreksi.
    const mis = await api('/api/reconciliation/verify-balance', {
      method: 'POST', cookie: session.cookie,
      body: { accountId, actualBalance: 2600000, date: '2026-08-13' },
    });
    expect((mis.json as any).status).toBe('mismatch');

    const { json: state } = await api('/api/reconciliation/state', { cookie: session.cookie });
    expect((state as Record<string, any>).accounts[0].verificationStatus).toBe('mismatch');

    const turso = await createE2eTursoClient();
    try {
      const txCount = await turso.execute({ sql: 'SELECT COUNT(*) c FROM transactions WHERE user_id = ?', args: [session.userId] });
      // 2 (Flow H/I) + 2 (transfer) — tetap; tidak ada transaksi adjustment.
      expect(Number(txCount.rows[0].c)).toBe(4);
      const audit = await turso.execute({
        sql: `SELECT action FROM reconciliation_audit_log WHERE user_id = ? AND action LIKE 'balance_anchor%'`,
        args: [session.userId],
      });
      const actions = audit.rows.map((r) => r.action);
      expect(actions).toContain('balance_anchor_created');
      expect(actions).toContain('balance_anchor_updated');
    } finally { turso.close(); }
  });

  test('Flow M: user B tidak bisa memverifikasi/akses akun user A', async () => {
    const other = await mintSessionCookieForEmail(OTHER_EMAIL);
    await ensureUser(other, OTHER_EMAIL, 'E2E Anchor Other');
    const res = await api('/api/reconciliation/verify-balance', {
      method: 'POST', cookie: other.cookie,
      body: { accountId, actualBalance: 1, date: '2026-08-11' },
    });
    expect(res.status).toBe(400); // engine menolak (user-scoped) → 400
    expect((res.json as any).ok).toBe(false);

    const { json } = await api('/api/reconciliation/state', { cookie: other.cookie });
    expect((json as Record<string, any>).accounts).toHaveLength(0);
  });
});
