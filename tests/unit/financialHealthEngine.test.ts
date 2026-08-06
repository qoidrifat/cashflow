import { describe, expect, it } from 'vitest';
import {
  computeFinancialHealth,
  categoryForScore,
  financialHealthCategoryLabel,
  type FinancialHealthInput,
} from '../../src/lib/financialHealthEngine';

const healthy: FinancialHealthInput = {
  monthlyIncome: 10_000_000,
  monthlyExpense: 4_000_000,   // rasio 40%
  avgMonthlyIncome3m: 9_500_000,
  avgMonthlyExpense3m: 4_500_000,
  balance: 40_000_000,         // ~9 bulan coverage
  debtTotal: 0,
  budgetUsage: [0.6, 0.7],
  subscriptionsMonthly: 300_000,
  topMerchantCount: 1,
};

const critical: FinancialHealthInput = {
  monthlyIncome: 5_000_000,
  monthlyExpense: 6_000_000,   // rasio 120% — defisit
  avgMonthlyIncome3m: 5_000_000,
  avgMonthlyExpense3m: 5_500_000,
  balance: 1_000_000,          // < 1 bulan coverage
  debtTotal: 8_000_000,        // 160% dari income
  budgetUsage: [1.2, 1.1],
  subscriptionsMonthly: 1_500_000,
  topMerchantCount: 9,
};

describe('financialHealthEngine — komponen', () => {
  it('profil sehat menghasilkan semua 8 subscore', () => {
    const r = computeFinancialHealth(healthy);
    expect(r.subscores).toHaveLength(8);
    expect(r.subscores.map((s) => s.key)).toEqual([
      'saving', 'cashflow', 'budget', 'debt', 'emergency', 'income_stability', 'expense_discipline', 'growth',
    ]);
    for (const s of r.subscores) {
      expect(s.score).toBeGreaterThanOrEqual(0);
      expect(s.score).toBeLessThanOrEqual(100);
      expect(s.reason.length).toBeGreaterThan(0);
      expect(s.recommendation.length).toBeGreaterThan(0);
    }
  });

  it('tiap subscore punya reason & recommendation non-kosong bahkan pada data ekstrem', () => {
    const r = computeFinancialHealth(critical);
    for (const s of r.subscores) {
      expect(s.reason.length).toBeGreaterThan(0);
      expect(s.recommendation.length).toBeGreaterThan(0);
    }
  });

  it('profil sehat skor > profil kritis', () => {
    const healthyScore = computeFinancialHealth(healthy).score;
    const criticalScore = computeFinancialHealth(critical).score;
    expect(healthyScore).toBeGreaterThan(criticalScore);
  });

  it('debt tinggi menurunkan debt subscore', () => {
    const noDebt = computeFinancialHealth(healthy);
    const withDebt = computeFinancialHealth({ ...healthy, debtTotal: 12_000_000 });
    const debtIdx = (r: typeof noDebt) => r.subscores.find((s) => s.key === 'debt')!;
    expect(debtIdx(noDebt).score).toBe(100);
    expect(debtIdx(withDebt).score).toBeLessThan(100);
  });
});

describe('financialHealthEngine — kategori', () => {
  it('memetakan skor ke kategori benar', () => {
    expect(categoryForScore(90)).toBe('Excellent');
    expect(categoryForScore(85)).toBe('Excellent');
    expect(categoryForScore(75)).toBe('Good');
    expect(categoryForScore(60)).toBe('Average');
    expect(categoryForScore(45)).toBe('Poor');
    expect(categoryForScore(30)).toBe('Critical');
    for (const cat of ['Excellent', 'Good', 'Average', 'Poor', 'Critical'] as const) {
      expect(financialHealthCategoryLabel(cat).length).toBeGreaterThan(0);
    }
  });

  it('kategori profil sehat = Excellent/Good, kritis = Critical/Poor', () => {
    const goodCat = computeFinancialHealth(healthy).category;
    const badCat = computeFinancialHealth(critical).category;
    expect(['Excellent', 'Good']).toContain(goodCat);
    expect(['Critical', 'Poor']).toContain(badCat);
  });
});

describe('financialHealthEngine — determinisme & guard', () => {
  it('deterministik: input sama → hasil identik', () => {
    expect(computeFinancialHealth(healthy)).toEqual(computeFinancialHealth(healthy));
  });

  it('interpretation selalu ada & konsisten dengan score', () => {
    const r = computeFinancialHealth(healthy);
    expect(r.interpretation).not.toBeNull();
    expect(r.interpretation!.percent).toBe(r.score);
  });

  it('data kosong tidak crash (semua score 0-100)', () => {
    const r = computeFinancialHealth({ monthlyIncome: 0, monthlyExpense: 0, balance: 0 });
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
    expect(r.summary.length).toBeGreaterThan(0);
  });

  it('summary menunjuk subscore terendah', () => {
    const r = computeFinancialHealth(critical);
    const worst = r.subscores.reduce((min, s) => (s.score < min.score ? s : min), r.subscores[0]);
    expect(r.summary).toContain(worst.label);
  });
});
