/**
 * Unit test: src/features/reports/ReportsPage.tsx (P2.3.1).
 *
 * HALAMAN PENUH — boundary di-mock:
 *   - transactionService.getAllTransactions (mock) + calculateBalance (asli,
 *     pure — dipertahankan via importOriginal)
 *   - aiInsightService.buildSpendingForecast (asli, pure) +
 *     generateMonthlyFinancialReport (mock — bisa memanggil AI/Gemini)
 *   - pdfExportService.exportMonthlyReportPdf (mock — generate blob PDF)
 *   - recharts → stub ResponsiveContainer (happy-dom tanpa ResizeObserver)
 *   - framer-motion, react-router-dom (Header), useAuthStore
 *
 * Kontrak yang di-lock:
 *   - loading  → skeleton (konten belum muncul)
 *   - empty    → EmptyState "Belum ada data laporan"
 *   - populated→ kartu Pemasukan/Pengeluaran/Net Cashflow (bahasa tanda
 *                formatSigned), AI Monthly Report, forecast, chart + pie
 *   - period   → Header "Laporan <Periode>" berubah + filter ulang
 *   - AI report→ generateMonthlyFinancialReport dipanggil otomatis saat data
 *                siap; konten (summary/risiko/rekomendasi) dirender
 *   - refresh  → tombol refresh memanggil ulang generate
 *   - export   → tombol PDF memanggil exportMonthlyReportPdf
 *   - error    → getAllTransactions REJECT → empty state, tanpa crash
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import ReportsPage from '../../src/features/reports/ReportsPage';

vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('framer-motion')>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const strip = (p: Record<string, any>) => {
    const { initial, animate, exit, transition, whileTap, whileHover, whileFocus, variants, layout, layoutId, custom, ...rest } = p;
    return rest;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Div = (p: Record<string, any>) => <div {...strip(p)}>{p.children}</div>;
  return { ...actual, motion: { div: Div } };
});

vi.mock('react-router-dom', () => ({
  Link: ({ to, children, className }: { to: string; children?: ReactNode; className?: string }) => (
    <a href={to} className={className}>{children}</a>
  ),
  useNavigate: () => vi.fn(),
}));

const authState = {
  authUser: { uid: 'user-1', email: 'user@cashflow.test' },
  logout: vi.fn(),
  setLogoutAnimationActive: vi.fn(),
};
vi.mock('../../src/store/useAuthStore', () => ({
  useAuthStore: (sel: (s: typeof authState) => unknown) => sel(authState),
}));

// recharts: ResponsiveContainer harus merender children di happy-dom (tanpa
// ResizeObserver); SVG chart tetap render polos — cukup untuk kontrak DOM.
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  BarChart: ({ children }: { children?: ReactNode }) => <div data-testid="bar-chart">{children}</div>,
  Bar: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  CartesianGrid: () => null,
  PieChart: ({ children }: { children?: ReactNode }) => <div data-testid="pie-chart">{children}</div>,
  Pie: () => null,
  Cell: () => null,
  Legend: () => null,
}));

const svc = vi.hoisted(() => ({
  getAllTransactions: vi.fn(),
  generateMonthlyFinancialReport: vi.fn(),
  exportMonthlyReportPdf: vi.fn(),
  getFinancialSettings: vi.fn(),
}));

vi.mock('../../src/services/transactionService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/transactionService')>();
  return { ...actual, getAllTransactions: svc.getAllTransactions };
});

// Paritas transfer internal netral (§10.13): getFinancialSettings di-mock —
// default [] = perilaku legacy (semua transfer = expense).
vi.mock('../../src/services/financialSettingsService', () => ({
  getFinancialSettings: svc.getFinancialSettings,
  updateFinancialSettings: vi.fn(),
}));

vi.mock('../../src/services/aiInsightService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/aiInsightService')>();
  return { ...actual, generateMonthlyFinancialReport: svc.generateMonthlyFinancialReport };
});

vi.mock('../../src/services/pdfExportService', () => ({
  exportMonthlyReportPdf: svc.exportMonthlyReportPdf,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asNever = (v: any) => v as never;

// Transaksi bulan berjalan (tanggal dinamis = hari ini) supaya filter monthly
// memasukkan keduanya; amount 0 → formatSigned tanpa tanda.
const today = new Date();
const txIncome = { id: 't1', type: 'income', amount: 5000000, date: today.toISOString().split('T')[0], categoryId: 'cat-salary', merchant: 'Gaji' };
const txExpense = { id: 't2', type: 'expense', amount: 2000000, date: today.toISOString().split('T')[0], categoryId: 'makanan-minuman', merchant: 'Warung' };

const aiReport = {
  summary: 'Ringkasan bulan ini: pemasukan lebih tinggi dari pengeluaran.',
  cashflowHealth: 'Sehat',
  generatedBy: 'local',
  generatedAt: '2026-08-09T00:00:00.000Z',
  financialHealthScore: 82,
  topRisks: ['Risiko 1: pengeluaran transport naik'],
  recommendations: ['Rekomendasi 1: kurangi belanja online'],
  savingOpportunities: ['Peluang 1: negosiasi langganan'],
  unusualSpending: ['Catatan 1: makan di luar naik'],
};

beforeEach(() => {
  vi.clearAllMocks();
  svc.getAllTransactions.mockResolvedValue(asNever([txIncome, txExpense]));
  svc.generateMonthlyFinancialReport.mockResolvedValue(asNever(aiReport));
  svc.exportMonthlyReportPdf.mockReturnValue(undefined);
  svc.getFinancialSettings.mockResolvedValue(asNever({ ownAccounts: [] }));
});

describe('ReportsPage — loading, empty, error', () => {
  it('loading → skeleton (konten belum muncul)', () => {
    svc.getAllTransactions.mockReturnValue(new Promise(() => {}));
    render(<ReportsPage />);
    expect(screen.queryByText('Belum ada data laporan')).toBeNull();
    expect(screen.queryByText('Pemasukan')).toBeNull();
  });

  it('empty → EmptyState "Belum ada data laporan"', async () => {
    svc.getAllTransactions.mockResolvedValue(asNever([]));
    render(<ReportsPage />);
    await screen.findByText('Belum ada data laporan');
    expect(screen.getByText(/Mulai catat transaksi untuk melihat laporan keuangan/)).toBeInTheDocument();
  });

  it('getAllTransactions REJECT → empty state tanpa crash (degradasi)', async () => {
    svc.getAllTransactions.mockRejectedValue(new Error('api down'));
    render(<ReportsPage />);
    await screen.findByText('Belum ada data laporan');
    expect(screen.queryByText(/api down/)).toBeNull();
  });
});

describe('ReportsPage — populated', () => {
  it('summary cards + AI report + forecast + chart + pie dirender', async () => {
    render(<ReportsPage />);
    // Summary (bahasa tanda formatSigned): '+' untuk income, '-' untuk expense.
    await screen.findByText('+Rp5.000.000');
    expect(screen.getByText('-Rp2.000.000')).toBeInTheDocument();
    expect(screen.getByText('Rp3.000.000')).toBeInTheDocument(); // Net Cashflow
    // AI report (otomatis di-generate saat data siap).
    await screen.findByText(/Ringkasan bulan ini/);
    expect(screen.getByText(/Rekomendasi 1: kurangi belanja online/)).toBeInTheDocument();
    expect(screen.getByText('82/100')).toBeInTheDocument();
    // Forecast + charts.
    expect(screen.getByText(/Forecast sampai akhir bulan/)).toBeInTheDocument();
    expect(screen.getByTestId('bar-chart')).toBeInTheDocument();
    expect(screen.getByTestId('pie-chart')).toBeInTheDocument();
  });

  it('chart punya accessible name (role="img" + aria-label) — kontrak P2.2', async () => {
    render(<ReportsPage />);
    await screen.findByText('+Rp5.000.000');
    const charts = await screen.findAllByRole('img', { name: /Grafik batang Pemasukan dan Pengeluaran harian/ });
    expect(charts.length).toBe(1);
    expect(screen.getByRole('img', { name: /Diagram lingkaran distribusi pengeluaran per kategori/ })).toBeInTheDocument();
  });

  it('ganti period → Header berubah + filter ulang (Harian)', async () => {
    render(<ReportsPage />);
    await screen.findByText('+Rp5.000.000');
    fireEvent.click(screen.getByRole('button', { name: 'Harian' }));
    await screen.findByRole('heading', { name: 'Laporan Harian' });
  });

  it('tombol refresh AI report → generateMonthlyFinancialReport dipanggil ulang', async () => {
    render(<ReportsPage />);
    await screen.findByText(/Ringkasan bulan ini/);
    const callsBefore = svc.generateMonthlyFinancialReport.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh AI report' }));
    await waitFor(() => expect(svc.generateMonthlyFinancialReport.mock.calls.length).toBeGreaterThan(callsBefore));
  });

  it('tombol PDF → exportMonthlyReportPdf dipanggil', async () => {
    render(<ReportsPage />);
    await screen.findByText('+Rp5.000.000');
    fireEvent.click(screen.getByRole('button', { name: /PDF/ }));
    expect(svc.exportMonthlyReportPdf).toHaveBeenCalledWith(expect.objectContaining({ month: expect.any(Number), year: expect.any(Number) }));
  });

  it('ownAccounts → transfer ke akun sendiri TIDAK mengurangi Net Cashflow (paritas §10.13)', async () => {
    // expense 500.000 + transfer 300.000 (ke 'blu' = akun sendiri)
    const txTransfer = { id: 't3', type: 'transfer', amount: 300000, date: today.toISOString().split('T')[0], categoryId: 'bank', merchant: 'blu' };
    svc.getAllTransactions.mockResolvedValue(asNever([txIncome, { ...txExpense, amount: 500000 }, txTransfer]));
    svc.getFinancialSettings.mockResolvedValue(asNever({ ownAccounts: ['blu'] }));
    render(<ReportsPage />);
    // Pemasukan +5.000.000 · Pengeluaran 500.000 (transfer 300.000 ke blu netral)
    await screen.findByText('+Rp5.000.000');
    expect(screen.getByText('-Rp500.000')).toBeInTheDocument();
    expect(screen.getByText('Rp4.500.000')).toBeInTheDocument(); // Net Cashflow
  });
});
