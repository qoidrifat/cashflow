import { describe, expect, it } from 'vitest';
import {
  runSimulation,
  scenarioImpactScore,
  type SimulationAdjustment,
} from '../../src/lib/simulationEngine';

const BASE = { monthlyIncome: 10_000_000, monthlyExpense: 6_000_000, balance: 20_000_000 };

describe('simulationEngine — determinisme & baseline', () => {
  it('tanpa adjustment: saldo bertambah sesuai surplus tiap bulan', () => {
    const r = runSimulation(BASE, [], { months: 3, startYear: 2026, startMonth: 1 });
    expect(r.months).toHaveLength(3);
    // surplus 4jt/bulan → saldo 20jt + 3×4jt = 32jt
    expect(r.finalBalance).toBe(32_000_000);
    expect(r.balanceDelta).toBe(12_000_000);
    expect(r.months[0].label).toBe('Januari 2026');
    expect(r.months[2].label).toBe('Maret 2026');
  });

  it('deterministik: input sama → hasil identik', () => {
    const a = runSimulation(BASE, [{ type: 'expense_pct', label: 'x', pct: -0.2 }], { months: 6 });
    const b = runSimulation(BASE, [{ type: 'expense_pct', label: 'x', pct: -0.2 }], { months: 6 });
    expect(a).toEqual(b);
  });
});

describe('simulationEngine — adjustment', () => {
  it('expense_pct -20% menaikkan net cashflow', () => {
    const base = runSimulation(BASE, [], { months: 1 });
    const cut = runSimulation(BASE, [{ type: 'expense_pct', label: 'GoFood -20%', pct: -0.2 }], { months: 1 });
    // pengeluaran 6jt → 4.8jt → surplus 5.2jt vs 4jt
    expect(cut.months[0].netCashflow).toBe(5_200_000);
    expect(cut.months[0].netCashflow).toBeGreaterThan(base.months[0].netCashflow);
  });

  it('income_pct +10% dan fixed_expense dijumlahkan benar', () => {
    const r = runSimulation(
      BASE,
      [
        { type: 'income_pct', label: 'Gaji +10%', pct: 0.1 },
        { type: 'fixed_expense', label: 'Cicilan 1jt', amount: 1_000_000 },
      ],
      { months: 1 },
    );
    const m = r.months[0];
    expect(m.income).toBe(11_000_000); // 10jt × 1.1
    expect(m.expense).toBe(7_000_000); // 6jt + 1jt
    expect(m.netCashflow).toBe(4_000_000);
  });

  it('fixed_expense negatif merepresentasikan "cicilan selesai"', () => {
    const r = runSimulation(BASE, [{ type: 'fixed_expense', label: 'Cicilan selesai', amount: -1_000_000 }], { months: 1 });
    expect(r.months[0].expense).toBe(5_000_000);
  });

  it('save_monthly memisahkan tabungan dari saldo', () => {
    const r = runSimulation(BASE, [{ type: 'save_monthly', label: 'Tabung 500rb', amount: 500_000 }], { months: 2 });
    expect(r.totalSaved).toBe(1_000_000);
    // saldo = 20jt + 2×4jt surplus - 2×500rb tabungan = 27jt
    expect(r.finalBalance).toBe(27_000_000);
    expect(r.months[1].savingsAccumulated).toBe(1_000_000);
  });

  it('one_time_expense hanya dikenakan di bulan yang ditentukan', () => {
    const r = runSimulation(BASE, [{ type: 'one_time_expense', label: 'Beli laptop', amount: 15_000_000, month: 2 }], { months: 3 });
    expect(r.months[0].expense).toBe(6_000_000);
    expect(r.months[1].expense).toBe(21_000_000);
    expect(r.months[2].expense).toBe(6_000_000);
  });

  it('one_time_income default bulan 1', () => {
    const r = runSimulation(BASE, [{ type: 'one_time_income', label: 'Bonus', amount: 5_000_000 }], { months: 2 });
    expect(r.months[0].income).toBe(15_000_000);
    expect(r.months[1].income).toBe(10_000_000);
  });

  it('includeSubscriptions menambah biaya langganan ke baseline', () => {
    const r = runSimulation({ ...BASE, subscriptionsMonthly: 500_000 }, [], { months: 1, includeSubscriptions: true });
    expect(r.months[0].expense).toBe(6_500_000);
  });
});

describe('simulationEngine — batas & skor', () => {
  it('membatasi bulan 1..24', () => {
    expect(runSimulation(BASE, [], { months: 0 }).months).toHaveLength(1);
    expect(runSimulation(BASE, [], { months: 99 }).months).toHaveLength(24);
  });

  it('scenarioImpactScore 0-100 dan skenario baik > skenario buruk', () => {
    const good = runSimulation(BASE, [{ type: 'expense_pct', label: 'hemat', pct: -0.5 }], { months: 6 });
    const bad = runSimulation(BASE, [{ type: 'expense_pct', label: 'boros', pct: 0.5 }], { months: 6 });
    const scoreGood = scenarioImpactScore(good);
    const scoreBad = scenarioImpactScore(bad);
    expect(scoreGood).toBeGreaterThanOrEqual(0);
    expect(scoreGood).toBeLessThanOrEqual(100);
    expect(scoreGood).toBeGreaterThan(scoreBad);
  });

  it('adjustment kosong → skenario baseline', () => {
    const r = runSimulation(BASE, [] as SimulationAdjustment[], { months: 1 });
    expect(r.months[0].netCashflow).toBe(4_000_000);
  });
});
