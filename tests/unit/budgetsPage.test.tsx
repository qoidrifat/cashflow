/**
 * Unit test: src/features/budgets/BudgetsPage.tsx — HALAMAN PENUH (P2.3).
 *
 * Memperluas budgetCard.test.tsx (widget saja) ke level halaman: wiring
 * listenToBudgets/listenToTransactions → budgetsWithUsage (status dihitung
 * dari transaksi bulan berjalan) → render BudgetCard / EmptyState / skeleton,
 * plus interaksi CRUD (Buat Budget → modal → Simpan → addBudget; hapus →
 * konfirmasi → deleteBudget).
 *
 * Mocking hanya boundary (P2.3 §19): service budget/transaksi/notifikasi,
 * store auth/toast, framer-motion (animasi tidak dieksekusi di happy-dom).
 * Business rule TIDAK diubah — getBudgetStatus asli (≥80% warning, ≥100%
 * overbudget) dipakai untuk fixture status.
 *
 * Kontrak yang di-lock:
 *   - loading → skeleton (belum ada konten budget)
 *   - empty  → EmptyState "Belum ada budget" + CTA "Buat Budget"
 *   - safe/warning/overbudget → label status (Aman/Waspada/Overbudget)
 *   - boundary usage 0% / 100% / >100% → status & notifikasi yang tepat
 *   - kategori kosong → tidak crash
 *   - error callback → degrade ke empty (tidak crash)
 *   - create/delete → service dipanggil dengan (uid, data)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import BudgetsPage from '../../src/features/budgets/BudgetsPage';
import type { Budget, Transaction } from '../../src/types';
import type { BudgetFormData } from '../../src/types';

// ── Boundary mocks ──────────────────────────────────────────────────────────

// framer-motion: motion.div → div polos, motion.button → <button> (role
// button untuk getByRole); prop animasi di-strip (happy-dom tanpa rAF).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('framer-motion')>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const strip = ({ initial, animate, exit, transition, whileTap, whileHover, whileFocus, variants, layout, layoutId, custom, ...rest }: Record<string, any>) => rest;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Div = (p: Record<string, any>) => <div {...strip(p)}>{p.children}</div>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Btn = (p: Record<string, any>) => (
    <button type="button" {...strip(p)}>
      {p.children}
    </button>
  );
  return { ...actual, motion: { div: Div, button: Btn } };
});

const authState = {
  authUser: { uid: 'user-1', email: 'user@cashflow.test' },
  logout: vi.fn(),
  setLogoutAnimationActive: vi.fn(),
};
vi.mock('../../src/store/useAuthStore', () => ({
  useAuthStore: (sel: (s: typeof authState) => unknown) => sel(authState),
}));

// useAppStore di-mock lengkap: addToast (BudgetPage) + bidang yang dibaca
// NotificationBell (Header) via useNotifications — tanpa ini `notifications`
// undefined → crash di useNotifications.filter.
const toastState = {
  addToast: vi.fn(),
  notifications: [] as unknown[],
  notificationLoading: false,
  realtimeConnected: false,
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
  removeNotification: vi.fn(),
  setNotifications: vi.fn(),
};
vi.mock('../../src/store/useAppStore', () => ({
  useAppStore: (sel: (s: typeof toastState) => unknown) => sel(toastState),
}));

// Header → ProfileDropdown memakai useNavigate — wajib ada di mock router.
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

// Service mocks — callback listener di-hold agar test bisa mengontrol timing.
const budgetListeners: Array<{
  cb: (data: Budget[]) => void;
  errCb?: (e: Error) => void;
}> = [];
const transactionListeners: Array<{
  cb: (data: Transaction[]) => void;
}> = [];

vi.mock('../../src/services/budgetService', () => ({
  listenToBudgets: (_uid: string, cb: (d: Budget[]) => void, errCb?: (e: Error) => void) => {
    budgetListeners.push({ cb, errCb });
    return () => {};
  },
  addBudget: vi.fn(),
  deleteBudget: vi.fn(),
  updateBudget: vi.fn(),
}));

vi.mock('../../src/services/transactionService', () => ({
  listenToTransactions: (_uid: string, cb: (d: Transaction[]) => void) => {
    transactionListeners.push({ cb });
    return () => {};
  },
  getAllTransactions: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/services/notificationTriggers', () => ({
  triggerBudgetOverNotification: vi.fn().mockResolvedValue(undefined),
  triggerBudgetWarningNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/services/aiInsightService', () => ({
  buildBudgetRecommendations: vi.fn().mockReturnValue([]),
}));

// ── Fixtures ────────────────────────────────────────────────────────────────

function makeBudget(overrides: Partial<Budget> = {}): Budget {
  return {
    id: 'budget-1',
    userId: 'user-1',
    categoryId: 'cat-food',
    categoryName: 'Makanan & Minuman',
    amount: 1000000,
    usedAmount: 0,
    month: new Date().getMonth() + 1,
    year: new Date().getFullYear(),
    status: 'safe',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeExpense(overrides: Partial<Transaction> = {}): Transaction {
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-15`;
  return {
    id: 'tx-1',
    userId: 'user-1',
    type: 'expense',
    amount: 400000,
    categoryId: 'cat-food',
    categoryName: 'Makanan & Minuman',
    merchant: 'GoFood',
    note: '',
    date,
    transactionDate: date,
    source: 'manual',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    ...overrides,
  } as Transaction;
}

/** Render halaman + flush listener budget (data default []). */
function renderPage() {
  const view = render(<BudgetsPage />);
  return view;
}

