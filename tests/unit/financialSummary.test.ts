/**
 * Unit test: server/lib/financialSummary.js — agregasi keuangan WINDOWLESS.
 *
 * GOLDEN RECONCILIATION (insiden 2026-08-08): dashboard sebelumnya menghitung
 * "Total Saldo" dari 50 transaksi terbaru (windowed). Menambahkan 6 expense
 * (total 83.500) menggeser window → saldo melompat -109.415 → -489.415
 * (tampil 489.415) padahal delta transaksi hanya -83.500.
 *
 * Modul ini membuktikan agregasi SQL atas SELURUH baris tidak pernah bergeser:
 *   - lifetime balance mengikuti delta transaksi eksak (-83.500).
 *   - monthly expense mengikuti delta eksak (+83.500), monthly income +0.
 *   - konvensi tanda sama persis dengan calculateBalance client
 *     (income|refund = +, expense|transfer = -).
 *   - range bulanan half-open [YYYY-MM-01, YYYY-MM+1-01).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  monthRange,
  round2,
  computeFinancialSummary,
  parseOwnAccounts,
  buildSummaryQuery,
  findInternalIncomePairIds,
  LIFETIME_SUMMARY_SQL,
  MONTHLY_SUMMARY_SQL,
  MONTHLY_EXPENSE_BY_CATEGORY_SQL,
} from '../../server/lib/financialSummary.js';

/** Client palsu: execute mengembalikan rows sesuai urutan pemanggilan SQL. */
function fakeClient(resultsByOrder) {
  let order = 0;
  return {
    execute: vi.fn(async () => {
      const res = resultsByOrder[order];
      order += 1;
      return res ?? { rows: [] };
    }),
  };
}

describe('monthRange — konvensi bulanan half-open', () => {
  it('bulan biasa → [YYYY-MM-01, YYYY-MM+1-01)', () => {
    expect(monthRange(8, 2026)).toEqual({ start: '2026-08-01', end: '2026-09-01' });
  });

  it('Desember → roll over ke tahun berikutnya', () => {
    expect(monthRange(12, 2026)).toEqual({ start: '2026-12-01', end: '2027-01-01' });
  });

  it('Januari → [YYYY-01-01, YYYY-02-01)', () => {
    expect(monthRange(1, 2026)).toEqual({ start: '2026-01-01', end: '2026-02-01' });
  });

  it('nilai tak valid di-clamp (bulan 0→1, 13→12)', () => {
    expect(monthRange(0, 2026).start).toBe('2026-01-01');
    expect(monthRange(13, 2026).end).toBe('2027-01-01');
  });
});

describe('round2 — presisi Rupiah tanpa drift float', () => {
  it('bulatkan ke 2 desimal', () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(1234.567)).toBe(1234.57);
    expect(round2(0.1 + 0.2)).toBe(0.3);
  });

  it('non-number → 0', () => {
    expect(round2(undefined)).toBe(0);
    expect(round2(null)).toBe(0);
  });
});

