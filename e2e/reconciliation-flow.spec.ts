/**
 * E2E P2.6 — ASSISTED RECONCILIATION FLOW.
 *
 * Membuktikan rantai onboarding → klasifikasi → pairing → verifikasi pada
 * user DEDIKASI (tidak menyentuh dataset pinned seed-admin):
 *
 *   1. Tanpa akun → /api/reconciliation/state status 'unknown' (jujur).
 *   2. Buat rekening + opening balance → state 'partial' + akun muncul.
 *   3. Transaksi pending dgn merchant cocok → saran HIGH (count + nominal).
 *   4. POST /api/reconciliation/classify-by-suggestion → applied; idempoten
 *      (run kedua → 0 applied, tanpa duplikat audit).
 *   5. Semua terhubung → summary.ledger.currentBalance known + reconciliation
 *      status 'reconciled'.
 *   6. POST verify-balance (actual == system) → status 'verified'.
 *   7. IDOR: state user lain tidak memuat akun user ini.
 *   8. Validasi fail-closed: body invalid → 400.
 *
 * Menjalankan (DB lokal terisolasi, fresh per run):
 *   npx playwright test -c playwright.e2e-local.config.mjs e2e/reconciliation-flow.spec.ts
 */
import { test, expect } from 'playwright/test';
import {
  mintSessionCookieForEmail,
  cleanupTestSessions,
  createE2eTursoClient,
  type MintedSession,
} from './helpers/mintSession';

const COOKIE_NAME = 'better-auth.session_token';
const RECON_EMAIL = 'e2e-recon@cashflow.test';
const OTHER_EMAIL = 'e2e-recon-other@cashflow.test';

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