function flushBudgets(data: Budget[], err?: Error) {
  const l = budgetListeners.pop();
  if (!l) throw new Error('listenToBudgets belum dipanggil');
  // act: cb memicu setState (setBudgets/setLoading) — harus di-flush dalam act
  // agar update React benar-benar ter-render sebelum assertion berikutnya.
  act(() => {
    if (err) l.errCb?.(err);
    else l.cb(data);
  });
}

function flushTransactions(data: Transaction[]) {
  const l = transactionListeners.pop();
  if (!l) throw new Error('listenToTransactions belum dipanggil');
  act(() => l.cb(data));
}

beforeEach(() => {
  budgetListeners.length = 0;
  transactionListeners.length = 0;
  vi.clearAllMocks();
});

// ── Scenarios ───────────────────────────────────────────────────────────────

describe('BudgetsPage — loading & empty', () => {
  it('loading → skeleton (konten budget belum muncul)', () => {
    renderPage();
    expect(screen.queryByText('Belum ada budget')).toBeNull();
    expect(screen.queryByText('Aman')).toBeNull();
  });

  it('empty (budget []) → EmptyState + CTA "Buat Budget"', () => {
    renderPage();
    flushBudgets([]);
    expect(screen.getByText('Belum ada budget')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Buat Budget' })).toBeInTheDocument();
  });

  it('error callback → degrade ke empty tanpa crash', () => {
    renderPage();
    flushBudgets([], new Error('network down'));
    expect(screen.getByText('Belum ada budget')).toBeInTheDocument();
  });
});

describe('BudgetsPage — status dari transaksi bulan berjalan', () => {
  it('safe: tanpa transaksi kategori → used 0 → label "Aman"', () => {
    renderPage();
    flushBudgets([makeBudget()]);
    flushTransactions([]);
    expect(screen.getByText('Aman')).toBeInTheDocument();
  });

  it('warning: usage 85% (≥80%) → "Waspada" + notifikasi warning', async () => {
    const { triggerBudgetWarningNotification } = await import('../../src/services/notificationTriggers');
    renderPage();
    flushBudgets([makeBudget()]); // amount 1.000.000
    flushTransactions([makeExpense({ amount: 850000 })]);
    expect(screen.getByText('Waspada')).toBeInTheDocument();
    await waitFor(() =>
      expect(vi.mocked(triggerBudgetWarningNotification)).toHaveBeenCalled(),
    );
  });

  it('overbudget 100% boundary (used == amount) → "Overbudget"', async () => {
    const { triggerBudgetOverNotification } = await import('../../src/services/notificationTriggers');
    renderPage();
    flushBudgets([makeBudget()]);
    flushTransactions([makeExpense({ amount: 1000000 })]);
    expect(screen.getByText('Overbudget')).toBeInTheDocument();
    await waitFor(() =>
      expect(vi.mocked(triggerBudgetOverNotification)).toHaveBeenCalled(),
    );
  });

  it('overbudget >100% (used 1.2× amount) → "Overbudget" (progress di-clamp di BudgetCard)', () => {
    renderPage();
    flushBudgets([makeBudget()]);
    flushTransactions([makeExpense({ amount: 1200000 })]);
    expect(screen.getByText('Overbudget')).toBeInTheDocument();
  });

  it('kategori kosong → kartu tetap render tanpa crash', () => {
    renderPage();
    flushBudgets([makeBudget({ categoryName: '', categoryId: '' })]);
    expect(screen.getByText('Aman')).toBeInTheDocument();
  });
});

describe('BudgetsPage — CRUD', () => {
  it('create: "Buat Budget" → modal → pilih kategori + nominal → Simpan → addBudget(uid, form)', async () => {
    const { addBudget } = await import('../../src/services/budgetService');
    renderPage();
    flushBudgets([]);
    fireEvent.click(screen.getByRole('button', { name: 'Buat Budget' }));

    // Label modal tidak pakai htmlFor → kueri role/placeholder (user-visible).
    const select = screen.getByRole('combobox');
    // Id kategori REAL dari EXPENSE_CATEGORIES — selectedOptions[0] valid.
    fireEvent.change(select, { target: { value: 'makanan-minuman' } });
    const input = screen.getByPlaceholderText('Rp 1.000.000');
    fireEvent.change(input, { target: { value: '750000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Simpan' }));

    await waitFor(() => expect(addBudget).toHaveBeenCalledTimes(1));
    const [uid, form] = vi.mocked(addBudget).mock.calls[0] as [string, BudgetFormData];
    expect(uid).toBe('user-1');
    expect(form.categoryId).toBe('makanan-minuman');
    expect(form.categoryName).toBe('Makanan & Minuman');
    expect(form.amount).toBe(750000);
  });

  it('delete: tombol hapus → konfirmasi → Hapus → deleteBudget(uid, id)', async () => {
    const { deleteBudget } = await import('../../src/services/budgetService');
    renderPage();
    flushBudgets([makeBudget({ id: 'budget-xyz' })]);
    flushTransactions([]);
    fireEvent.click(screen.getByRole('button', { name: 'Hapus budget Makanan & Minuman' }));
    expect(screen.getByText('Apakah kamu yakin ingin menghapus budget ini?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Hapus' }));
    await waitFor(() => expect(deleteBudget).toHaveBeenCalledTimes(1));
    expect(vi.mocked(deleteBudget)).toHaveBeenCalledWith('user-1', 'budget-xyz');
  });
});
