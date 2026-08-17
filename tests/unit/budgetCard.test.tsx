/**
 * Unit test: src/features/budgets/BudgetCard.tsx (P1.6 — widget budget).
 *
 * Komponen di-ekstrak dari BudgetsPage (P1.6) agar perilaku user-visible
 * widget bisa di-test tanpa mock seluruh halaman. Business rule TIDAK diubah
 * (status dihitung pemanggil via getBudgetStatus; persentase di-clamp ke 100).
 *
 * framer-motion di-mock (motion.div → div polos dengan data-animate-width):
 * happy-dom tidak menjalankan rAF animasi → inline style motion selalu
 * tertahan di initial (width: 0px). Mock menangkap TARGET animate prop —
 * wiring `animate={{ width: `${percentage}%` }}` adalah kontrak yang di-lock,
 * bukan eksekusi animasinya (fungsi murni budgetProgressPercent di-lock juga).
 *
 * Kontrak yang di-lock:
 *   - label status: safe → "Aman" · warning → "Waspada" · overbudget → "Overbudget"
 *   - nominal "used / amount" dirender (formatCurrency)
 *   - overbudget → ikon peringatan (AlertTriangle → class lucide-triangle-alert)
 *   - progress: target animate width = persentase (clamp 100; amount 0 → 0)
 *   - tombol hapus (aria-label) → onDelete dipanggil dengan budget.id
 */
import { describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import BudgetCard, { budgetProgressPercent } from '../../src/features/budgets/BudgetCard';
import { formatCurrency } from '../../src/lib/utils';
import type { Budget } from '../../src/types';

// Mock PARTIAL (importOriginal): pertahankan useReducedMotion (dipakai
// CategoryIcon di dalam BudgetCard) tapi ganti motion.div → div polos dengan
// data-animate-width yang menangkap TARGET animate prop. happy-dom tidak
// menjalankan rAF animasi → inline style motion tertahan di initial (0px);
// mock ini mengunci wiring `animate={{ width: `${percentage}%` }}`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('framer-motion')>();
  const MockMotionDiv = ({
    children,
    animate,
    ...rest
  }: { children?: ReactNode; animate?: { width?: string | number } } & Record<string, any>) => (
    <div data-animate-width={String(animate?.width ?? '')} {...rest}>
      {children}
    </div>
  );
  return { ...actual, motion: { div: MockMotionDiv } };
});

function makeBudget(overrides: Partial<Budget> = {}): Budget {
  return {
    id: 'budget-1',
    userId: 'user-1',
    categoryId: 'cat-food',
    categoryName: 'Makanan & Minuman',
    amount: 1000000,
    usedAmount: 400000,
    month: 8,
    year: 2026,
    status: 'safe',
    createdAt: new Date('2026-08-01T00:00:00Z'),
    updatedAt: new Date('2026-08-01T00:00:00Z'),
    ...overrides,
  };
}

function renderCard(budget: Budget, onDelete: (id: string) => void) {
  return render(<BudgetCard budget={budget} onDelete={onDelete} />);
}

const animateWidth = (container: HTMLElement): string => {
  // Progress bar ditandai data-testid (kueri presisi — ada 2 motion.div:
  // wrapper luar tanpa width + bar dalam).
  const bar = container.querySelector('[data-testid="budget-progress-bar"]');
  if (!bar) throw new Error('progress bar (motion.div) tidak ditemukan');
  return bar.getAttribute('data-animate-width') || '';
};

describe('BudgetCard — status & nominal', () => {
  it('safe → label "Aman" + nominal used/amount', () => {
    renderCard(makeBudget({ status: 'safe', usedAmount: 400000 }), vi.fn());
    expect(screen.getByText('Aman')).toBeInTheDocument();
    expect(screen.getByText(`${formatCurrency(400000)} / ${formatCurrency(1000000)}`)).toBeInTheDocument();
  });

  it('warning → label "Waspada"', () => {
    renderCard(makeBudget({ status: 'warning' }), vi.fn());
    expect(screen.getByText('Waspada')).toBeInTheDocument();
    expect(screen.queryByText('Overbudget')).toBeNull();
  });

  it('overbudget → label "Overbudget" + ikon peringatan', () => {
    const { container } = renderCard(makeBudget({ status: 'overbudget' }), vi.fn());
    expect(screen.getByText('Overbudget')).toBeInTheDocument();
    // lucide-react 1.21: AlertTriangle → class 'lucide-triangle-alert'.
    expect(container.querySelector('.lucide-triangle-alert')).not.toBeNull();
  });

  it('kategori dirender sebagai heading', () => {
    renderCard(makeBudget({ categoryName: 'Transportasi' }), vi.fn());
    expect(screen.getByRole('heading', { name: 'Transportasi' })).toBeInTheDocument();
  });
});

describe('budgetProgressPercent — boundary murni', () => {
  it('0% · 50% · 100% · >100% clamp · amount 0 guard', () => {
    expect(budgetProgressPercent(0, 1000000)).toBe(0);
    expect(budgetProgressPercent(500000, 1000000)).toBe(50);
    expect(budgetProgressPercent(1000000, 1000000)).toBe(100);
    expect(budgetProgressPercent(2500000, 1000000)).toBe(100); // clamp
    expect(budgetProgressPercent(50000, 0)).toBe(0); // guard nol
  });
});

describe('BudgetCard — progress bar wiring (animate target)', () => {
  it('0% → animate width 0%', () => {
    const { container } = renderCard(makeBudget({ usedAmount: 0 }), vi.fn());
    expect(animateWidth(container)).toBe('0%');
  });

  it('50% → animate width 50%', () => {
    const { container } = renderCard(makeBudget({ usedAmount: 500000 }), vi.fn());
    expect(animateWidth(container)).toBe('50%');
  });

  it('100% → animate width 100%', () => {
    const { container } = renderCard(makeBudget({ usedAmount: 1000000 }), vi.fn());
    expect(animateWidth(container)).toBe('100%');
  });

  it('>100% → di-clamp ke 100% (UI tidak pernah overflow)', () => {
    const { container } = renderCard(makeBudget({ usedAmount: 2500000 }), vi.fn());
    expect(animateWidth(container)).toBe('100%');
  });

  it('amount 0 → animate width 0% (guard pembagian nol)', () => {
    const { container } = renderCard(makeBudget({ amount: 0, usedAmount: 50000 }), vi.fn());
    expect(animateWidth(container)).toBe('0%');
  });
});

describe('BudgetCard — hapus', () => {
  it('klik tombol hapus → onDelete dipanggil dengan budget.id', () => {
    const onDelete = vi.fn();
    renderCard(makeBudget({ id: 'budget-xyz' }), onDelete);
    fireEvent.click(screen.getByRole('button', { name: 'Hapus budget Makanan & Minuman' }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledWith('budget-xyz');
  });
});
