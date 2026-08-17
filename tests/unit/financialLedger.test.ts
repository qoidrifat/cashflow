/**
 * P2.5 — ACCOUNT-BASED LEDGER (server/lib/financialLedger.js).
 *
 * Database libsql FILE lokal nyata (pola financialSummaryReconciliation.test.ts)
 * — TANPA mock, TANPA jaringan, TANPA Turso remote. Setiap skenario mengunci
 * invariant yang membedakan Current Balance dari Net Cash Flow:
 *
 *   current_balance = opening_balance + inflow − expense − outgoing + incoming
 *   internal transfer (dua leg, owned accounts) → net 0 pada aggregate
 *   external transfer (leg tunggal) → mengurangi balance
 *   status jujur: known | partial | unknown (TIDAK pernah menebak 0)
 *   transaksi tanpa account_id → unclassified (account_id NULL), partial
 *   opening_balance_date: transaksi >= tanggal tsb MASUK (start-of-day)
 *   user isolation + cross-user account attribution
 *   WINDOWLESS: agregasi seluruh baris (55+ baris → tetap penuh)
 */
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createClient } from '@libsql/client';
import {
  computeAccountLedger,
  computeLedgerSummary,
  classifyTransferLegs,
  parseTransactionMetadata,
} from '../../server/lib/financialLedger.js';

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
  gmail_message_id TEXT,
  metadata TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  account_id TEXT,
  transfer_group_id TEXT
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
`;

const clients = [];
const dbs = [];

async function newDb() {
  const dbPath = path
    .join(os.tmpdir(), `cf-ledger-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`)
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
            (id, user_id, type, amount, category_id, category_name, merchant, date, transaction_date, metadata, account_id, transfer_group_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        r.id,
        r.user_id,
        r.type,
        r.amount,
        r.category_id,
        r.category_name,
        r.merchant ?? '',
        r.date,
        r.transaction_date,
        JSON.stringify(r.metadata ?? {}),
        r.account_id ?? null,
        r.transfer_group_id ?? null,
      ],
    });
  }
}

async function seedAccount(client, row) {
  await client.execute({
    sql: `INSERT INTO wallet_accounts (id, user_id, name, type, opening_balance, opening_balance_date, currency, archived,
             real_balance, real_balance_date, real_balance_verified_at, balance_anchor_status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      row.id,
      row.user_id,
      row.name,
      row.type ?? 'bank',
      row.opening_balance ?? null,
      row.opening_balance_date ?? null,
      row.currency ?? 'IDR',
      row.archived ?? 0,
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

describe('financialLedger — status & opening balance', () => {
  it('tanpa akun → currentBalance unknown (reason no_accounts), BUKAN Rp0', async () => {
    const client = await newDb();
    await seedTx(client, [tx({ id: 't1', type: 'income', amount: 5000 })]);
    const ledger = await computeAccountLedger(client, 'user-a');
    expect(ledger.currentBalance.status).toBe('unknown');
    expect(ledger.currentBalance.reason).toBe('no_accounts');
    expect(ledger.currentBalance.amount).toBeNull();
    expect(ledger.accounts).toEqual([]);
    expect(ledger.reconciliationStatus).toBe('unknown');
  });

  it('akun tanpa opening balance → unknown (opening_balance_missing), bukan tebakan 0', async () => {
    const client = await newDb();
    await seedAccount(client, { id: 'acc-a', user_id: 'user-a', name: 'LINE Bank' });
    const ledger = await computeAccountLedger(client, 'user-a');
    expect(ledger.currentBalance.status).toBe('unknown');
    expect(ledger.currentBalance.reason).toBe('opening_balance_missing');
    expect(ledger.currentBalance.amount).toBeNull();
    expect(ledger.accounts[0].status).toBe('unknown');
    expect(ledger.accounts[0].closingBalance).toBeNull();
  });

  it('opening = 0 + income → known, amount = income (0 adalah nilai eksplisit, bukan default)', async () => {
    const client = await newDb();
    await seedAccount(client, { id: 'acc-a', user_id: 'user-a', name: 'LINE Bank', opening_balance: 0, opening_balance_date: '2026-08-01' });
    await seedTx(client, [tx({ id: 't1', type: 'income', amount: 50000, account_id: 'acc-a' })]);
    const ledger = await computeAccountLedger(client, 'user-a');
    expect(ledger.currentBalance.status).toBe('known');
    expect(ledger.currentBalance.amount).toBe(50000);
    expect(ledger.reconciliationStatus).toBe('balanced');
  });

  it('opening = 1.000.000 + income → 1.050.000 (opening ditambahkan)', async () => {
    const client = await newDb();
    await seedAccount(client, { id: 'acc-a', user_id: 'user-a', name: 'LINE Bank', opening_balance: 1000000, opening_balance_date: '2026-01-01' });
    await seedTx(client, [tx({ id: 't1', type: 'income', amount: 50000, account_id: 'acc-a' })]);
    const ledger = await computeAccountLedger(client, 'user-a');
    expect(ledger.currentBalance.amount).toBe(1050000);
    expect(ledger.accounts[0].closingBalance).toBe(1050000);
  });

  it('opening NEGATIF (credit card) → known, closing negatif TIDAK di-clamp', async () => {
    const client = await newDb();
    await seedAccount(client, { id: 'cc-1', user_id: 'user-a', name: 'Kartu Kredit', type: 'credit', opening_balance: -500000, opening_balance_date: '2026-01-01' });
    await seedTx(client, [tx({ id: 't1', type: 'expense', amount: 100000, account_id: 'cc-1' })]);
    const ledger = await computeAccountLedger(client, 'user-a');
    expect(ledger.currentBalance.status).toBe('known');
    expect(ledger.accounts[0].closingBalance).toBe(-600000);
    expect(ledger.currentBalance.amount).toBe(-600000);
  });

  it('opening − expense dan opening + refund', async () => {
    const client = await newDb();
    await seedAccount(client, { id: 'acc-a', user_id: 'user-a', name: 'DANA', opening_balance: 1000000, opening_balance_date: '2026-01-01' });
    await seedTx(client, [
      tx({ id: 't1', type: 'expense', amount: 250000, account_id: 'acc-a' }),
      tx({ id: 't2', type: 'refund', amount: 50000, account_id: 'acc-a' }),
    ]);
    const ledger = await computeAccountLedger(client, 'user-a');
    expect(ledger.accounts[0].closingBalance).toBe(800000); // 1.000.000 − 250.000 + 50.000
    expect(ledger.currentBalance.amount).toBe(800000);
  });
});

describe('financialLedger — transfer semantics', () => {
  it('internal transfer (2 leg, role out/in, group sama) → net 0 aggregate', async () => {
    const client = await newDb();
    await seedAccount(client, { id: 'acc-a', user_id: 'user-a', name: 'blu', opening_balance: 1000000, opening_balance_date: '2026-01-01' });
    await seedAccount(client, { id: 'acc-b', user_id: 'user-a', name: 'DANA', opening_balance: 500000, opening_balance_date: '2026-01-01' });
    await seedTx(client, [
      tx({ id: 'tr-out', type: 'transfer', amount: 100000, account_id: 'acc-a', transfer_group_id: 'g-1', metadata: { transferRole: 'out' }, merchant: 'DANA' }),
      tx({ id: 'tr-in', type: 'transfer', amount: 100000, account_id: 'acc-b', transfer_group_id: 'g-1', metadata: { transferRole: 'in' }, merchant: 'DANA' }),
    ]);
    const ledger = await computeAccountLedger(client, 'user-a');
    // Per akun: blu −100.000, DANA +100.000
    expect(ledger.accounts[0].closingBalance).toBe(900000);
    expect(ledger.accounts[1].closingBalance).toBe(600000);
    // Aggregate = opening total (1.500.000) — internal transfer netral.
    expect(ledger.currentBalance.amount).toBe(1500000);
    expect(ledger.currentBalance.status).toBe('known');
  });

  it('internal pair TANPA role (legacy) → pair bucket, net 0 aggregate, tidak ditebak arah', async () => {
    const client = await newDb();
    await seedAccount(client, { id: 'acc-a', user_id: 'user-a', name: 'blu', opening_balance: 1000000, opening_balance_date: '2026-01-01' });
    await seedAccount(client, { id: 'acc-b', user_id: 'user-a', name: 'DANA', opening_balance: 500000, opening_balance_date: '2026-01-01' });
    await seedTx(client, [
      tx({ id: 'tr-1', type: 'transfer', amount: 100000, account_id: 'acc-a', transfer_group_id: 'g-1' }),
      tx({ id: 'tr-2', type: 'transfer', amount: 100000, account_id: 'acc-b', transfer_group_id: 'g-1' }),
    ]);
    const ledger = await computeAccountLedger(client, 'user-a');
    expect(ledger.accounts[0].movements.internalTransferPair).toBe(100000);
    expect(ledger.accounts[1].movements.internalTransferPair).toBe(100000);
    // Pair tidak mengubah closing (bukan incoming/outgoing yang ditebak).
    expect(ledger.accounts[0].closingBalance).toBe(1000000);
    expect(ledger.accounts[1].closingBalance).toBe(500000);
    expect(ledger.currentBalance.amount).toBe(1500000);
  });

  it('external transfer (leg tunggal, tanpa group) → mengurangi balance', async () => {
    const client = await newDb();
    await seedAccount(client, { id: 'acc-a', user_id: 'user-a', name: 'blu', opening_balance: 1000000, opening_balance_date: '2026-01-01' });
    await seedTx(client, [tx({ id: 'tr-x', type: 'transfer', amount: 100000, account_id: 'acc-a' })]);
    const ledger = await computeAccountLedger(client, 'user-a');
    expect(ledger.accounts[0].movements.outgoingTransfer).toBe(100000);
    expect(ledger.currentBalance.amount).toBe(900000);
  });

  it('classifyTransferLegs: grup campuran tidak lengkap → unresolved (jangan ditebak)', () => {
    const buckets = classifyTransferLegs([
      { id: 'a', account_id: 'acc-a', amount: 50, transfer_group_id: 'g-1', metadata: '{}' },
      { id: 'b', account_id: 'acc-b', amount: 50, transfer_group_id: 'g-1', metadata: '{}' },
      { id: 'c', account_id: 'acc-c', amount: 30, transfer_group_id: 'g-1', metadata: '{}' },
    ]);
    expect(buckets.get('acc-a').unresolved).toBe(50);
    expect(buckets.get('acc-c').unresolved).toBe(30);
  });

  it('parseTransactionMetadata: korup / non-string → {} (robust)', () => {
    expect(parseTransactionMetadata('not-json')).toEqual({});
    expect(parseTransactionMetadata(null)).toEqual({});
    expect(parseTransactionMetadata('{"a":1}')).toEqual({ a: 1 });
  });
});

describe('financialLedger — unclassified & partial', () => {
  it('akun known + transaksi tanpa account_id → status partial, unclassified dihitung', async () => {
    const client = await newDb();
    await seedAccount(client, { id: 'acc-a', user_id: 'user-a', name: 'LINE Bank', opening_balance: 1000000, opening_balance_date: '2026-01-01' });
    await seedTx(client, [
      tx({ id: 't1', type: 'income', amount: 100000, account_id: 'acc-a' }),
      tx({ id: 't2', type: 'expense', amount: 50000 }), // unclassified
      tx({ id: 't3', type: 'income', amount: 200000 }), // unclassified
    ]);
    const ledger = await computeAccountLedger(client, 'user-a');
    expect(ledger.currentBalance.status).toBe('partial');
    expect(ledger.currentBalance.reason).toBe('unclassified_transactions');
    expect(ledger.unclassified.count).toBe(2);
    expect(ledger.unclassified.amount).toBe(250000);
    // Amount = hanya akun known (250.000 TIDAK ikut).
    expect(ledger.currentBalance.amount).toBe(1100000);
    expect(ledger.reconciliationStatus).toBe('warning');
  });

  it('campuran akun known + akun tanpa opening → partial (opening_balance_missing)', async () => {
    const client = await newDb();
    await seedAccount(client, { id: 'acc-a', user_id: 'user-a', name: 'LINE Bank', opening_balance: 1000000, opening_balance_date: '2026-01-01' });
    await seedAccount(client, { id: 'acc-b', user_id: 'user-a', name: 'blu', opening_balance: null });
    const ledger = await computeAccountLedger(client, 'user-a');
    expect(ledger.currentBalance.status).toBe('partial');
    expect(ledger.currentBalance.reason).toBe('opening_balance_missing');
    expect(ledger.currentBalance.amount).toBe(1000000);
    expect(ledger.accounts[1].status).toBe('unknown');
  });
});

describe('financialLedger — opening_balance_date semantics', () => {
  it('transaksi SEBELUM opening date TIDAK dihitung; transaksi SAMA tanggal DIHITUNG (start-of-day)', async () => {
    const client = await newDb();
    await seedAccount(client, { id: 'acc-a', user_id: 'user-a', name: 'LINE Bank', opening_balance: 1000000, opening_balance_date: '2026-03-01' });
    await seedTx(client, [
      tx({ id: 't-old', type: 'income', amount: 50000, account_id: 'acc-a', transaction_date: '2026-02-28' }),
      tx({ id: 't-boundary', type: 'income', amount: 100000, account_id: 'acc-a', transaction_date: '2026-03-01' }),
      tx({ id: 't-new', type: 'expense', amount: 25000, account_id: 'acc-a', transaction_date: '2026-03-15' }),
    ]);
    const ledger = await computeAccountLedger(client, 'user-a');
    // 1.000.000 + 100.000 (tanggal sama, inclusive) − 25.000; 50.000 lama TIDAK masuk
    expect(ledger.accounts[0].closingBalance).toBe(1075000);
    expect(ledger.accounts[0].movements.count).toBe(2);
  });

  it('tanpa opening date → seluruh riwayat ter-link dihitung', async () => {
    const client = await newDb();
    await seedAccount(client, { id: 'acc-a', user_id: 'user-a', name: 'LINE Bank', opening_balance: 1000000, opening_balance_date: null });
    await seedTx(client, [tx({ id: 't1', type: 'income', amount: 50000, account_id: 'acc-a', transaction_date: '2025-01-01' })]);
    const ledger = await computeAccountLedger(client, 'user-a');
    expect(ledger.accounts[0].closingBalance).toBe(1050000);
  });
});

describe('financialLedger — user isolation & attribution safety', () => {
  it('user B data tidak memengaruhi user A', async () => {
    const client = await newDb();
    await seedAccount(client, { id: 'acc-a', user_id: 'user-a', name: 'LINE Bank', opening_balance: 1000000, opening_balance_date: '2026-01-01' });
    await seedAccount(client, { id: 'acc-b', user_id: 'user-b', name: 'LINE Bank B', opening_balance: 999999999, opening_balance_date: '2026-01-01' });
    await seedTx(client, [
      tx({ id: 't1', type: 'income', amount: 100000, account_id: 'acc-a' }),
      tx({ id: 't2', type: 'income', amount: 777777, account_id: 'acc-b', user_id: 'user-b' }),
    ]);
    const a = await computeAccountLedger(client, 'user-a');
    const b = await computeAccountLedger(client, 'user-b');
    expect(a.currentBalance.amount).toBe(1100000);
    expect(a.accounts).toHaveLength(1);
    expect(b.currentBalance.amount).toBe(999999999 + 777777);
  });

  it('account_id milik user LAIN TIDAK di-attribusi (JOIN user-scoped)', async () => {
    const client = await newDb();
    await seedAccount(client, { id: 'acc-b', user_id: 'user-b', name: 'LINE Bank B', opening_balance: 500000, opening_balance_date: '2026-01-01' });
    // user-a mencatat transaksi dengan account_id milik user-b (data korup/malicious)
    await seedTx(client, [tx({ id: 't1', type: 'income', amount: 100000, account_id: 'acc-b' })]);
    const a = await computeAccountLedger(client, 'user-a');
    expect(a.currentBalance.status).toBe('unknown'); // tanpa akun sendiri
    expect(a.unclassified.count).toBe(1); // transaksi tidak ter-attribusi → unclassified
  });
});

describe('financialLedger — windowless & precision', () => {
  it('55+ transaksi ter-link → agregasi PENUH (tanpa LIMIT/window)', async () => {
    const client = await newDb();
    await seedAccount(client, { id: 'acc-a', user_id: 'user-a', name: 'LINE Bank', opening_balance: 0, opening_balance_date: '2026-01-01' });
    const rows = [];
    for (let i = 0; i < 60; i++) {
      rows.push(tx({ id: `t${i}`, type: 'income', amount: 1000, account_id: 'acc-a' }));
    }
    await seedTx(client, rows);
    const ledger = await computeAccountLedger(client, 'user-a');
    expect(ledger.currentBalance.amount).toBe(60000); // 60 × 1000 — bukan window 50
    expect(ledger.accounts[0].movements.count).toBe(60);
  });

  it('presisi desimal: 0.01 / 0.10 / 999999999.99 tidak drift', async () => {
    const client = await newDb();
    await seedAccount(client, { id: 'acc-a', user_id: 'user-a', name: 'LINE Bank', opening_balance: 0, opening_balance_date: '2026-01-01' });
    await seedTx(client, [
      tx({ id: 't1', type: 'income', amount: 0.01, account_id: 'acc-a' }),
      tx({ id: 't2', type: 'income', amount: 0.1, account_id: 'acc-a' }),
      tx({ id: 't3', type: 'income', amount: 999999999.99, account_id: 'acc-a' }),
      tx({ id: 't4', type: 'expense', amount: 0.01, account_id: 'acc-a' }),
    ]);
    const ledger = await computeAccountLedger(client, 'user-a');
    expect(ledger.currentBalance.amount).toBe(1000000000.09); // 0.01 + 0.10 + 999999999.99 − 0.01
  });

  it('computeLedgerSummary: netCashFlow terpisah dari currentBalance (Mode B)', async () => {
    const client = await newDb();
    await seedAccount(client, { id: 'acc-a', user_id: 'user-a', name: 'blu', opening_balance: 1000000, opening_balance_date: '2026-01-01' });
    await seedTx(client, [
      tx({ id: 't1', type: 'income', amount: 100000, account_id: 'acc-a' }),
      tx({ id: 't2', type: 'expense', amount: 25000, account_id: 'acc-a' }),
    ]);
    const summary = await computeLedgerSummary(client, 'user-a', { ownAccounts: [] });
    expect(summary.currentBalance.status).toBe('known');
    expect(summary.currentBalance.amount).toBe(1075000);
    // Net cash flow TANPA opening (income − expense) — konsep berbeda.
    expect(summary.netCashFlow.amount).toBe(75000);
  });
});

describe('financialLedger P2.7 — VERIFIED BALANCE ANCHOR (real_balance = anchor)', () => {
  // Helper: akun dengan anchor (real_balance + date + verified_at).
  const anchored = (client, over = {}) => seedAccount(client, { id: 'acc-a', user_id: 'user-a', name: 'blu', currency: 'IDR',
    real_balance: 3000000, real_balance_date: '2026-08-11', real_balance_verified_at: '2026-08-11T10:00:00Z', ...over });

  it('1/2. anchor TANPA opening → currentBalance VERIFIED (anchor = saldo), bukan unknown', async () => {
    const client = await newDb();
    await anchored(client);
    const ledger = await computeAccountLedger(client, 'user-a');
    expect(ledger.currentBalance.status).toBe('verified');
    expect(ledger.currentBalance.amount).toBe(3000000);
    expect(ledger.currentBalance.anchorDate).toBe('2026-08-11');
    expect(ledger.accounts[0].anchor).toEqual({ amount: 3000000, date: '2026-08-11', verifiedAt: '2026-08-11T10:00:00Z' });
    expect(ledger.accounts[0].status).toBe('anchored');
    // Net cash flow tetap terpisah (tanpa transaksi = 0).
    const summary = await computeLedgerSummary(client, 'user-a', { ownAccounts: [] });
    expect(summary.currentBalance.status).toBe('verified');
    expect(summary.currentBalance.amount).toBe(3000000);
    expect(summary.netCashFlow.amount).toBe(0);
  });

  it('3. satu akun anchored + income setelah anchor → anchor + income', async () => {
    const client = await newDb();
    await anchored(client);
    await seedTx(client, [tx({ id: 't1', type: 'income', amount: 500000, account_id: 'acc-a', transaction_date: '2026-08-12' })]);
    const ledger = await computeAccountLedger(client, 'user-a');
    expect(ledger.currentBalance.status).toBe('verified');
    expect(ledger.currentBalance.amount).toBe(3500000);
  });

  it('4. sebagian akun anchored → PARTIAL (anchor_missing)', async () => {
    const client = await newDb();
    await anchored(client);
    await seedAccount(client, { id: 'acc-b', user_id: 'user-a', name: 'DANA', currency: 'IDR' }); // tanpa anchor
    const ledger = await computeAccountLedger(client, 'user-a');
    expect(ledger.currentBalance.status).toBe('partial');
    expect(ledger.currentBalance.reason).toBe('anchor_missing');
    // Hanya akun anchored yang dijumlah.
    expect(ledger.currentBalance.amount).toBe(3000000);
  });

  it('5/6/7. anchor + income / expense / refund SETELAH anchor dihitung', async () => {
    const client = await newDb();
    await anchored(client);
    await seedTx(client, [
      tx({ id: 't1', type: 'income', amount: 100000, account_id: 'acc-a', transaction_date: '2026-08-12' }),
      tx({ id: 't2', type: 'expense', amount: 50000, account_id: 'acc-a', transaction_date: '2026-08-13' }),
      tx({ id: 't3', type: 'refund', amount: 20000, account_id: 'acc-a', transaction_date: '2026-08-14' }),
    ]);
    const ledger = await computeAccountLedger(client, 'user-a');
    expect(ledger.currentBalance.amount).toBe(3070000); // 3.000.000 + 100.000 − 50.000 + 20.000
  });

  it('8/9. transfer IN/OUT setelah anchor', async () => {
    const client = await newDb();
    await anchored(client);
    await seedAccount(client, { id: 'acc-b', user_id: 'user-a', name: 'DANA', currency: 'IDR',
      real_balance: 1000000, real_balance_date: '2026-08-11', real_balance_verified_at: '2026-08-11T10:00:00Z' });
    await seedTx(client, [
      tx({ id: 't1', type: 'transfer', amount: 200000, account_id: 'acc-a', transfer_group_id: 'g1', metadata: { transferRole: 'out' }, transaction_date: '2026-08-12' }),
      tx({ id: 't2', type: 'transfer', amount: 200000, account_id: 'acc-b', transfer_group_id: 'g1', metadata: { transferRole: 'in' }, transaction_date: '2026-08-12' }),
    ]);
    const ledger = await computeAccountLedger(client, 'user-a');
    const byName = Object.fromEntries(ledger.accounts.map((a) => [a.name, a.closingBalance]));
    expect(byName.blu).toBe(2800000);   // 3.000.000 − 200.000
    expect(byName.DANA).toBe(1200000);   // 1.000.000 + 200.000
    expect(ledger.currentBalance.amount).toBe(4000000); // aggregate netral
    expect(ledger.currentBalance.status).toBe('verified');
  });

  it('10. internal transfer post-anchor TIDAK double-count (net 0 aggregate)', async () => {
    const client = await newDb();
    await anchored(client);
    await seedAccount(client, { id: 'acc-b', user_id: 'user-a', name: 'DANA', currency: 'IDR',
      real_balance: 1000000, real_balance_date: '2026-08-11', real_balance_verified_at: '2026-08-11T10:00:00Z' });
    await seedTx(client, [
      tx({ id: 't1', type: 'transfer', amount: 100000, account_id: 'acc-a', transfer_group_id: 'g1', metadata: { transferRole: 'out' }, transaction_date: '2026-08-12' }),
      tx({ id: 't2', type: 'transfer', amount: 100000, account_id: 'acc-b', transfer_group_id: 'g1', metadata: { transferRole: 'in' }, transaction_date: '2026-08-12' }),
    ]);
    const ledger = await computeAccountLedger(client, 'user-a');
    expect(ledger.currentBalance.amount).toBe(4000000); // 3.000.000 + 1.000.000 — netral
  });

  it('11. unresolved transfer post-anchor → STALE (post_anchor_activity_unresolved)', async () => {
    const client = await newDb();
    await anchored(client);
    await seedTx(client, [
      tx({ id: 't1', type: 'transfer', amount: 100000, account_id: 'acc-a', transfer_group_id: 'g1', metadata: { transferRole: 'out' }, transaction_date: '2026-08-12' }),
      // Leg kedua TIDAK ada (tidak lengkap) → unresolved.
      tx({ id: 't2', type: 'transfer', amount: 100000, account_id: 'acc-a', transfer_group_id: 'g1', metadata: { transferRole: 'in' }, transaction_date: '2026-08-12' }),
      tx({ id: 't3', type: 'transfer', amount: 100000, account_id: 'acc-a', transfer_group_id: 'g2', transaction_date: '2026-08-12' }), // tanpa role
    ]);
    const ledger = await computeAccountLedger(client, 'user-a');
    expect(ledger.currentBalance.status).toBe('stale');
    expect(ledger.currentBalance.reason).toBe('post_anchor_activity_unresolved');
  });

  it('12/13. transaksi SEBELUM / PADA anchor date TIDAK dihitung ulang (anti double-count)', async () => {
    const client = await newDb();
    await anchored(client);
    await seedTx(client, [
      tx({ id: 't1', type: 'expense', amount: 999999, account_id: 'acc-a', transaction_date: '2026-08-10' }), // sebelum
      tx({ id: 't2', type: 'income', amount: 999999, account_id: 'acc-a', transaction_date: '2026-08-11' }), // pada anchor date
    ]);
    const ledger = await computeAccountLedger(client, 'user-a');
    // Tidak ada double counting — anchor sudah mencakup keduanya.
    expect(ledger.currentBalance.amount).toBe(3000000);
    expect(ledger.currentBalance.status).toBe('verified');
  });

  it('14. transaksi SETELAH anchor date dihitung (strictly >)', async () => {
    const client = await newDb();
    await anchored(client);
    await seedTx(client, [
      tx({ id: 't1', type: 'expense', amount: 250000, account_id: 'acc-a', transaction_date: '2026-08-12' }),
    ]);
    const ledger = await computeAccountLedger(client, 'user-a');
    expect(ledger.currentBalance.amount).toBe(2750000);
  });

  it('15/16. anchor 0 dan anchor negatif (credit) TIDAK di-clamp', async () => {
    const client = await newDb();
    await seedAccount(client, { id: 'acc-z', user_id: 'user-a', name: 'Zero', currency: 'IDR',
      real_balance: 0, real_balance_date: '2026-08-11', real_balance_verified_at: '2026-08-11T10:00:00Z' });
    await seedAccount(client, { id: 'acc-c', user_id: 'user-a', name: 'Kartu Kredit', currency: 'IDR',
      real_balance: -500000, real_balance_date: '2026-08-11', real_balance_verified_at: '2026-08-11T10:00:00Z' });
    const ledger = await computeAccountLedger(client, 'user-a');
    expect(ledger.currentBalance.amount).toBe(-500000); // 0 + (−500.000)
    expect(ledger.currentBalance.status).toBe('verified');
  });

  it('17. presisi desimal pada roll-forward anchor', async () => {
    const client = await newDb();
    await seedAccount(client, { id: 'acc-a', user_id: 'user-a', name: 'blu', currency: 'IDR',
      real_balance: 0.1, real_balance_date: '2026-08-11', real_balance_verified_at: '2026-08-11T10:00:00Z' });
    await seedTx(client, [
      tx({ id: 't1', type: 'income', amount: 0.2, account_id: 'acc-a', transaction_date: '2026-08-12' }),
    ]);
    const ledger = await computeAccountLedger(client, 'user-a');
    expect(ledger.currentBalance.amount).toBe(0.3); // round2 — bukan 0.30000000000000004
  });

  it('20. transaksi identik yang sah (2 baris) tetap dihitung terpisah', async () => {
    const client = await newDb();
    await anchored(client);
    await seedTx(client, [
      tx({ id: 't1', type: 'income', amount: 50000, account_id: 'acc-a', transaction_date: '2026-08-12', merchant: 'X' }),
      tx({ id: 't2', type: 'income', amount: 50000, account_id: 'acc-a', transaction_date: '2026-08-12', merchant: 'X' }),
    ]);
    const ledger = await computeAccountLedger(client, 'user-a');
    expect(ledger.currentBalance.amount).toBe(3100000); // keduanya dihitung
  });

  it('21. anchor mismatch (outcome tersimpan) → status MISMATCH', async () => {
    const client = await newDb();
    // Outcome verifikasi di-SIMPAN (migration 0009): user memasukkan actual
    // yang berbeda dari sistem saat verifikasi → balance_anchor_status='mismatch'.
    await anchored(client, { balance_anchor_status: 'mismatch' });
    const ledger = await computeAccountLedger(client, 'user-a');
    expect(ledger.accounts[0].verificationStatus).toBe('mismatch');
    expect(ledger.currentBalance.status).toBe('mismatch');
    expect(ledger.currentBalance.reason).toBe('anchor_mismatch');
  });

  it('22. unclassified SETELAH anchor → STALE (tidak disembunyikan)', async () => {
    const client = await newDb();
    await anchored(client);
    await seedTx(client, [
      tx({ id: 't1', transaction_date: '2026-08-12' }), // tanpa account_id, setelah anchor
    ]);
    const ledger = await computeAccountLedger(client, 'user-a');
    expect(ledger.currentBalance.status).toBe('stale');
    expect(ledger.currentBalance.reason).toBe('post_anchor_activity_unresolved');
    // Unclassified HISTORIS (sebelum anchor) TIDAK merusak status.
    const client2 = await newDb();
    await anchored(client2);
    await seedTx(client2, [tx({ id: 't2', transaction_date: '2026-08-10' })]); // sebelum anchor
    const ledger2 = await computeAccountLedger(client2, 'user-a');
    expect(ledger2.currentBalance.status).toBe('verified');
    expect(ledger2.currentBalance.amount).toBe(3000000);
  });

  it('cross-user: anchor user B tidak memengaruhi user A; akun user lain tidak dijumlah', async () => {
    const client = await newDb();
    await anchored(client);
    await seedAccount(client, { id: 'acc-b2', user_id: 'user-b', name: 'B punya', currency: 'IDR',
      real_balance: 999999999, real_balance_date: '2026-08-11', real_balance_verified_at: '2026-08-11T10:00:00Z' });
    const ledger = await computeAccountLedger(client, 'user-a');
    expect(ledger.accounts).toHaveLength(1);
    expect(ledger.currentBalance.amount).toBe(3000000);
  });

  it('GOLDEN (§38): blu 3jt + Bank Jago 2jt + income 500k − expense 200k − transfer out 100k + refund 50k = 5.250.000', async () => {
    const client = await newDb();
    await seedAccount(client, { id: 'acc-blu', user_id: 'user-a', name: 'blu', currency: 'IDR',
      real_balance: 3000000, real_balance_date: '2026-08-11', real_balance_verified_at: '2026-08-11T10:00:00Z' });
    await seedAccount(client, { id: 'acc-jago', user_id: 'user-a', name: 'Bank Jago', currency: 'IDR',
      real_balance: 2000000, real_balance_date: '2026-08-11', real_balance_verified_at: '2026-08-11T10:00:00Z' });
    await seedTx(client, [
      tx({ id: 'g1', type: 'income', amount: 500000, account_id: 'acc-blu', transaction_date: '2026-08-12' }),
      tx({ id: 'g2', type: 'expense', amount: 200000, account_id: 'acc-blu', transaction_date: '2026-08-12' }),
      tx({ id: 'g3', type: 'transfer', amount: 100000, account_id: 'acc-blu', transaction_date: '2026-08-12' }), // transfer out (single leg)
      tx({ id: 'g4', type: 'refund', amount: 50000, account_id: 'acc-blu', transaction_date: '2026-08-12' }),
    ]);
    const ledger = await computeAccountLedger(client, 'user-a');
    expect(ledger.currentBalance.status).toBe('verified');
    expect(ledger.currentBalance.amount).toBe(5250000); // 3.000.000 + 2.000.000 + 500.000 − 200.000 − 100.000 + 50.000
  });

  it('P2.8 §63/§64 — SQL ORACLE PARITY: oracle independen (raw SQL, TANPA engine) == computeAccountLedger hingga 2 desimal', async () => {
    const client = await newDb();
    await seedAccount(client, { id: 'acc-blu', user_id: 'user-a', name: 'blu', currency: 'IDR',
      real_balance: 3000000, real_balance_date: '2026-08-11', real_balance_verified_at: '2026-08-11T10:00:00Z' });
    await seedAccount(client, { id: 'acc-jago', user_id: 'user-a', name: 'Bank Jago', currency: 'IDR',
      real_balance: 2000000, real_balance_date: '2026-08-11', real_balance_verified_at: '2026-08-11T10:00:00Z' });
    await seedTx(client, [
      tx({ id: 'o1', type: 'income', amount: 500000, account_id: 'acc-blu', transaction_date: '2026-08-12' }),
      tx({ id: 'o2', type: 'expense', amount: 200000, account_id: 'acc-blu', transaction_date: '2026-08-12' }),
      tx({ id: 'o3', type: 'refund', amount: 50000, account_id: 'acc-jago', transaction_date: '2026-08-12' }),
      tx({ id: 'o4', type: 'transfer', amount: 100000, account_id: 'acc-blu', transaction_date: '2026-08-12' }), // single leg = outgoing
    ]);

    // ORACLE INDEPENDEN — formulasi SQL ulang dari semantik terdokumentasi
    // (§5.3 P2.7): closing = anchor + (income+refund) − expense − outgoing
    // transfer, dengan transaction_date > anchor_date (END-OF-DAY, strict).
    // TIDAK memanggil financialLedger.js (bukan circular validation).
    const oracle = await client.execute({
      sql: `SELECT w.id,
                   ROUND(w.real_balance
                     + COALESCE(SUM(CASE WHEN t.type IN ('income','refund') THEN t.amount ELSE 0 END), 0)
                     - COALESCE(SUM(CASE WHEN t.type = 'expense' THEN t.amount ELSE 0 END), 0)
                     - COALESCE(SUM(CASE WHEN t.type = 'transfer' AND t.transfer_group_id IS NULL THEN t.amount ELSE 0 END), 0), 2) AS closing
            FROM wallet_accounts w
            LEFT JOIN transactions t
              ON t.account_id = w.id AND t.user_id = w.user_id
             AND t.transaction_date > w.real_balance_date
            WHERE w.user_id = ? AND w.archived = 0 AND w.real_balance_date IS NOT NULL
            GROUP BY w.id
            ORDER BY w.name`,
      args: ['user-a'],
    });
    const oracleByAccount = new Map(oracle.rows.map((r) => [String(r.id), Number(r.closing)]));
    expect(oracleByAccount.get('acc-blu')).toBe(3200000); // 3.000.000 + 500.000 − 200.000 − 100.000
    expect(oracleByAccount.get('acc-jago')).toBe(2050000); // 2.000.000 + 50.000

    // Engine == oracle (parity per akun + aggregate).
    const ledger = await computeAccountLedger(client, 'user-a');
    for (const account of ledger.accounts) {
      expect(account.closingBalance).toBe(oracleByAccount.get(account.id));
    }
    expect(ledger.currentBalance.amount).toBe(5250000);
    expect(ledger.currentBalance.amount).toBe(
      [...oracleByAccount.values()].reduce((s, v) => s + v, 0),
    );
  });

  it('cross-currency (§32): akun non-IDR → agregasi ditolak (null), status partial', async () => {
    const client = await newDb();
    await seedAccount(client, { id: 'acc-a', user_id: 'user-a', name: 'blu', currency: 'IDR',
      real_balance: 3000000, real_balance_date: '2026-08-11', real_balance_verified_at: '2026-08-11T10:00:00Z' });
    await seedAccount(client, { id: 'acc-usd', user_id: 'user-a', name: 'USD Wallet', currency: 'USD',
      real_balance: 100, real_balance_date: '2026-08-11', real_balance_verified_at: '2026-08-11T10:00:00Z' });
    const ledger = await computeAccountLedger(client, 'user-a');
    expect(ledger.currentBalance.status).toBe('partial');
    expect(ledger.currentBalance.reason).toBe('cross_currency');
    expect(ledger.currentBalance.amount).toBeNull();
    // Per-akun tetap dihitung sendiri (jujur).
    expect(ledger.accounts.find((a) => a.name === 'USD Wallet').closingBalance).toBe(100);
  });
});
