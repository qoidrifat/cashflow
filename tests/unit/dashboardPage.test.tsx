/**
 * Unit test: src/features/dashboard/DashboardPage.tsx (P2.3.1).
 *
 * HALAMAN PENUH — subscription service di-mock (callback pattern):
 *   - transactionService.listenToTransactions / listenToTransactionSummary
 *     (ringkasan WINDOWLESS — sumber kebenaran kartu; watchdog 10s)
 *   - budgetService.listenToBudgets + notificationTriggers (overbudget/warning)
 *   - fraudService.getFraudSummary
 *   - recharts → stub ResponsiveContainer; framer-motion; react-router-dom;
 *     useAuthStore + useAppStore (addToast)
 *
 * Kontrak yang di-lock:
 *   - loading  → skeleton (kartu Rp0 TIDAK boleh muncul sebelum summary tiba)
 *   - summary error → ErrorState jujur "Gagal Memuat Data" (bukan kartu Rp0)
 *   - populated→ welcome + 4 quick actions + StatCards (Total Saldo,
 *                Pemasukan/Pengeluaran Bulan Ini dengan sign +/-) + chart +
 *                fraud widget + transaksi terbaru
 *   - empty    → EmptyState "Belum ada transaksi" + CTA Tambah
 *   - budget   → overbudget memicu triggerBudgetOverNotification SEKALI
 *   - chart    → ringkasan sr-only (P2.3.4) + role="img" aria-label
 *   - fraud    → openCount>0 menampilkan flag + tombol "Lihat"
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import DashboardPage from '../../src/features/dashboard/DashboardPage';

vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('framer-motion')>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const strip = (p: Record<string, any>) => {
    const { initial, animate, exit, transition, whileTap, whileHover, whileFocus, variants, layout, layoutId, custom, ...rest } = p;
    return rest;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Div = (p: Record<string, any>) => <div {...strip(p)}>{p.children}</div>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Btn = (p: Record<string, any>) => <button type="button" {...strip(p)}>{p.children}</button>;
  return { ...actual, motion: { div: Div, button: Btn } };
});

vi.mock('react-router-dom', () => ({
  Link: ({ to, children, className }: { to: string; children?: ReactNode; className?: string }) => (
    <a href={to} className={className}>{children}</a>
  ),
  useNavigate: () => vi.fn(),
}));

const authState = {
  authUser: { uid: 'user-1', email: 'user@cashflow.test', displayName: 'Dafa' },
  logout: vi.fn(),
  setLogoutAnimationActive: vi.fn(),
};
vi.mock('../../src/store/useAuthStore', () => ({
  useAuthStore: (sel: (s: typeof authState) => unknown) => sel(authState),
}));

// useAppStore di-mock lengkap: addToast (halaman) + bidang yang dibaca
// NotificationBell (Header) via useNotifications — tanpa ini `notifications`
// undefined → crash di useNotifications.filter (pola budgetsPage.test).
const appState = {
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
  useAppStore: (sel: (s: typeof appState) => unknown) => sel(appState),
}));

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  LineChart: ({ children }: { children?: ReactNode }) => <div data-testid="line-chart">{children}</div>,
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  Legend: () => null,
  CartesianGrid: () => null,
}));

const svc = vi.hoisted(() => ({
  listenToTransactions: vi.fn(),
  listenToTransactionSummary: vi.fn(),
  listenToBudgets: vi.fn(),
  getFraudSummary: vi.fn(),
  triggerBudgetOverNotification: vi.fn(),
  triggerBudgetWarningNotification: vi.fn(),
}));

vi.mock('../../src/services/transactionService', () => ({
  listenToTransactions: svc.listenToTransactions,
  listenToTransactionSummary: svc.listenToTransactionSummary,
}));

vi.mock('../../src/services/budgetService', () => ({
  listenToBudgets: svc.listenToBudgets,
}));

// fraudService juga mengekspor FRAUD_RULE_LABELS / FRAUD_SEVERITY_LABELS
// (dipakai render daftar fraud) — pertahankan asli, mock hanya fetch.
vi.mock('../../src/services/fraudService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/fraudService')>();
  return { ...actual, getFraudSummary: svc.getFraudSummary };
});

vi.mock('../../src/services/notificationTriggers', () => ({
  triggerBudgetOverNotification: svc.triggerBudgetOverNotification,
  triggerBudgetWarningNotification: svc.triggerBudgetWarningNotification,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asNever = (v: any) => v as never;

const now = new Date();
const month = now.getMonth() + 1;
const year = now.getFullYear();

const tx1 = { id: 'tx-1', type: 'income', amount: 5000000, date: now.toISOString().split('T')[0], categoryId: 'gaji', merchant: 'Gaji' };
const tx2 = { id: 'tx-2', type: 'expense', amount: 1500000, date: now.toISOString().split('T')[0], categoryId: 'makanan-minuman', merchant: 'Warung' };

/** Default boundary sukses: summary windowless + transaksi + budget kosong. */
function populatedBoundary() {
  svc.listenToTransactions.mockImplementation((_uid: string, cb: (d: unknown[]) => void) => {
    cb([tx1, tx2]);
    return () => {};
  });
  svc.listenToTransactionSummary.mockImplementation((_uid: string, _m: number, _y: number, cb: (d: unknown) => void) => {
    cb(asNever({
      lifetime: { totalIncome: 8000000, totalExpense: 3000000, balance: 5000000, count: 10 },
      monthly: { totalIncome: 5000000, totalExpense: 1500000, balance: 3500000, count: 2 },
      monthlyByCategory: [],
    }));
    return () => {};
  });
  svc.listenToBudgets.mockImplementation((_uid: string, cb: (d: unknown[]) => void) => {
    cb([]);
    return () => {};
  });
  svc.getFraudSummary.mockResolvedValue(asNever({ openCount: 0, recent: [] }));
  svc.triggerBudgetOverNotification.mockResolvedValue(undefined);
  svc.triggerBudgetWarningNotification.mockResolvedValue(undefined);
}

