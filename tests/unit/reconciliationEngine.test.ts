/**
 * P2.6 — RECONCILIATION ENGINE (server/lib/reconciliationEngine.js).
 *
 * DB libsql FILE lokal nyata (pola financialLedger.test.ts) — tanpa mock/
 * jaringan. Mengunci invariant mandate P2.6:
 *   - klasifikasi deterministik + user-confirmed; audit trail per aksi
 *   - idempoten (2× run → state sama, tanpa duplikat)
 *   - cross-user: assign ke akun user lain ditolak
 *   - GOLDEN: A=1jt, B=2jt, income 500k, expense 200k, transfer 300k →
 *     A=1.000.000, B=2.300.000, total 3.300.000 (internal transfer net 0)
 *   - verifikasi saldo nyata: verified (diff 0) / mismatch (tanpa auto-fix)
 *   - pairing transfer min-pair 1:1 (1 transfer, 2 income → 1 pasangan)
 */
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createClient } from '@libsql/client';
import {
  normalizeMerchant,
  merchantMatches,
  suggestTransactionAccount,
  suggestTransferPairs,
  classifyTransactions,
  classifyBySuggestion,
  rejectBySuggestion,
  rejectTransactions,
  rejectTransferCandidate,
  pairTransfer,
  verifyAccountBalance,
  buildReconciliationState,
  buildReconciliationSummary,
  reconciliationStatus,
  completionScore,
} from '../../server/lib/reconciliationEngine.js';
import { computeAccountLedger, computeLedgerSummary } from '../../server/lib/financialLedger.js';

const CREATE_SQL = `
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('income','expense','transfer','refund')),
  amount REAL NOT NULL CHECK (amount > 0),
  category_id TEXT NOT NULL,
  category_name TEXT NOT NULL,
  merchant TEXT NOT NULL DEFAULT '',
  payment_method TEXT NOT NULL DEFAULT 'cash',
  note TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL,
  transaction_date TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  metadata TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  account_id TEXT,
  transfer_group_id TEXT,
  account_review_status TEXT NOT NULL DEFAULT 'pending',
  transfer_review_status TEXT NOT NULL DEFAULT 'pending'
);
CREATE TABLE IF NOT EXISTS wallet_accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'bank',
  institution TEXT NOT NULL DEFAULT '',
  balance REAL NOT NULL DEFAULT 0,
  color TEXT NOT NULL DEFAULT '#8b5cf6',
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  opening_balance REAL,
  opening_balance_date TEXT,
  currency TEXT NOT NULL DEFAULT 'IDR',
  real_balance REAL,
  real_balance_date TEXT,
  real_balance_verified_at TEXT,
  balance_anchor_status TEXT
);
CREATE TABLE IF NOT EXISTS reconciliation_audit_log (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  transaction_id TEXT,
  old_account_id TEXT,
  new_account_id TEXT,
  old_transfer_group_id TEXT,
  new_transfer_group_id TEXT,
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS user_financial_settings (
  user_id TEXT PRIMARY KEY,
  own_accounts TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

const clients = [];
const dbs = [];

async function newDb() {
  const dbPath = path
    .join(os.tmpdir(), `cf-recon-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`)
    .replace(/\\/g, '/');
  const client = createClient({ url: `file:${dbPath}` });
  clients.push(client);
  dbs.push(dbPath);
  await client.batch(CREATE_SQL.split(';').filter((s) => s.trim()).map((sql) => ({ sql, args: [] })));
  return client;
}

let seq = 0;

async function seedTx(client, rows) {
  for (const r of rows) {
    await client.execute({
      sql: `INSERT INTO transactions
            (id, user_id, type, amount, category_id, category_name, merchant, payment_method, date, transaction_date, metadata, account_id, transfer_group_id, account_review_status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        r.id,
        r.user_id,
        r.type,
        r.amount,
        r.category_id,
        r.category_name,
        r.merchant ?? '',
        r.payment_method ?? 'cash',
        r.date,
        r.transaction_date,
        JSON.stringify(r.metadata ?? {}),
        r.account_id ?? null,
        r.transfer_group_id ?? null,
        r.account_review_status ?? 'pending',
      ],
    });
  }
}