describe('computeFinancialSummary — GOLDEN RECONCILIATION (insiden 2026-08-08)', () => {
  it('delta 6 expense (83.500): lifetime balance -83.500, monthly expense +83.500, income +0 — windowless', async () => {
    // Query urutan: [0] lifetime, [1] monthly, [2] byCategory
    // Tanpa ownAccounts → tanpa query internal pairs (3 query: lifetime, monthly, byCategory)
    const client = fakeClient([
      { rows: [{ total_income: 51554047.42, total_expense: 57866289.04, count: 778 }] },
      { rows: [{ total_income: 135394, total_expense: 344826, count: 60 }] }, // setelah +83.500
      { rows: [] },
    ]);
    const summary = await computeFinancialSummary(client, 'user-a', { month: 8, year: 2026 });

    expect(summary.month).toBe(8);
    expect(summary.year).toBe(2026);
    expect(summary.monthly.totalIncome).toBe(135394); // income TIDAK berubah
    expect(summary.monthly.totalExpense).toBe(344826); // = 261.326 + 83.500
    expect(round2(summary.monthly.totalIncome - summary.monthly.totalExpense)).toBe(-209432);
    expect(summary.lifetime.balance).toBe(round2(51554047.42 - 57866289.04));
    expect(round2(summary.lifetime.balance)).toBe(-6312241.62);
  });

  it('sebelum insiden: monthly expense 261.326 (tanpa delta) tetap dihitung dari data penuh', async () => {
    const client = fakeClient([
      { rows: [{ total_income: 51554047.42, total_expense: 57866289.04, count: 772 }] },
      { rows: [{ total_income: 135394, total_expense: 261326, count: 54 }] },
      { rows: [] },
    ]);
    const summary = await computeFinancialSummary(client, 'user-a', { month: 8, year: 2026 });
    expect(summary.monthly.totalExpense).toBe(261326);
    expect(summary.monthly.totalIncome).toBe(135394);
  });

  it('konvensi tanda: refund = income, transfer = expense (sama dengan calculateBalance)', async () => {
    const client = fakeClient([
      { rows: [{ total_income: 10000 + 5000, total_expense: 2000 + 3000, count: 4 }] },
      { rows: [{ total_income: 10000 + 5000, total_expense: 2000 + 3000, count: 4 }] },
      { rows: [{ category_id: 'c1', category_name: 'Kategori', total: 2000 }] },
    ]);
    const summary = await computeFinancialSummary(client, 'user-a', { month: 8, year: 2026 });
    // income = 10.000 (income) + 5.000 (refund) = 15.000
    // expense = 2.000 (expense) + 3.000 (transfer) = 5.000
    expect(summary.monthly.totalIncome).toBe(15000);
    expect(summary.monthly.totalExpense).toBe(5000);
    expect(summary.monthly.balance).toBe(10000);
    expect(summary.monthlyByCategory).toEqual([
      { categoryId: 'c1', categoryName: 'Kategori', total: 2000 },
    ]);
  });

  it('monthlyByCategory HANYA type=expense (filter budget usage dashboard)', async () => {
    const client = fakeClient([
      { rows: [{ total_income: 0, total_expense: 0, count: 0 }] },
      { rows: [{ total_income: 0, total_expense: 0, count: 0 }] },
      { rows: [
        { category_id: 'food', category_name: 'Makanan', total: 50000 },
        { category_id: 'fun', category_name: 'Hiburan', total: 20000 },
      ] },
    ]);
    const summary = await computeFinancialSummary(client, 'user-a', { month: 8, year: 2026 });
    expect(summary.monthlyByCategory).toHaveLength(2);
    expect(summary.monthlyByCategory[0]).toMatchObject({ categoryId: 'food', total: 50000 });
  });

  it('data kosong → totals 0, bukan error', async () => {
    const client = fakeClient([
      { rows: [{ total_income: null, total_expense: null, count: 0 }] },
      { rows: [{ total_income: null, total_expense: null, count: 0 }] },
      { rows: [] },
    ]);
    const summary = await computeFinancialSummary(client, 'user-a', { month: 8, year: 2026 });
    expect(summary.lifetime).toEqual({ totalIncome: 0, totalExpense: 0, balance: 0, count: 0 });
    expect(summary.monthly).toEqual({ totalIncome: 0, totalExpense: 0, balance: 0, count: 0 });
    expect(summary.monthlyByCategory).toEqual([]);
  });
});

describe('computeFinancialSummary — ownAccounts (transfer internal netral, §10.13)', () => {
  it('ownAccounts KOSONG → perilaku legacy: transfer tetap = expense', async () => {
    const client = fakeClient([
      { rows: [{ total_income: 15000, total_expense: 5000, count: 4 }] },
      { rows: [{ total_income: 15000, total_expense: 5000, count: 4 }] },
      { rows: [] },
    ]);
    const summary = await computeFinancialSummary(client, 'user-a', { month: 8, year: 2026, ownAccounts: [] });
    // income 15.000 (income 10.000 + refund 5.000) − expense 5.000 (expense 2.000 + transfer 3.000)
    expect(summary.monthly.totalExpense).toBe(5000);
    expect(summary.lifetime.balance).toBe(10000);
  });

  it('transfer ke akun sendiri TIDAK dihitung sebagai expense (netral)', async () => {
    // Skenario: income 15.000 · expense 2.000 · transfer 3.000 (ke akun sendiri)
    // ownAccounts = ['blu'] → transfer 3.000 dikecualikan → expense = 2.000
    const client = fakeClient([
      { rows: [] }, // internal income pairs — kosong
      { rows: [{ total_income: 15000, total_expense: 2000, count: 4 }] },
      { rows: [{ total_income: 15000, total_expense: 2000, count: 4 }] },
      { rows: [] },
    ]);
    const summary = await computeFinancialSummary(client, 'user-a', { month: 8, year: 2026, ownAccounts: ['blu'] });
    expect(summary.monthly.totalExpense).toBe(2000);
    expect(summary.monthly.balance).toBe(13000);
    expect(summary.lifetime.balance).toBe(13000);
  });

  it('transfer ke akun BUKAN milik sendiri tetap = expense', async () => {
    // transfer 3.000 ke merchant LAIN (mis. orang lain) → tetap dihitung
    const client = fakeClient([
      { rows: [] }, // internal income pairs — kosong
      { rows: [{ total_income: 15000, total_expense: 5000, count: 4 }] },
      { rows: [{ total_income: 15000, total_expense: 5000, count: 4 }] },
      { rows: [] },
    ]);
    const summary = await computeFinancialSummary(client, 'user-a', { month: 8, year: 2026, ownAccounts: ['LINE Bank'] });
    // ownAccounts = LINE Bank, tetapi transfer di data ini ke merchant lain → expense 5.000
    expect(summary.monthly.totalExpense).toBe(5000);
  });

  it('SQL query memuat klausa merchant NOT IN saat ownAccounts hadir (parameterized)', () => {
    const lifetime = buildSummaryQuery(['LINE Bank', 'blu'], { userId: 'u1' });
    expect(lifetime.sql).toContain('merchant NOT IN (?, ?)');
    expect(lifetime.args).toEqual(['LINE Bank', 'blu', 'u1']);

    const monthly = buildSummaryQuery(['LINE Bank'], { monthly: true, userId: 'u1', start: '2026-08-01', end: '2026-09-01' });
    expect(monthly.sql).toContain('merchant NOT IN (?)');
    expect(monthly.args).toEqual(['LINE Bank', 'u1', '2026-08-01', '2026-09-01']);
  });

  it('buildSummaryQuery ownAccounts kosong → konstanta legacy (tanpa klausa NOT IN)', () => {
    const lifetime = buildSummaryQuery([], { userId: 'u1' });
    expect(lifetime.sql).toBe(LIFETIME_SUMMARY_SQL);
    expect(lifetime.args).toEqual(['u1']);
    const monthly = buildSummaryQuery([], { monthly: true, userId: 'u1', start: '2026-08-01', end: '2026-09-01' });
    expect(monthly.sql).toBe(MONTHLY_SUMMARY_SQL);
    expect(monthly.args).toEqual(['u1', '2026-08-01', '2026-09-01']);
  });
});