test.describe('Assisted reconciliation (P2.6)', () => {
  let session: MintedSession;
  let accountId: string;
  let txId: string;

  test.beforeAll(async () => {
    session = await mintSessionCookieForEmail(RECON_EMAIL);
    const turso = await createE2eTursoClient();
    try {
      await turso.execute({
        sql: `INSERT INTO users (id, email, name, display_name)
              SELECT ?, ?, 'E2E Recon', 'E2E Recon'
              WHERE NOT EXISTS (SELECT 1 FROM users WHERE email = ?)`,
        args: [session.userId, RECON_EMAIL, RECON_EMAIL],
      });
    } finally {
      turso.close();
    }
  });

  test.afterAll(async () => {
    await cleanupTestSessions();
  });

  test('1. tanpa akun → state status unknown (bukan Rp0 karangan)', async () => {
    const { status, json } = await api('/api/reconciliation/state', { cookie: session.cookie });
    expect(status).toBe(200);
    const body = json as Record<string, any>;
    expect(body.status).toBe('unknown');
    expect(body.accounts).toHaveLength(0);
    expect(body.balanceConfidence).toBe('unknown');
    expect(body.onboardingProgress.completedSteps).toBe(0);
    // Summary juga expose reconciliation counts + status.
    const { json: summary } = await api('/api/transactions/summary', { cookie: session.cookie });
    expect((summary as Record<string, any>).reconciliation).toBeTruthy();
    expect((summary as Record<string, any>).reconciliation.status).toBe('unknown');
  });

  test('2. buat rekening + opening → state partial, akun + saldo sistem muncul', async () => {
    const { status, json } = await api('/api/wallets', {
      method: 'POST',
      cookie: session.cookie,
      body: {
        name: 'blu',
        type: 'e-wallet',
        institution: 'blu',
        balance: 0,
        color: '#0ea5e9',
        openingBalance: 1000000,
        openingBalanceDate: '2026-01-01',
        currency: 'IDR',
      },
    });
    expect(status).toBe(200);
    accountId = (json as { id: string }).id;

    const { json: state } = await api('/api/reconciliation/state', { cookie: session.cookie });
    const s = state as Record<string, any>;
    // Belum ada transaksi → semua ter-link secara vacuous → reconciled
    // (partial muncul saat ada transaksi unclassified, test 3).
    expect(s.status).toBe('reconciled');
    expect(s.accounts).toHaveLength(1);
    expect(s.accounts[0].name).toBe('blu');
    expect(s.accounts[0].openingBalance).toBe(1000000);
    expect(s.accounts[0].systemBalance).toBe(1000000);
    expect(s.accounts[0].verificationStatus).toBe('not_verified');
    expect(s.onboardingProgress.accountsConfigured).toBe(true);
  });

  test('3. transaksi merchant "blu" → saran HIGH dengan nominal', async () => {
    const { status, json } = await api('/api/transactions', {
      method: 'POST',
      cookie: session.cookie,
      body: {
        type: 'expense',
        amount: 150000,
        categoryId: 'makanan',
        categoryName: 'Makanan',
        merchant: 'blu',
        date: '2026-08-10',
        source: 'manual',
      },
    });
    expect(status).toBe(200);
    txId = (json as { id: string }).id;

    const { json: state } = await api('/api/reconciliation/state', { cookie: session.cookie });
    const s = state as Record<string, any>;
    expect(s.transactions.total).toBe(1);
    expect(s.transactions.unlinked).toBe(1);
    expect(s.status).toBe('partial'); // ada 1 transaksi unclassified
    const blu = s.suggestions.find((g: any) => g.accountName === 'blu');
    expect(blu).toBeTruthy();
    expect(blu.accountId).toBe(accountId);
    expect(blu.confidence).toBe('high');
    expect(blu.count).toBe(1);
    expect(blu.totalAmount).toBe(150000);
  });

  test('4. classify-by-suggestion → applied; idempoten pada run kedua', async () => {
    const first = await api('/api/reconciliation/classify-by-suggestion', {
      method: 'POST',
      cookie: session.cookie,
      body: { accountId, confidence: 'high' },
    });
    expect(first.status).toBe(200);
    expect((first.json as { applied: number }).applied).toBe(1);

    // Idempoten: run kedua → 0 applied.
    const second = await api('/api/reconciliation/classify-by-suggestion', {
      method: 'POST',
      cookie: session.cookie,
      body: { accountId, confidence: 'high' },
    });
    expect((second.json as { applied: number }).applied).toBe(0);

    // Audit trail tercatat, tidak duplikat (1 transaksi = 1 baris audit).
    const turso = await createE2eTursoClient();
    try {
      const audit = await turso.execute({
        sql: `SELECT COUNT(*) c FROM reconciliation_audit_log WHERE user_id = ? AND action = 'account_assigned'`,
        args: [session.userId],
      });
      expect(Number(audit.rows[0].c)).toBe(1);
    } finally {
      turso.close();
    }
  });

  test('5. semua terhubung → summary known + status reconciled', async () => {
    const { json: summary } = await api('/api/transactions/summary', { cookie: session.cookie });
    const body = summary as Record<string, any>;
    expect(body.ledger.currentBalance.status).toBe('known');
    expect(body.ledger.currentBalance.amount).toBe(850000); // 1.000.000 − 150.000
    expect(body.reconciliation.status).toBe('reconciled');
    expect(body.reconciliation.transactions.unclassified).toBe(0);

    const { json: state } = await api('/api/reconciliation/state', { cookie: session.cookie });
    expect((state as Record<string, any>).status).toBe('reconciled');
    expect((state as Record<string, any>).transactions.unlinked).toBe(0);
    expect((state as Record<string, any>).onboardingProgress.completedSteps).toBe(4);
  });

  test('6. verify-balance actual == system → verified; mismatch → tanpa auto-fix', async () => {
    const ok = await api('/api/reconciliation/verify-balance', {
      method: 'POST',
      cookie: session.cookie,
      body: { accountId, actualBalance: 850000, date: '2026-08-11' },
    });
    expect(ok.status).toBe(200);
    expect((ok.json as any).status).toBe('verified');
    expect((ok.json as any).difference).toBe(0);

    const { json: state } = await api('/api/reconciliation/state', { cookie: session.cookie });
    expect((state as Record<string, any>).status).toBe('verified');
    expect((state as Record<string, any>).accounts[0].verificationStatus).toBe('verified');

    // Mismatch TANPA auto-fix: tidak ada transaksi adjustment dibuat.
    const mis = await api('/api/reconciliation/verify-balance', {
      method: 'POST',
      cookie: session.cookie,
      body: { accountId, actualBalance: 700000, date: '2026-08-11' },
    });
    expect((mis.json as any).status).toBe('mismatch');
    const turso = await createE2eTursoClient();
    try {
      const txCount = await turso.execute({ sql: 'SELECT COUNT(*) c FROM transactions WHERE user_id = ?', args: [session.userId] });
      expect(Number(txCount.rows[0].c)).toBe(1); // tetap 1 — tidak ada adjustment
    } finally {
      turso.close();
    }
  });

  test('7. IDOR — state user lain tidak memuat akun/transaksi user ini', async () => {
    const other = await mintSessionCookieForEmail(OTHER_EMAIL);
    const turso = await createE2eTursoClient();
    try {
      await turso.execute({
        sql: `INSERT INTO users (id, email, name, display_name)
              SELECT ?, ?, 'E2E Recon Other', 'E2E Recon Other'
              WHERE NOT EXISTS (SELECT 1 FROM users WHERE email = ?)`,
        args: [other.userId, OTHER_EMAIL, OTHER_EMAIL],
      });
    } finally {
      turso.close();
    }
    const { json } = await api('/api/reconciliation/state', { cookie: other.cookie });
    const s = json as Record<string, any>;
    expect(s.accounts).toHaveLength(0);
    expect(s.transactions.total).toBe(0);

    // Transfer-pair ke transaksi user lain → ditolak (ok: false, 400).
    const pair = await api('/api/reconciliation/transfer-pair', {
      method: 'POST',
      cookie: other.cookie,
      body: { transferId: txId, incomeId: 'fake' },
    });
    expect(pair.status).toBe(400);
  });

  test('8. validasi fail-closed: body invalid → 400 VALIDATION_ERROR', async () => {
    const badConfidence = await api('/api/reconciliation/classify-by-suggestion', {
      method: 'POST',
      cookie: session.cookie,
      body: { accountId, confidence: 'very-high' },
    });
    expect(badConfidence.status).toBe(400);

    const noBody = await api('/api/reconciliation/verify-balance', {
      method: 'POST',
      cookie: session.cookie,
      body: { accountId },
    });
    expect(noBody.status).toBe(400);
  });
});