async function seedAccount(client, row) {
  await client.execute({
    sql: `INSERT INTO wallet_accounts
          (id, user_id, name, type, opening_balance, opening_balance_date, currency, real_balance, real_balance_date, real_balance_verified_at, balance_anchor_status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      row.id,
      row.user_id,
      row.name,
      row.type ?? 'bank',
      row.opening_balance ?? null,
      row.opening_balance_date ?? null,
      row.currency ?? 'IDR',
      row.real_balance ?? null,
      row.real_balance_date ?? null,
      row.real_balance_verified_at ?? null,
      row.balance_anchor_status ?? null,
    ],
  });
}

function tx(over = {}) {
  seq += 1;
  return {
    id: `tx-${seq}`,
    user_id: 'user-a',
    type: 'expense',
    amount: 1000,
    category_id: 'cat-1',
    category_name: 'Kategori',
    merchant: '',
    date: '2026-08-01',
    transaction_date: '2026-08-01',
    ...over,
  };
}

afterEach(() => {
  for (const c of clients) {
    try { c.close(); } catch { /* ignore */ }
  }
  clients.length = 0;
  for (const p of dbs) {
    try { fs.rmSync(p, { force: true }); } catch { /* ignore */ }
  }
  dbs.length = 0;
});

describe('normalizeMerchant & matching', () => {
  it('varian brand dinormalisasi untuk evidence (bukan truth)', () => {
    expect(normalizeMerchant('  BLU  ')).toBe('blu');
    expect(normalizeMerchant('blu by BCA Digital')).toBe('blu by bca digital');
    expect(normalizeMerchant('LINE-Bank')).toBe('line bank');
    expect(normalizeMerchant('')).toBe('');
    expect(merchantMatches('blu', 'BLU')).toBe(true);
    expect(merchantMatches('LINE Bank', 'LINE-Bank')).toBe(true);
    expect(merchantMatches('Shopee', 'blu')).toBe(false);
  });
});

describe('suggestTransactionAccount — signals deterministik', () => {
  const accounts = [
    { id: 'acc-blu', name: 'blu', type: 'e-wallet' },
    { id: 'acc-line', name: 'LINE Bank', type: 'bank' },
  ];
  const ownAccounts = ['LINE Bank', 'blu', 'Bank Jago', 'DANA', 'ShopeePay', 'Krom Bank'];

  it('HIGH: merchant eksak dengan akun terkonfigurasi → suggestedAccountId', () => {
    const s = suggestTransactionAccount({ transaction: { merchant: 'BLU', payment_method: '' }, accounts, ownAccounts });
    expect(s.confidence).toBe('high');
    expect(s.suggestedAccountId).toBe('acc-blu');
    expect(s.requiresReview).toBe(false);
    expect(s.evidence).toContain('account=blu');
  });

  it('HIGH: merchant = own account yang BELUM dibuat → suggestedAccountName + null id (butuh pembuatan)', () => {
    const s = suggestTransactionAccount({ transaction: { merchant: 'DANA', payment_method: '' }, accounts, ownAccounts });
    expect(s.confidence).toBe('high');
    expect(s.suggestedAccountId).toBeNull();
    expect(s.suggestedAccountName).toBe('DANA');
    expect(s.requiresReview).toBe(true);
  });

  it('MEDIUM: varian brand (substring) → requiresReview true', () => {
    const s = suggestTransactionAccount({ transaction: { merchant: 'blu by BCA Digital', payment_method: '' }, accounts, ownAccounts });
    expect(s.confidence).toBe('medium');
    expect(s.suggestedAccountId).toBe('acc-blu');
    expect(s.requiresReview).toBe(true);
  });

  it('LOW: tanpa sinyal → suggestedAccountId null, TIDAK menebak dari nominal', () => {
    const s = suggestTransactionAccount({ transaction: { merchant: 'PT. KAI', payment_method: '' }, accounts, ownAccounts });
    expect(s.confidence).toBe('low');
    expect(s.suggestedAccountId).toBeNull();
  });

  it('HIGH: account_id sudah ter-set → re-confirm', () => {
    const s = suggestTransactionAccount({ transaction: { merchant: '', payment_method: '', account_id: 'acc-line' }, accounts, ownAccounts });
    expect(s.confidence).toBe('high');
    expect(s.suggestedAccountId).toBe('acc-line');
  });
});

describe('GOLDEN — internal transfer netral (mandate §47)', () => {
  it('A=1jt B=2jt · income 500k · expense 200k · transfer 300k → A=1jt, B=2.3jt, total 3.3jt', async () => {
    const client = await newDb();
    await seedAccount(client, { id: 'acc-a', user_id: 'user-a', name: 'A', opening_balance: 1000000, opening_balance_date: '2026-01-01' });
    await seedAccount(client, { id: 'acc-b', user_id: 'user-a', name: 'B', opening_balance: 2000000, opening_balance_date: '2026-01-01' });
    await seedTx(client, [
      tx({ id: 'inc', type: 'income', amount: 500000, account_id: 'acc-a', merchant: 'Gaji' }),
      tx({ id: 'exp', type: 'expense', amount: 200000, account_id: 'acc-a', merchant: 'Warung' }),
      tx({ id: 'tr-out', type: 'transfer', amount: 300000, account_id: 'acc-a', transfer_group_id: 'g1', metadata: { transferRole: 'out' } }),
      tx({ id: 'tr-in', type: 'transfer', amount: 300000, account_id: 'acc-b', transfer_group_id: 'g1', metadata: { transferRole: 'in' } }),
    ]);
    const ledger = await computeAccountLedger(client, 'user-a');
    const byName = Object.fromEntries(ledger.accounts.map((a) => [a.name, a.closingBalance]));
    expect(byName.A).toBe(1000000); // 1jt + 500k − 200k − 300k
    expect(byName.B).toBe(2300000); // 2jt + 300k
    expect(ledger.currentBalance.amount).toBe(3300000); // internal transfer net 0
    expect(ledger.currentBalance.status).toBe('known');
  });
});

describe('classifyTransactions — bulk, audit, idempotent, cross-user', () => {
  it('assign account_id + confirmed + audit; run kedua = skipped (idempoten)', async () => {
    const client = await newDb();
    await seedAccount(client, { id: 'acc-blu', user_id: 'user-a', name: 'blu' });
    await seedTx(client, [tx({ id: 't1', merchant: 'blu' }), tx({ id: 't2', merchant: 'blu' })]);

    const first = await classifyTransactions(client, 'user-a', [
      { transactionId: 't1', accountId: 'acc-blu' },
      { transactionId: 't2', accountId: 'acc-blu' },
    ]);
    expect(first.applied).toBe(2);

    const audit = await client.execute({ sql: 'SELECT COUNT(*) c FROM reconciliation_audit_log', args: [] });
    expect(Number(audit.rows[0].c)).toBe(2);

    const second = await classifyTransactions(client, 'user-a', [
      { transactionId: 't1', accountId: 'acc-blu' },
      { transactionId: 't2', accountId: 'acc-blu' },
    ]);
    expect(second.applied).toBe(0);
    expect(second.skipped).toBe(2);

    const audit2 = await client.execute({ sql: 'SELECT COUNT(*) c FROM reconciliation_audit_log', args: [] });
    expect(Number(audit2.rows[0].c)).toBe(2); // tidak duplikat audit
  });

  it('reassignment mencatat old_account_id; akun user lain ditolak', async () => {
    const client = await newDb();
    await seedAccount(client, { id: 'acc-a', user_id: 'user-a', name: 'A' });
    await seedAccount(client, { id: 'acc-b', user_id: 'user-b', name: 'B' });
    await seedTx(client, [tx({ id: 't1', account_id: 'acc-a' })]);

    const cross = await classifyTransactions(client, 'user-a', [{ transactionId: 't1', accountId: 'acc-b' }]);
    expect(cross.applied).toBe(0); // akun user lain → ditolak

    const ok = await classifyTransactions(client, 'user-a', [{ transactionId: 't1', accountId: 'acc-a' }]);
    expect(ok.applied).toBe(1);
    const audit = await client.execute({ sql: `SELECT action, old_account_id, new_account_id FROM reconciliation_audit_log WHERE transaction_id = 't1'`, args: [] });
    expect(audit.rows[0].action).toBe('account_reassigned');
    expect(audit.rows[0].old_account_id).toBe('acc-a');
  });

  it('P3.1 §21 — confirmed TANPA reassign eksplisit → tetap skip (tidak pernah overwrite diam-diam)', async () => {
    const client = await newDb();
    await seedAccount(client, { id: 'acc-a', user_id: 'user-a', name: 'A' });
    await seedAccount(client, { id: 'acc-b', user_id: 'user-a', name: 'B' });
    await seedTx(client, [tx({ id: 't1', account_id: 'acc-a' })]);
    // Confirm dulu (run pertama assign + confirm).
    await classifyTransactions(client, 'user-a', [{ transactionId: 't1', accountId: 'acc-a' }]);

    // Tanpa flag reassign: akun BEDA → skip (NO-OP), tanpa audit baru.
    const res = await classifyTransactions(client, 'user-a', [{ transactionId: 't1', accountId: 'acc-b' }]);
    expect(res.applied).toBe(0);
    expect(res.skipped).toBe(1);
    const audits = await client.execute({ sql: 'SELECT COUNT(*) c FROM reconciliation_audit_log', args: [] });
    expect(Number(audits.rows[0].c)).toBe(1);
  });

  it('P3.1 §21 — reassign EKSPLISIT: confirmed ke akun beda → applied + audit account_reassigned + old/new', async () => {
    const client = await newDb();
    await seedAccount(client, { id: 'acc-a', user_id: 'user-a', name: 'A' });
    await seedAccount(client, { id: 'acc-b', user_id: 'user-a', name: 'B' });
    // Seed TANPA account (pending) → audit pertama = account_assigned (bersih).
    await seedTx(client, [tx({ id: 't1' })]);
    await classifyTransactions(client, 'user-a', [{ transactionId: 't1', accountId: 'acc-a' }]);

    const res = await classifyTransactions(client, 'user-a', [{ transactionId: 't1', accountId: 'acc-b' }], { reassign: true });
    expect(res.applied).toBe(1);
    expect(res.skipped).toBe(0);
    const row = await client.execute({ sql: 'SELECT account_id FROM transactions WHERE id = ?', args: ['t1'] });
    expect(row.rows[0].account_id).toBe('acc-b');
    // Audit terakhir (rowid = urutan insert) harus reassign old=a → new=b.
    const audits = await client.execute({
      sql: `SELECT action, old_account_id, new_account_id FROM reconciliation_audit_log WHERE transaction_id = 't1' ORDER BY rowid ASC`,
      args: [],
    });
    expect(audits.rows[0].action).toBe('account_assigned');
    expect(audits.rows[0].old_account_id).toBeNull();
    const last = audits.rows[audits.rows.length - 1];
    expect(last.action).toBe('account_reassigned');
    expect(last.old_account_id).toBe('acc-a');
    expect(last.new_account_id).toBe('acc-b');
  });

  it('P3.1 §21 — reassign IDEMPOTEN: confirmed ke akun SAMA → skip tanpa audit duplikat', async () => {
    const client = await newDb();
    await seedAccount(client, { id: 'acc-a', user_id: 'user-a', name: 'A' });
    await seedTx(client, [tx({ id: 't1', account_id: 'acc-a' })]);
    await classifyTransactions(client, 'user-a', [{ transactionId: 't1', accountId: 'acc-a' }]);

    const again = await classifyTransactions(client, 'user-a', [{ transactionId: 't1', accountId: 'acc-a' }], { reassign: true });
    expect(again.applied).toBe(0);
    expect(again.skipped).toBe(1);
    const audits = await client.execute({ sql: 'SELECT COUNT(*) c FROM reconciliation_audit_log', args: [] });
    expect(Number(audits.rows[0].c)).toBe(1); // hanya audit assign pertama
  });

  it('P3.1 §21 — reassign ke akun user LAIN → ditolak (no-op, tanpa audit)', async () => {
    const client = await newDb();
    await seedAccount(client, { id: 'acc-a', user_id: 'user-a', name: 'A' });
    await seedAccount(client, { id: 'acc-other', user_id: 'user-b', name: 'Other' });
    await seedTx(client, [tx({ id: 't1', account_id: 'acc-a' })]);
    await classifyTransactions(client, 'user-a', [{ transactionId: 't1', accountId: 'acc-a' }]);

    const res = await classifyTransactions(client, 'user-a', [{ transactionId: 't1', accountId: 'acc-other' }], { reassign: true });
    expect(res.applied).toBe(0);
    const row = await client.execute({ sql: 'SELECT account_id FROM transactions WHERE id = ?', args: ['t1'] });
    expect(row.rows[0].account_id).toBe('acc-a'); // tidak berubah
  });
});

describe('pairTransfer — konfirmasi pasangan internal', () => {
  it('transfer + income → transfer_group_id + role out/in + audit', async () => {
    const client = await newDb();
    await seedTx(client, [
      tx({ id: 'tr', type: 'transfer', amount: 100000, merchant: 'blu' }),
      tx({ id: 'inc', type: 'income', amount: 100000, merchant: 'blu' }),
    ]);
    const res = await pairTransfer(client, 'user-a', { transferId: 'tr', incomeId: 'inc' });
    expect(res.ok).toBe(true);
    const rows = await client.execute({ sql: `SELECT id, transfer_group_id, metadata FROM transactions WHERE user_id = 'user-a'`, args: [] });
    const byId = Object.fromEntries(rows.rows.map((r) => [r.id, r]));
    expect(JSON.parse(byId.tr.metadata).transferRole).toBe('out');
    expect(JSON.parse(byId.inc.metadata).transferRole).toBe('in');
    expect(byId.tr.transfer_group_id).toBe(byId.inc.transfer_group_id);
    const audit = await client.execute({ sql: `SELECT COUNT(*) c FROM reconciliation_audit_log WHERE action = 'transfer_paired'`, args: [] });
    expect(Number(audit.rows[0].c)).toBe(1);
  });

  it('bukan transfer/income → ditolak (400 semantics)', async () => {
    const client = await newDb();
    await seedTx(client, [tx({ id: 'e1', type: 'expense' }), tx({ id: 'i1', type: 'income' })]);
    const res = await pairTransfer(client, 'user-a', { transferId: 'e1', incomeId: 'i1' });
    expect(res.ok).toBe(false);
  });

  it('P2.8 §35/§36 — IDEMPOTEN: transfer sudah dipasangkan → kembalikan group existing TANPA mutasi/audit baru (double-click / retry / replay)', async () => {
    const client = await newDb();
    await seedTx(client, [
      tx({ id: 'tr', type: 'transfer', amount: 100000, merchant: 'blu' }),
      tx({ id: 'inc', type: 'income', amount: 100000, merchant: 'blu' }),
    ]);
    const first = await pairTransfer(client, 'user-a', { transferId: 'tr', incomeId: 'inc' });
    expect(first.ok).toBe(true);
    expect(first.idempotent).toBeUndefined();

    const second = await pairTransfer(client, 'user-a', { transferId: 'tr', incomeId: 'inc' });
    expect(second.ok).toBe(true);
    expect(second.transferGroupId).toBe(first.transferGroupId);
    expect(second.idempotent).toBe(true);

    // Tidak ada group kedua / audit duplikat.
    const groups = await client.execute({ sql: 'SELECT DISTINCT transfer_group_id FROM transactions WHERE transfer_group_id IS NOT NULL', args: [] });
    expect(groups.rows).toHaveLength(1);
    const audits = await client.execute({ sql: "SELECT COUNT(*) c FROM reconciliation_audit_log WHERE action = 'transfer_paired'", args: [] });
    expect(Number(audits.rows[0].c)).toBe(1);
  });
});

describe('rejectBySuggestion / rejectTransactions — P2.8 §13 [Abaikan]', () => {
  it('tolak saran kelompok: pending yang cocok persis → rejected + audit; idempoten; transaksi lain tidak tersentuh', async () => {
    const client = await newDb();
    await seedAccount(client, { id: 'acc-blu', user_id: 'user-a', name: 'blu' });
    await seedTx(client, [
      tx({ id: 't1', merchant: 'blu', amount: 50000 }),
      tx({ id: 't2', merchant: 'BLU', amount: 90000 }),
      tx({ id: 't3', merchant: 'Shopee', amount: 20000 }),
    ]);

    const res = await rejectBySuggestion(client, 'user-a', { accountId: 'acc-blu', confidence: 'high' });
    expect(res.rejected).toBe(2);
    expect(res.skipped).toBe(0);

    const rows = await client.execute({ sql: 'SELECT id, account_review_status, account_id FROM transactions ORDER BY id', args: [] });
    const byId = Object.fromEntries(rows.rows.map((r) => [r.id, r]));
    expect(byId.t1.account_review_status).toBe('rejected');
    expect(byId.t1.account_id).toBeNull(); // TIDAK di-assign, hanya ditandai
    expect(byId.t2.account_review_status).toBe('rejected');
    expect(byId.t3.account_review_status).toBe('pending'); // saran beda → tak tersentuh

    const audit = await client.execute({ sql: "SELECT COUNT(*) c FROM reconciliation_audit_log WHERE action = 'account_rejected'", args: [] });
    expect(Number(audit.rows[0].c)).toBe(2);

    // Idempoten: run kedua → no-op (sudah rejected, tidak lagi pending),
    // tanpa audit duplikat.
    const again = await rejectBySuggestion(client, 'user-a', { accountId: 'acc-blu', confidence: 'high' });
    expect(again.rejected).toBe(0);
    expect(again.skipped).toBe(0);
    const audit2 = await client.execute({ sql: "SELECT COUNT(*) c FROM reconciliation_audit_log WHERE action = 'account_rejected'", args: [] });
    expect(Number(audit2.rows[0].c)).toBe(2);
  });

  it('transaksi CONFIRMED tidak pernah ditolak (skipped)', async () => {
    const client = await newDb();
    await seedAccount(client, { id: 'acc-blu', user_id: 'user-a', name: 'blu' });
    await seedTx(client, [tx({ id: 't1', merchant: 'blu', account_id: 'acc-blu', account_review_status: 'confirmed' })]);
    const res = await rejectBySuggestion(client, 'user-a', { accountId: 'acc-blu', confidence: 'high' });
    expect(res.rejected).toBe(0);
    const row = await client.execute({ sql: 'SELECT account_review_status FROM transactions WHERE id = ?', args: ['t1'] });
    expect(row.rows[0].account_review_status).toBe('confirmed');
  });

  it('cross-user: transaksi user lain tidak ditemukan → no-op', async () => {
    const client = await newDb();
    await seedTx(client, [tx({ id: 't1', merchant: 'blu', user_id: 'user-b' })]);
    const res = await rejectTransactions(client, 'user-a', ['t1']);
    expect(res.rejected).toBe(0);
  });
});

describe('rejectTransferCandidate — P2.8 §17 [Reject]', () => {
  it('set transfer_review_status=rejected + audit; idempoten; TETAP ungrouped', async () => {
    const client = await newDb();
    await seedTx(client, [tx({ id: 'tr', type: 'transfer', amount: 100000, merchant: 'blu' })]);
    const res = await rejectTransferCandidate(client, 'user-a', { transferId: 'tr' });
    expect(res.ok).toBe(true);
    expect(res.alreadyRejected).toBe(false);
    const row = await client.execute({ sql: 'SELECT transfer_review_status, transfer_group_id FROM transactions WHERE id = ?', args: ['tr'] });
    expect(row.rows[0].transfer_review_status).toBe('rejected');
    expect(row.rows[0].transfer_group_id).toBeNull(); // tetap unresolved — jujur
    const audit = await client.execute({ sql: "SELECT COUNT(*) c FROM reconciliation_audit_log WHERE action = 'transfer_rejected'", args: [] });
    expect(Number(audit.rows[0].c)).toBe(1);

    const again = await rejectTransferCandidate(client, 'user-a', { transferId: 'tr' });
    expect(again.ok).toBe(true);
    expect(again.alreadyRejected).toBe(true);
    const audit2 = await client.execute({ sql: "SELECT COUNT(*) c FROM reconciliation_audit_log WHERE action = 'transfer_rejected'", args: [] });
    expect(Number(audit2.rows[0].c)).toBe(1); // tidak duplikat audit
  });

  it('bukan transfer / transfer user lain → ditolak', async () => {
    const client = await newDb();
    await seedTx(client, [
      tx({ id: 'e1', type: 'expense', amount: 100 }),
      tx({ id: 'tr2', type: 'transfer', amount: 100, user_id: 'user-b' }),
    ]);
    const notTransfer = await rejectTransferCandidate(client, 'user-a', { transferId: 'e1' });
    expect(notTransfer.ok).toBe(false);
    const crossUser = await rejectTransferCandidate(client, 'user-a', { transferId: 'tr2' });
    expect(crossUser.ok).toBe(false);
  });
});

describe('verifyAccountBalance — verified vs mismatch (tanpa auto-fix)', () => {
  async function setup(client) {
    await seedAccount(client, { id: 'acc-a', user_id: 'user-a', name: 'blu', opening_balance: 1000000, opening_balance_date: '2026-01-01' });
    await seedTx(client, [tx({ id: 't1', type: 'income', amount: 500000, account_id: 'acc-a' })]);
  }

  it('actual == system → status verified, diff 0', async () => {
    const client = await newDb();
    await setup(client);
    const res = await verifyAccountBalance(client, 'user-a', { accountId: 'acc-a', actualBalance: 1500000, date: '2026-08-11' });
    expect(res.ok).toBe(true);
    expect(res.systemBalance).toBe(1500000);
    expect(res.status).toBe('verified');
    expect(res.difference).toBe(0);
    const audit = await client.execute({ sql: `SELECT COUNT(*) c FROM reconciliation_audit_log WHERE action = 'balance_anchor_created'`, args: [] });
    expect(Number(audit.rows[0].c)).toBe(1);
    // balance_anchor_status tersimpan 'verified' + anchor date.
    const row = await client.execute({ sql: 'SELECT balance_anchor_status, real_balance_date FROM wallet_accounts WHERE id = ?', args: ['acc-a'] });
    expect(row.rows[0].balance_anchor_status).toBe('verified');
    expect(row.rows[0].real_balance_date).toBe('2026-08-11');
  });

  it('actual != system → status mismatch (anchor tetap tersimpan, TANPA auto-fix)', async () => {
    const client = await newDb();
    await setup(client);
    const res = await verifyAccountBalance(client, 'user-a', { accountId: 'acc-a', actualBalance: 1300000, date: '2026-08-11' });
    expect(res.status).toBe('mismatch');
    expect(res.difference).toBe(-200000);
    // Anchor = KEBENARAN USER tetap tersimpan (REAL MONEY > derived), status
    // mismatch dicatat untuk review — bukan ditolak.
    const row = await client.execute({ sql: 'SELECT balance_anchor_status FROM wallet_accounts WHERE id = ?', args: ['acc-a'] });
    expect(row.rows[0].balance_anchor_status).toBe('mismatch');
    const audit = await client.execute({ sql: `SELECT COUNT(*) c FROM reconciliation_audit_log WHERE action = 'balance_anchor_created'`, args: [] });
    expect(Number(audit.rows[0].c)).toBe(1);
    // Tidak ada transaksi adjustment dibuat.
    const txCount = await client.execute({ sql: 'SELECT COUNT(*) c FROM transactions', args: [] });
    expect(Number(txCount.rows[0].c)).toBe(1);
  });

  it('tanpa baseline (no opening, no anchor) → anchor DITERIMA sebagai kebenaran user (no_baseline)', async () => {
    const client = await newDb();
    // P2.7 §3: user TIDAK dipaksa tahu saldo historis — anchor cukup.
    await seedAccount(client, { id: 'acc-a', user_id: 'user-a', name: 'blu' });
    const res = await verifyAccountBalance(client, 'user-a', { accountId: 'acc-a', actualBalance: 2500000, date: '2026-08-11' });
    expect(res.ok).toBe(true);
    expect(res.systemBalance).toBeNull();
    expect(res.difference).toBeNull();
    expect(res.status).toBe('verified');
    const row = await client.execute({ sql: 'SELECT balance_anchor_status FROM wallet_accounts WHERE id = ?', args: ['acc-a'] });
    expect(row.rows[0].balance_anchor_status).toBe('verified');
  });

  it('update anchor → audit balance_anchor_updated dengan nominal lama', async () => {
    const client = await newDb();
    await seedAccount(client, { id: 'acc-a', user_id: 'user-a', name: 'blu' });
    await verifyAccountBalance(client, 'user-a', { accountId: 'acc-a', actualBalance: 3000000, date: '2026-08-11' });
    await verifyAccountBalance(client, 'user-a', { accountId: 'acc-a', actualBalance: 3500000, date: '2026-08-12' });
    const audit = await client.execute({ sql: `SELECT action, reason FROM reconciliation_audit_log ORDER BY created_at`, args: [] });
    expect(audit.rows.map((r) => r.action)).toEqual(['balance_anchor_created', 'balance_anchor_updated']);
    expect(audit.rows[1].reason).toContain('actual=3500000');
  });

  it('akun user lain / tidak ada akun → ditolak', async () => {
    const client = await newDb();
    await seedAccount(client, { id: 'acc-b', user_id: 'user-b', name: 'B', opening_balance: 100, opening_balance_date: '2026-01-01' });
    const other = await verifyAccountBalance(client, 'user-a', { accountId: 'acc-b', actualBalance: 100 });
    expect(other.ok).toBe(false);
    const noAccount = await verifyAccountBalance(client, 'user-a', { accountId: 'nope', actualBalance: 100 });
    expect(noAccount.ok).toBe(false);
  });
});

describe('suggestTransferPairs — min-pair 1:1', () => {
  it('1 transfer + 2 income (same date/amount) → HANYA 1 pasangan (min-pair, deterministik)', () => {
    const transfers = [{ id: 'tr-1', transaction_date: '2026-08-01', amount: 100000, merchant: 'blu' }];
    const incomes = [
      { id: 'in-a', transaction_date: '2026-08-01', amount: 100000, merchant: 'blu' },
      { id: 'in-b', transaction_date: '2026-08-01', amount: 100000, merchant: 'blu' },
    ];
    const pairs = suggestTransferPairs(transfers, incomes);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].incomeId).toBe('in-a'); // id ASC deterministik
    expect(pairs[0].confidence).toBe('high');
  });

  it('beda tanggal / beda nominal → tidak dipasangkan', () => {
    const transfers = [{ id: 'tr-1', transaction_date: '2026-08-01', amount: 100000, merchant: 'blu' }];
    const incomes = [
      { id: 'in-a', transaction_date: '2026-08-02', amount: 100000, merchant: 'blu' },
      { id: 'in-b', transaction_date: '2026-08-01', amount: 99000, merchant: 'blu' },
    ];
    expect(suggestTransferPairs(transfers, incomes)).toHaveLength(0);
  });

  it('merchant berbeda → confidence medium (butuh review)', () => {
    const transfers = [{ id: 'tr-1', transaction_date: '2026-08-01', amount: 100000, merchant: 'LINE Bank' }];
    const incomes = [{ id: 'in-a', transaction_date: '2026-08-01', amount: 100000, merchant: 'blu' }];
    const pairs = suggestTransferPairs(transfers, incomes);
    expect(pairs[0].confidence).toBe('medium');
    expect(pairs[0].requiresReview).toBe(true);
  });
});

describe('classifyBySuggestion — bulk berbasis saran (deterministik, idempoten)', () => {
  it('HANYA transaksi dengan suggestion cocok persis yang diklasifikasi', async () => {
    const client = await newDb();
    await seedAccount(client, { id: 'acc-blu', user_id: 'user-a', name: 'blu' });
    await seedTx(client, [
      tx({ id: 't1', merchant: 'blu', amount: 50000 }),       // HIGH → acc-blu
      tx({ id: 't2', merchant: 'BLU', amount: 90000 }),        // HIGH (normalisasi) → acc-blu
      tx({ id: 't3', merchant: 'Shopee', amount: 20000 }),     // LOW → tidak tersentuh
    ]);

    const res = await classifyBySuggestion(client, 'user-a', { accountId: 'acc-blu', confidence: 'high' });
    expect(res.applied).toBe(2);
    expect(res.skipped).toBe(0);

    const rows = await client.execute({ sql: 'SELECT id, account_id FROM transactions ORDER BY id', args: [] });
    const byId = Object.fromEntries(rows.rows.map((r) => [r.id, r.account_id]));
    expect(byId.t1).toBe('acc-blu');
    expect(byId.t2).toBe('acc-blu');
    expect(byId.t3).toBeNull(); // LOW tidak di-assign

    // Idempoten: run kedua → no-op, tanpa duplikat audit.
    const again = await classifyBySuggestion(client, 'user-a', { accountId: 'acc-blu', confidence: 'high' });
    expect(again.applied).toBe(0);
    const audit = await client.execute({ sql: 'SELECT COUNT(*) c FROM reconciliation_audit_log', args: [] });
    expect(Number(audit.rows[0].c)).toBe(2);
  });

  it('akun user lain / accountId kosong → no-op', async () => {
    const client = await newDb();
    await seedTx(client, [tx({ id: 't1', merchant: 'blu' })]);
    const res = await classifyBySuggestion(client, 'user-a', { accountId: 'acc-lain', confidence: 'high' });
    expect(res.applied).toBe(0);
  });
});

describe('buildReconciliationSummary — ringkasan ringan (counts + status)', () => {
  it('unknown tanpa akun; partial dengan unclassified; counts benar', async () => {
    const client = await newDb();
    await seedTx(client, [
      tx({ id: 't1' }),
      tx({ id: 't2', type: 'transfer', amount: 50000 }),
    ]);
    const s1 = await buildReconciliationSummary(client, 'user-a');
    expect(s1.accounts).toBe(0);
    expect(s1.status).toBe('unknown');
    expect(s1.transactions.total).toBe(2);
    expect(s1.transactions.unclassified).toBe(2);
    expect(s1.transfers.unresolved).toBe(1);

    await seedAccount(client, { id: 'acc-a', user_id: 'user-a', name: 'A', opening_balance: 1000000, opening_balance_date: '2026-01-01' });
    const s2 = await buildReconciliationSummary(client, 'user-a');
    expect(s2.accounts).toBe(1);
    expect(s2.openingBalancesConfigured).toBe(1);
    expect(s2.status).toBe('partial'); // masih ada unclassified
  });

  it('reconciled saat semua terhubung; verified saat semua akun diverifikasi', async () => {
    const client = await newDb();
    await seedAccount(client, {
      id: 'acc-a', user_id: 'user-a', name: 'A', opening_balance: 1000000, opening_balance_date: '2026-01-01',
      real_balance: 1500000, real_balance_date: '2026-08-11', real_balance_verified_at: '2026-08-11',
    });
    await seedTx(client, [tx({ id: 't1', type: 'income', amount: 500000, account_id: 'acc-a' })]);
    const s = await buildReconciliationSummary(client, 'user-a');
    expect(s.status).toBe('verified');
    expect(s.balanceConfidence).toBe('verified');
    expect(s.transactions.unclassified).toBe(0);
  });
});

describe('reconciliationStatus — rule deterministik (P2.6 §6 + P2.7 anchor-aware)', () => {
  const acc = (opening, anchor = null) => ({ verificationStatus: anchor ? 'verified' : 'not_verified', openingBalance: opening });
  it('unknown: tanpa akun / tanpa opening / tanpa anchor sama sekali', () => {
    expect(reconciliationStatus({ accounts: [], openingConfigured: 0, anchoredCount: 0, unclassifiedCount: 0, unresolvedTransfers: 0 })).toBe('unknown');
    expect(reconciliationStatus({ accounts: [acc(null), acc(5)], openingConfigured: 1, anchoredCount: 0, unclassifiedCount: 0, unresolvedTransfers: 0 })).toBe('partial');
    expect(reconciliationStatus({ accounts: [acc(null)], openingConfigured: 0, anchoredCount: 0, unclassifiedCount: 0, unresolvedTransfers: 0 })).toBe('unknown');
  });
  it('partial: basis tidak lengkap / unclassified / unresolved', () => {
    expect(reconciliationStatus({ accounts: [acc(1)], openingConfigured: 1, anchoredCount: 0, unclassifiedCount: 2, unresolvedTransfers: 0 })).toBe('partial');
    expect(reconciliationStatus({ accounts: [acc(1)], openingConfigured: 1, anchoredCount: 0, unclassifiedCount: 0, unresolvedTransfers: 1 })).toBe('partial');
  });
  it('reconciled (opening penuh) vs verified (semua anchor)', () => {
    expect(reconciliationStatus({ accounts: [acc(1)], openingConfigured: 1, anchoredCount: 0, unclassifiedCount: 0, unresolvedTransfers: 0 })).toBe('reconciled');
    expect(reconciliationStatus({
      accounts: [{ verificationStatus: 'verified', openingBalance: null }],
      openingConfigured: 0,
      anchoredCount: 1,
      unclassifiedCount: 0,
      unresolvedTransfers: 0,
    })).toBe('verified');
  });
});

describe('buildReconciliationState — matriks + onboarding progress', () => {
  it('state lengkap: coverage, suggestions, confidence, resume', async () => {
    const client = await newDb();
    await seedAccount(client, { id: 'acc-blu', user_id: 'user-a', name: 'blu', opening_balance: 1000000, opening_balance_date: '2026-01-01' });
    await seedTx(client, [
      tx({ id: 't1', merchant: 'blu', amount: 50000 }),
      tx({ id: 't2', merchant: 'Shopee', amount: 90000 }),
      tx({ id: 't3', merchant: 'blu', amount: 20000 }),
    ]);
    await client.execute({
      sql: `INSERT INTO user_financial_settings (user_id, own_accounts) VALUES (?, ?)`,
      args: ['user-a', JSON.stringify(['LINE Bank', 'blu', 'Bank Jago'])],
    });

    const state = await buildReconciliationState(client, 'user-a');
    expect(state.transactions.total).toBe(3);
    expect(state.transactions.linked).toBe(0);
    expect(state.transactions.unlinked).toBe(3);
    expect(state.dateCoverage.earliest).toBe('2026-08-01');
    // 2× blu → saran HIGH (akun sudah ada); 1× Shopee → LOW.
    const bluSuggestion = state.suggestions.find((s) => s.accountName === 'blu');
    expect(bluSuggestion.count).toBe(2);
    expect(bluSuggestion.totalAmount).toBe(70000);
    expect(state.balanceConfidence).toBe('medium'); // ada unclassified
    expect(state.onboardingProgress.accountsConfigured).toBe(true);
    expect(state.onboardingProgress.transactionsReconciled).toBe(false);
    expect(state.onboardingProgress.totalSteps).toBe(5);
  });

  it('tanpa akun → confidence unknown, progress 0', async () => {
    const client = await newDb();
    await seedTx(client, [tx({ id: 't1' })]);
    const state = await buildReconciliationState(client, 'user-a');
    expect(state.balanceConfidence).toBe('unknown');
    expect(state.onboardingProgress.completedSteps).toBe(0);
  });

  it('P2.8 §4 — accountCandidates = own_accounts yang BELUM dibuat sebagai rekening', async () => {
    const client = await newDb();
    await seedAccount(client, { id: 'acc-blu', user_id: 'user-a', name: 'blu' });
    await client.execute({
      sql: `INSERT INTO user_financial_settings (user_id, own_accounts) VALUES (?, ?)`,
      args: ['user-a', JSON.stringify(['LINE Bank', 'blu', 'Bank Jago', 'DANA'])],
    });
    const state = await buildReconciliationState(client, 'user-a');
    // blu sudah dibuat → tidak muncul; sisanya kandidat aktivasi.
    expect(state.accountCandidates).toEqual(['LINE Bank', 'Bank Jago', 'DANA']);
  });

  it('P2.8 §17 — transfer yang ditolak TIDAK disarankan ulang (tetap dihitung ungrouped)', async () => {
    const client = await newDb();
    await seedTx(client, [
      tx({ id: 'tr', type: 'transfer', amount: 100000, merchant: 'blu' }),
      tx({ id: 'inc', type: 'income', amount: 100000, merchant: 'blu' }),
    ]);
    // Sebelum ditolak → 1 kandidat.
    const before = await buildReconciliationState(client, 'user-a');
    expect(before.transferPairSuggestions).toHaveLength(1);
    expect(before.transfers.ungrouped).toBe(1);

    await rejectTransferCandidate(client, 'user-a', { transferId: 'tr' });
    const after = await buildReconciliationState(client, 'user-a');
    expect(after.transferPairSuggestions).toHaveLength(0); // tidak disarankan ulang
    expect(after.transfers.ungrouped).toBe(1); // tetap unresolved — jujur
  });
});

describe('P2.9 §28 — completionScore (deterministik dari state, bukan klik user)', () => {
  it('tanpa data → 0; data lengkap → 100', () => {
    const empty = completionScore({
      accounts: [], accountCandidates: [], anchoredCount: 0, unclassifiedCount: 0,
      unresolvedTransfers: 0, totalTransactions: 0, totalTransfers: 0,
    });
    expect(empty.score).toBe(0);
    const full = completionScore({
      accounts: [{ id: 'a' }], accountCandidates: ['X'], anchoredCount: 1, unclassifiedCount: 0,
      unresolvedTransfers: 0, totalTransactions: 10, totalTransfers: 5,
    });
    // akun 1/2×20% (10) + anchor 1/1×20% (20) + tx 10/10×35% (35) + transfer 5/5×25% (25) = 90
    expect(full.score).toBe(90);
  });

  it('PARTIAL — sebagian lengkap → skor parsial (bobot jujur)', () => {
    const s = completionScore({
      accounts: [{ id: 'a' }, { id: 'b' }], accountCandidates: [], anchoredCount: 1,
      unclassifiedCount: 2, unresolvedTransfers: 1, totalTransactions: 10, totalTransfers: 5,
    });
    // akun 2/2 (0.2) + anchor 1/2 (0.1) + tx 8/10 (0.28) + tr 4/5 (0.2) = 0.78
    expect(s.score).toBe(78);
    expect(s.accounts.activated).toBe(2);
    expect(s.anchors.anchored).toBe(1);
    expect(s.transfers.resolved).toBe(4);
  });
});

describe('P2.9 §12/§27 — unassignedTransactions (LOW) + transfers.rejected di state', () => {
  it('transaksi LOW di-expose untuk assign manual; transfer ditolak dihitung rejected', async () => {
    const client = await newDb();
    await seedAccount(client, { id: 'acc-blu', user_id: 'user-a', name: 'blu' });
    await seedTx(client, [
      tx({ id: 'low1', merchant: 'Merchant Acak', amount: 45000 }),
      tx({ id: 'low2', merchant: 'Lainnya', amount: 20000 }),
    ]);
    const state = await buildReconciliationState(client, 'user-a');
    expect(state.unassignedTransactions).toHaveLength(2);
    expect(state.unassignedTransactions[0]).toMatchObject({ id: 'low1', amount: 45000 });
    expect(state.unassignedTransactions[0]).toHaveProperty('merchant');
    expect(state.unassignedTransactions[0]).toHaveProperty('date');
    expect(state.transactions.rejected).toBe(0);

    await seedTx(client, [tx({ id: 'tr', type: 'transfer', amount: 50000, merchant: 'blu' })]);
    await rejectTransferCandidate(client, 'user-a', { transferId: 'tr' });
    const after = await buildReconciliationState(client, 'user-a');
    expect(after.transfers.rejected).toBe(1);
    expect(after.transfers.ungrouped).toBe(1); // tetap unresolved — jujur
  });

  it('P3.0 §12 — unassignedTransactions membawa `type` (filter UI All/Income/Expense/Refund)', async () => {
    const client = await newDb();
    await seedAccount(client, { id: 'acc-blu', user_id: 'user-a', name: 'blu' });
    await seedTx(client, [
      tx({ id: 'low-inc', merchant: 'Acak Masuk', amount: 50000, type: 'income' }),
      tx({ id: 'low-exp', merchant: 'Acak Keluar', amount: 30000, type: 'expense' }),
      tx({ id: 'low-ref', merchant: 'Acak Refund', amount: 10000, type: 'refund' }),
      // Transfer tetap TIDAK masuk daftar (jalur resolusi = pairing, bukan assign).
      tx({ id: 'low-tr', merchant: 'Transfer X', amount: 20000, type: 'transfer' }),
    ]);
    const state = await buildReconciliationState(client, 'user-a');
    expect(state.unassignedTransactions).toHaveLength(3);
    const byId = Object.fromEntries(state.unassignedTransactions.map((t) => [t.id, t]));
    expect(byId['low-inc']).toMatchObject({ type: 'income' });
    expect(byId['low-exp']).toMatchObject({ type: 'expense' });
    expect(byId['low-ref']).toMatchObject({ type: 'refund' });
    expect(byId['low-tr']).toBeUndefined();
  });
});

describe('P2.9 §19 — kebijakan saldo aktual negatif', () => {
  it('negatif ditolak untuk bank; diizinkan untuk credit (tanpa auto-fix)', async () => {
    const client = await newDb();
    await seedAccount(client, { id: 'acc-bank', user_id: 'user-a', name: 'Bank', type: 'bank' });
    const bad = await verifyAccountBalance(client, 'user-a', { accountId: 'acc-bank', actualBalance: -500000, date: '2026-08-11' });
    expect(bad.ok).toBe(false);
    expect(bad.reason).toContain('credit/investment');

    await seedAccount(client, { id: 'acc-cc', user_id: 'user-a', name: 'Kartu', type: 'credit' });
    const good = await verifyAccountBalance(client, 'user-a', { accountId: 'acc-cc', actualBalance: -250000, date: '2026-08-11' });
    expect(good.ok).toBe(true);
    expect(good.status).toBe('verified');
  });
});

describe('P2.9 §50 — real-world 3-account reconciliation (anchor + post-anchor)', () => {
  it('Bank A 5jt / Bank B 3jt / E-wallet C 1jt + post-anchor → 3.5jt / 3.75jt / 1.35jt, total 8.6jt', async () => {
    const client = await newDb();
    for (const a of [
      { id: 'acc-a', user_id: 'user-a', name: 'Bank A', type: 'bank', real_balance: 5000000, real_balance_date: '2026-08-10', balance_anchor_status: 'verified' },
      { id: 'acc-b', user_id: 'user-a', name: 'Bank B', type: 'bank', real_balance: 3000000, real_balance_date: '2026-08-10', balance_anchor_status: 'verified' },
      { id: 'acc-c', user_id: 'user-a', name: 'E-wallet C', type: 'e-wallet', real_balance: 1000000, real_balance_date: '2026-08-10', balance_anchor_status: 'verified' },
    ]) {
      await seedAccount(client, a);
    }
    await seedTx(client, [
      // Sama hari dengan anchor (10 Aug) → TIDAK dihitung ulang (END-of-day §6).
      tx({ id: 'same-day', type: 'expense', amount: 777777, account_id: 'acc-a', date: '2026-08-10', transaction_date: '2026-08-10', merchant: 'Termasuk anchor' }),
      // Post-anchor (11–14 Aug) → dihitung.
      tx({ id: 'exp-a', type: 'expense', amount: 500000, account_id: 'acc-a', date: '2026-08-11', transaction_date: '2026-08-11', merchant: 'Toko' }),
      tx({ id: 'tr-ab-out', type: 'transfer', amount: 1000000, account_id: 'acc-a', transfer_group_id: 'g1', metadata: { transferRole: 'out' }, date: '2026-08-12', transaction_date: '2026-08-12', merchant: 'Transfer' }),
      tx({ id: 'tr-ab-in', type: 'transfer', amount: 1000000, account_id: 'acc-b', transfer_group_id: 'g1', metadata: { transferRole: 'in' }, date: '2026-08-12', transaction_date: '2026-08-12', merchant: 'Transfer' }),
      tx({ id: 'tr-bc-out', type: 'transfer', amount: 250000, account_id: 'acc-b', transfer_group_id: 'g2', metadata: { transferRole: 'out' }, date: '2026-08-13', transaction_date: '2026-08-13', merchant: 'Transfer' }),
      tx({ id: 'tr-bc-in', type: 'transfer', amount: 250000, account_id: 'acc-c', transfer_group_id: 'g2', metadata: { transferRole: 'in' }, date: '2026-08-13', transaction_date: '2026-08-13', merchant: 'Transfer' }),
      tx({ id: 'refund-c', type: 'refund', amount: 100000, account_id: 'acc-c', date: '2026-08-14', transaction_date: '2026-08-14', merchant: 'Merchant' }),
    ]);
    const ledger = await computeAccountLedger(client, 'user-a');
    const byName = Object.fromEntries(ledger.accounts.map((a) => [a.name, a.closingBalance]));
    expect(byName['Bank A']).toBe(3500000);      // 5jt − 500k − 1jt (same-day TIDAK dihitung)
    expect(byName['Bank B']).toBe(3750000);      // 3jt + 1jt − 250k
    expect(byName['E-wallet C']).toBe(1350000);  // 1jt + 250k + 100k
    expect(ledger.currentBalance.amount).toBe(8600000); // transfer internal netral di aggregate
    expect(ledger.currentBalance.status).toBe('verified');
  });
});

describe('P3.1 §32 — GOLDEN TEST: anchor 3jt + post-anchor → 3.5jt (SQL oracle == ledger == verify)', () => {
  it('fixture §32: income +500k, expense −100k, transfer-out −150k, transfer-in +200k, refund +50k', async () => {
    const client = await newDb();
    await seedAccount(client, {
      id: 'acc-a', user_id: 'user-a', name: 'Bank A', type: 'bank',
      real_balance: 3000000, real_balance_date: '2026-08-10', balance_anchor_status: 'verified',
    });
    // Post-anchor (11 Aug, > anchor 10 Aug END-of-day) → semua dihitung.
    await seedTx(client, [
      tx({ id: 'inc', type: 'income', amount: 500000, account_id: 'acc-a', date: '2026-08-11', transaction_date: '2026-08-11', merchant: 'Gaji' }),
      tx({ id: 'exp', type: 'expense', amount: 100000, account_id: 'acc-a', date: '2026-08-11', transaction_date: '2026-08-11', merchant: 'Toko' }),
      tx({ id: 'tr-out', type: 'transfer', amount: 150000, account_id: 'acc-a', transfer_group_id: 'g1', metadata: { transferRole: 'out' }, date: '2026-08-11', transaction_date: '2026-08-11', merchant: 'Transfer' }),
      tx({ id: 'tr-in', type: 'transfer', amount: 200000, account_id: 'acc-a', transfer_group_id: 'g2', metadata: { transferRole: 'in' }, date: '2026-08-11', transaction_date: '2026-08-11', merchant: 'Transfer' }),
      tx({ id: 'ref', type: 'refund', amount: 50000, account_id: 'acc-a', date: '2026-08-11', transaction_date: '2026-08-11', merchant: 'Refund' }),
    ]);

    // ── SQL ORACLE (INDEPENDEN — tidak memanggil financialLedger/engine) ──
    const oracle = await client.execute({
      sql: `SELECT
              3000000
              + COALESCE(SUM(CASE WHEN t.type IN ('income','refund') THEN t.amount ELSE 0 END), 0)
              + COALESCE(SUM(CASE WHEN t.type = 'transfer' AND json_extract(t.metadata, '$.transferRole') = 'in' THEN t.amount ELSE 0 END), 0)
              - COALESCE(SUM(CASE WHEN t.type = 'expense' THEN t.amount ELSE 0 END), 0)
              - COALESCE(SUM(CASE WHEN t.type = 'transfer' AND json_extract(t.metadata, '$.transferRole') = 'out' THEN t.amount ELSE 0 END), 0)
              AS expected
            FROM transactions t
            WHERE t.user_id = 'user-a' AND t.account_id = 'acc-a' AND t.transaction_date > '2026-08-10'`,
      args: [],
    });
    const oracleBalance = Math.round(Number(oracle.rows[0].expected));
    expect(oracleBalance).toBe(3500000); // 3jt + 500k + 200k + 50k − 100k − 150k

    // ── LEDGER (engine canonical) ──
    const ledger = await computeAccountLedger(client, 'user-a');
    const acct = ledger.accounts.find((a) => a.id === 'acc-a');
    expect(acct.closingBalance).toBe(3500000);
    expect(ledger.currentBalance.status).toBe('verified');
    expect(ledger.currentBalance.amount).toBe(3500000);
    // Net Cash Flow TETAP TERPISAH (Skr A legacy: income + refund − expense
    // − SEMUA transfer dihitung expense ketika ownAccounts kosong):
    // (500k + 50k) − (100k + 150k + 200k) = 100k — BUKAN 3.5jt (invariant §15).
    const summary = await computeLedgerSummary(client, 'user-a', { ownAccounts: [] });
    expect(summary.netCashFlow.amount).toBe(100000);

    // ── VERIFY (actual == system) → VERIFIED, diff 0 ──
    const res = await verifyAccountBalance(client, 'user-a', { accountId: 'acc-a', actualBalance: 3500000, date: '2026-08-11' });
    expect(res.ok).toBe(true);
    expect(res.status).toBe('verified');
    expect(res.difference).toBe(0);
    expect(res.systemBalance).toBe(3500000);
    // Waterfall breakdown tersedia (P3.1 §19).
    expect(res.breakdown).toBeDefined();
    // inflow = income + refund (500k + 50k); expense = 100k; transfers by role.
    expect(res.breakdown.postAnchorMovements).toMatchObject({ inflow: 550000, expense: 100000, outgoingTransfer: 150000, incomingTransfer: 200000 });

    // ── MISMATCH (§34): actual 3.450.000 → diff −50.000, tanpa auto-fix ──
    const mismatch = await verifyAccountBalance(client, 'user-a', { accountId: 'acc-a', actualBalance: 3450000, date: '2026-08-11' });
    expect(mismatch.ok).toBe(true);
    expect(mismatch.status).toBe('mismatch');
    expect(mismatch.difference).toBe(-50000);
    expect(mismatch.systemBalance).toBe(3500000); // sistem TIDAK diubah
  });
});
