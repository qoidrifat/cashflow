/**
 * Unit test: src/pages/admin/MonitoringPage.tsx — HALAMAN PENUH (P2.3).
 *
 * Memperluas jangkauan admin dari E2E (auth + seed) ke unit: kontrol penuh
 * atas respons SEMUA endpoint /api/admin/metrics/* (mock boundary service —
 * bukan mock business logic). Panel observability bonus (cache, engagement,
 * feedback, retention, rekomendasi, feedback-rate, telemetry) memakai
 * `.catch(() => null)` di halaman — kegagalan panel TIDAK boleh menjatuhkan
 * halaman; di-lock sebagai regression guard.
 *
 * Kontrak yang di-lock:
 *   - loading   → skeleton (kartu metric belum muncul)
 *   - populated → kartu metric (Biaya/Tokem/Calls/Avg Time) + heading panel
 *   - empty     → panel dengan data kosong → "Belum ada data pada rentang ini."
 *                 tanpa crash
 *   - 403       → error banner "Akses ditolak" (ADMIN_METRICS_403) + TANPA
 *                 tombol retry (403 bukan transient)
 *   - 500       → error banner + "Coba Lagi" → refetch → sembuh
 *   - partial   → fetchFeedbackSummary GAGAL → halaman tetap render metric
 *                 (panel non-kritikal di-degrade, bukan halaman penuh)
 *
 * Mocking boundary: src/services/adminMetrics (seluruh fetch), useAuthStore,
 * react-router-dom (useNavigate), recharts (chart → stub; happy-dom tidak
 * punya ResizeObserver untuk ResponsiveContainer), framer-motion.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import MonitoringPage from '../../src/pages/admin/MonitoringPage';

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
  useNavigate: () => vi.fn(),
}));

const authState = {
  authUser: { uid: 'admin-1', email: 'admin@cashflow.test' },
  logout: vi.fn(),
  setLogoutAnimationActive: vi.fn(),
};
vi.mock('../../src/store/useAuthStore', () => ({
  useAuthStore: (sel: (s: typeof authState) => unknown) => sel(authState),
}));

// recharts: ResponsiveContainer harus merender children (konten panel di
// luarnya); primitif chart → stub kosong (tidak ada ResizeObserver di happy-dom).
vi.mock('recharts', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Null = () => null;
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
    LineChart: Null,
    Line: Null,
    XAxis: Null,
    YAxis: Null,
    Tooltip: Null,
    CartesianGrid: Null,
    Legend: Null,
  };
});

const service = vi.hoisted(() => ({
  fetchMetricsSummary: vi.fn(),
  fetchAiUsage: vi.fn(),
  fetchFeatureHealth: vi.fn(),
  fetchAlerts: vi.fn(),
  fetchAICacheStats: vi.fn(),
  fetchAgentSearchEngagement: vi.fn(),
  fetchFeedbackSummary: vi.fn(),
  fetchRetentionMetrics: vi.fn(),
  fetchRecommendationEngagement: vi.fn(),
  fetchFeedbackRate: vi.fn(),
  fetchTelemetryUsers: vi.fn(),
}));
vi.mock('../../src/services/adminMetrics', () => service);

// ── Fixtures minimal (tipe penuh nested di-degrade via cast — kontrak yang
// di-lock adalah yang DIBACA halaman, bukan seluruh interface) ───────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asNever = (v: any) => v as never;

function populatedService() {
  service.fetchMetricsSummary.mockResolvedValue(
    asNever({
      ok: true,
      today: { costIdr: 12000, tokens: 34000, calls: 42, avgTimeMs: 850 },
      week: { costIdr: 50000, tokens: 100000, calls: 200, avgTimeMs: 900 },
      month: { costIdr: 200000, tokens: 400000, calls: 800, avgTimeMs: 910 },
      features: { insight: { feature: 'insight', costIdr: 12000, tokens: 34000, calls: 42 } },
    }),
  );
  service.fetchAiUsage.mockResolvedValue(
    asNever({
      ok: true,
      summary: { costIdr: 0, costUsd: 0, tokens: 0, calls: 0, avgTimeMs: 0, features: {} },
      trend: [],
      trendByFeature: [],
      cacheByFeature: [],
    }),
  );
  service.fetchFeatureHealth.mockResolvedValue(asNever({ ok: true, health: [] }));
  service.fetchAlerts.mockResolvedValue(asNever({ ok: true, alerts: [] }));
  service.fetchAICacheStats.mockResolvedValue(asNever({ ok: true, size: 0, maxEntries: 200, hits: 0, misses: 0, sets: 0, evictions: 0, hitRate: 0, inflight: 0 }));
  service.fetchAgentSearchEngagement.mockResolvedValue(asNever({ ok: true, searches: 0, clicks: 0, suggestionsUsed: 0, ctr: 0, topSuggestedQueries: [], clicksByTab: [], suggestionsByTab: [] }));
  service.fetchFeedbackSummary.mockResolvedValue(
    asNever({ ok: true, totalFeedback: 0, overallNegativeRate: 0, featuresWithFeedback: 0, features: [], actionPlan: [], topPriority: null }),
  );
  service.fetchRetentionMetrics.mockResolvedValue(
    asNever({ ok: true, totalCohorts: 0, totalCohortUsers: 0, cohortGuardActive: true, minCohortUsers: 10, cohorts: [], days: [] }),
  );
  service.fetchRecommendationEngagement.mockResolvedValue(asNever({ ok: true, shown: 10, opened: 4, ctr: 0.4, byFeature: [], byDay: [], byEventType: [] }));
  service.fetchFeedbackRate.mockResolvedValue(asNever({ ok: true, feedback: 0, views: 0, rate: 0, byFeature: [] }));
  service.fetchTelemetryUsers.mockResolvedValue(asNever({ ok: true, users: [] }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Scenarios ───────────────────────────────────────────────────────────────

describe('MonitoringPage — loading & populated & empty', () => {
  it('loading → skeleton (kartu metric belum muncul)', () => {
    service.fetchMetricsSummary.mockReturnValue(new Promise(() => {})); // gantung
    render(<MonitoringPage />);
    expect(screen.queryByText('Biaya Hari Ini')).toBeNull();
    expect(screen.queryByText('Token Hari Ini')).toBeNull();
  });

  it('populated → kartu metric + heading panel (Rekomendasi AI, Feedback Rate, Retensi)', async () => {
    populatedService();
    render(<MonitoringPage />);
    await screen.findByText('Biaya Hari Ini');
    expect(screen.getByText('Token Hari Ini')).toBeInTheDocument();
    expect(screen.getByText('Calls Hari Ini')).toBeInTheDocument();
    expect(screen.getByText('850 ms')).toBeInTheDocument();
    // Panel non-kosong ikut render
    expect(screen.getByRole('heading', { name: 'Rekomendasi AI' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Feedback Rate' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Retensi Pengguna' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Prioritas Perbaikan Prompt' })).toBeInTheDocument();
  });

  it('empty data → metric render + panel kosong menunjukkan EmptyMini tanpa crash', async () => {
    populatedService();
    // Semua panel data kosong: rekomendasi dengan array kosong → EmptyMini.
    render(<MonitoringPage />);
    await screen.findByText('Biaya Hari Ini');
    expect(screen.getAllByText('Belum ada data pada rentang ini.').length).toBeGreaterThan(0);
  });
});

describe('MonitoringPage — error & auth', () => {
  it('403 (ADMIN_METRICS_403) → "Akses ditolak" + TANPA tombol retry', async () => {
    service.fetchMetricsSummary.mockRejectedValue(asNever({ code: 'ADMIN_METRICS_403', message: 'forbidden' }));
    render(<MonitoringPage />);
    await screen.findByText('Akses ditolak');
    expect(screen.getByText(/khusus admin/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Coba Lagi' })).toBeNull();
  });

  it('500 → error banner + "Coba Lagi" → refetch → sembuh', async () => {
    service.fetchMetricsSummary.mockRejectedValueOnce(new Error('internal error'));
    populatedService(); // panggilan berikutnya sukses
    render(<MonitoringPage />);
    await screen.findByText('Tidak dapat memuat data monitoring');
    expect(screen.getByText('internal error')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Coba Lagi' }));
    await screen.findByText('Biaya Hari Ini');
    expect(screen.queryByText('Tidak dapat memuat data monitoring')).toBeNull();
  });

  it('partial failure (feedback summary gagal) → halaman tetap render metric', async () => {
    populatedService();
    service.fetchFeedbackSummary.mockRejectedValue(new Error('panel down'));
    render(<MonitoringPage />);
    // Panel feedback non-kritikal gagal → degrade ke null → Prioritas tidak
    // dirender, TAPI kartu metric tetap muncul.
    await screen.findByText('Biaya Hari Ini');
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Prioritas Perbaikan Prompt' })).toBeNull());
    expect(screen.getByText('Token Hari Ini')).toBeInTheDocument();
    expect(screen.queryByText('Tidak dapat memuat data monitoring')).toBeNull();
  });
});