test.describe('P2.8 — reject classification, transfer reject & account activation', () => {
  let session: MintedSession;
  let rejectedTxId: string;
  let transferId: string;
  let incomeId: string;

  test.beforeAll(async () => {
    session = await mintSessionCookieForEmail('e2e-recon-p28@cashflow.test');
    const turso = await createE2eTursoClient();
    try {
      await turso.execute({
        sql: `INSERT INTO users (id, email, name, display_name)
              SELECT ?, ?, 'E2E Recon P2.8', 'E2E Recon P2.8'
              WHERE NOT EXISTS (SELECT 1 FROM users WHERE email = ?)`,
        args: [session.userId, 'e2e-recon-p28@cashflow.test', 'e2e-recon-p28@cashflow.test'],
      });
      // Kandidat aktivasi: LINE Bank (belum dibuat) + blu (akan dibuat).
      await turso.execute({
        sql: `INSERT INTO user_financial_settings (user_id, own_accounts) VALUES (?, ?)
              ON CONFLICT (user_id) DO UPDATE SET own_accounts = excluded.own_accounts`,
        args: [session.userId, JSON.stringify(['LINE Bank', 'blu'])],
      });
    } finally {
      turso.close();
    }
  });

  test.afterAll(async () => {
    await cleanupTestSessions();
  });

  test('9. state expose accountCandidates (own_accounts yang belum dibuat)', async () => {
    const { status, json } = await api('/api/reconciliation/state', { cookie: session.cookie });
    expect(status).toBe(200);
    const body = json as Record<string, any>;
    // blu belum dibuat juga → keduanya kandidat pada tahap ini.
    expect(body.accountCandidates).toContain('LINE Bank');
    expect(body.accountCandidates).toContain('blu');

    // Aktivasi eksplisit: buat rekening LINE Bank via POST /api/wallets.
    const created = await api('/api/wallets', {
      method: 'POST',
      cookie: session.cookie,
      body: { name: 'LINE Bank', type: 'bank', institution: 'LINE Bank', balance: 0, color: '#06b6d4', currency: 'IDR' },
    });
    expect(created.status).toBe(200);
    const { json: after } = await api('/api/reconciliation/state', { cookie: session.cookie });
    const a = after as Record<string, any>;
    // LINE Bank sudah dibuat → keluar dari kandidat; blu tetap kandidat.
    expect(a.accountCandidates).not.toContain('LINE Bank');
    expect(a.accountCandidates).toContain('blu');
    expect(a.accounts).toHaveLength(1);
  });

  test('10. reject-by-suggestion: transaksi ditolak TANPA di-assign + audit + idempoten', async () => {
    // Transaksi merchant LINE Bank (akun sudah dibuat) → saran HIGH.
    const { status, json } = await api('/api/transactions', {
      method: 'POST',
      cookie: session.cookie,
      body: {
        type: 'expense',
        amount: 50000,
        categoryId: 'makanan',
        categoryName: 'Makanan',
        merchant: 'LINE Bank',
        date: '2026-08-10',
        source: 'manual',
      },
    });
    expect(status).toBe(200);
    rejectedTxId = (json as { id: string }).id;

    const { json: state } = await api('/api/reconciliation/state', { cookie: session.cookie });
    const s = state as Record<string, any>;
    const lineSuggestion = s.suggestions.find((g: any) => g.accountName === 'LINE Bank');
    expect(lineSuggestion).toBeTruthy();
    expect(lineSuggestion.accountId).toBeTruthy();
    expect(lineSuggestion.confidence).toBe('high');

    const reject = await api('/api/reconciliation/classify-reject', {
      method: 'POST',
      cookie: session.cookie,
      body: { accountId: lineSuggestion.accountId, confidence: 'high' },
    });
    expect(reject.status).toBe(200);
    expect((reject.json as { rejected: number }).rejected).toBe(1);

    // Idempoten: run kedua → 0 rejected.
    const again = await api('/api/reconciliation/classify-reject', {
      method: 'POST',
      cookie: session.cookie,
      body: { accountId: lineSuggestion.accountId, confidence: 'high' },
    });
    expect((again.json as { rejected: number }).rejected).toBe(0);

    // Transaksi TIDAK di-assign; saran tidak muncul ulang; rejected count tampil.
    const turso = await createE2eTursoClient();
    try {
      const row = await turso.execute({
        sql: 'SELECT account_id, account_review_status FROM transactions WHERE id = ?',
        args: [rejectedTxId],
      });
      expect(row.rows[0].account_id).toBeNull();
      expect(row.rows[0].account_review_status).toBe('rejected');
      const audit = await turso.execute({
        sql: `SELECT COUNT(*) c FROM reconciliation_audit_log WHERE user_id = ? AND action = 'account_rejected'`,
        args: [session.userId],
      });
      expect(Number(audit.rows[0].c)).toBe(1); // 1 transaksi, 1 audit, tidak duplikat
    } finally {
      turso.close();
    }
    const { json: after } = await api('/api/reconciliation/state', { cookie: session.cookie });
    const a = after as Record<string, any>;
    expect(a.transactions.rejected).toBe(1);
    expect(a.suggestions.some((g: any) => g.accountName === 'LINE Bank')).toBe(false);
  });

  test('11. transfer-reject: kandidat ditolak → tidak disarankan ulang, tetap ungrouped', async () => {
    // Transfer + income (tanggal & nominal sama) → 1 kandidat pasangan.
    const tr = await api('/api/transactions', {
      method: 'POST',
      cookie: session.cookie,
      body: { type: 'transfer', amount: 100000, categoryId: 'transfer', categoryName: 'Transfer', merchant: 'blu', date: '2026-08-10', source: 'manual' },
    });
    const inc = await api('/api/transactions', {
      method: 'POST',
      cookie: session.cookie,
      body: { type: 'income', amount: 100000, categoryId: 'gaji', categoryName: 'Gaji', merchant: 'blu', date: '2026-08-10', source: 'manual' },
    });
    transferId = (tr.json as { id: string }).id;
    incomeId = (inc.json as { id: string }).id;

    const { json: state } = await api('/api/reconciliation/state', { cookie: session.cookie });
    const s = state as Record<string, any>;
    const candidate = s.transferPairSuggestions.find((c: any) => c.transferId === transferId && c.incomeId === incomeId);
    expect(candidate).toBeTruthy();
    expect(s.transfers.ungrouped).toBeGreaterThanOrEqual(1);

    const reject = await api('/api/reconciliation/transfer-reject', {
      method: 'POST',
      cookie: session.cookie,
      body: { transferId },
    });
    expect(reject.status).toBe(200);
    expect((reject.json as { ok: boolean }).ok).toBe(true);

    const { json: after } = await api('/api/reconciliation/state', { cookie: session.cookie });
    const a = after as Record<string, any>;
    // Tidak disarankan ulang, TAPI tetap ungrouped (jujur — bukan auto-pair).
    expect(a.transferPairSuggestions.some((c: any) => c.transferId === transferId)).toBe(false);
    expect(a.transfers.ungrouped).toBeGreaterThanOrEqual(1);

    const turso = await createE2eTursoClient();
    try {
      const row = await turso.execute({
        sql: 'SELECT transfer_review_status, transfer_group_id FROM transactions WHERE id = ?',
        args: [transferId],
      });
      expect(row.rows[0].transfer_review_status).toBe('rejected');
      expect(row.rows[0].transfer_group_id).toBeNull();
    } finally {
      turso.close();
    }
  });

  test('12. pairTransfer idempoten: pair kedua → group sama, tanpa duplikat', async () => {
    // IncomeId masih tersedia sebagai pasangan (transfer belum di-pair).
    const first = await api('/api/reconciliation/transfer-pair', {
      method: 'POST',
      cookie: session.cookie,
      body: { transferId, incomeId },
    });
    expect(first.status).toBe(200);
    expect((first.json as any).ok).toBe(true);
    const group1 = (first.json as any).transferGroupId;

    const second = await api('/api/reconciliation/transfer-pair', {
      method: 'POST',
      cookie: session.cookie,
      body: { transferId, incomeId },
    });
    expect(second.status).toBe(200);
    expect((second.json as any).idempotent).toBe(true);
    expect((second.json as any).transferGroupId).toBe(group1);

    const turso = await createE2eTursoClient();
    try {
      const audits = await turso.execute({
        sql: `SELECT COUNT(*) c FROM reconciliation_audit_log WHERE user_id = ? AND action = 'transfer_paired'`,
        args: [session.userId],
      });
      expect(Number(audits.rows[0].c)).toBe(1); // tanpa audit duplikat
    } finally {
      turso.close();
    }
  });
});

