/**
 * AI Hub (Sprint 1.5 — AI Product Experience).
 *
 * Halaman AI khusus (bukan dashboard transaksi) yang menggabungkan:
 *   - P9  AI Dashboard  — Today's Insight, Risk, Opportunities, Confidence
 *   - P6  Financial Health Score — 8 komponen + kategori Excellent..Critical
 *   - P4  Financial Simulation — what-if deterministik (tanpa AI)
 *   - P5  Scenario Analysis — perbandingan skenario side-by-side
 *   - P3  AI Timeline — riwayat rekomendasi AI (persisted di server)
 *   - P7  AI Memory — preferensi personal, editable & deletable
 *
 * Semua engine (simulation/health) DETERMINISTIK MURNI — tidak memakai AI.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BrainCircuit,
  HeartPulse,
  LineChart,
  GitCompareArrows,
  History,
  Cpu,
  Plus,
  Trash2,
  Pencil,
  Check,
  X,
  TrendingUp,
  TrendingDown,
  Minus,
  MessageCircleQuestion,
  ArrowRight,
  TriangleAlert,
} from 'lucide-react';
import { useAuthStore } from '../../store/useAuthStore';
import { getAllTransactions } from '../../services/transactionService';
import { listenToBudgets } from '../../services/budgetService';
import { getWalletAccounts, getSavingGoals, getSubscriptions } from '../../services/professionalSuiteService';
import { computeAdvisorMetrics, type AdvisorInput } from '../../services/advisorService';
import { buildFallbackMonthlyReport } from '../../services/aiInsightService';
import { computeFinancialHealth, type HealthSubscore } from '../../lib/financialHealthEngine';
import {
  runSimulation,
  scenarioImpactScore,
  type SimulationAdjustment,
  type SimulationBaseline,
} from '../../lib/simulationEngine';
import { cn, formatCurrency, formatSigned, getCurrentMonth, getCurrentYear } from '../../lib/utils';
import type { Budget } from '../../types';
import Header from '../../components/layout/Header';
import Card from '../../components/ui/Card';
import EmptyState from '../../components/ui/EmptyState';
import { ChartSkeleton } from '../../components/ui/Skeleton';
import AiConfidenceBadge from './components/AiConfidenceBadge';
import AiFeedbackButtons from './components/AiFeedbackButtons';
import AiTrustMeta from './components/AiTrustMeta';
import {
  listMemory,
  upsertMemory,
  updateMemory,
  deleteMemory,
  listTimeline,
  addTimelineEntry,
  trackAiProductEvent,
  type MemoryRecord,
  type TimelineRecord,
} from '../../services/aiProductService';
import { MEMORY_CATEGORY_LABELS, type MemoryCategory } from './types';

/** Bungkus listener berbasis-callback jadi Promise (pola AdvisorPage/Dashboard). */
function fetchOnce<T>(subscribe: (cb: (data: T) => void, errCb?: (e: Error) => void) => () => void): Promise<T> {
  return new Promise((resolve) => {
    const unsub = subscribe(
      (data) => { unsub(); resolve(data); },
      (e) => { console.error('AI Hub: gagal memuat data, degrade ke kosong', e); unsub(); resolve([] as unknown as T); },
    );
  });
}

// ── Preset adjustment cepat untuk simulation ────────────────────────────────
const PRESET_ADJUSTMENTS: Array<{ label: string; adj: SimulationAdjustment }> = [
  { label: 'GoFood -20%', adj: { type: 'expense_pct', label: 'GoFood turun 20%', pct: -0.2 } },
  { label: 'Gaji +10%', adj: { type: 'income_pct', label: 'Gaji naik 10%', pct: 0.1 } },
  { label: 'Tabung 500rb/bln', adj: { type: 'save_monthly', label: 'Menabung 500rb/bulan', amount: 500000 } },
  { label: 'Beli Laptop', adj: { type: 'one_time_expense', label: 'Beli laptop (bulan 2)', amount: 15000000, month: 2 } },
  { label: 'Cicilan Selesai', adj: { type: 'fixed_expense', label: 'Cicilan 1jt selesai (-)', amount: -1000000 } },
];

const TREND_ICON: Record<HealthSubscore['trend'], React.ReactNode> = {
  up: <TrendingUp className="h-3.5 w-3.5 text-mint-500" />,
  down: <TrendingDown className="h-3.5 w-3.5 text-red-500" />,
  flat: <Minus className="h-3.5 w-3.5 text-app-subtle" />,
  none: <Minus className="h-3.5 w-3.5 text-app-subtle opacity-40" />,
};

