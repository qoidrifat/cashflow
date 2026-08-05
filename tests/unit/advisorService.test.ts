/**
 * Unit tests — src/services/advisorService.ts (Sprint 1.3 Financial Advisor).
 * Fungsi murni: computeAdvisorMetrics, buildFallbackAdvisorReport,
 * normalizeAdvisorReport — diuji tanpa server/AI (pola fraudEngine.test.ts).
 */
import { describe, expect, it } from 'vitest';
import {
  computeAdvisorMetrics,
  buildFallbackAdvisorReport,
  normalizeAdvisorReport,
  type AdvisorInput,
} from '../../src/services/advisorService';
import type { Transaction } from '../../src/types';

const now = new Date('2026-08-05T00:00:00Z');

function tx(overrides: Partial<Transaction>): Transaction {
  return {
    id: `tx-${Math.random()}`,
    userId: 'u-1',
    type: 'expense',
    amount: 10000,
    categoryId: 'cat-food',
    categoryName: 'Makanan',
    merchant: 'Warung',
    paymentMethod: 'cash',
    note: '',
    date: '2026-08-01',
    source: 'manual',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function baseInput(): AdvisorInput {
  return {
    transactions: [],
    budgets: [],
    subscriptions: [],
    wallets: [],
    goals: [],
    month: 8,
    year: 2026,
  };
}

describe('computeAdvisorMetrics', () => {
  it('menghitung income/expense/ratio/savingsRate bulan berjalan', () => {
    const input = baseInput();
    input.transactions = [
      tx({ type: 'income', amount: 5_000_000 }),
      tx({ type: 'expense', amount: 2_000_000 }),
      tx({ type: 'expense', amount: 500_000 }),
      tx({ date: '2026-07-20', type: 'expense', amount: 999_999 }), // bulan lalu
    ];
    const m = computeAdvisorMetrics(input);
    expect(m.currentMonthIncome).toBe(5_000_000);
    expect(m.currentMonthExpense).toBe(2_500_000);
    expect(m.expenseRatio).toBe(0.5);
    expect(m.savingsRate).toBe(0.5);
    expect(m.avgMonthlyExpense3m).toBe(333_333); // 999999 / 3
  });

  it('expenseRatio = 1 bila tanpa income tapi ada expense (hindari pembagian nol)', () => {
    const input = baseInput();
    input.transactions = [tx({ amount: 50_000 })];
    const m = computeAdvisorMetrics(input);
    expect(m.currentMonthIncome).toBe(0);
    expect(m.expenseRatio).toBe(1);
  });

  it('meringkas topCategory & topMerchant dari transaksi expense', () => {
    const input = baseInput();
    input.transactions = [
      tx({ categoryId: 'cat-food', categoryName: 'Makanan', merchant: 'Warung', amount: 30_000 }),
      tx({ categoryId: 'cat-food', categoryName: 'Makanan', merchant: 'Warung', amount: 20_000 }),
      tx({ categoryId: 'cat-transport', categoryName: 'Transportasi', merchant: 'Gojek', amount: 40_000 }),
    ];
    const m = computeAdvisorMetrics(input);
    expect(m.topCategory?.categoryName).toBe('Makanan'); // 50k > 40k
    expect(m.topMerchant?.merchant).toBe('Warung'); // 50k total > 40k Gojek
    expect(m.topMerchant?.count).toBe(2);
  });

  it('menghitung biaya bulanan langganan per cycle', () => {
    const input = baseInput();
    input.subscriptions = [
      { name: 'Netflix', amount: 150_000, cycle: 'monthly' },
      { name: 'Spotify', amount: 50_000, cycle: 'weekly' },
      { name: 'VPN', amount: 600_000, cycle: 'yearly' },
    ] as AdvisorInput['subscriptions'];
    const m = computeAdvisorMetrics(input);
    const byName = Object.fromEntries(m.subscriptions.map((s) => [s.name, s.monthlyCost]));
    expect(byName['Netflix']).toBe(150_000);
    expect(byName['Spotify']).toBe(Math.round(50_000 * 4.33));
    expect(byName['VPN']).toBe(50_000);
  });
});

describe('buildFallbackAdvisorReport', () => {
  it('menghasilkan semua 6 section + emergency fund (never throw, selalu lengkap)', () => {
    const input = baseInput();
    input.transactions = [
      tx({ type: 'income', amount: 10_000_000 }), // Agustus (bulan berjalan)
      // Pengeluaran tersebar di 3 bulan sebelumnya → avg 4jt/bulan
      tx({ date: '2026-07-15', type: 'expense', amount: 4_000_000 }),
      tx({ date: '2026-06-15', type: 'expense', amount: 4_000_000 }),
      tx({ date: '2026-05-15', type: 'expense', amount: 4_000_000 }),
    ];
    input.wallets = [{ balance: 12_000_000 }] as AdvisorInput['wallets'];
    const metrics = computeAdvisorMetrics(input);
    const report = buildFallbackAdvisorReport(metrics);

    expect(report.generatedBy).toBe('rule-based');
    expect(report.spendingAdvice.length).toBeGreaterThan(0);
    expect(report.savingStrategy.length).toBeGreaterThan(0);
    expect(report.budgetStrategy.length).toBeGreaterThan(0);
    expect(report.subscriptionOptimization.length).toBeGreaterThan(0);
    expect(report.actionList.length).toBeGreaterThan(0);
    expect(report.emergencyFund.monthsCoverage).toBe(3); // 12jt / avg 4jt
    expect(report.emergencyFund.targetAmount).toBe(24_000_000); // 6 x 4jt
    expect(report.summary).toContain('Agustus 2026');
  });

  it('dana darurat terbatas 99+ bulan (bukan Infinity)', () => {
    const input = baseInput();
    input.transactions = [
      tx({ date: '2026-07-15', type: 'expense', amount: 300_000 }), // avg 100k/bulan
    ];
    input.wallets = [{ balance: 500_000_000 }] as AdvisorInput['wallets'];
    const report = buildFallbackAdvisorReport(computeAdvisorMetrics(input));
    expect(report.emergencyFund.monthsCoverage).toBe(99);
  });
});

describe('normalizeAdvisorReport', () => {
  const input = baseInput();
  input.transactions = [tx({ type: 'expense', amount: 10_000 })];
  const fallback = buildFallbackAdvisorReport(computeAdvisorMetrics(input));

  it('payload AI valid → dibersihkan (trim, cap, priority whitelist)', () => {
    const report = normalizeAdvisorReport({
      summary: '  Ringkasan sehat  ',
      spendingAdvice: ['Saran A', 'Saran B', 'Saran C', 'Saran D'],
      actionList: [
        { priority: 'high', action: '  Kurangi langganan  ' },
        { priority: 'urgent', action: 'Priority tidak dikenal' },
        { action: 'Tanpa priority' },
        { priority: 'low', action: '' }, // action kosong → dibuang
      ],
      emergencyFund: { suggestion: 'Saran dana', monthsCoverage: 5, targetAmount: 1_000_000, currentAmount: 900_000 },
      subscriptionOptimization: [],
    }, fallback);

    expect(report.summary).toBe('Ringkasan sehat');
    expect(report.spendingAdvice).toEqual(['Saran A', 'Saran B', 'Saran C']); // cap 3
    expect(report.actionList.length).toBe(3); // urgent→medium, tanpa priority→medium, kosong dibuang
    expect(report.actionList[0]).toEqual({ priority: 'high', action: 'Kurangi langganan' });
    expect(report.actionList.every((a) => ['high', 'medium', 'low'].includes(a.priority))).toBe(true);
    expect(report.emergencyFund.monthsCoverage).toBe(5);
    expect(report.subscriptionOptimization).toEqual(fallback.subscriptionOptimization); // fallback bila kosong
    expect(report.generatedBy).toBe('gemini');
  });

  it('payload rusak → fallback penuh (never throw)', () => {
    const report = normalizeAdvisorReport({ notAReport: true }, fallback);
    expect(report).toEqual({
      ...fallback,
      generatedBy: 'gemini',
      generatedAt: report.generatedAt,
    });
    expect(report.summary).toBe(fallback.summary);
    expect(report.actionList).toEqual(fallback.actionList);
  });

  it('angka negatif/NaN di-clamp ke 0 (tidak pernah negatif)', () => {
    const report = normalizeAdvisorReport({
      emergencyFund: { monthsCoverage: -3, targetAmount: 'NaN', currentAmount: -5 },
    }, fallback);
    expect(report.emergencyFund.monthsCoverage).toBe(0);
    expect(report.emergencyFund.targetAmount).toBe(fallback.emergencyFund.targetAmount); // NaN → fallback
    expect(report.emergencyFund.currentAmount).toBe(0);
  });
});