beforeEach(() => {
  vi.clearAllMocks();
  populatedBoundary();
});

describe('DashboardPage — loading & error', () => {
  it('loading → skeleton; kartu Rp0 TIDAK muncul sebelum summary tiba', () => {
    svc.listenToTransactionSummary.mockImplementation(() => () => {});
    render(<DashboardPage />);
    expect(screen.queryByText('Total Saldo')).toBeNull();
    expect(screen.queryByText('Ringkasan Keuangan')).toBeNull();
  });

  it('summary ERROR → ErrorState jujur (bukan kartu Rp0 yang menyesatkan)', async () => {
    svc.listenToTransactionSummary.mockImplementation((_uid: string, _m: number, _y: number, _cb: unknown, errCb: (e: Error) => void) => {
      errCb(new Error('summary down'));
      return () => {};
    });
    render(<DashboardPage />);
    await screen.findByText('Gagal Memuat Data');
    expect(appState.addToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
    expect(screen.queryByText('Arus Kas Bersih')).toBeNull();
  });
});

describe('DashboardPage — populated', () => {
  it('populated → welcome + quick actions + StatCards + chart + fraud + transaksi', async () => {
    render(<DashboardPage />);
    await screen.findByText('Ringkasan Keuangan');
    expect(screen.getByText('Halo, Dafa')).toBeInTheDocument();
    // 4 quick actions (aria-label).
    for (const label of ['Pemasukan', 'Pengeluaran', 'Scan Gmail', 'Laporan']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
    // StatCards: Arus Kas Bersih (P2.5 — lifetime net cash flow, label lama
    // "Total Saldo" di-rename) + bahasa tanda bulan ini.
    expect(screen.getByText('Arus Kas Bersih')).toBeInTheDocument();
    // P2.5: Saldo Saat Ini (ledger) — tanpa ledger → status jujur "Belum dapat dihitung".
    expect(screen.getByText('Saldo Saat Ini')).toBeInTheDocument();
    expect(screen.getByText('Rp5.000.000')).toBeInTheDocument();
    expect(screen.getByText('Pemasukan Bulan Ini')).toBeInTheDocument();
    // '+Rp5.000.000' muncul di StatCard Pemasukan DAN TransactionItem income → getAll.
    expect(screen.getAllByText('+Rp5.000.000').length).toBeGreaterThan(0);
    expect(screen.getByText('Pengeluaran Bulan Ini')).toBeInTheDocument();
    // '-Rp1.500.000' muncul di StatCard Pengeluaran DAN TransactionItem expense → getAll.
    expect(screen.getAllByText('-Rp1.500.000').length).toBeGreaterThan(0);
    // Chart + fraud + transaksi terbaru.
    expect(screen.getByTestId('line-chart')).toBeInTheDocument();
    expect(screen.getByText('Tidak ada aktivitas mencurigakan. Ledger kamu aman.')).toBeInTheDocument();
    expect(screen.getByText('Warung')).toBeInTheDocument();
  });

  it('chart punya accessible name + ringkasan sr-only (P2.3.4)', async () => {
    render(<DashboardPage />);
    await screen.findByText('Ringkasan Keuangan');
    expect(screen.getByRole('img', { name: 'Grafik garis Pemasukan dan Pengeluaran, 7 hari terakhir' })).toBeInTheDocument();
    // Ringkasan sr-only: total 7 hari (income 5jt+...; tx1 hari ini 5jt, tx2 1.5jt).
    expect(screen.getByText(/total pemasukan Rp5.000.000, total pengeluaran Rp1.500.000/)).toBeInTheDocument();
  });

  it('transaksi kosong → EmptyState "Belum ada transaksi" + CTA Tambah', async () => {
    svc.listenToTransactions.mockImplementation((_uid: string, cb: (d: unknown[]) => void) => {
      cb([]);
      return () => {};
    });
    render(<DashboardPage />);
    await screen.findByText('Ringkasan Keuangan');
    await screen.findByText('Belum ada transaksi');
    expect(screen.getByRole('button', { name: /Tambah Transaksi/ })).toBeInTheDocument();
  });

  it('Sisa Budget semantic (audit 2026-08-10): tanpa budget → label "Belum ada budget" bukan Rp0 menyesatkan', async () => {
    // populatedBoundary default: listenToBudgets cb([]) → budgetConfigured=false.
    render(<DashboardPage />);
    await screen.findByText('Ringkasan Keuangan');
    expect(screen.getByText('Sisa Budget')).toBeInTheDocument();
    expect(screen.getByText('Belum ada budget')).toBeInTheDocument();
  });

  it('Sisa Budget semantic (audit 2026-08-10): budget ada → sisa dihitung, label "Belum ada budget" tidak muncul', async () => {
    svc.listenToBudgets.mockImplementation((_uid: string, cb: (d: unknown[]) => void) => {
      cb(asNever([{ id: 'b1', name: 'Makanan', categoryId: 'makanan-minuman', amount: 1000000, month, year }]));
      return () => {};
    });
    svc.listenToTransactionSummary.mockImplementation((_uid: string, _m: number, _y: number, cb: (d: unknown) => void) => {
      cb(asNever({
        lifetime: { totalIncome: 0, totalExpense: 0, balance: 0, count: 0 },
        monthly: { totalIncome: 0, totalExpense: 0, balance: 0, count: 0 },
        // Pengeluaran kategori 400rb dari budget 1jt → sisa 600rb.
        monthlyByCategory: [{ categoryId: 'makanan-minuman', total: 400000 }],
      }));
      return () => {};
    });
    render(<DashboardPage />);
    await screen.findByText('Ringkasan Keuangan');
    expect(screen.getByText('Sisa Budget')).toBeInTheDocument();
    expect(screen.queryByText('Belum ada budget')).toBeNull();
    expect(screen.getByText('Rp600.000')).toBeInTheDocument();
  });
});

describe('DashboardPage — budget notification (Sprint 1.8)', () => {
  it('overbudget → triggerBudgetOverNotification dipanggil SEKALI', async () => {
    svc.listenToBudgets.mockImplementation((_uid: string, cb: (d: unknown[]) => void) => {
      cb(asNever([{ id: 'b1', name: 'Makanan', categoryId: 'makanan-minuman', amount: 1000000, month, year }]));
      return () => {};
    });
    svc.listenToTransactionSummary.mockImplementation((_uid: string, _m: number, _y: number, cb: (d: unknown) => void) => {
      cb(asNever({
        lifetime: { totalIncome: 0, totalExpense: 0, balance: 0, count: 0 },
        monthly: { totalIncome: 0, totalExpense: 0, balance: 0, count: 0 },
        // Pengeluaran kategori 2× lipat budget → overbudget.
        monthlyByCategory: [{ categoryId: 'makanan-minuman', total: 2000000 }],
      }));
      return () => {};
    });
    render(<DashboardPage />);
    await screen.findByText('Ringkasan Keuangan');
    await waitFor(() => expect(svc.triggerBudgetOverNotification).toHaveBeenCalledTimes(1));
    expect(svc.triggerBudgetWarningNotification).not.toHaveBeenCalled();
  });

  it('fraud openCount>0 → flag ditampilkan + tombol "Lihat"', async () => {
    svc.getFraudSummary.mockResolvedValue(asNever({
      openCount: 1,
      recent: [{ id: 'f1', merchant: 'TOKO X', amount: 500000, flagType: 'unusual_time', severity: 'high' }],
    }));
    render(<DashboardPage />);
    await screen.findByText('Ringkasan Keuangan');
    // Teks dalam <p> gabungan "TOKO X · Rp500.000" → matcher regex (bukan exact).
    await screen.findByText(/TOKO X/);
    expect(screen.getByText('1 perlu dicek')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lihat' })).toBeInTheDocument();
  });
});

describe('DashboardPage — Saldo Saat Ini (P2.5 ledger card)', () => {
  function withLedger(ledger: unknown) {
    svc.listenToTransactionSummary.mockImplementation((_uid: string, _m: number, _y: number, cb: (d: unknown) => void) => {
      cb(asNever({
        lifetime: { totalIncome: 8000000, totalExpense: 3000000, balance: 5000000, count: 10 },
        monthly: { totalIncome: 5000000, totalExpense: 1500000, balance: 3500000, count: 2 },
        monthlyByCategory: [],
        ledger,
      }));
      return () => {};
    });
  }

  it('ledger ABSEN → status jujur "Belum terverifikasi" + CTA Aktifkan Saldo (P2.8 §27, bukan Rp0)', async () => {
    render(<DashboardPage />);
    await screen.findByText('Ringkasan Keuangan');
    expect(screen.getByText('Saldo Saat Ini')).toBeInTheDocument();
    // P2.7: tanpa anchor → jangan tampilkan angka palsu — "Belum terverifikasi".
    expect(screen.getByText('Belum terverifikasi')).toBeInTheDocument();
    // P2.8 §27: tanpa rekening → CTA "Aktifkan Saldo" (bukan Verifikasi).
    expect(screen.getByRole('link', { name: /Aktifkan Saldo/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Verifikasi Saldo/ })).toBeNull();
    // Net cash flow tetap tampil terpisah sebagai Arus Kas Bersih.
    expect(screen.getByText('Arus Kas Bersih')).toBeInTheDocument();
  });

  it('ledger known (opening-based) → amount ditampilkan, badge Diketahui, CTA atur rekening', async () => {
    withLedger({
      currentBalance: { status: 'known', amount: 2250000, reason: null, message: 'ok' },
      accounts: [
        { id: 'acc-1', name: 'LINE Bank', type: 'bank', currency: 'IDR', openingBalance: 2000000, openingBalanceDate: '2026-01-01', anchor: null, verificationStatus: 'not_verified', movements: { inflow: 500000, expense: 250000, incomingTransfer: 0, outgoingTransfer: 0, internalTransferPair: 0, unresolvedTransfer: 0, count: 2 }, closingBalance: 2250000, status: 'known' },
      ],
      unclassified: { count: 0, amount: 0 },
      netCashFlow: { amount: 5000000, totalIncome: 8000000, totalExpense: 3000000 },
      reconciliationStatus: 'balanced',
    });
    render(<DashboardPage />);
    await screen.findByText('Ringkasan Keuangan');
    expect(screen.getByText('Diketahui')).toBeInTheDocument();
    // Rp2.250.000 muncul di amount card DAN baris akun → getAll.
    expect(screen.getAllByText('Rp2.250.000').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: /Atur rekening/ })).toBeInTheDocument();
  });

  it('ledger partial + unclassified → "Saldo sebagian" + warning transaksi belum ter-link + CTA rekonsiliasi', async () => {
    withLedger({
      currentBalance: { status: 'partial', amount: 1100000, reason: 'unclassified_transactions', message: 'Ada transaksi yang belum terhubung ke rekening.' },
      accounts: [
        { id: 'acc-1', name: 'LINE Bank', type: 'bank', currency: 'IDR', openingBalance: 1000000, openingBalanceDate: '2026-01-01', anchor: null, verificationStatus: 'not_verified', movements: { inflow: 100000, expense: 0, incomingTransfer: 0, outgoingTransfer: 0, internalTransferPair: 0, unresolvedTransfer: 0, count: 1 }, closingBalance: 1100000, status: 'known' },
      ],
      unclassified: { count: 2, amount: 250000 },
      netCashFlow: { amount: 5000000, totalIncome: 8000000, totalExpense: 3000000 },
      reconciliationStatus: 'warning',
    });
    render(<DashboardPage />);
    await screen.findByText('Ringkasan Keuangan');
    expect(screen.getByText('Saldo sebagian')).toBeInTheDocument();
    expect(screen.getByText(/2 transaksi belum terhubung/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Lanjutkan Rekonsiliasi/ })).toBeInTheDocument();
  });

  it('ledger VERIFIED (P2.7 anchor) → amount + badge Terverifikasi + tanggal anchor, tanpa Rp0', async () => {
    withLedger({
      currentBalance: { status: 'verified', amount: 5500000, reason: null, message: 'Saldo saat ini = saldo aktual terverifikasi per 2026-08-11 + pergerakan setelahnya.', anchorDate: '2026-08-11' },
      accounts: [
        { id: 'acc-1', name: 'blu', type: 'e-wallet', currency: 'IDR', openingBalance: null, openingBalanceDate: null, anchor: { amount: 3000000, date: '2026-08-11', verifiedAt: '2026-08-11T10:00:00Z' }, verificationStatus: 'verified', movements: { inflow: 500000, expense: 0, incomingTransfer: 0, outgoingTransfer: 0, internalTransferPair: 0, unresolvedTransfer: 0, count: 1 }, closingBalance: 3500000, status: 'anchored' },
        { id: 'acc-2', name: 'Bank Jago', type: 'bank', currency: 'IDR', openingBalance: null, openingBalanceDate: null, anchor: { amount: 2000000, date: '2026-08-11', verifiedAt: '2026-08-11T10:00:00Z' }, verificationStatus: 'verified', movements: { inflow: 0, expense: 0, incomingTransfer: 0, outgoingTransfer: 0, internalTransferPair: 0, unresolvedTransfer: 0, count: 0 }, closingBalance: 2000000, status: 'anchored' },
      ],
      unclassified: { count: 0, amount: 0 },
      netCashFlow: { amount: 996193.08, totalIncome: 8000000, totalExpense: 3000000 },
      reconciliationStatus: 'balanced',
    });
    render(<DashboardPage />);
    await screen.findByText('Ringkasan Keuangan');
    expect(screen.getByText('Saldo terverifikasi')).toBeInTheDocument();
    // P0.11 — label saldo-verified TIDAK boleh tampil sebagai "Terverifikasi"
    // tanpa qualifier "saldo" (agar tidak disangka provider identity-verified).
    expect(screen.queryByText('Terverifikasi')).not.toBeInTheDocument();
    expect(screen.getAllByText(/Rp5.500.000/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/per 11 Agu 2026/).length).toBeGreaterThan(0);
    // Arus Kas Bersih tetap terpisah (nilai anchor-based TIDAK menggantikannya).
    expect(screen.getByText('Arus Kas Bersih')).toBeInTheDocument();
  });
});
