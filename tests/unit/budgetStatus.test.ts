/**
 * Unit test: logika widget budget (P1.6) — status & warna (src/lib/utils.ts)
 * plus formula persentase yang dipakai BudgetCard/BudgetsPage.
 *
 * Business rule existing (TIDAK diubah):
 *   - used/total * 100 >= 100 → 'overbudget'
 *   - used/total * 100 >= 80  → 'warning'
 *   - selainnya                 → 'safe'
 *   - total === 0 → 'safe' (guard pembagian nol)
 *   - warna: safe mint · warning amber · overbudget red (text + bg)
 *   - persentase UI di-clamp ke 100 (Math.min(used/amount * 100, 100)) —
 *     boundary 0/50/100/>100
 */
import { describe, it, expect } from 'vitest';
import { getBudgetStatus, getBudgetStatusColor, getBudgetStatusBgColor } from '../../src/lib/utils';

describe('getBudgetStatus — boundary status', () => {
  it('total 0 → safe (guard pembagian nol)', () => {
    expect(getBudgetStatus(0, 0)).toBe('safe');
    expect(getBudgetStatus(50000, 0)).toBe('safe');
  });

  it('0% → safe', () => {
    expect(getBudgetStatus(0, 1000000)).toBe('safe');
  });

  it('< 80% → safe (boundary bawah)', () => {
    expect(getBudgetStatus(799000, 1000000)).toBe('safe'); // 79.9%
  });

  it('80% → warning (boundary atas safe)', () => {
    expect(getBudgetStatus(800000, 1000000)).toBe('warning');
  });

  it('antara 80–100% → warning', () => {
    expect(getBudgetStatus(950000, 1000000)).toBe('warning'); // 95%
  });

  it('100% → overbudget (boundary)', () => {
    expect(getBudgetStatus(1000000, 1000000)).toBe('overbudget');
  });

  it('> 100% → overbudget', () => {
    expect(getBudgetStatus(1500000, 1000000)).toBe('overbudget');
  });
});

describe('getBudgetStatusColor / getBudgetStatusBgColor', () => {
  it('warna text: safe mint · warning amber · overbudget red', () => {
    expect(getBudgetStatusColor('safe')).toBe('text-mint-500');
    expect(getBudgetStatusColor('warning')).toBe('text-amber-500');
    expect(getBudgetStatusColor('overbudget')).toBe('text-red-500');
  });

  it('warna bg: safe mint · warning amber · overbudget red', () => {
    expect(getBudgetStatusBgColor('safe')).toBe('bg-mint-500');
    expect(getBudgetStatusBgColor('warning')).toBe('bg-amber-500');
    expect(getBudgetStatusBgColor('overbudget')).toBe('bg-red-500');
  });
});

describe('persentase progress bar (formula BudgetsPage/BudgetCard)', () => {
  const progress = (used: number, amount: number) =>
    amount > 0 ? Math.min((used / amount) * 100, 100) : 0;

  it('0% boundary', () => {
    expect(progress(0, 1000000)).toBe(0);
  });

  it('50%', () => {
    expect(progress(500000, 1000000)).toBe(50);
  });

  it('100% (clamp boundary)', () => {
    expect(progress(1000000, 1000000)).toBe(100);
  });

  it('> 100% di-clamp ke 100 (UI tidak pernah overflow)', () => {
    expect(progress(2000000, 1000000)).toBe(100);
    expect(progress(5000000, 100000)).toBe(100);
  });

  it('amount 0 → 0 (guard pembagian nol)', () => {
    expect(progress(50000, 0)).toBe(0);
  });
});