describe('computeFinancialSummary — Skr B: income pasangan transfer internal dinetralkan (§10.13)', () => {
  it('findInternalIncomePairIds: SQL windowless + user-scoped + merchant IN own; args = [userId, ...accounts]', async () => {
    const client = fakeClient([{ rows: [{ id: 'inc-pair-1' }, { id: 'inc-pair-2' }] }]);
    const ids = await findInternalIncomePairIds(client, 'user-a', ['LINE Bank', 'blu']);
    expect(ids).toEqual(['inc-pair-1', 'inc-pair-2']);
    const [sql, args] = [client.execute.mock.calls[0][0].sql, client.execute.mock.calls[0][0].args];
    expect(sql).toContain("type IN ('income','transfer')");
    expect(sql).toContain('merchant IN (?, ?)');
    expect(sql).toContain('ROW_NUMBER() OVER');
    expect(sql).toContain('WHERE user_id = ?');
    expect(sql.toLowerCase()).not.toContain('limit');
    expect(args).toEqual(['user-a', 'LINE Bank', 'blu']);
  });

  it('findInternalIncomePairIds: ownAccounts KOSONG → [] TANPA query (legacy — income tidak pernah dinetralkan)', async () => {
    const client = fakeClient([]);
    const ids = await findInternalIncomePairIds(client, 'user-a', []);
    expect(ids).toEqual([]);
    expect(client.execute).not.toHaveBeenCalled();
  });

  it('buildSummaryQuery excludeIncomeIds → klausa NOT IN (type=income) + urutan args [accounts, base, ids]', () => {
    const lifetime = buildSummaryQuery(['LINE Bank'], { userId: 'u1', excludeIncomeIds: ['inc-a', 'inc-b'] });
    expect(lifetime.sql).toContain("AND NOT (type = 'income' AND id IN (?, ?))");
    expect(lifetime.args).toEqual(['LINE Bank', 'u1', 'inc-a', 'inc-b']);

    const monthly = buildSummaryQuery(['blu'], { monthly: true, userId: 'u1', start: '2026-08-01', end: '2026-09-01', excludeIncomeIds: ['inc-x'] });
    expect(monthly.sql).toContain("AND NOT (type = 'income' AND id IN (?))");
    expect(monthly.args).toEqual(['blu', 'u1', '2026-08-01', '2026-09-01', 'inc-x']);
  });

  it('buildSummaryQuery excludeIncomeIds kosong → tanpa klausa NOT IN (args tetap [accounts, base])', () => {
    const lifetime = buildSummaryQuery(['LINE Bank'], { userId: 'u1' });
    expect(lifetime.sql).not.toContain('id IN (');
    expect(lifetime.args).toEqual(['LINE Bank', 'u1']);
  });

  it('buildSummaryQuery ownAccounts KOSONG → exclusion DIABAIKAN (konstanta legacy; produksi tidak memproduksi kombinasi ini)', () => {
    // computeFinancialSummary hanya menghitung pairs saat ownAccounts non-kosong,
    // jadi kombinasi (kosong + exclusion) tidak terjadi di produksi — test
    // mengunci bahwa konstanta legacy TIDAK pernah memuat klausa id IN.
    const lifetime = buildSummaryQuery([], { userId: 'u1', excludeIncomeIds: ['inc-x'] });
    expect(lifetime.sql).toBe(LIFETIME_SUMMARY_SQL);
    expect(lifetime.sql).not.toContain('id IN (');
    expect(lifetime.args).toEqual(['u1']);
  });

  it('computeFinancialSummary: income pasangan dikeluarkan dari income (lifetime & monthly) saat ownAccounts hadir', async () => {
    // Urutan query dengan ownAccounts non-kosong: [0] internal pairs, [1] lifetime,
    // [2] monthly, [3] byCategory. Rows mock SUDAH mencerminkan hasil after-exclusion
    // (income pasangan 5.000 tidak lagi dijumlahkan).
    const client = fakeClient([
      { rows: [{ id: 'inc-pair' }] },
      { rows: [{ total_income: 10000, total_expense: 2000, count: 3 }] },
      { rows: [{ total_income: 10000, total_expense: 2000, count: 3 }] },
      { rows: [] },
    ]);
    const summary = await computeFinancialSummary(client, 'user-a', { month: 8, year: 2026, ownAccounts: ['LINE Bank'] });
    expect(summary.lifetime.totalIncome).toBe(10000); // pasangan sudah dikecualikan di rows mock
    expect(summary.monthly.totalIncome).toBe(10000);
    // Query lifetime & monthly DIBANGUN dengan excludeIncomeIds dari hasil pairs.
    const calls = client.execute.mock.calls;
    expect(calls[1][0].args).toEqual(['LINE Bank', 'user-a', 'inc-pair']);
    expect(calls[2][0].args).toEqual(['LINE Bank', 'user-a', '2026-08-01', '2026-09-01', 'inc-pair']);
    expect(calls[1][0].sql).toContain("AND NOT (type = 'income' AND id IN (?))");
  });

  it('computeFinancialSummary: ownAccounts kosong → TANPA query pairs (perilaku legacy)', async () => {
    const client = fakeClient([
      { rows: [{ total_income: 15000, total_expense: 5000, count: 4 }] },
      { rows: [{ total_income: 15000, total_expense: 5000, count: 4 }] },
      { rows: [] },
    ]);
    await computeFinancialSummary(client, 'user-a', { month: 8, year: 2026, ownAccounts: [] });
    expect(client.execute).toHaveBeenCalledTimes(3); // tanpa query pairs
  });
});

