/**
 * REAL-DATABASE RECONCILIATION (audit finansial 2026-08-10).
 *
 * Tidak memakai mock — menjalankan computeFinancialSummary terhadap libsql
 * FILE lokal (pola migrationRunner.test.ts) lalu membandingkan dengan
 * AGREGASI SQL INDEPENDEN (per-type breakdown + kombinatorika manual, BUKAN
 * formula aplikasi). Target: SQL = computeFinancialSummary = (contract) API.
 *
 * Kasus wajib (super prompt §22) + regression LIMIT 50 (§28):
 *   1. no transaction → 0/0/0
 *   2. income only → +100000
 *   3. expense only → -25000
 *   4. mix → 75000
 *   5. >50 transaksi → lifetime penuh (bukan window) + insert 6 expense → delta eksak
 *   6. month boundary (hari terakhir bulan lalu / hari pertama bulan ini / hari pertama bulan depan)
 *   7. refund = income
 *   8. transfer = expense (dihitung SEKALI — tanpa double counting)
 *   9. decimal (0.01 / 0.10 / 0.30 / 100000.55) tanpa drift float
 *  10. user isolation (user B tidak memengaruhi user A)
 *  11. mutation insert → update → delete → summary selalu sinkron
 *  12. persistence (client baru, file sama → hasil sama)
 *  13. SQL independen ≡ computeFinancialSummary (di dalam setiap skenario)
 *  14. reload consistency (dua panggilan berurutan identik)
 */
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createClient } from '@libsql/client';
import { computeFinancialSummary, round2 } from '../../server/lib/financialSummary.js';

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
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`;

interface Row {
  id: string;
  user_id: string;
  type: 'income' | 'expense' | 'transfer' | 'refund';
  amount: number;
  category_id: string;
  category_name: string;
  merchant?: string;
  date: string;
  transaction_date: string;
  source?: string;
}

/** Client file lokal + destructor otomatis. */
function makeDb() {
  const dbPath = path
    .join(os.tmpdir(), `cf-fin-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`)
    .replace(/\\/g, '/');
  const client = createClient({ url: `file:${dbPath}` });
  return { client, dbPath };
}

const clients: Array<ReturnType<typeof createClient>> = [];
const dbs: string[] = [];

async function newDb() {
  const { client, dbPath } = makeDb();
  clients.push(client);
  dbs.push(dbPath);
  await client.execute({ sql: CREATE_SQL, args: [] });
  return { client, dbPath };
}

async function seed(client: ReturnType<typeof createClient>, rows: Row[]) {
  for (const r of rows) {
    await client.execute({
      sql: `INSERT INTO transactions
            (id, user_id, type, amount, category_id, category_name, merchant, date, transaction_date, source)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [r.id, r.user_id, r.type, r.amount, r.category_id, r.category_name, r.merchant ?? '', r.date, r.transaction_date, r.source ?? 'manual'],
    });
  }
}

let seq = 0;

/** Factory baris dengan default user-a / expense / 2026-08-01. */
function tx(over: Partial<Row> & { id?: string }): Row {
  seq += 1;
  return {
    id: `tx-${seq}`,
    user_id: 'user-a',
    type: 'expense',
    amount: 1000,
    category_id: 'cat-1',
    category_name: 'Kategori',
    date: '2026-08-01',
    transaction_date: '2026-08-01',
    ...over,
  };
}

/**
 * Agregasi INDEPENDEN: breakdown per type + kombinatorika manual di JS.
 * BUKAN formula aplikasi — satu-satunya sumber yang dibandingkan dengan
 * computeFinancialSummary.
 */