export default function AiHubPage() {
  const authUser = useAuthStore((s) => s.authUser);
  const [input, setInput] = useState<AdvisorInput | null>(null);
  const [loading, setLoading] = useState(true);
  // P10.2 telemetry guard: fire exposure SEKALI per MOUNT. StrictMode dev
  // double-mount memanggil effect & loadData dua kali (keduanya async lanjut)
  // — tanpa guard, ai_hub_view dan ai_result_shown feature-level ter-inflasi
  // 2× di dev (denominator Feedback Rate tidak konsisten dev vs prod).
  const hubViewFiredRef = useRef(false);
  const featureShownFiredRef = useRef(false);

  const loadData = useCallback(async () => {
    if (!authUser) return;
    setLoading(true);
    const [transactions, budgets, wallets, goals, subscriptions] = await Promise.all([
      // Migrasi 2026-08-09 (audit windowed): dataset LENGKAP (windowless-complete,
      // paginated) — sebelumnya listenToTransactions = 50 baris terbaru → metrics
      // kartu AI (bulan ini, avg 3 bulan, top kategori/merchant, budget usage) dan
      // insight bulanan salah untuk user >50 transaksi (kelas insiden 2026-08-08).
      // Evaluasi summary-vs-list: endpoint /summary TIDAK cukup — computeAdvisorMetrics
      // butuh avg 3 bulan & topMerchant.count (repeat detection) yang hanya tersedia
      // dari list lengkap; pola sama dengan AdvisorPage.
      getAllTransactions(authUser.uid).catch((e) => { console.error('AI Hub: gagal memuat data awal, degrade ke kosong', e); return []; }),
      fetchOnce<Budget[]>((cb, errCb) => listenToBudgets(authUser.uid, cb, errCb)),
      getWalletAccounts(authUser.uid).catch(() => []),
      getSavingGoals(authUser.uid).catch(() => []),
      getSubscriptions(authUser.uid).catch(() => []),
    ]);
    setInput({
      transactions,
      budgets,
      subscriptions,
      wallets,
      goals,
      month: getCurrentMonth(),
      year: getCurrentYear(),
    });
    setLoading(false);
    // P10.2i telemetry: denominator Feedback Rate — kartu feedback-capable di
    // hub (insight hero, health score, simulasi) ditampilkan. Guard ref:
    // StrictMode dev double-mount memanggil loadData() dua kali — fire SEKALI
    // per mount (bukan per panggilan) agar denominator tidak inflasi.
    if (!featureShownFiredRef.current) {
      featureShownFiredRef.current = true;
      trackAiProductEvent('ai_result_shown', { feature: 'insight' }).catch(() => {});
      trackAiProductEvent('ai_result_shown', { feature: 'health' }).catch(() => {});
      trackAiProductEvent('ai_result_shown', { feature: 'simulation' }).catch(() => {});
    }
  }, [authUser]);

  useEffect(() => {
    loadData();
    // P10.2 telemetry: exposure AI Hub (non-PII, fire-and-forget). Guard ref:
    // StrictMode dev double-mount → fire SEKALI per mount.
    if (!hubViewFiredRef.current) {
      hubViewFiredRef.current = true;
      trackAiProductEvent('ai_hub_view').catch(() => {});
    }
  }, [loadData]);

  const metrics = useMemo(() => (input ? computeAdvisorMetrics(input) : null), [input]);
  const health = useMemo(() => {
    if (!metrics || !input) return null;
    const debtTotal = input.wallets
      .filter((w) => w.type === 'credit')
      .reduce((s, w) => s + Math.max(0, Number(w.balance) || 0), 0);
    return computeFinancialHealth({
      monthlyIncome: metrics.currentMonthIncome,
      monthlyExpense: metrics.currentMonthExpense,
      avgMonthlyIncome3m: metrics.avgMonthlyIncome3m,
      avgMonthlyExpense3m: metrics.avgMonthlyExpense3m,
      balance: metrics.totalBalance,
      savingsRate: metrics.savingsRate,
      expenseRatio: metrics.expenseRatio,
      budgetUsage: metrics.budgetUsage.map((b) => b.usage),
      debtTotal,
      subscriptionsMonthly: metrics.subscriptions.reduce((s, sub) => s + sub.monthlyCost, 0),
      topMerchantCount: metrics.topMerchant?.count ?? 0,
      transactionCount: metrics.transactionCount,
    });
  }, [metrics, input]);

  const insight = useMemo(() => {
    if (!input) return null;
    return buildFallbackMonthlyReport({
      transactions: input.transactions,
      month: input.month,
      year: input.year,
    });
  }, [input]);

  if (loading) {
    return (
      <div>
        <Header title="AI Hub" />
        <div className="p-4 lg:p-6 space-y-4 max-w-6xl mx-auto">
          <ChartSkeleton />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[1, 2, 3, 4].map((i) => <ChartSkeleton key={i} />)}
          </div>
          <ChartSkeleton />
        </div>
      </div>
    );
  }

  if (!metrics || !health || !insight) {
    return (
      <div>
        <Header title="AI Hub" />
        <div className="p-4 lg:p-6 max-w-3xl mx-auto">
          <EmptyState
            icon={<BrainCircuit className="w-8 h-8" />}
            title="Belum ada data untuk analisis AI"
            description="Catat pemasukan dan pengeluaran terlebih dahulu, lalu AI Hub akan menyusun skor kesehatan, simulasi, dan rekomendasi personal."
          />
        </div>
      </div>
    );
  }

  const baseline: SimulationBaseline = {
    monthlyIncome: metrics.currentMonthIncome || metrics.avgMonthlyIncome3m,
    monthlyExpense: metrics.currentMonthExpense || metrics.avgMonthlyExpense3m,
    balance: metrics.totalBalance,
    subscriptionsMonthly: metrics.subscriptions.reduce((s, sub) => s + sub.monthlyCost, 0),
  };

  return (
    <div>
      <Header title="AI Hub" />
      <div className="p-4 lg:p-6 space-y-5 max-w-6xl mx-auto">
        {/* Hero */}
        <Card className="overflow-hidden border-primary-200/70 bg-gradient-to-br from-primary-50 via-app-card to-mint-50/70 dark:border-primary-400/20 dark:from-primary-500/10 dark:via-app-card dark:to-mint-400/10">
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-primary-500 to-soft-purple text-white flex items-center justify-center shadow-lg shadow-primary-500/25">
              <BrainCircuit className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary-600 dark:text-primary-300">
                AI Product Experience
              </p>
              <h2 className="text-lg font-bold text-app-text">Dashboard keuangan cerdas kamu</h2>
            </div>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-app-text">{insight.summary}</p>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <AiTrustMeta
              model={{ source: 'rule-based', feature: 'insight', timestamp: insight.generatedAt }}
            />
            <div className="flex flex-wrap items-center gap-2">
              <AiFeedbackButtons feature="insight" />
              <Link
                to="/ai/chat"
                className="inline-flex items-center gap-1.5 rounded-full bg-primary-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-primary-700"
              >
                <MessageCircleQuestion className="h-3.5 w-3.5" />
                Tanya AI
                <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          </div>
        </Card>

        {/* Today's Insight — mini cards */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <MiniCard title="Peluang" icon={<TrendingUp className="w-4 h-4" />} tone="bg-mint-50 dark:bg-mint-500/12 text-mint-600 dark:text-mint-300" items={(insight.savingOpportunities ?? []).slice(0, 2)} />
          <MiniCard title="Risiko" icon={<TrendingDown className="w-4 h-4" />} tone="bg-red-50 dark:bg-red-500/12 text-red-500 dark:text-red-300" items={(insight.topRisks ?? []).slice(0, 2)} />
          <MiniCard title="Rekomendasi" icon={<BrainCircuit className="w-4 h-4" />} tone="bg-primary-50 dark:bg-primary-500/12 text-primary-600 dark:text-primary-300" items={(insight.recommendations ?? []).slice(0, 2)} />
        </div>

        {/* Financial Health Score */}
        <HealthScoreCard health={health} />

        {/* Simulation + Scenario */}
        <SimulationSection baseline={baseline} />

        {/* Timeline + Memory */}
        <div className="grid gap-4 lg:grid-cols-2">
          <TimelineSection insightTitle={insight.summary} feature="insight" />
          <MemorySection />
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function MiniCard({ title, icon, tone, items }: { title: string; icon: React.ReactNode; tone: string; items: string[] }) {
  return (
    <Card className="!p-4">
      <div className="flex items-center gap-2 mb-2">
        <div className={cn('w-8 h-8 rounded-xl flex items-center justify-center', tone)}>{icon}</div>
        <h3 className="text-sm font-semibold text-app-text">{title}</h3>
      </div>
      <ul className="space-y-1.5">
        {items.map((item) => (
          <li key={item} className="text-xs leading-relaxed text-app-muted">{item}</li>
        ))}
      </ul>
    </Card>
  );
}

function HealthScoreCard({ health }: { health: ReturnType<typeof computeFinancialHealth> }) {
  return (
    <Card>
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-violet-50 dark:bg-violet-500/12 flex items-center justify-center text-violet-600 dark:text-violet-300">
            <HeartPulse className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-app-text">Skor Kesehatan Finansial</h3>
            <p className="text-xs text-app-subtle">8 komponen terukur · deterministik</p>
          </div>
        </div>
        <div className="text-right">
          <span className="text-3xl font-black tabular-nums text-app-text">{health.score}</span>
          <span className="ml-2 inline-block rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[11px] font-bold text-violet-600 dark:text-violet-300">
            {health.category}
          </span>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {health.subscores.map((s) => (
          <div key={s.key} className="rounded-xl border border-app-border bg-app-bg/50 p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] font-semibold text-app-text">{s.label}</span>
              <span className="flex items-center gap-1 text-[11px] font-bold tabular-nums text-app-text">
                {s.score}{TREND_ICON[s.trend]}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-app-hover overflow-hidden mb-1.5">
              <div
                className={cn('h-full rounded-full transition-all duration-700', s.score >= 70 ? 'bg-mint-500' : s.score >= 55 ? 'bg-amber-500' : 'bg-red-500')}
                style={{ width: `${s.score}%` }}
              />
            </div>
            <p className="text-[10px] leading-relaxed text-app-muted">{s.reason}</p>
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 flex-wrap">
        <p className="text-xs text-app-muted max-w-2xl">{health.summary}</p>
        <AiFeedbackButtons feature="health" />
      </div>
    </Card>
  );
}

// ── Simulation & Scenario ────────────────────────────────────────────────────

function SimulationSection({ baseline }: { baseline: SimulationBaseline }) {
  const [adjustments, setAdjustments] = useState<SimulationAdjustment[]>([]);
  const [months, setMonths] = useState(6);
  const [scenarios, setScenarios] = useState<Array<{ name: string; adjustments: SimulationAdjustment[]; result: ReturnType<typeof runSimulation> }>>([]);

  const result = useMemo(() => runSimulation(baseline, adjustments, { months }), [baseline, adjustments, months]);

  const addPreset = (adj: SimulationAdjustment) => {
    setAdjustments((prev) => [...prev, { ...adj }]);
  };

  const saveScenario = () => {
    if (adjustments.length === 0) return;
    const name = `Skenario ${scenarios.length + 1}`;
    const res = runSimulation(baseline, adjustments, { months });
    setScenarios((prev) => [...prev, { name, adjustments: [...adjustments], result: res }]);
  };

  const removeScenario = (index: number) => {
    setScenarios((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* min-w-0: grid item WAJIB bisa menyusut di bawah min-content tabel
          (default min-width:auto) agar overflow-x-auto di dalam card aktif —
          tanpa ini tabel simulasi (min-content ~470px) memaksa card keluar
          viewport mobile → horizontal scroll (bug ditemukan saat capture
          screenshot mobile AI Hub, 2026-08-09). */}
      <Card className="min-w-0">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-blue-50 dark:bg-blue-500/12 flex items-center justify-center text-blue-600 dark:text-blue-300">
              <LineChart className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-app-text">Simulasi What-if</h3>
              <p className="text-xs text-app-subtle">Perhitungan deterministik, tanpa AI</p>
            </div>
          </div>
          <label className="flex items-center gap-1.5 text-xs text-app-subtle">
            <Cpu className="h-3.5 w-3.5" />
            {months} bln
            <input
              type="range" min={3} max={12} value={months}
              onChange={(e) => setMonths(Number(e.target.value))}
              className="w-20 accent-primary-500"
              aria-label="Jumlah bulan proyeksi"
            />
          </label>
        </div>

        <div className="flex flex-wrap gap-1.5 mb-3">
          {PRESET_ADJUSTMENTS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => addPreset(p.adj)}
              className="rounded-full border border-app-border bg-app-bg px-2.5 py-1 text-[11px] font-medium text-app-text hover:border-primary-500/40 hover:bg-primary-500/10 transition-colors"
            >
              + {p.label}
            </button>
          ))}
        </div>

        {adjustments.length > 0 && (
          <ul className="space-y-1.5 mb-3">
            {adjustments.map((adj, i) => (
              <li key={`${adj.type}-${i}`} className="flex items-center justify-between gap-2 rounded-lg bg-app-bg/60 px-2.5 py-1.5 text-xs text-app-text">
                <span>{adj.label}</span>
                <button
                  type="button"
                  aria-label={`Hapus ${adj.label}`}
                  onClick={() => setAdjustments((prev) => prev.filter((_, idx) => idx !== i))}
                  className="text-app-subtle hover:text-red-500"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="overflow-x-auto rounded-xl border border-app-border">
          <table className="w-full text-xs">
            <thead className="bg-app-bg/60 text-left text-[11px] uppercase tracking-wide text-app-subtle">
              <tr>
                <th className="px-2.5 py-2">Bulan</th>
                <th className="px-2.5 py-2 text-right">Masuk</th>
                <th className="px-2.5 py-2 text-right">Keluar</th>
                <th className="px-2.5 py-2 text-right">Net</th>
                <th className="px-2.5 py-2 text-right">Saldo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-app-border/60">
              {result.months.map((m) => (
                <tr key={m.monthIndex}>
                  <td className="px-2.5 py-1.5 font-medium text-app-text">{m.label}</td>
                  <td className="px-2.5 py-1.5 text-right tabular-nums text-app-text">{formatCurrency(m.income)}</td>
                  <td className="px-2.5 py-1.5 text-right tabular-nums text-app-text">{formatCurrency(m.expense)}</td>
                  <td className={cn('px-2.5 py-1.5 text-right tabular-nums', m.netCashflow >= 0 ? 'text-mint-600 dark:text-mint-300' : 'text-red-500')}>
                    {formatSigned(m.netCashflow)}
                  </td>
                  <td className={cn('px-2.5 py-1.5 text-right tabular-nums font-semibold', m.balance < 0 ? 'text-red-500' : 'text-app-text')}>
                    {formatSigned(m.balance)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          {/* finalBalance bisa negatif (one-time expense besar > saldo) — formatCurrency
              memakai Math.abs, jadi tanda minus + tone merah eksplisit (pola StatCard). */}
          <Stat label="Saldo Akhir" value={formatSigned(result.finalBalance)} tone={result.finalBalance < 0 ? 'text-red-500' : undefined} />
          <Stat label="Total Tabungan" value={formatCurrency(result.totalSaved)} />
          {/* formatSigned menangani Math.abs + tanda +/- (pola StatCard negative). */}
          <Stat label="Δ Saldo" value={formatSigned(result.balanceDelta, { showPlus: true })} tone={result.balanceDelta < 0 ? 'text-red-500' : 'text-mint-600 dark:text-mint-300'} />
        </div>

        {/* Indikator defisit (audit 2026-08-09): angka proyeksi TETAP negatif
            (jujur) — indikator TERPISAH supaya defisit tidak terlewat walau
            saldo akhir kebetulan pulih positif. */}
        {result.deficitMonths > 0 && (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-300">
            <TriangleAlert className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />              <p>
                <span className="font-semibold">Defisit proyeksi</span>
                {/* deficitMonths > 0 menjamin firstDeficitMonth non-null (find yang
                    sama menghasilkan count) — tidak perlu fallback. */}
                {` — saldo diperkirakan minus mulai bulan ke-${result.firstDeficitMonth}`}{' '}
                ({result.deficitMonths} bulan negatif).
              </p>
          </div>
        )}

        <button
          type="button"
          disabled={adjustments.length === 0}
          onClick={saveScenario}
          className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-primary-600 px-3 py-2 text-xs font-semibold text-white hover:bg-primary-700 disabled:opacity-40"
        >
          <Plus className="h-3.5 w-3.5" /> Simpan sebagai Skenario
        </button>
        <AiFeedbackButtons className="mt-2" feature="simulation" />
      </Card>

      <Card className="min-w-0">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-9 h-9 rounded-xl bg-amber-50 dark:bg-amber-500/12 flex items-center justify-center text-amber-600 dark:text-amber-300">
            <GitCompareArrows className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-app-text">Perbandingan Skenario</h3>
            <p className="text-xs text-app-subtle">Side-by-side: tabungan, cashflow, pertumbuhan saldo</p>
          </div>
        </div>

        {scenarios.length === 0 ? (
          <EmptyState
            icon={<GitCompareArrows className="w-7 h-7" />}
            title="Belum ada skenario"
            description="Buat simulasi di kiri lalu simpan untuk dibandingkan."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-app-bg/60 text-left text-[11px] uppercase tracking-wide text-app-subtle">
                <tr>
                  <th className="px-2.5 py-2">Metrik</th>
                  {scenarios.map((s) => (
                    <th key={s.name} className="px-2.5 py-2">
                      <div className="flex items-center gap-1.5">
                        {s.name}
                        <button
                          type="button"
                          aria-label={`Hapus ${s.name}`}
                          onClick={() => removeScenario(scenarios.indexOf(s))}
                          className="text-app-subtle hover:text-red-500"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-app-border/60">
                {/* formatSigned menangani tanda minus — tone merah per-cell tetap
                    eksplisit (konsisten dengan Stat Saldo Akhir di kartu simulasi). */}
                <Row
                  label="Saldo Akhir"
                  values={scenarios.map((s) => formatSigned(s.result.finalBalance))}
                  tones={scenarios.map((s) => (s.result.finalBalance < 0 ? 'text-red-500' : undefined))}
                />
                <Row label="Total Tabungan" values={scenarios.map((s) => formatCurrency(s.result.totalSaved))} />
                <Row
                  label="Rata-rata Cashflow"
                  values={scenarios.map((s) => formatSigned(s.result.avgNetCashflow))}
                  tones={scenarios.map((s) => (s.result.avgNetCashflow < 0 ? 'text-red-500' : undefined))}
                />
                {/* Konsisten dengan Stat Δ Saldo: merah negatif, mint positif. */}
                <Row
                  label="Δ Saldo"
                  values={scenarios.map((s) => formatSigned(s.result.balanceDelta, { showPlus: true }))}
                  tones={scenarios.map((s) => (s.result.balanceDelta < 0 ? 'text-red-500' : 'text-mint-600 dark:text-mint-300'))}
                />
                {/* Defisit per skenario — indikator terpisah (angka tetap jujur,
                    lihat audit simulationEngine). Baris ikon: ⚠ bila pernah minus. */}
                <Row
                  label="Defisit"
                  values={scenarios.map((s) =>
                    // deficitMonths > 0 menjamin firstDeficitMonth non-null.
                    s.result.deficitMonths > 0
                      ? `Bln ${s.result.firstDeficitMonth} · ${s.result.deficitMonths} bln`
                      : '—',
                  )}
                  tones={scenarios.map((s) => (s.result.deficitMonths > 0 ? 'font-semibold text-red-500' : undefined))}
                />
                <tr>
                  <td className="px-2.5 py-2 font-medium text-app-text">Dampak</td>
                  {scenarios.map((s) => {
                    const score = scenarioImpactScore(s.result);
                    const tone = score >= 60
                      ? 'bg-mint-500/12 text-mint-600 dark:text-mint-300 border-mint-500/30'
                      : score >= 40
                        ? 'bg-amber-500/12 text-amber-600 dark:text-amber-300 border-amber-500/30'
                        : 'bg-red-500/12 text-red-500 dark:text-red-300 border-red-500/30';
                    return (
                      <td key={s.name} className="px-2.5 py-2">
                        <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold', tone)}>
                          {score}/100
                        </span>
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function Row({ label, values, tones }: { label: string; values: string[]; tones?: Array<string | undefined> }) {
  return (
    <tr>
      <td className="px-2.5 py-2 font-medium text-app-text">{label}</td>
      {values.map((v, i) => (
        <td key={i} className={cn('px-2.5 py-2 tabular-nums text-app-text', tones?.[i])}>{v}</td>
      ))}
    </tr>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl bg-app-bg/60 px-2 py-2">
      <p className="text-[11px] uppercase tracking-wide text-app-subtle">{label}</p>
      <p className={cn('text-sm font-bold tabular-nums text-app-text', tone)}>{value}</p>
    </div>
  );
}

// ── Timeline ─────────────────────────────────────────────────────────────────

function TimelineSection({ insightTitle, feature }: { insightTitle: string; feature: string }) {
  const [entries, setEntries] = useState<TimelineRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [logging, setLogging] = useState(false);
  // P10.2e: item yang sudah pernah dirender di kartu ini — anti double-count
  // recommendation_shown saat reload (+ Catat insight ini) / kembali ke hub.
  const trackedIdsRef = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      // 5 entri terbaru lintas jenis AI (insight/recommendation/conversation/dst)
      // — kartu ini adalah exposure surface; rekomendasi yang tampil wajib
      // dihitung `shown` (P10.2e, tutup undercount denominator).
      const page = await listTimeline({ limit: 5 });
      setEntries(page.items);
      // Telemetry: fire SEKALI per item di kartu ini (pola halaman /ai/timeline):
      //   - ai_result_shown untuk SEMUA entri (P10.2i — denominator Feedback Rate)
      //   - recommendation_shown hanya untuk recommendation (P10.2 — CTR)
      // KEDUANYA di dalam guard trackedIdsRef — StrictMode dev double-mount
      // memanggil load() dua kali; tanpa guard, shown ter-inflasi 2× padahal
      // ai_result_shown sudah dedup → CTR denominator tidak konsisten.
      const tracked = trackedIdsRef.current;
      page.items.forEach((e) => {
        if (!tracked.has(e.id)) {
          tracked.add(e.id);
          trackAiProductEvent('ai_result_shown', { feature: e.feature, itemId: e.id, eventType: e.event_type }).catch(() => {});
          if (e.event_type === 'recommendation') {
            trackAiProductEvent('recommendation_shown', { feature: e.feature, itemId: e.id, eventType: e.event_type }).catch(() => {});
          }
        }
      });
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const logCurrent = async () => {
    setLogging(true);
    try {
      await addTimelineEntry({
        feature,
        title: 'Insight bulan ini',
        body: insightTitle,
        confidence: null,
      });
      await load();
    } catch { /* feedback error handling di UI tetap sederhana */ } finally {
      setLogging(false);
    }
  };

  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-cyan-50 dark:bg-cyan-500/12 flex items-center justify-center text-cyan-600 dark:text-cyan-300">
            <History className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-app-text">AI Timeline</h3>
            <p className="text-xs text-app-subtle">Apa yang AI sarankan & kapan berubah</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Link
            to="/ai/timeline"
            className="rounded-full border border-app-border px-2.5 py-1 text-[11px] font-medium text-app-text hover:border-primary-500/40 hover:bg-primary-500/10 transition-colors"
          >
            Lihat semua
          </Link>
          <button
            type="button"
            disabled={logging}
            onClick={logCurrent}
            className="rounded-full border border-app-border px-2.5 py-1 text-[11px] font-medium text-app-text hover:border-primary-500/40 hover:bg-primary-500/10 transition-colors disabled:opacity-50"
          >
            {logging ? 'Menyimpan...' : '+ Catat insight ini'}
          </button>
        </div>
      </div>

      {loading ? (
        <ChartSkeleton />
      ) : entries.length === 0 ? (
        <EmptyState
          icon={<History className="w-7 h-7" />}
          title="Timeline kosong"
          description="Catat insight atau rekomendasi AI untuk melihat riwayat perubahan saran."
        />
      ) : (
        <ol className="relative space-y-4 border-l border-app-border/70 pl-4">
          {entries.map((e) => (
            <li key={e.id} className="relative">
              <span className="absolute -left-[21.5px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-app-card bg-primary-500" />
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-app-text">{e.title}</p>
                {typeof e.created_at === 'string' && (
                  <span className="shrink-0 text-[10px] text-app-subtle">
                    {new Date(e.created_at + (e.created_at.endsWith('Z') ? '' : 'Z')).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
              </div>
              {e.body && <p className="mt-0.5 text-[11px] leading-relaxed text-app-muted">{e.body}</p>}
              <div className="mt-1 flex items-center justify-between gap-2 flex-wrap">
                {typeof e.confidence === 'number' && <AiConfidenceBadge score={e.confidence} hidePercent />}
                <AiFeedbackButtons feature={e.feature} itemId={e.id} />
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

// ── Memory ───────────────────────────────────────────────────────────────────

function MemorySection() {
  const [items, setItems] = useState<MemoryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newCategory, setNewCategory] = useState<MemoryCategory>('spending_habit');
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const load = useCallback(async () => {
    try {
      setItems(await listMemory());
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const add = async () => {
    if (!newKey.trim() || !newValue.trim()) return;
    try {
      await upsertMemory({ category: newCategory, key: newKey.trim(), value: newValue.trim() });
      setNewKey(''); setNewValue(''); setAdding(false);
      await load();
    } catch { /* biarkan tetap di form */ }
  };

  const saveEdit = async (item: MemoryRecord) => {
    if (!editValue.trim()) return;
    try {
      await updateMemory(item.id, { value: editValue.trim(), source: 'manual' });
      setEditingId(null);
      await load();
    } catch { /* biarkan tetap edit */ }
  };

  const remove = async (id: string) => {
    try {
      await deleteMemory(id);
    } catch { /* ignore — 404 (sudah terhapus) juga akhirnya reload */ }
    await load();
  };

  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-mint-50 dark:bg-mint-500/12 flex items-center justify-center text-mint-600 dark:text-mint-300">
            <BrainCircuit className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-app-text">AI Memory</h3>
            <p className="text-xs text-app-subtle">Preferensi personal — transparan & bisa diubah</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="rounded-full border border-app-border px-2.5 py-1 text-[11px] font-medium text-app-text hover:border-mint-500/40 hover:bg-mint-500/10 transition-colors"
        >
          {adding ? 'Batal' : '+ Tambah'}
        </button>
      </div>

      {adding && (
        <div className="mb-3 space-y-2 rounded-xl border border-app-border bg-app-bg/50 p-3">
          <select
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value as MemoryCategory)}
            className="w-full rounded-lg border border-app-border bg-app-card px-2 py-1.5 text-xs text-app-text"
            aria-label="Kategori preferensi"
          >
            {Object.entries(MEMORY_CATEGORY_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <input
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            placeholder="Label (mis. Metode favorit)"
            className="w-full rounded-lg border border-app-border bg-app-card px-2 py-1.5 text-xs text-app-text placeholder:text-app-subtle"
            aria-label="Label preferensi"
          />
          <input
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            placeholder="Nilai (mis. QRIS)"
            className="w-full rounded-lg border border-app-border bg-app-card px-2 py-1.5 text-xs text-app-text placeholder:text-app-subtle"
            aria-label="Nilai preferensi"
          />
          <button
            type="button"
            onClick={add}
            disabled={!newKey.trim() || !newValue.trim()}
            className="w-full rounded-lg bg-mint-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-mint-600 disabled:opacity-40"
          >
            Simpan
          </button>
        </div>
      )}

      {loading ? (
        <ChartSkeleton />
      ) : items.length === 0 && !adding ? (
        <EmptyState
          icon={<BrainCircuit className="w-7 h-7" />}
          title="Belum ada preferensi"
          description="Simpan preferensi seperti 'Lebih suka QRIS' agar rekomendasi AI makin personal."
        />
      ) : (
        <ul className="space-y-1.5">
          {items.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-2 rounded-lg bg-app-bg/60 px-2.5 py-2">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-app-subtle">
                  {MEMORY_CATEGORY_LABELS[item.category as MemoryCategory] || item.category}
                </p>
                {editingId === item.id ? (
                  <div className="mt-1 flex items-center gap-1.5">
                    <input
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      className="w-full min-w-32 rounded-md border border-app-border bg-app-card px-2 py-1 text-xs text-app-text"
                      aria-label={`Edit ${item.key}`}
                    />
                    <button type="button" onClick={() => saveEdit(item)} className="text-mint-600 dark:text-mint-300" aria-label="Simpan edit">
                      <Check className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" onClick={() => setEditingId(null)} className="text-app-subtle" aria-label="Batal edit">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <p className="text-xs text-app-text">
                    <span className="font-semibold">{item.key}:</span> {item.value}
                    {item.source === 'ai_inferred' && <span className="ml-1.5 text-[10px] text-app-subtle">(AI)</span>}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {editingId !== item.id && (
                  <button
                    type="button"
                    onClick={() => { setEditingId(item.id); setEditValue(item.value); }}
                    className="text-app-subtle hover:text-app-text"
                    aria-label={`Edit ${item.key}`}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => remove(item.id)}
                  className="text-app-subtle hover:text-red-500"
                  aria-label={`Hapus ${item.key}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
