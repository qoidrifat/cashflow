/**
 * Unit test: src/features/ai-product/AiHubPage.tsx — HALAMAN PENUH (P2.3).
 *
 * Memperluas jangkauan AI hub dari E2E (seed + auth nyata) ke unit: kontrol
 * penuh atas data (transaksi/budget/service) dan boundary AI (computeAdvisorMetrics,
 * computeFinancialHealth, buildFallbackMonthlyReport, aiProductService).
 * Business logic AI TIDAK di-mock — hanya boundary service/pure-function yang
 * dipanggil halaman; logika degradasi (getAllTransactions reject → degrade ke
 * kosong, tidak crash) di-lock sebagai contract.
 *
 * Kontrak yang di-lock:
 *   - loading   → skeleton (ChartSkeleton; konten belum muncul)
 *   - empty     → EmptyState "Belum ada data untuk analisis AI" (metrics null)
 *   - populated → heading "Dashboard keuangan cerdas kamu" + trust meta +
 *                 CTA "Tanya AI" (Link → /ai/chat) + insight summary +
 *                 kartu Rekomendasi + skor kesehatan
 *   - error     → getAllTransactions REJECT → degrade ke populated (tanpa
 *                 crash, tanpa error mentah)
 *   - telemetry → trackAiProductEvent dipanggil (ai_hub_view, ai_result_shown)
 *
 * Mocking boundary: service transaksi/budget/professional-suite/ai-product,
 * pure-function AI (advisor/health/insight), store auth, react-router-dom
 * (Link), framer-motion (animasi tidak dieksekusi di happy-dom).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import AiHubPage from '../../src/features/ai-product/AiHubPage';

// ── Boundary mocks ──────────────────────────────────────────────────────────

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

vi.mock('react-router-dom', () => ({
  Link: ({ to, children, className }: { to: string; children?: ReactNode; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
  // Header → ProfileDropdown memakai useNavigate — wajib ada di mock.
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

const svc = vi.hoisted(() => ({
  getAllTransactions: vi.fn(),
  listenToBudgets: vi.fn(),
  getWalletAccounts: vi.fn(),
  getSavingGoals: vi.fn(),
  getSubscriptions: vi.fn(),
  computeAdvisorMetrics: vi.fn(),
  computeFinancialHealth: vi.fn(),
  buildFallbackMonthlyReport: vi.fn(),
  listMemory: vi.fn(),
  listTimeline: vi.fn(),
  trackAiProductEvent: vi.fn(),
  addTimelineEntry: vi.fn(),
  upsertMemory: vi.fn(),
  updateMemory: vi.fn(),
  deleteMemory: vi.fn(),
}));

vi.mock('../../src/services/transactionService', () => ({
  getAllTransactions: svc.getAllTransactions,
}));

vi.mock('../../src/services/budgetService', () => ({
  listenToBudgets: svc.listenToBudgets,
}));

vi.mock('../../src/services/professionalSuiteService', () => ({
  getWalletAccounts: svc.getWalletAccounts,
  getSavingGoals: svc.getSavingGoals,
  getSubscriptions: svc.getSubscriptions,
}));

vi.mock('../../src/services/advisorService', () => ({
  computeAdvisorMetrics: svc.computeAdvisorMetrics,
}));

vi.mock('../../src/lib/financialHealthEngine', () => ({
  computeFinancialHealth: svc.computeFinancialHealth,
}));

vi.mock('../../src/services/aiInsightService', () => ({
  buildFallbackMonthlyReport: svc.buildFallbackMonthlyReport,
}));

vi.mock('../../src/services/aiProductService', () => ({
  listMemory: svc.listMemory,
  upsertMemory: svc.upsertMemory,
  updateMemory: svc.updateMemory,
  deleteMemory: svc.deleteMemory,
  listTimeline: svc.listTimeline,
  addTimelineEntry: svc.addTimelineEntry,
  trackAiProductEvent: svc.trackAiProductEvent,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asNever = (v: any) => v as never;

/** Boundary sukses default: halaman populated. */
function populatedBoundary() {
  svc.getAllTransactions.mockResolvedValue([]);
  svc.listenToBudgets.mockImplementation(
    (_uid: string, cb: (d: unknown[]) => void) => {
      // fetchOnce halaman mereferensikan `unsub` di callback — callback harus
      // async (setTimeout) agar unsub sudah ter-assign (TDZ otherwise).
      setTimeout(() => cb([]), 0);
      return () => {};
    },
  );
  svc.getWalletAccounts.mockResolvedValue([]);
  svc.getSavingGoals.mockResolvedValue([]);
  svc.getSubscriptions.mockResolvedValue([]);
  svc.computeAdvisorMetrics.mockReturnValue(
    asNever({
      month: 8,
      year: 2026,
      currentMonthIncome: 8000000,
      currentMonthExpense: 6000000,
      avgMonthlyIncome3m: 7500000,
      avgMonthlyExpense3m: 5800000,
      expenseRatio: 0.75,
      savingsRate: 0.25,
      totalBalance: 25000000,
      transactionCount: 42,
      topCategory: null,
      topMerchant: null,
      budgetUsage: [],
      subscriptions: [],
      goals: { totalTarget: 0, totalCurrent: 0 },
      forecastProjectedExpense: 6000000,
    }),
  );
  svc.computeFinancialHealth.mockReturnValue(
    asNever({
      score: 82,
      category: 'Sehat',
      interpretation: { label: 'Sehat', percent: 82, bucket: 'high' },
      subscores: [],
      summary: 'Kondisi keuangan kamu sehat.',
    }),
  );
  svc.buildFallbackMonthlyReport.mockReturnValue(
    asNever({
      summary: 'Ringkasan bulan ini: pemasukan lebih tinggi dari pengeluaran.',
      generatedAt: '2026-08-09T00:00:00.000Z',
      savingOpportunities: [],
      topRisks: [],
      recommendations: ['Rekomendasi 1: kurangi belanja online'],
    }),
  );
  svc.listMemory.mockResolvedValue([]);
  svc.listTimeline.mockResolvedValue(asNever({ items: [] }));
  svc.trackAiProductEvent.mockResolvedValue(undefined);
  svc.addTimelineEntry.mockResolvedValue(undefined);
}