async function independentTotals(client: ReturnType<typeof createClient>, userId: string) {
  const r = await client.execute({
    sql: `SELECT type, COALESCE(SUM(amount),0) AS s, COUNT(*) AS c
          FROM transactions WHERE user_id = ? GROUP BY type`,
    args: [userId],
  });
  const byType: Record<string, { s: number; c: number }> = {};
  for (const row of r.rows) byType[String(row.type)] = { s: Number(row.s), c: Number(row.c) };
  const income = round2((byType.income?.s ?? 0) + (byType.refund?.s ?? 0));
  const expense = round2((byType.expense?.s ?? 0) + (byType.transfer?.s ?? 0));
  return {
    income,
    expense,
    balance: round2(income - expense),
    count: Object.values(byType).reduce((a, b) => a + b.c, 0),
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

describe('real-DB reconciliation — SQL independen ≡ computeFinancialSummary', () => {
  it('Case 1: no transaction → 0/0/0 + byCategory kosong', async () => {
    const { client } = await newDb();
    const summary = await computeFinancialSummary(client, 'user-a', { month: 8, year: 2026 });
    expect(summary.lifetime).toEqual({ totalIncome: 0, totalExpense: 0, balance: 0, count: 0 });
    expect(summary.monthly).toEqual({ totalIncome: 0, totalExpense: 0, balance: 0, count: 0 });
    expect(summary.monthlyByCategory).toEqual([]);
    expect(await independentTotals(client, 'user-a')).toEqual({ income: 0, expense: 0, balance: 0, count: 0 });
  });

  it('Case 2: income only → +100000', async () => {
    const { client } = await newDb();
    await seed(client, [tx({ type: 'income', amount: 100000, transaction_date: '2026-08-05' })]);
    const s = await computeFinancialSummary(client, 'user-a', { month: 8, year: 2026 });
    expect(s.lifetime.balance).toBe(100000);
    expect(s.monthly.totalIncome).toBe(100000);
    expect(await independentTotals(client, 'user-a')).toEqual({ income: 100000, expense: 0, balance: 100000, count: 1 });
  });

  it('Case 3: expense only → -25000', async () => {
    const { client } = await newDb();
    await seed(client, [tx({ type: 'expense', amount: 25000 })]);
    const s = await computeFinancialSummary(client, 'user-a', { month: 8, year: 2026 });
    expect(s.lifetime.balance).toBe(-25000);
    expect(s.monthly.totalExpense).toBe(25000);
    expect(await independentTotals(client, 'user-a')).toEqual({ income: 0, expense: 25000, balance: -25000, count: 1 });
  });

  it('Case 4: income 100000 + expense 25000 → balance 75000', async () => {
    const { client } = await newDb();
    await seed(client, [
      tx({ type: 'income', amount: 100000 }),
      tx({ type: 'expense', amount: 25000 }),
    ]);
    const s = await computeFinancialSummary(client, 'user-a', { month: 8, year: 2026 });
    expect(s.lifetime.balance).toBe(75000);
    expect(await independentTotals(client, 'user-a')).toEqual({ income: 100000, expense: 25000, balance: 75000, count: 2 });
  });

  it('Case 5 + §28: >50 transaksi → lifetime PENUH; +6 expense → delta eksak (regresi LIMIT 50)', async () => {
    const { client } = await newDb();
    // 60 income × 1000 + 60 expense × 500 = 120 baris (jauh di atas window 50).
    const rows: Row[] = [];
    for (let i = 0; i < 60; i++) rows.push(tx({ type: 'income', amount: 1000 }));
    for (let i = 0; i < 60; i++) rows.push(tx({ type: 'expense', amount: 500 }));
    await seed(client, rows);

    const before = await computeFinancialSummary(client, 'user-a', { month: 8, year: 2026 });
    expect(before.lifetime.count).toBe(120);
    expect(before.lifetime.totalIncome).toBe(60000);
    expect(before.lifetime.totalExpense).toBe(30000);
    expect(before.lifetime.balance).toBe(30000); // window-50 akan memberi 50×1000−50×500 = 25000 → FAIL

    // Mutation: 6 expense baru × 1000 → balance harus turun PERSIS -6000.
    const six: Row[] = [];
    for (let i = 0; i < 6; i++) six.push(tx({ type: 'expense', amount: 1000 }));
    await seed(client, six);
    const after = await computeFinancialSummary(client, 'user-a', { month: 8, year: 2026 });
    expect(after.lifetime.balance).toBe(round2(before.lifetime.balance - 6000)); // 24000
    expect(after.lifetime.count).toBe(126);
    expect(await independentTotals(client, 'user-a')).toEqual({
      income: 60000,
      expense: 36000,
      balance: 24000,
      count: 126,
    });
  });

  it('Case 6: month boundary — bulan lalu / bulan ini / bulan depan', async () => {
    const { client } = await newDb();
    await seed(client, [
      tx({ type: 'expense', amount: 70000, transaction_date: '2026-07-31' }), // hari terakhir bulan lalu
      tx({ type: 'expense', amount: 30000, transaction_date: '2026-08-01' }), // hari pertama bulan ini
      tx({ type: 'expense', amount: 50000, transaction_date: '2026-09-01' }), // hari pertama bulan depan
    ]);
    const aug = await computeFinancialSummary(client, 'user-a', { month: 8, year: 2026 });
    expect(aug.monthly.totalExpense).toBe(30000); // HANYA Agustus
    expect(aug.lifetime.totalExpense).toBe(150000); // semua
    const jul = await computeFinancialSummary(client, 'user-a', { month: 7, year: 2026 });
    expect(jul.monthly.totalExpense).toBe(70000);
    const sep = await computeFinancialSummary(client, 'user-a', { month: 9, year: 2026 });
    expect(sep.monthly.totalExpense).toBe(50000);
  });

  it('Case 7: refund = income', async () => {
    const { client } = await newDb();
    await seed(client, [
      tx({ type: 'income', amount: 10000 }),
      tx({ type: 'refund', amount: 5000 }),
    ]);
    const s = await computeFinancialSummary(client, 'user-a', { month: 8, year: 2026 });
    expect(s.lifetime.totalIncome).toBe(15000);
    expect(s.lifetime.balance).toBe(15000);
    expect(await independentTotals(client, 'user-a')).toEqual({ income: 15000, expense: 0, balance: 15000, count: 2 });
  });

  it('Case 8: transfer = expense, dihitung SEKALI (tanpa double counting)', async () => {
    const { client } = await newDb();
    await seed(client, [
      tx({ type: 'expense', amount: 2000 }),
      tx({ type: 'transfer', amount: 3000 }),
    ]);
    const s = await computeFinancialSummary(client, 'user-a', { month: 8, year: 2026 });
    expect(s.lifetime.totalExpense).toBe(5000); // 2000 + 3000 — bukan 6000
    expect(s.lifetime.totalIncome).toBe(0); // transfer TIDAK masuk income
    expect(s.lifetime.balance).toBe(-5000);
    expect(await independentTotals(client, 'user-a')).toEqual({ income: 0, expense: 5000, balance: -5000, count: 2 });
  });

  it('§10.13: transfer internal netral — ownAccounts mengecualikan transfer ke akun sendiri dari expense', async () => {
    const { client } = await newDb();
    await seed(client, [
      // income 15.000 · expense 2.000 · transfer 3.000 ke akun sendiri (blu)
      tx({ type: 'income', amount: 15000 }),
      tx({ type: 'expense', amount: 2000 }),
      tx({ type: 'transfer', amount: 3000, merchant: 'blu' }),
    ]);
    const legacy = await computeFinancialSummary(client, 'user-a', { month: 8, year: 2026 });
    expect(legacy.lifetime.balance).toBe(10000); // 15000 − (2000+3000)

    const neutral = await computeFinancialSummary(client, 'user-a', { month: 8, year: 2026, ownAccounts: ['blu'] });
    expect(neutral.lifetime.totalExpense).toBe(2000); // transfer 3.000 ke blu dikecualikan
    expect(neutral.lifetime.balance).toBe(13000); // 15000 − 2000
    expect(neutral.monthly.balance).toBe(13000);
  });

  it('§10.13: transfer ke akun BUKAN milik sendiri tetap = expense (user isolation ownAccounts)', async () => {
    const { client } = await newDb();
    await seed(client, [
      tx({ type: 'transfer', amount: 3000, merchant: 'blu', user_id: 'user-a' }),
      tx({ type: 'transfer', amount: 7000, merchant: 'LINE Bank', user_id: 'user-b' }),
    ]);
    const a = await computeFinancialSummary(client, 'user-a', { month: 8, year: 2026, ownAccounts: ['LINE Bank'] });
    // ownAccounts user-a berisi LINE Bank, tetapi transfer user-a ke 'blu'
    // (bukan akun sendiri) → tetap expense 3.000.
    expect(a.lifetime.totalExpense).toBe(3000);
    expect(a.lifetime.balance).toBe(-3000);
  });

  it('§10.13 Skr B: income pasangan transfer internal (same day+amount+merchant) dinetralkan dari income', async () => {
    const { client } = await newDb();
    await seed(client, [
      // income 100.000 (LINE Bank) + transfer 100.000 ke LINE Bank, hari sama → pasangan internal
      tx({ id: 'inc-pair', type: 'income', amount: 100000, merchant: 'LINE Bank' }),
      tx({ id: 'tr-pair', type: 'transfer', amount: 100000, merchant: 'LINE Bank' }),
      // income legit tanpa pasangan
      tx({ id: 'inc-legit', type: 'income', amount: 50000, merchant: 'blu' }),
    ]);
    const legacy = await computeFinancialSummary(client, 'user-a', { month: 8, year: 2026 });
    expect(legacy.lifetime.totalIncome).toBe(150000); // legacy: semua income dihitung
    expect(legacy.lifetime.totalExpense).toBe(100000); // legacy: transfer = expense

    const skrB = await computeFinancialSummary(client, 'user-a', { month: 8, year: 2026, ownAccounts: ['LINE Bank', 'blu'] });
    expect(skrB.lifetime.totalIncome).toBe(50000); // pasangan 100.000 dinetralkan
    expect(skrB.lifetime.totalExpense).toBe(0); // transfer internal netral
    expect(skrB.lifetime.balance).toBe(50000);
    expect(skrB.monthly.totalIncome).toBe(50000);
    expect(skrB.monthly.totalExpense).toBe(0);
    expect(skrB.monthly.balance).toBe(50000);
  });

  it('§10.13 Skr B: bucket tidak seimbang → min-pair (1 transfer, 2 income → HANYA 1 income dinetralkan)', async () => {
    const { client } = await newDb();
    await seed(client, [
      tx({ id: 'tr-1', type: 'transfer', amount: 200000, merchant: 'LINE Bank' }),
      tx({ id: 'inc-a', type: 'income', amount: 200000, merchant: 'LINE Bank' }),
      tx({ id: 'inc-b', type: 'income', amount: 200000, merchant: 'LINE Bank' }),
    ]);
    const s = await computeFinancialSummary(client, 'user-a', { month: 8, year: 2026, ownAccounts: ['LINE Bank'] });
    // min(1,2) = 1 → inc-a (id ASC) dinetralkan; inc-b tetap income 200.000 (legit sisa).
    expect(s.lifetime.totalIncome).toBe(200000);
    expect(s.lifetime.totalExpense).toBe(0); // transfer netral
    expect(s.lifetime.balance).toBe(200000);
  });

  it('§10.13 Skr B: merchant BERBEDA → TIDAK dipasangkan (income tetap dihitung; rule sama-merchant)', async () => {
    const { client } = await newDb();
    await seed(client, [
      tx({ id: 'tr-1', type: 'transfer', amount: 100000, merchant: 'LINE Bank' }),
      tx({ id: 'inc-1', type: 'income', amount: 100000, merchant: 'blu' }),
    ]);
    const s = await computeFinancialSummary(client, 'user-a', { month: 8, year: 2026, ownAccounts: ['LINE Bank', 'blu'] });
    // transfer 100.000 netral (LINE Bank); income 100.000 (blu) TIDAK punya pasangan
    // (transfer LINE Bank merchant beda) → tetap income.
    expect(s.lifetime.totalIncome).toBe(100000);
    expect(s.lifetime.totalExpense).toBe(0);
    expect(s.lifetime.balance).toBe(100000);
  });

  it('§10.13 Skr B: tanggal BERBEDA → TIDAK dipasangkan (rule same-day)', async () => {
    const { client } = await newDb();
    await seed(client, [
      tx({ id: 'tr-1', type: 'transfer', amount: 100000, merchant: 'LINE Bank', transaction_date: '2026-08-01' }),
      tx({ id: 'inc-1', type: 'income', amount: 100000, merchant: 'LINE Bank', transaction_date: '2026-08-02' }),
    ]);
    const s = await computeFinancialSummary(client, 'user-a', { month: 8, year: 2026, ownAccounts: ['LINE Bank'] });
    expect(s.lifetime.totalIncome).toBe(100000); // tidak dipasangkan (beda hari)
    expect(s.lifetime.totalExpense).toBe(0); // transfer tetap netral (Skr A)
    expect(s.lifetime.balance).toBe(100000);
  });

  it('§10.13 Skr B: user isolation — pasangan user B tidak memengaruhi income user A', async () => {
    const { client } = await newDb();
    await seed(client, [
      tx({ id: 'a-inc', user_id: 'user-a', type: 'income', amount: 100000, merchant: 'LINE Bank' }),
      tx({ id: 'b-tr', user_id: 'user-b', type: 'transfer', amount: 100000, merchant: 'LINE Bank' }),
      tx({ id: 'b-inc', user_id: 'user-b', type: 'income', amount: 100000, merchant: 'LINE Bank' }),
    ]);
    const a = await computeFinancialSummary(client, 'user-a', { month: 8, year: 2026, ownAccounts: ['LINE Bank'] });
    const b = await computeFinancialSummary(client, 'user-b', { month: 8, year: 2026, ownAccounts: ['LINE Bank'] });
    // user-a: income 100.000 tanpa transfer pasangan (transfer milik user-b) → tetap income
    expect(a.lifetime.totalIncome).toBe(100000);
    // user-b: income + transfer same day/amount/merchant → income dinetralkan
    expect(b.lifetime.totalIncome).toBe(0);
    expect(b.lifetime.totalExpense).toBe(0);
  });

  it('Case 9: decimal (0.01/0.10/0.30/100000.55) tanpa drift float', async () => {
    const { client } = await newDb();
    await seed(client, [
      tx({ type: 'income', amount: 0.01 }),
      tx({ type: 'income', amount: 0.1 }),
      tx({ type: 'expense', amount: 0.3 }),
      tx({ type: 'income', amount: 100000.55 }),
    ]);
    const s = await computeFinancialSummary(client, 'user-a', { month: 8, year: 2026 });
    expect(s.lifetime.totalIncome).toBe(100000.66); // 0.01+0.10+100000.55 → 100000.66 (bukan 100000.66000000001)
    expect(s.lifetime.totalExpense).toBe(0.3);
    expect(s.lifetime.balance).toBe(100000.36);
    const ind = await independentTotals(client, 'user-a');
    expect(ind.income).toBe(100000.66);
    expect(ind.balance).toBe(100000.36);
  });

  it('Case 10: user isolation — user B tidak memengaruhi user A', async () => {
    const { client } = await newDb();
    await seed(client, [
      tx({ type: 'income', amount: 100000 }),
      tx({ type: 'income', amount: 500000, user_id: 'user-b' }),
      tx({ type: 'expense', amount: 900000, user_id: 'user-b' }),
    ]);
    const a = await computeFinancialSummary(client, 'user-a', { month: 8, year: 2026 });
    const b = await computeFinancialSummary(client, 'user-b', { month: 8, year: 2026 });
    expect(a.lifetime.balance).toBe(100000);
    expect(b.lifetime.balance).toBe(-400000);
    expect(await independentTotals(client, 'user-a')).toEqual({ income: 100000, expense: 0, balance: 100000, count: 1 });
  });

  it('Case 11: mutation insert → update → delete → summary selalu sinkron', async () => {
    const { client } = await newDb();
    await seed(client, [tx({ id: 'tx-mut', type: 'income', amount: 100000 })]);
    let s = await computeFinancialSummary(client, 'user-a', { month: 8, year: 2026 });
    expect(s.lifetime.balance).toBe(100000);

    // update: income 100000 → expense 25000
    await client.execute({
      sql: `UPDATE transactions SET type = 'expense', amount = 25000 WHERE id = 'tx-mut' AND user_id = 'user-a'`,
      args: [],
    });
    s = await computeFinancialSummary(client, 'user-a', { month: 8, year: 2026 });
    expect(s.lifetime.balance).toBe(-25000);

    // delete
    await client.execute({ sql: `DELETE FROM transactions WHERE id = 'tx-mut' AND user_id = 'user-a'`, args: [] });
    s = await computeFinancialSummary(client, 'user-a', { month: 8, year: 2026 });
    expect(s.lifetime.balance).toBe(0);
    expect(await independentTotals(client, 'user-a')).toEqual({ income: 0, expense: 0, balance: 0, count: 0 });
  });

  it('Case 12 + 14: persistence (client baru, file sama) + reload consistency', async () => {
    const { client, dbPath } = await newDb();
    await seed(client, [
      tx({ type: 'income', amount: 500000 }),
      tx({ type: 'expense', amount: 125000 }),
    ]);
    const first = await computeFinancialSummary(client, 'user-a', { month: 8, year: 2026 });

    // "reload": panggilan kedua pada client yang sama → identik.
    const second = await computeFinancialSummary(client, 'user-a', { month: 8, year: 2026 });
    expect(second).toEqual(first);

    // "server restart": client BARU membuka file yang sama → identik.
    const reopened = createClient({ url: `file:${dbPath}` });
    clients.push(reopened);
    const third = await computeFinancialSummary(reopened, 'user-a', { month: 8, year: 2026 });
    expect(third).toEqual(first);
    expect(first.lifetime.balance).toBe(375000);
    expect(await independentTotals(reopened, 'user-a')).toEqual({ income: 500000, expense: 125000, balance: 375000, count: 2 });
  });

  it('monthlyByCategory HANYA type=expense + user-scoped', async () => {
    const { client } = await newDb();
    await seed(client, [
      tx({ type: 'expense', amount: 20000, category_id: 'food', category_name: 'Makanan' }),
      tx({ type: 'expense', amount: 15000, category_id: 'food', category_name: 'Makanan' }),
      tx({ type: 'income', amount: 90000, category_id: 'gaji', category_name: 'Gaji' }),
      tx({ type: 'transfer', amount: 5000, category_id: 'food', category_name: 'Makanan' }), // transfer ≠ expense → TIDAK masuk
      tx({ type: 'expense', amount: 99999, category_id: 'food', category_name: 'Makanan', user_id: 'user-b' }),
    ]);
    const s = await computeFinancialSummary(client, 'user-a', { month: 8, year: 2026 });
    expect(s.monthlyByCategory).toEqual([
      { categoryId: 'food', categoryName: 'Makanan', total: 35000 },
    ]);
  });
});