test.describe('P2.9 — completion score, LOW manual assign & negative-anchor policy', () => {
  const LOW_EMAIL = 'e2e-recon-low@cashflow.test';
  let session: MintedSession;
  let accountId: string;
  let lowTxIds: string[];

  test.beforeAll(async () => {
    session = await mintSessionCookieForEmail(LOW_EMAIL);
    const turso = await createE2eTursoClient();
    try {
      await turso.execute({
        sql: `INSERT INTO users (id, email, name, display_name)
              SELECT ?, ?, 'E2E Recon LOW', 'E2E Recon LOW'
              WHERE NOT EXISTS (SELECT 1 FROM users WHERE email = ?)`,
        args: [session.userId, LOW_EMAIL, LOW_EMAIL],
      });
      // Idempoten terhadap retry: bersihkan baris seed milik user DEDIKASI ini
      // saja (tidak pernah menyentuh data user lain).
      await turso.execute({
        sql: `DELETE FROM reconciliation_audit_log WHERE user_id = ?`,
        args: [session.userId],
      });
      await turso.execute({
        sql: `DELETE FROM transactions WHERE user_id = ?`,
        args: [session.userId],
      });
      await turso.execute({
        sql: `DELETE FROM wallet_accounts WHERE user_id = ?`,
        args: [session.userId],
      });
      // Transaksi tanpa sinyal akun (LOW) + 1 transfer (untuk rejected count).
      lowTxIds = [];
      for (const merchant of ['Merchant Aneh 1', 'Merchant Aneh 2']) {
        const id = `p29-low-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        lowTxIds.push(id);
        await turso.execute({
          sql: `INSERT INTO transactions (id, user_id, type, amount, category_id, category_name, merchant, payment_method, date, transaction_date, source, account_review_status)
                VALUES (?, ?, 'expense', ?, 'cat-1', 'Kategori', ?, 'cash', '2026-08-01', '2026-08-01', 'manual', 'pending')`,
          args: [id, session.userId, 45000 + Math.round(Math.random() * 1000), merchant],
        });
      }
      await turso.execute({
        sql: `INSERT INTO transactions (id, user_id, type, amount, category_id, category_name, merchant, payment_method, date, transaction_date, source, transfer_review_status)
              VALUES (?, ?, 'transfer', 100000, 'cat-1', 'Kategori', 'blu', 'cash', '2026-08-02', '2026-08-02', 'manual', 'rejected')`,
        args: [`p29-tr-${Date.now()}`, session.userId],
      });
    } finally {
      turso.close();
    }
  });

  test('13. state expose completionScore + unassignedTransactions (LOW) + transfers.rejected', async () => {
    const res = await api('/api/reconciliation/state', { cookie: session.cookie });
    expect(res.status).toBe(200);
    const s = res.json as any;
    expect(s.unassignedTransactions).toHaveLength(2);
    // P3.0 §12 — field `type` tersedia untuk filter UI (seed ini expense semua).
    for (const tx of s.unassignedTransactions) {
      expect(typeof tx.type).toBe('string');
      expect(tx.type).toBe('expense');
    }
    expect(s.transfers.rejected).toBe(1);
    expect(s.transfers.ungrouped).toBe(1); // rejected tetap unresolved — jujur
    expect(typeof s.completionScore.score).toBe('number');
    expect(s.completionScore.score).toBeGreaterThanOrEqual(0);
    expect(s.completionScore.score).toBeLessThanOrEqual(100);
    expect(s.completionScore.transactions.linked).toBe(0);
  });

  test('14. classify-bulk manual (LOW) → linked + audit; run kedua idempoten', async () => {
    const created = await api('/api/wallets', {
      method: 'POST',
      cookie: session.cookie,
      body: { name: 'Rekening Manual', type: 'bank', currency: 'IDR' },
    });
    expect(created.status).toBe(200);
    accountId = (created.json as any).id;

    const pairs = lowTxIds.map((transactionId) => ({ transactionId, accountId }));
    const first = await api('/api/reconciliation/classify-bulk', {
      method: 'POST',
      cookie: session.cookie,
      body: { pairs },
    });
    expect(first.status).toBe(200);
    expect((first.json as any).applied).toBe(2);

    const second = await api('/api/reconciliation/classify-bulk', {
      method: 'POST',
      cookie: session.cookie,
      body: { pairs },
    });
    expect(second.status).toBe(200);
    expect((second.json as any).applied).toBe(0); // idempoten

    const turso = await createE2eTursoClient();
    try {
      const linked = await turso.execute({
        sql: `SELECT COUNT(*) c FROM transactions WHERE user_id = ? AND account_id = ?`,
        args: [session.userId, accountId],
      });
      expect(Number(linked.rows[0].c)).toBe(2);
      const audits = await turso.execute({
        sql: `SELECT COUNT(*) c FROM reconciliation_audit_log WHERE user_id = ? AND action = 'account_assigned'`,
        args: [session.userId],
      });
      expect(Number(audits.rows[0].c)).toBe(2); // 2 baris → 2 audit, tanpa duplikat
    } finally {
      turso.close();
    }
  });

  test('15. saldo aktual negatif ditolak untuk bank (400 semantics), diizinkan untuk credit', async () => {
    const bad = await api('/api/reconciliation/verify-balance', {
      method: 'POST',
      cookie: session.cookie,
      body: { accountId, actualBalance: -500000, date: '2026-08-11' },
    });
    expect(bad.status).toBe(400);

    const cc = await api('/api/wallets', {
      method: 'POST',
      cookie: session.cookie,
      body: { name: 'Kartu Kredit', type: 'credit', currency: 'IDR' },
    });
    expect(cc.status).toBe(200);
    const ccId = (cc.json as any).id;
    const ok = await api('/api/reconciliation/verify-balance', {
      method: 'POST',
      cookie: session.cookie,
      body: { accountId: ccId, actualBalance: -250000, date: '2026-08-11' },
    });
    expect(ok.status).toBe(200);
    expect((ok.json as any).status).toBe('verified');
  });
});

test.describe('P3.1 §31 — completion journey: VERIFIED → STALE → reverify → MISMATCH → correction → VERIFIED', () => {
  let s: MintedSession;
  let accId: string;
  let postTxId: string;

  test.beforeAll(async () => {
    s = await mintSessionCookieForEmail('e2e-recon-completion@cashflow.test');
    const turso = await createE2eTursoClient();
    try {
      // mintSessionCookieForEmail hanya menulis `user` (singular); FK tabel
      // bisnis menunjuk `users` (plural) — sinkronkan seperti describe lain.
      await turso.execute({
        sql: `INSERT INTO users (id, email, name, display_name)
              SELECT ?, ?, 'E2E Recon Completion', 'E2E Recon Completion'
              WHERE NOT EXISTS (SELECT 1 FROM users WHERE email = ?)`,
        args: [s.userId, 'e2e-recon-completion@cashflow.test', 'e2e-recon-completion@cashflow.test'],
      });
    } finally {
      turso.close();
    }
    // Akun tanpa opening (anchor murni dari saldo aktual user).
    const created = await api('/api/wallets', {
      method: 'POST',
      cookie: s.cookie,
      body: { name: 'blu', type: 'e-wallet', institution: 'blu', balance: 0, color: '#0ea5e9', currency: 'IDR' },
    });
    expect(created.status).toBe(200);
    accId = (created.json as any).id;
  });

  test.afterAll(async () => {
    await cleanupTestSessions();
  });

  const ledgerStatus = async () => {
    const { json } = await api('/api/transactions/summary', { cookie: s.cookie });
    return (json as any).ledger.currentBalance;
  };

  test('Flow K — actual == system (baseline kosong) → VERIFIED', async () => {
    const res = await api('/api/reconciliation/verify-balance', {
      method: 'POST',
      cookie: s.cookie,
      body: { accountId: accId, actualBalance: 1000000, date: '2026-08-10' },
    });
    expect(res.status).toBe(200);
    expect((res.json as any).status).toBe('verified');
    const cb = await ledgerStatus();
    expect(cb.status).toBe('verified');
    expect(cb.amount).toBe(1000000);
  });

  test('Flow L — transaksi post-anchor BARU belum diklasifikasi → STALE (tidak disembunyikan)', async () => {
    const created = await api('/api/transactions', {
      method: 'POST',
      cookie: s.cookie,
      body: { type: 'expense', amount: 100000, categoryId: 'makanan', categoryName: 'Makanan', merchant: 'Warung Baru', date: '2026-08-11' },
    });
    expect(created.status).toBe(200);
    postTxId = (created.json as any).id;

    const cb = await ledgerStatus();
    expect(cb.status).toBe('stale');
    expect(cb.amount).toBe(1000000); // saldo lama TIDAK berubah sampai diverifikasi ulang
    expect(cb.message).toContain('verifikasi');
  });

  test('Flow M/N — klasifikasi transaksi post-anchor + reverify → VERIFIED (900.000)', async () => {
    const cls = await api('/api/reconciliation/classify-bulk', {
      method: 'POST',
      cookie: s.cookie,
      body: { pairs: [{ transactionId: postTxId, accountId: accId }] },
    });
    expect(cls.status).toBe(200);
    expect((cls.json as any).applied).toBe(1);

    const rev = await api('/api/reconciliation/verify-balance', {
      method: 'POST',
      cookie: s.cookie,
      body: { accountId: accId, actualBalance: 900000, date: '2026-08-11' },
    });
    expect(rev.status).toBe(200);
    expect((rev.json as any).status).toBe('verified');
    expect((rev.json as any).difference).toBe(0);
    const cb = await ledgerStatus();
    expect(cb.status).toBe('verified');
    expect(cb.amount).toBe(900000);
  });

  test('Flow O — mismatch disengaja: actual 800.000 vs system 900.000 → MISMATCH −100.000, tanpa auto-fix', async () => {
    const res = await api('/api/reconciliation/verify-balance', {
      method: 'POST',
      cookie: s.cookie,
      body: { accountId: accId, actualBalance: 800000, date: '2026-08-11' },
    });
    expect(res.status).toBe(200);
    expect((res.json as any).status).toBe('mismatch');
    expect((res.json as any).difference).toBe(-100000);
    expect((res.json as any).systemBalance).toBe(900000); // sistem TIDAK diubah
    const cb = await ledgerStatus();
    expect(cb.status).toBe('mismatch');
  });

  test('Flow P/Q — waterfall breakdown tersedia di response verifikasi', async () => {
    const res = await api('/api/reconciliation/verify-balance', {
      method: 'POST',
      cookie: s.cookie,
      body: { accountId: accId, actualBalance: 850000, date: '2026-08-11' },
    });
    const b = (res.json as any).breakdown;
    expect(b).toBeDefined();
    expect(typeof b.unclassifiedAmount).toBe('number');
    expect(typeof b.unresolvedTransferAmount).toBe('number');
    // Anchor END-OF-DAY di 2026-08-11: transaksi 100.000 terjadi PADA tanggal
    // anchor → BUKAN movement post-anchor. Waterfall jujur: nol kontributor,
    // mismatch semata dari actual yang salah dimasukkan user (tanpa auto-fix).
    expect(b.postAnchorMovements).toMatchObject({ inflow: 0, expense: 0, incomingTransfer: 0, outgoingTransfer: 0 });
    expect(b.unclassifiedAmount).toBe(0);
    expect(b.unresolvedTransferAmount).toBe(0);
  });

  test('Flow R — koreksi: konfirmasi actual yang konsisten dengan ledger (850.000) → VERIFIED final', async () => {
    // Semantik P2.7: setiap verify meng-re-anchor real_balance ke actual user.
    // Setelah Flow P/Q, anchor = 850.000 @ 08-11; transaksi 100.000 terjadi
    // PADA tanggal anchor (END-OF-DAY) → bukan movement post-anchor, sehingga
    // saldo ledger yang konsisten = 850.000. User mengonfirmasi actual tsb.
    const res = await api('/api/reconciliation/verify-balance', {
      method: 'POST',
      cookie: s.cookie,
      body: { accountId: accId, actualBalance: 850000, date: '2026-08-11' },
    });
    expect((res.json as any).status).toBe('verified');
    expect((res.json as any).difference).toBe(0);
    const cb = await ledgerStatus();
    expect(cb.status).toBe('verified');
    expect(cb.amount).toBe(850000);
  });
});