beforeEach(() => {
  vi.clearAllMocks();
  populatedBoundary();
});

// ── Scenarios ───────────────────────────────────────────────────────────────

describe('AiHubPage — loading & empty & populated', () => {
  it('loading → skeleton (konten AI belum muncul)', () => {
    svc.getAllTransactions.mockReturnValue(new Promise(() => {})); // gantung
    render(<AiHubPage />);
    expect(screen.queryByText('Dashboard keuangan cerdas kamu')).toBeNull();
    expect(screen.queryByText('Belum ada data untuk analisis AI')).toBeNull();
  });

  it('empty (metrics null) → EmptyState "Belum ada data untuk analisis AI"', async () => {
    svc.computeAdvisorMetrics.mockReturnValue(null as never);
    render(<AiHubPage />);
    await screen.findByText('Belum ada data untuk analisis AI');
    expect(screen.getByText(/Catat pemasukan dan pengeluaran terlebih dahulu/)).toBeInTheDocument();
  });

  it('populated → hero heading + trust meta + CTA "Tanya AI" + rekomendasi + skor kesehatan', async () => {
    render(<AiHubPage />);
    await screen.findByRole('heading', { name: 'Dashboard keuangan cerdas kamu' });
    // Trust meta: model rule-based → label deterministik (AiTrustMeta P1.3).
    expect(screen.getByText(/Aturan lokal/)).toBeInTheDocument();
    // CTA navigasi → /ai/chat
    const cta = screen.getByRole('link', { name: /Tanya AI/ });
    expect(cta).toHaveAttribute('href', '/ai/chat');
    // Insight summary + kartu rekomendasi + skor kesehatan
    expect(screen.getByText(/Ringkasan bulan ini/)).toBeInTheDocument();
    expect(screen.getByText('Rekomendasi 1: kurangi belanja online')).toBeInTheDocument();
    expect(screen.getByText('82')).toBeInTheDocument();
    expect(screen.getByText('Sehat')).toBeInTheDocument();
  });
});

describe('AiHubPage — error & telemetry', () => {
  it('getAllTransactions REJECT → degrade ke populated tanpa crash', async () => {
    svc.getAllTransactions.mockRejectedValue(new Error('api down'));
    render(<AiHubPage />);
    // Degradasi: data transaksi kosong, TAPI halaman tetap render (bukan
    // error mentah / crash).
    await screen.findByRole('heading', { name: 'Dashboard keuangan cerdas kamu' });
    expect(screen.queryByText(/api down/)).toBeNull();
  });

  it('telemetry exposure: ai_hub_view + ai_result_shown di-fire (denominator P10.2i)', async () => {
    render(<AiHubPage />);
    await screen.findByRole('heading', { name: 'Dashboard keuangan cerdas kamu' });
    await waitFor(() => {
      expect(svc.trackAiProductEvent).toHaveBeenCalledWith('ai_hub_view');
      expect(svc.trackAiProductEvent).toHaveBeenCalledWith('ai_result_shown', { feature: 'insight' });
      expect(svc.trackAiProductEvent).toHaveBeenCalledWith('ai_result_shown', { feature: 'health' });
    });
  });

  it('timeline kosong → kartu timeline tetap render tanpa crash (listTimeline dipanggil)', async () => {
    render(<AiHubPage />);
    await screen.findByRole('heading', { name: 'Dashboard keuangan cerdas kamu' });
    await waitFor(() => expect(svc.listTimeline).toHaveBeenCalled());
  });
});