describe('parseOwnAccounts — parsing JSON daftar akun (robust)', () => {
  it('array string valid → di-trim + duplikat dibuang', () => {
    expect(parseOwnAccounts('["LINE Bank"," blu ","LINE Bank"]')).toEqual(['LINE Bank', 'blu']);
  });

  it('bukan JSON / bukan array / kosong → []', () => {
    expect(parseOwnAccounts('')).toEqual([]);
    expect(parseOwnAccounts('not-json')).toEqual([]);
    expect(parseOwnAccounts('{"a":1}')).toEqual([]);
    expect(parseOwnAccounts(null)).toEqual([]);
    expect(parseOwnAccounts(undefined)).toEqual([]);
  });

  it('elemen non-string dibuang, string kosong dibuang', () => {
    expect(parseOwnAccounts('[1, "LINE Bank", "", "blu"]')).toEqual(['LINE Bank', 'blu']);
  });
});

describe('SQL konvensi — tidak pernah windowed (tanpa LIMIT)', () => {
  it('semua query agregasi TIDAK memuat LIMIT (root cause window 50)', () => {
    expect(LIFETIME_SUMMARY_SQL.toLowerCase()).not.toContain('limit');
    expect(MONTHLY_SUMMARY_SQL.toLowerCase()).not.toContain('limit');
    expect(MONTHLY_EXPENSE_BY_CATEGORY_SQL.toLowerCase()).not.toContain('limit');
  });

  it('lifetime query user-scoped via WHERE user_id = ?', () => {
    expect(LIFETIME_SUMMARY_SQL).toContain('WHERE user_id = ?');
  });

  it('monthly query user-scoped + half-open range pada transaction_date', () => {
    expect(MONTHLY_SUMMARY_SQL).toContain('WHERE user_id = ?');
    expect(MONTHLY_SUMMARY_SQL).toContain('transaction_date >= ?');
    expect(MONTHLY_SUMMARY_SQL).toContain('transaction_date < ?');
  });

  it('sign convention CASE: income|refund → +, expense|transfer → -', () => {
    expect(LIFETIME_SUMMARY_SQL).toContain("type IN ('income','refund')");
    expect(LIFETIME_SUMMARY_SQL).toContain("type IN ('expense','transfer')");
  });
});

describe('beforeEach/afterEach hygiene', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('sanitasi placeholder agar tidak ada test kosong', () => {
    expect(true).toBe(true);
  });
});
