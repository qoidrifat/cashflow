// CF-053: Admin Monitoring Dashboard
import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts';
import {
  DollarSign, Cpu, Activity, Clock, AlertTriangle, CheckCircle2,
  RefreshCw, ShieldAlert, Database, Zap, XCircle, Trash2,
  MousePointerClick, Sparkles, TrendingUp, ThumbsUp, ThumbsDown, Users, ListChecks,
} from 'lucide-react';
import Header from '../../components/layout/Header';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import { useAuthStore } from '../../store/useAuthStore';
import {
  fetchMetricsSummary, fetchAiUsage, fetchFeatureHealth, fetchAlerts, fetchAICacheStats,
  fetchAgentSearchEngagement, fetchFeedbackSummary, fetchRetentionMetrics, fetchRecommendationEngagement,
  fetchFeedbackRate, fetchTelemetryUsers,
} from '../../services/adminMetrics';
import type {
  MetricsSummary, AIUsageSummary, CostTrendPoint, CostTrendByFeaturePoint,
  FeatureHealth, AlertStatus, AICacheStats, AgentSearchEngagement, AgentSearchTabCount, CacheByFeature,
  FeedbackSummaryResponse, RetentionMetrics, RecommendationEngagement, RecommendationDayStat,
  FeedbackRateSummary, TelemetryUser,
} from '../../types/metrics';
import { activeTrendFeatures, pivotTrendByFeature, type TrendMetric } from '../../utils/costTrendPivot';
import { topFeatureEntries, type FeatureRankRow } from '../../utils/featureRanking';
import { cn } from '../../lib/utils';

const FEATURE_LABELS: Record<string, string> = {
  gmail_sync: 'Gmail Sync',
  agent_search: 'Agent Search',
  ocr_receipt: 'OCR Receipt',
  insight_generator: 'Insight Generator',
  fraud_detection: 'Fraud Detection',
  financial_advisor: 'Financial Advisor',
};

/** Sprint 2 — periode Cost Monitoring: mingguan / bulanan / kuartalan. */
const PERIOD_OPTIONS = [
  { label: '7 Hari', days: 7 },
  { label: '30 Hari', days: 30 },
  { label: '90 Hari', days: 90 },
] as const;

/** Palet warna seri per fitur (line chart multi-seri cost per fitur). */
const FEATURE_COLORS = ['#10b981', '#6366f1', '#f59e0b', '#06b6d4', '#ec4899', '#8b5cf6'];

/** Sprint 2 — toggle metrik chart Tren Biaya: Biaya / Token / Calls. */
const TREND_METRICS: Array<{ key: TrendMetric; label: string }> = [
  { key: 'costIdr', label: 'Biaya' },
  { key: 'tokens', label: 'Token' },
  { key: 'calls', label: 'Calls' },
];

/** Warna garis untuk seri tunggal per metrik (multi-seri tetap FEATURE_COLORS). */
const TREND_METRIC_COLORS: Record<TrendMetric, string> = {
  costIdr: '#10b981',
  tokens: '#6366f1',
  calls: '#f59e0b',
};

/** Label seri tunggal per metrik (paralel dengan TREND_METRIC_COLORS). */
const TREND_METRIC_LABELS: Record<TrendMetric, string> = {
  costIdr: 'Biaya',
  tokens: 'Token',
  calls: 'Calls',
};

/** Format nilai tooltip/axis sesuai metrik terpilih. */
function formatTrendValue(metric: TrendMetric, value: number): string {
  if (metric === 'costIdr') return formatIdr(value);
  if (metric === 'tokens') return formatTokens(value);
  return String(value);
}

function formatIdr(value: number): string {
  return 'Rp ' + Math.round(value).toLocaleString('id-ID');
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

/**
 * Line chart multi-seri: satu seri per fitur untuk metrik terpilih (Sprint 2).
 * Mem-pivot baris per-(hari, fitur) menjadi satu baris per hari + satu kolom
 * per fitur (metrik: costIdr/tokens/calls), lalu satu Line per fitur dengan
 * warna dari FEATURE_COLORS.
 */
function renderMultiSeriesTrend(points: CostTrendByFeaturePoint[], metric: TrendMetric = 'costIdr'): React.ReactNode {
  if (!points || points.length === 0) {
    return <EmptyMini message="Belum ada data pada rentang ini." />;
  }
  const pivoted = pivotTrendByFeature(points, metric);
  const features = activeTrendFeatures(points);
  return (
    <div className="h-56" role="img" aria-label="Grafik tren biaya AI per fitur">
      <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0} initialDimension={{ width: 0, height: 224 }}>
        <LineChart data={pivoted} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-app-border" opacity={0.3} />
          <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="currentColor" className="text-app-subtle" />
          <YAxis tick={{ fontSize: 10 }} stroke="currentColor" className="text-app-subtle" tickFormatter={(v) => formatTrendValue(metric, Number(v) || 0)} />
          <Tooltip
            formatter={(value, name) => [formatTrendValue(metric, Number(value) || 0), String(name)]}
            contentStyle={{ borderRadius: 12, fontSize: 12 }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {features.map((f, i) => (
            <Line
              key={f}
              type="monotone"
              dataKey={f}
              stroke={FEATURE_COLORS[i % FEATURE_COLORS.length]}
              strokeWidth={2}
              dot={false}
              name={FEATURE_LABELS[f] || f}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function MonitoringPage() {
  const authUser = useAuthStore((s) => s.authUser);
  const navigate = useNavigate();
  const [summary, setSummary] = useState<MetricsSummary | null>(null);
  // Ringkasan period-driven (dari /ai-usage?from&to) — sumber tabel "Cost per
  // Fitur". TERPISAH dari `summary` (/summary — bucket fixed today/week/month).
  const [usageSummary, setUsageSummary] = useState<AIUsageSummary | null>(null);
  const [trend, setTrend] = useState<CostTrendPoint[]>([]);
  const [trendByFeature, setTrendByFeature] = useState<CostTrendByFeaturePoint[]>([]);
  // Filter Tren Biaya: 'all' = multi-seri per fitur, selain itu = fitur tunggal.
  const [trendFeature, setTrendFeature] = useState<string>('all');
  // Metrik chart Tren Biaya (Sprint 2): biaya / token / calls.
  const [trendMetric, setTrendMetric] = useState<TrendMetric>('costIdr');
  const [health, setHealth] = useState<FeatureHealth[]>([]);
  const [alerts, setAlerts] = useState<AlertStatus[]>([]);
  const [cacheStats, setCacheStats] = useState<AICacheStats | null>(null);
  const [cacheByFeature, setCacheByFeature] = useState<CacheByFeature[]>([]);
  const [engagement, setEngagement] = useState<AgentSearchEngagement | null>(null);
  // Sprint 1.5 — prioritas perbaikan prompt dari dataset ai_feedback (admin).
  const [feedbackSummary, setFeedbackSummary] = useState<FeedbackSummaryResponse | null>(null);
  // P10.2 — retention D1/D7/D14/D28 (cohort user + user_active).
  const [retention, setRetention] = useState<RetentionMetrics | null>(null);
  // P10.2 — funnel rekomendasi AI (shown/opened/CTR per hari & per feature).
  const [recommendation, setRecommendation] = useState<RecommendationEngagement | null>(null);
  // P10.2i — Feedback Rate: ai_feedback ÷ ai_result_shown (tampilan kartu AI).
  const [feedbackRate, setFeedbackRate] = useState<FeedbackRateSummary | null>(null);
  // P10.2 view per-user — daftar user dengan aktivitas telemetry AI (dropdown)
  // + user terpilih ('' = semua user). Scoping: Rekomendasi AI & Feedback Rate
  // di-refetch dengan userId; panel lain tetap global.
  const [telemetryUsers, setTelemetryUsers] = useState<TelemetryUser[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [periodDays, setPeriodDays] = useState<number>(7);
  // Lookup cache-hit per fitur (Sprint 2) untuk kolom "Cache Hit" di tabel cost.
  const cacheByFeatureMap = new Map(cacheByFeature.map((c) => [c.feature, c]));
  // Nama fitur yang punya data pada periode aktif (opsi dropdown Tren Biaya).
  const availableFeatures = Object.keys(usageSummary?.features || {});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ code?: string; message: string } | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Sprint 2: rentang dinamis mengikuti periode terpilih (7/30/90 hari) —
      // memuati ulang summary/trend/health/engagement sesuai periode.
      const to = new Date().toISOString();
      const from = new Date(Date.now() - periodDays * 86_400_000).toISOString();
      // Panel cache & engagement bersifat observability bonus — kegagalan endpoint-nya
      // tidak boleh menjatuhkan seluruh dashboard (fetch lainnya tetap kritikal).
      // Rekomendasi AI & Feedback Rate memakai userId terpilih ('' = semua user).
      const scopedUserId = selectedUserId || undefined;
      const [summaryRes, usageRes, healthRes, alertsRes, cacheRes, engagementRes, feedbackRes, retentionRes, recommendationRes, feedbackRateRes, telemetryUsersRes] = await Promise.all([
        fetchMetricsSummary(),
        fetchAiUsage(from, to, trendFeature !== 'all' ? trendFeature : undefined),
        fetchFeatureHealth(from, to),
        fetchAlerts(),
        fetchAICacheStats().catch(() => null),
        fetchAgentSearchEngagement(from, to).catch(() => null),
        fetchFeedbackSummary().catch(() => null),
        fetchRetentionMetrics(from, to).catch(() => null),
        fetchRecommendationEngagement(from, to, scopedUserId).catch(() => null),
        fetchFeedbackRate(from, to, scopedUserId).catch(() => null),
        fetchTelemetryUsers(from, to).catch(() => null),
      ]);
      setSummary(summaryRes);
      setUsageSummary(usageRes.summary || null);
      setTrend(usageRes.trend || []);
      setTrendByFeature(usageRes.trendByFeature || []);
      setCacheByFeature(usageRes.cacheByFeature || []);
      setHealth(healthRes.health || []);
      setAlerts(alertsRes.alerts || []);
      setCacheStats(cacheRes);
      setEngagement(engagementRes);
      setFeedbackSummary(feedbackRes);
      setRetention(retentionRes);
      setRecommendation(recommendationRes);
      setFeedbackRate(feedbackRateRes);
      setTelemetryUsers(telemetryUsersRes?.users || []);
    } catch (err) {
      const typed = err as Error & { code?: string };
      setError({ code: typed.code, message: typed.message || 'Gagal memuat data monitoring.' });
    } finally {
      setLoading(false);
    }
  }, [periodDays, trendFeature, selectedUserId]);

  useEffect(() => {
    if (authUser?.uid) void loadAll();
  }, [authUser?.uid, loadAll]);

  // Fix UX (review): bila fitur yang dipilih hilang dari data periode baru (mis.
  // tidak ada aktivitas di 90 hari), reset ke 'all' agar select tidak menampilkan
  // value yang tidak ada di daftar opsi (chart kembali multi-seri).
  useEffect(() => {
    if (trendFeature !== 'all' && usageSummary && !availableFeatures.includes(trendFeature)) {
      setTrendFeature('all');
    }
    // availableFeatures dihitung per render dari usageSummary — cukup dua dep ini.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usageSummary, trendFeature]);

  // P10.2 view per-user: bila user terpilih hilang dari daftar periode baru
  // (mis. tidak ada aktivitas 90 hari), reset ke '' (Semua User) agar select
  // tidak menampilkan value yang tidak ada di opsi.
  useEffect(() => {
    if (selectedUserId && telemetryUsers.length > 0 && !telemetryUsers.some((u) => u.userId === selectedUserId)) {
      setSelectedUserId('');
    }
  }, [telemetryUsers, selectedUserId]);

  return (
    <div>
      <Header title="Monitoring" />
      <div className="mx-auto max-w-6xl space-y-5 p-4 lg:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-2xl font-black text-app-text">AI Cost & Health</h1>
            <p className="text-sm text-app-muted mt-1">Observability biaya AI dan kesehatan fitur CashFlow.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded-xl bg-app-hover p-1">
              {PERIOD_OPTIONS.map((p) => (
                <button
                  key={p.days}
                  type="button"
                  onClick={() => setPeriodDays(p.days)}
                  disabled={loading}
                  className={cn(
                    'rounded-lg px-3 py-1.5 text-xs font-bold transition',
                    periodDays === p.days
                      ? 'bg-white text-app-text shadow-sm dark:bg-slate-800'
                      : 'text-app-muted hover:text-app-text',
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <Button variant="outline" size="sm" icon={<RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />} onClick={loadAll} disabled={loading}>
              Refresh
            </Button>
          </div>
        </div>

        {/* Error state */}
        {error && (
          <Card className="border-red-200 bg-red-50/70 dark:border-red-400/20 dark:bg-red-500/8">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-red-500 text-white">
                {error.code === 'ADMIN_METRICS_403' ? <ShieldAlert className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-sm font-bold text-app-text">
                  {error.code === 'ADMIN_METRICS_403' ? 'Akses ditolak' : 'Tidak dapat memuat data monitoring'}
                </h2>
                <p className="mt-1 text-sm text-app-muted">
                  {error.code === 'ADMIN_METRICS_403'
                    ? 'Halaman ini khusus admin. Email kamu tidak terdaftar sebagai admin.'
                    : error.message}
                </p>
              </div>
              {error.code !== 'ADMIN_METRICS_403' && (
                <Button variant="outline" size="sm" onClick={loadAll}>Coba Lagi</Button>
              )}
            </div>
          </Card>
        )}

        {/* Loading skeleton */}
        {loading && !error && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[0, 1, 2, 3].map((i) => (
              <Card key={i}><div className="animate-pulse h-20 bg-app-hover rounded-xl" /></Card>
            ))}
          </div>
        )}

        {!loading && !error && summary && (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <MetricCard icon={<DollarSign className="h-4 w-4" />} label="Biaya Hari Ini" value={formatIdr(summary.today.costIdr)} accent="text-mint-500" />
              <MetricCard icon={<Cpu className="h-4 w-4" />} label="Token Hari Ini" value={formatTokens(summary.today.tokens)} accent="text-primary-500" />
              <MetricCard icon={<Activity className="h-4 w-4" />} label="Calls Hari Ini" value={String(summary.today.calls)} accent="text-amber-500" />
              <MetricCard icon={<Clock className="h-4 w-4" />} label="Avg Time" value={`${summary.today.avgTimeMs} ms`} accent="text-blue-500" />
            </div>

            {/* Per-feature summary tiles (Sprint 2): biaya & token teratas 7 hari */}
            <Card>
              <h2 className="text-sm font-bold text-app-text mb-1">Ringkasan per Fitur (7 Hari)</h2>
              <p className="text-[11px] text-app-subtle mb-3">Biaya & token teratas dari summary.features — mini bar relatif terhadap pemuncak.</p>
              {Object.keys(summary.features).length === 0 ? (
                <EmptyMini message="Belum ada penggunaan AI pada 7 hari terakhir." />
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <FeatureRankList
                    title="Top Biaya"
                    rows={topFeatureEntries(summary.features, 'costIdr')}
                    valueKey="costIdr"
                    barClass="bg-mint-500"
                    formatValue={formatIdr}
                  />
                  <FeatureRankList
                    title="Top Token"
                    rows={topFeatureEntries(summary.features, 'tokens')}
                    valueKey="tokens"
                    barClass="bg-primary-500"
                    formatValue={formatTokens}
                  />
                </div>
              )}
            </Card>

            {/* AI Response Cache panel (Sprint 3 LRU) */}
            {cacheStats && (
              <Card>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-bold text-app-text">AI Response Cache</h2>
                  <span className="text-[11px] text-app-subtle font-medium">LRU in-process · max {cacheStats.maxEntries} entri</span>
                </div>
                <div className="flex items-center gap-4">
                  <div className="flex-1">
                    <div className="flex items-end justify-between mb-1">
                      <p className="text-[11px] text-app-subtle font-medium">Hit Rate</p>
                      <p className="text-sm font-black text-app-text">
                        {cacheStats.hits + cacheStats.misses === 0 ? '—' : `${Math.round(cacheStats.hitRate * 100)}%`}
                      </p>
                    </div>
                    <div className="h-2 rounded-full bg-app-hover overflow-hidden">
                      <div
                        className={cn('h-full rounded-full transition-all', cacheStats.hitRate >= 0.5 ? 'bg-mint-500' : 'bg-amber-500')}
                        style={{ width: `${Math.min(100, Math.round(cacheStats.hitRate * 100))}%` }}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-4 gap-4 text-center">
                    <CacheStat icon={<Zap className="h-3.5 w-3.5 text-mint-500" />} label="Hits" value={String(cacheStats.hits)} />
                    <CacheStat icon={<XCircle className="h-3.5 w-3.5 text-amber-500" />} label="Misses" value={String(cacheStats.misses)} />
                    <CacheStat icon={<Database className="h-3.5 w-3.5 text-primary-500" />} label="Tersimpan" value={`${cacheStats.size}/${cacheStats.maxEntries}`} />
                    <CacheStat icon={<Trash2 className="h-3.5 w-3.5 text-app-subtle" />} label="Evictions" value={String(cacheStats.evictions)} />
                  </div>
                </div>
                <p className="mt-3 text-[11px] text-app-subtle">
                  Cache menyimpan hasil ekstraksi sukses (gmail_sync 7 hari, ocr_receipt 1 jam) — hit berarti request identik tidak memanggil Vertex AI lagi.
                </p>
              </Card>
            )}

            {/* Cost trend chart — Sprint 2: filter fitur + multi-seri per fitur */}
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <h2 className="text-sm font-bold text-app-text">Tren Biaya ({periodDays} Hari)</h2>
                <div className="flex flex-wrap items-center gap-1">
                  {/* Toggle metrik chart: Biaya / Token / Calls */}
                  <div className="flex items-center gap-1 rounded-xl bg-app-hover p-1">
                    {TREND_METRICS.map((m) => (
                      <button
                        key={m.key}
                        type="button"
                        onClick={() => setTrendMetric(m.key)}
                        disabled={loading}
                        aria-pressed={trendMetric === m.key}
                        className={cn(
                          'rounded-lg px-3 py-1.5 text-xs font-bold transition',
                          trendMetric === m.key
                            ? 'bg-white text-app-text shadow-sm dark:bg-slate-800'
                            : 'text-app-muted hover:text-app-text',
                        )}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                  <select
                    value={trendFeature}
                    onChange={(e) => setTrendFeature(e.target.value)}
                    disabled={loading}
                    aria-label="Filter fitur pada grafik tren biaya"
                    className="rounded-xl bg-app-hover px-3 py-1.5 text-xs font-bold text-app-text transition hover:bg-app-border/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                  >
                    <option value="all">Semua Fitur</option>
                    {availableFeatures.map((f) => (
                      <option key={f} value={f}>{FEATURE_LABELS[f] || f}</option>
                    ))}
                  </select>
                </div>
              </div>
              {trendFeature === 'all'
                ? renderMultiSeriesTrend(trendByFeature, trendMetric)
                : trend.length === 0
                  ? <EmptyMini message="Belum ada data pada rentang ini." />
                  : (
                    <div className="h-56" role="img" aria-label="Grafik tren biaya AI">
                      <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0} initialDimension={{ width: 0, height: 224 }}>
                        <LineChart data={trend} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-app-border" opacity={0.3} />
                          <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="currentColor" className="text-app-subtle" />
                          <YAxis tick={{ fontSize: 10 }} stroke="currentColor" className="text-app-subtle" tickFormatter={(v) => formatTrendValue(trendMetric, Number(v) || 0)} />
                          <Tooltip
                            formatter={(value) => formatTrendValue(trendMetric, Number(value) || 0)}
                            contentStyle={{ borderRadius: 12, fontSize: 12 }}
                          />
                          <Line
                            type="monotone"
                            dataKey={trendMetric}
                            stroke={TREND_METRIC_COLORS[trendMetric]}
                            strokeWidth={2}
                            dot={false}
                            name={TREND_METRIC_LABELS[trendMetric]}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  )}
            </Card>

            {/* Per-feature cost breakdown (Sprint 2: + latency & cache hit per fitur) */}
            <Card>
              <h2 className="text-sm font-bold text-app-text mb-1">Cost per Fitur ({periodDays} Hari)</h2>
              <p className="text-[11px] text-app-subtle mb-3">Token · request · latency · cache hit · biaya per fitur (dari ai_usage_metrics + system_metrics).</p>
              {!usageSummary || Object.keys(usageSummary.features).length === 0 ? (
                <EmptyMini message="Belum ada penggunaan AI pada rentang ini." />
              ) : (
                <div className="space-y-2">
                  {Object.entries(usageSummary.features).map(([feature, usage]) => {
                    const cache = cacheByFeatureMap.get(feature);
                    const hasCacheData = !!cache && cache.hits + cache.misses > 0;
                    return (
                      <div
                        key={feature}
                        className="grid grid-cols-2 gap-2 py-2.5 border-t border-app-border first:border-t-0 sm:grid-cols-[1.5fr_1fr_1fr_1fr_1fr] sm:items-center"
                      >
                        <div>
                          <p className="text-sm font-medium text-app-text">{FEATURE_LABELS[feature] || feature}</p>
                          <p className="text-xs text-app-subtle">{usage.calls} calls · {formatTokens(usage.tokens)} token</p>
                        </div>
                        <div className="text-right sm:text-center">
                          <p className="text-sm font-bold text-app-text">{usage.avgTimeMs}ms</p>
                          <p className="text-[11px] text-app-subtle font-medium">Latency</p>
                        </div>
                        <div className="text-right sm:text-center">
                          <p className="text-sm font-bold text-app-text">{hasCacheData ? `${Math.round(cache.hitRate * 100)}%` : '—'}</p>
                          <p className="text-[11px] text-app-subtle font-medium">Cache Hit</p>
                        </div>
                        <div className="text-right sm:text-center">
                          <p className="text-sm font-bold text-app-text">{formatIdr(usage.costIdr)}</p>
                          <p className="text-[11px] text-app-subtle font-medium">Biaya</p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-bold text-app-text">{Math.round(usage.successRate * 100)}%</p>
                          <p className="text-[11px] text-app-subtle font-medium">Sukses</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>

            {/* AI Search Engagement (Sprint 1.9) — suggested queries + CTR */}
            <Card>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-bold text-app-text">AI Search Engagement</h2>
                <span className="text-[11px] text-app-subtle font-medium">{periodDays} hari · klik hasil & suggestion</span>
              </div>
              {!engagement || (engagement.searches === 0 && engagement.clicks === 0 && engagement.suggestionsUsed === 0) ? (
                <EmptyMini message="Belum ada data engagement AI Search pada rentang ini." />
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-4 text-center mb-5">
                    <CacheStat icon={<MousePointerClick className="h-3.5 w-3.5 text-primary-500" />} label="Klik Hasil" value={String(engagement.clicks)} />
                    <CacheStat icon={<Sparkles className="h-3.5 w-3.5 text-mint-500" />} label="Suggestion Dipakai" value={String(engagement.suggestionsUsed)} />
                    <CacheStat icon={<TrendingUp className="h-3.5 w-3.5 text-amber-500" />} label="CTR" value={`${Math.round(engagement.ctr * 100)}%`} />
                  </div>
                  {engagement.searches > 0 && (
                    <p className="text-[11px] text-app-subtle mb-1">
                      CTR = klik hasil ÷ {engagement.searches} pencarian · suggestion = suggested query yang dipakai user.
                    </p>
                  )}

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-4">
                    {/* Top suggested queries */}
                    <div>
                      <p className="text-[11px] font-bold text-app-subtle mb-2 uppercase tracking-wide">Top Suggested Queries</p>
                      {engagement.topSuggestedQueries.length === 0 ? (
                        <p className="text-xs text-app-muted">Belum ada suggested query yang dipakai.</p>
                      ) : (
                        <div className="space-y-2.5">
                          {engagement.topSuggestedQueries.map((q, i) => {
                            const max = engagement.topSuggestedQueries[0].count || 1;
                            return (
                              <div key={q.query} className="flex items-center gap-2.5">
                                <span className="w-4 shrink-0 text-right text-[11px] font-bold text-app-subtle">{i + 1}</span>
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center justify-between gap-2">
                                    <p className="truncate text-xs font-medium text-app-text">{q.query}</p>
                                    <span className="shrink-0 text-[11px] font-bold text-app-subtle">{q.count}×</span>
                                  </div>
                                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-app-hover">
                                    <div
                                      className="h-full rounded-full bg-primary-500 transition-all"
                                      style={{ width: `${Math.round((q.count / max) * 100)}%` }}
                                    />
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* Per-tab breakdown */}
                    <div>
                      <p className="text-[11px] font-bold text-app-subtle mb-2 uppercase tracking-wide">Per Tab</p>
                      {engagement.clicksByTab.length === 0 && engagement.suggestionsByTab.length === 0 ? (
                        <p className="text-xs text-app-muted">Belum ada aktivitas per tab.</p>
                      ) : (
                        <div className="space-y-1.5">
                          {mergeTabCounts(engagement.clicksByTab, engagement.suggestionsByTab).map((row) => (
                            <div key={row.tab} className="flex items-center justify-between border-t border-app-border first:border-t-0 py-1.5">
                              <p className="text-xs font-medium capitalize text-app-text">{row.tab}</p>
                              <div className="flex items-center gap-3 text-[11px] text-app-subtle">
                                <span><span className="font-bold text-primary-500">{row.clicks}</span> klik</span>
                                <span><span className="font-bold text-mint-500">{row.suggestions}</span> suggestion</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </Card>

            {/* Feedback → Prioritas Perbaikan Prompt (Sprint 1.5) */}
            {feedbackSummary && <FeedbackPriorityPanel summary={feedbackSummary} />}

            {/* Retention D1/D7/D14/D28 (P10.2) */}
            {retention && <RetentionPanel data={retention} />}

            {/* Rekomendasi AI — funnel shown/opened/CTR (P10.2) */}
            {recommendation && (
              <RecommendationPanel
                data={recommendation}
                periodDays={periodDays}
                users={telemetryUsers}
                selectedUserId={selectedUserId}
                onUserChange={setSelectedUserId}
              />
            )}

            {/* Feedback Rate — ai_feedback ÷ ai_result_shown (P10.2i) */}
            {feedbackRate && (
              <FeedbackRatePanel
                data={feedbackRate}
                periodDays={periodDays}
                users={telemetryUsers}
                selectedUserId={selectedUserId}
                onUserChange={setSelectedUserId}
              />
            )}

            {/* Feature health cards */}
            <div>
              <h2 className="text-sm font-bold text-app-text mb-3 px-1">Kesehatan Fitur</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {health.map((h) => {
                  const label = FEATURE_LABELS[h.feature] || h.feature;
                  const goDetail = () => navigate(`/admin/monitoring/${h.feature}`);
                  return (
                  <Card
                    key={h.feature}
                    role="button"
                    tabIndex={0}
                    aria-label={`Lihat detail riwayat panggilan ${label}`}
                    onClick={goDetail}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        goDetail();
                      }
                    }}
                    className="cursor-pointer transition hover:border-primary-300 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 dark:hover:border-primary-500/40"
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-app-text">{label}</p>
                      <span className={cn(
                        'text-xs font-bold px-2 py-0.5 rounded-full',
                        h.successRate >= 0.9 ? 'bg-mint-50 text-mint-700 dark:bg-mint-500/12 dark:text-mint-300'
                          : h.successRate >= 0.7 ? 'bg-amber-50 text-amber-600 dark:bg-amber-500/12 dark:text-amber-300'
                          : 'bg-red-50 text-red-700 dark:bg-red-500/12 dark:text-red-300'
                      )}>
                        {Math.round(h.successRate * 100)}%
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 mt-3 text-center">
                      <div><p className="text-sm font-bold text-app-text">{h.totalCalls}</p><p className="text-[11px] text-app-subtle">Calls</p></div>
                      <div><p className="text-sm font-bold text-red-500">{h.failureCount}</p><p className="text-[11px] text-app-subtle">Gagal</p></div>
                      <div><p className="text-sm font-bold text-app-text">{h.avgTimeMs}ms</p><p className="text-[11px] text-app-subtle">Avg</p></div>
                    </div>
                    <p className="mt-2 text-[11px] font-medium text-primary-500">Lihat detail →</p>
                  </Card>
                  );
                })}
              </div>
            </div>

            {/* Alerts panel */}
            <Card>
              <h2 className="text-sm font-bold text-app-text mb-3">Alerts</h2>
              {alerts.length === 0 ? (
                <EmptyMini message="Belum ada alert rule aktif." />
              ) : (
                <div className="space-y-2">
                  {alerts.map((a) => (
                    <div key={a.name} className="flex items-center justify-between py-2 border-t border-app-border first:border-t-0">
                      <div className="flex items-center gap-2">
                        {a.status === 'triggered'
                          ? <AlertTriangle className="h-4 w-4 text-red-500" />
                          : <CheckCircle2 className="h-4 w-4 text-mint-500" />}
                        <div>
                          <p className="text-sm font-medium text-app-text">{a.name}</p>
                          <p className="text-[11px] text-app-subtle">
                            {a.currentValue} {a.condition === 'gt' ? '>' : a.condition === 'lt' ? '<' : '='} {a.threshold} ({a.windowMinutes}m)
                          </p>
                        </div>
                      </div>
                      <span className={cn(
                        'text-xs font-bold px-2 py-0.5 rounded-full',
                        a.status === 'triggered'
                          ? 'bg-red-50 text-red-700 dark:bg-red-500/12 dark:text-red-300'
                          : 'bg-mint-50 text-mint-700 dark:bg-mint-500/12 dark:text-mint-300'
                      )}>
                        {a.status === 'triggered' ? 'TRIGGERED' : 'OK'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

function MetricCard({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent: string }) {
  return (
    <Card>
      <div className={cn('w-8 h-8 rounded-xl bg-app-hover/80 flex items-center justify-center mb-2', accent)}>
        {icon}
      </div>
      <p className="text-[11px] text-app-subtle font-medium">{label}</p>
      <p className="text-lg font-black text-app-text mt-0.5">{value}</p>
    </Card>
  );
}

/**
 * Tile ringkasan per fitur: daftar ber-urut dengan mini bar (pola sama dengan
 * Top Suggested Queries). `max` = nilai pemuncak — bar proporsional terhadapnya.
 */
function FeatureRankList({ title, rows, valueKey, barClass, formatValue }: {
  title: string;
  rows: FeatureRankRow[];
  valueKey: 'costIdr' | 'tokens';
  barClass: string;
  formatValue: (v: number) => string;
}) {
  const max = rows.length > 0 ? rows[0][valueKey] || 1 : 1;
  return (
    <div>
      <p className="text-[11px] font-bold text-app-subtle mb-2 uppercase tracking-wide">{title}</p>
      {rows.length === 0 ? (
        <p className="text-xs text-app-muted">Belum ada data.</p>
      ) : (
        <div className="space-y-2.5">
          {rows.map((row, i) => (
            <div key={row.feature} className="flex items-center gap-2.5">
              <span className="w-4 shrink-0 text-right text-[11px] font-bold text-app-subtle">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-xs font-medium text-app-text">{FEATURE_LABELS[row.feature] || row.feature}</p>
                  <span className="shrink-0 text-[11px] font-bold text-app-text">{formatValue(row[valueKey])}</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-app-hover">
                  <div
                    className={cn('h-full rounded-full transition-all', barClass)}
                    style={{ width: `${Math.round((row[valueKey] / max) * 100)}%` }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CacheStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div>
      <div className="flex items-center justify-center gap-1">{icon}<p className="text-sm font-black text-app-text">{value}</p></div>
      <p className="text-[11px] text-app-subtle font-medium mt-0.5">{label}</p>
    </div>
  );
}

function EmptyMini({ message }: { message: string }) {
  return (
    <div className="py-8 text-center">
      <p className="text-sm text-app-muted">{message}</p>
    </div>
  );
}

/**
 * Sprint 1.5 — panel prioritas perbaikan prompt dari dataset ai_feedback.
 * Ranking dari actionPlan server (score desc); bar = negativeRate per feature;
 * badge skor 0-100 (merah ≥60 · amber ≥30 · mint lainnya) + rating negatif dominan.
 */
function FeedbackPriorityPanel({ summary }: { summary: FeedbackSummaryResponse }) {
  const negativePct = (feature: string) => {
    const s = summary.features.find((f) => f.feature === feature);
    return s ? Math.round(s.negativeRate * 100) : 0;
  };

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-50 dark:bg-amber-500/12 text-amber-600 dark:text-amber-300">
            <ThumbsUp className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-app-text">Prioritas Perbaikan Prompt</h2>
            <p className="text-[11px] text-app-subtle">Dataset ai_feedback (semua waktu) — fitur mana yang prompt-nya perlu dievaluasi/diperbaiki duluan.</p>
          </div>
        </div>
        <div className="flex items-center gap-3 text-[11px] font-medium text-app-subtle">
          <span>{summary.totalFeedback} feedback</span>
          <span>{summary.featuresWithFeedback} feature</span>
          {summary.totalFeedback > 0 && (
            <span className={cn(
              'rounded-full px-2 py-0.5 font-bold',
              summary.overallNegativeRate >= 0.3
                ? 'bg-red-500/10 text-red-500 dark:text-red-300'
                : 'bg-mint-500/10 text-mint-600 dark:text-mint-300',
            )}>
              negatif {Math.round(summary.overallNegativeRate * 100)}%
            </span>
          )}
        </div>
      </div>

      {summary.totalFeedback === 0 ? (
        <EmptyMini message="Belum ada feedback dari user. Ajakan feedback muncul di kartu AI (AI Hub, Advisor, dst)." />
      ) : (
        <div className="space-y-2.5">
          {summary.actionPlan.map((plan, i) => {
            const pct = negativePct(plan.feature);
            return (
              <div key={plan.feature} className="rounded-xl border border-app-border bg-app-bg/50 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="w-4 shrink-0 text-right text-[11px] font-bold text-app-subtle">{i + 1}</span>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-app-text">{plan.label || plan.feature}</p>
                      <p className="truncate text-[10px] text-app-muted">{plan.prompt} · {plan.file}</p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {plan.dominantNegative && (
                      <span className={cn(
                        'rounded-full border px-2 py-0.5 text-[10px] font-semibold',
                        plan.dominantNegative === 'not_helpful'
                          ? 'border-red-500/30 bg-red-500/10 text-red-500 dark:text-red-300'
                          : plan.dominantNegative === 'mismatched'
                            ? 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300'
                            : 'border-slate-500/30 bg-slate-500/10 text-app-muted',
                      )}>
                        {plan.dominantNegative}
                      </span>
                    )}
                    <span className={cn(
                      'rounded-full border px-2 py-0.5 text-[10px] font-bold tabular-nums',
                      plan.priorityScore >= 60
                        ? 'border-red-500/30 bg-red-500/10 text-red-500 dark:text-red-300'
                        : plan.priorityScore >= 30
                          ? 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300'
                          : 'border-mint-500/30 bg-mint-500/10 text-mint-600 dark:text-mint-300',
                    )}>
                      {plan.priorityScore}/100
                    </span>
                    <span className="text-[11px] font-bold text-app-subtle">{plan.total} fb</span>
                  </div>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-app-hover">
                  <div
                    className={cn('h-full rounded-full transition-all', pct >= 60 ? 'bg-red-500' : pct >= 30 ? 'bg-amber-500' : 'bg-mint-500')}
                    style={{ width: `${Math.min(100, pct)}%` }}
                  />
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-app-muted">{plan.direction}</p>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

/**
 * P10.2 — panel retention D1/D7/D14/D28 dari cohort user + sinyal user_active.
 * Guard: total cohort < minCohortUsers (10) → empty state "belum cukup data"
 * (hindari angka kosong/menyesatkan — PRODUCT_METRICS aturan pelaporan).
 */
function RetentionPanel({ data }: { data: RetentionMetrics }) {
  const fmt = (rate: number | null | undefined): string => {
    if (rate === null || rate === undefined) return '—';
    return `${Math.round(rate * 100)}%`;
  };
  const tone = (rate: number | null | undefined) => {
    if (rate === null || rate === undefined) return 'text-app-subtle';
    return rate >= 0.4 ? 'text-mint-600 dark:text-mint-300' : rate >= 0.2 ? 'text-amber-600 dark:text-amber-300' : 'text-red-500';
  };

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-50 dark:bg-primary-500/12 text-primary-600 dark:text-primary-300">
            <Users className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-app-text">Retensi Pengguna</h2>
            <p className="text-[11px] text-app-subtle">Cohort per hari registrasi (UTC) · sinyal user_active · D1/D7/D14/D28</p>
          </div>
        </div>
        {data.totalCohorts > 0 && (
          <span className="text-[11px] font-medium text-app-subtle">
            {data.totalCohorts} cohort · {data.totalCohortUsers} user
          </span>
        )}
      </div>

      {data.cohortGuardActive || data.cohorts.length === 0 ? (
        <EmptyMini
          message={`Belum cukup data untuk retention (butuh cohort ≥ ${data.minCohortUsers} user per hari). Angka hanya dilaporkan setelah cohort beta nyata terkumpul — hindari data kosong/menyesatkan.`}
        />
      ) : (
        <>
          {/* Ringkasan mean per offset */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
            {data.days.map((d) => (
              <div key={d.day} className="rounded-xl border border-app-border bg-app-bg/50 p-3 text-center">
                <p className="text-lg font-black tabular-nums text-app-text">{fmt(d.rate)}</p>
                <p className="text-[10px] font-medium text-app-subtle mt-0.5">D{d.day}</p>
                <p className="text-[10px] text-app-muted">{d.users} cohort</p>
              </div>
            ))}
          </div>

          {/* Tabel per cohort-day */}
          <div className="overflow-x-auto rounded-xl border border-app-border">
            <table className="w-full text-xs">
              <thead className="bg-app-bg/60 text-left text-[11px] uppercase tracking-wide text-app-subtle">
                <tr>
                  <th className="px-2.5 py-2">Cohort (hari)</th>
                  <th className="px-2.5 py-2 text-right">User</th>
                  <th className="px-2.5 py-2 text-right">D1</th>
                  <th className="px-2.5 py-2 text-right">D7</th>
                  <th className="px-2.5 py-2 text-right">D14</th>
                  <th className="px-2.5 py-2 text-right">D28</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-app-border/60">
                {data.cohorts.map((c) => (
                  <tr key={c.day}>
                    <td className="px-2.5 py-2 font-medium tabular-nums text-app-text">{c.day}</td>
                    <td className="px-2.5 py-2 text-right tabular-nums text-app-text">{c.users}</td>
                    <td className={cn('px-2.5 py-2 text-right tabular-nums font-semibold', tone(c.d1))}>{fmt(c.d1)}</td>
                    <td className={cn('px-2.5 py-2 text-right tabular-nums font-semibold', tone(c.d7))}>{fmt(c.d7)}</td>
                    <td className={cn('px-2.5 py-2 text-right tabular-nums font-semibold', tone(c.d14))}>{fmt(c.d14)}</td>
                    <td className={cn('px-2.5 py-2 text-right tabular-nums font-semibold', tone(c.d28))}>{fmt(c.d28)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-app-subtle">
            D-N = % cohort yang aktif pada hari registrasi+N (UTC). Kolom "—" = jendela pengamatan belum tercapai. Sinyal aktivitas: request API terautentikasi (user_active, 1×/user/hari).
          </p>
        </>
      )}
    </Card>
  );
}

/**
 * P10.2 — panel "Rekomendasi AI": funnel recommendation_shown/_opened dari
 * system_metrics (via POST /api/ai-product/track). Tampilkan:
 *   - ringkasan shown / opened / CTR
 *   - seri per-hari CTR (line chart recharts, pola Tren Biaya)
 *   - breakdown per feature (mini bar, pola FeedbackPriorityPanel)
 */
function RecommendationPanel({ data, periodDays, users, selectedUserId, onUserChange }: {
  data: RecommendationEngagement;
  periodDays: number;
  users: TelemetryUser[];
  selectedUserId: string;
  onUserChange: (userId: string) => void;
}) {
  const hasData = data.shown > 0 || data.opened > 0 || data.byFeature.length > 0;
  const ctrTone = data.ctr >= 0.05 ? 'text-mint-600 dark:text-mint-300' : 'text-amber-600 dark:text-amber-300';

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 dark:bg-blue-500/12 text-blue-600 dark:text-blue-300">
            <ListChecks className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-app-text">Rekomendasi AI</h2>
            <p className="text-[11px] text-app-subtle">
              {periodDays} hari · shown/opened/CTR rekomendasi{selectedUserId ? ' · scoped ke user terpilih' : ' (event track frontend)'}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <UserScopeSelect users={users} value={selectedUserId} onChange={onUserChange} />
          <span className="text-[11px] font-medium text-app-subtle">CTR = opened ÷ shown</span>
        </div>
      </div>

      {!hasData ? (
        <EmptyMini message="Belum ada aktivitas rekomendasi pada rentang ini. Rekomendasi ter-tracking saat dirender/dibuka di halaman AI Timeline." />
      ) : (
        <>
          {/* Ringkasan */}
          <div className="grid grid-cols-3 gap-4 text-center mb-5">
            <CacheStat icon={<Sparkles className="h-3.5 w-3.5 text-primary-500" />} label="Ditampilkan" value={String(data.shown)} />
            <CacheStat icon={<MousePointerClick className="h-3.5 w-3.5 text-mint-500" />} label="Dibuka" value={String(data.opened)} />
            <CacheStat icon={<TrendingUp className={cn('h-3.5 w-3.5', ctrTone)} />} label="CTR" value={`${Math.round(data.ctr * 100)}%`} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Tren CTR per hari */}
            <div>
              <p className="text-[11px] font-bold text-app-subtle mb-2 uppercase tracking-wide">CTR per Hari</p>
              {data.byDay.length === 0 ? (
                <p className="text-xs text-app-muted">Belum ada data harian.</p>
              ) : (
                <div className="h-48" role="img" aria-label="Grafik rasio klik (CTR) rekomendasi AI harian">
                  <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0} initialDimension={{ width: 0, height: 192 }}>
                    <LineChart data={data.byDay} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-app-border" opacity={0.3} />
                      <XAxis dataKey="date" tick={{ fontSize: 9 }} stroke="currentColor" className="text-app-subtle" />
                      <YAxis
                        tick={{ fontSize: 9 }}
                        stroke="currentColor"
                        className="text-app-subtle"
                        domain={[0, 1]}
                        tickFormatter={(v) => `${Math.round(Number(v) * 100)}%`}
                      />
                      <Tooltip
                        formatter={(value, name, props) => {
                          if (name === 'CTR') return [`${Math.round(Number(value) * 100)}%`, 'CTR'];
                          const day = (props?.payload as RecommendationDayStat | undefined);
                          return [
                            day ? `${day.shown} shown · ${day.opened} opened` : String(value),
                            String(name),
                          ];
                        }}
                        contentStyle={{ borderRadius: 12, fontSize: 11 }}
                      />
                      <Line type="monotone" dataKey="ctr" name="CTR" stroke="#6366f1" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            {/* Breakdown per feature */}
            <div>
              <p className="text-[11px] font-bold text-app-subtle mb-2 uppercase tracking-wide">Per Feature</p>
              {data.byFeature.length === 0 ? (
                <p className="text-xs text-app-muted">Belum ada data per feature.</p>
              ) : (
                <div className="space-y-2.5">
                  {data.byFeature.map((f, i) => {
                    const max = data.byFeature[0].count || 1;
                    return (
                      <div key={f.feature} className="flex items-center gap-2.5">
                        <span className="w-4 shrink-0 text-right text-[11px] font-bold text-app-subtle">{i + 1}</span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <p className="truncate text-xs font-medium capitalize text-app-text">{f.feature}</p>
                            <span className="shrink-0 text-[11px] font-bold text-app-subtle">{f.count}×</span>
                          </div>
                          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-app-hover">
                            <div
                              className="h-full rounded-full bg-blue-500 transition-all"
                              style={{ width: `${Math.round((f.count / max) * 100)}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* CTR per event_type (P10.2d) — breakdown shown/opened/CTR per tipe */}
          <div className="mt-5">
            <p className="text-[11px] font-bold text-app-subtle mb-2 uppercase tracking-wide">Per Event Type</p>
            {data.byEventType.length === 0 ? (
              <p className="text-xs text-app-muted">Belum ada data per event type.</p>
            ) : (
              <div className="space-y-2">
                {data.byEventType.map((et) => (
                  <div key={et.eventType} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-app-border first:border-t-0 py-2">
                    <p className="text-xs font-medium capitalize text-app-text">{et.eventType.replace(/_/g, ' ')}</p>
                    <div className="flex items-center gap-3 text-[11px] text-app-subtle">
                      <span><span className="font-bold text-app-text">{et.shown}</span> shown</span>
                      <span><span className="font-bold text-app-text">{et.opened}</span> opened</span>
                      <span className={cn('rounded-full border px-2 py-0.5 font-bold tabular-nums', et.ctr >= 0.05 ? 'border-mint-500/30 bg-mint-500/10 text-mint-600 dark:text-mint-300' : 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300')}>
                        CTR {Math.round(et.ctr * 100)}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <p className="mt-3 text-[11px] text-app-subtle">
            Sumber: event <code className="rounded bg-app-hover px-1 text-app-muted">recommendation_shown</code> / <code className="rounded bg-app-hover px-1 text-app-muted">recommendation_opened</code> via{' '}
            <code className="rounded bg-app-hover px-1 text-app-muted">POST /api/ai-product/track</code> — non-PII, user-scoped. Scoping: hanya event_type recommendation — halaman AI Timeline + kartu timeline AI Hub (P10.2e).
          </p>
        </>
      )}
    </Card>
  );
}

/**
 * P10.2i — panel "Feedback Rate": ai_feedback (numerator) ÷ ai_result_shown
 * (denominator = tampilan kartu AI feedback-capable, event track frontend).
 * Tampilkan ringkasan feedback / views / rate + breakdown per feature.
 */
function FeedbackRatePanel({ data, periodDays, users, selectedUserId, onUserChange }: {
  data: FeedbackRateSummary;
  periodDays: number;
  users: TelemetryUser[];
  selectedUserId: string;
  onUserChange: (userId: string) => void;
}) {
  const hasData = data.views > 0 || data.feedback > 0 || data.byFeature.length > 0;
  const rateTone = data.rate >= 0.2 ? 'text-mint-600 dark:text-mint-300' : 'text-amber-600 dark:text-amber-300';

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-50 dark:bg-violet-500/12 text-violet-600 dark:text-violet-300">
            <ThumbsDown className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-app-text">Feedback Rate</h2>
            <p className="text-[11px] text-app-subtle">
              {periodDays} hari · feedback ÷ tampilan kartu AI{selectedUserId ? ' · scoped ke user terpilih' : ' (event track frontend)'}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <UserScopeSelect users={users} value={selectedUserId} onChange={onUserChange} />
          <span className="text-[11px] font-medium text-app-subtle">Feedback Rate = feedback ÷ views</span>
        </div>
      </div>

      {!hasData ? (
        <EmptyMini message="Belum ada data pada rentang ini. Tampilan kartu AI ter-tracking via event ai_result_shown (AI Hub, AI Timeline, Advisor, Chat)." />
      ) : (
        <>
          {/* Ringkasan */}
          <div className="grid grid-cols-3 gap-4 text-center mb-5">
            <CacheStat icon={<ThumbsUp className="h-3.5 w-3.5 text-primary-500" />} label="Feedback" value={String(data.feedback)} />
            <CacheStat icon={<Sparkles className="h-3.5 w-3.5 text-blue-500" />} label="Tampilan Kartu" value={String(data.views)} />
            <CacheStat icon={<TrendingUp className={cn('h-3.5 w-3.5', rateTone)} />} label="Rate" value={`${Math.round(data.rate * 100)}%`} />
          </div>

          {/* Breakdown per feature */}
          <p className="text-[11px] font-bold text-app-subtle mb-2 uppercase tracking-wide">Per Feature</p>
          {data.byFeature.length === 0 ? (
            <p className="text-xs text-app-muted">Belum ada data per feature.</p>
          ) : (
            <div className="space-y-2.5">
              {data.byFeature.map((f, i) => {
                const max = data.byFeature[0].feedback || 1;
                return (
                  <div key={f.feature} className="flex flex-wrap items-center gap-2.5">
                    <span className="w-4 shrink-0 text-right text-[11px] font-bold text-app-subtle">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-xs font-medium capitalize text-app-text">{f.feature}</p>
                        <span className="shrink-0 text-[11px] font-bold text-app-subtle">
                          {f.feedback} fb · {f.views} views
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-app-hover">
                        <div
                          className="h-full rounded-full bg-violet-500 transition-all"
                          style={{ width: `${Math.round((f.feedback / max) * 100)}%` }}
                        />
                      </div>
                    </div>
                    <span className={cn(
                      'shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold tabular-nums',
                      f.rate >= 0.2
                        ? 'border-mint-500/30 bg-mint-500/10 text-mint-600 dark:text-mint-300'
                        : 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300',
                    )}>
                      {Math.round(f.rate * 100)}%
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          <p className="mt-3 text-[11px] text-app-subtle">
            Sumber: <code className="rounded bg-app-hover px-1 text-app-muted">ai_feedback</code> ÷{' '}
            <code className="rounded bg-app-hover px-1 text-app-muted">ai_result_shown</code> (POST /api/ai-product/track) — non-PII, user-scoped.
            Numerator & denominator SAMA-SAMA dari kartu feedback-capable (timeline, hub insight/health/simulation, advisor, chat) → scoping konsisten.
          </p>
        </>
      )}
    </Card>
  );
}

/**
 * P10.2 view per-user — dropdown user dengan aktivitas telemetry AI pada
 * rentang (sumber GET /api/admin/metrics/telemetry-users). '' = Semua User;
 * memilih user meng-scope panel Rekomendasi AI & Feedback Rate ke user itu
 * (QA verifikasi telemetry satu user tanpa query Turso manual). Disabled
 * dengan label "Belum ada user" bila tidak ada aktivitas telemetry pada rentang.
 */
function UserScopeSelect({ users, value, onChange }: {
  users: TelemetryUser[];
  value: string;
  onChange: (userId: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Filter per user"
      title="Scoping telemetry ke satu user (Rekomendasi AI & Feedback Rate)"
      disabled={users.length === 0}
      className="max-w-56 rounded-xl bg-app-hover px-2.5 py-1.5 text-[11px] font-bold text-app-text transition hover:bg-app-border/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 disabled:opacity-50"
    >
      <option value="">{users.length === 0 ? 'Belum ada user' : 'Semua User'}</option>
      {users.map((u) => (
        <option key={u.userId} value={u.userId}>
          {u.label} · {u.activity} aktivitas
        </option>
      ))}
    </select>
  );
}

/** Gabungkan klik & suggestion per tab jadi satu baris (urut total aktivitas desc). */
function mergeTabCounts(
  clicks: AgentSearchTabCount[],
  suggestions: AgentSearchTabCount[],
): Array<{ tab: string; clicks: number; suggestions: number }> {
  const merged = new Map<string, { clicks: number; suggestions: number }>();
  for (const c of clicks) {
    merged.set(c.tab, { clicks: c.count, suggestions: 0 });
  }
  for (const s of suggestions) {
    const existing = merged.get(s.tab) || { clicks: 0, suggestions: 0 };
    existing.suggestions = s.count;
    merged.set(s.tab, existing);
  }
  return [...merged.entries()]
    .map(([tab, v]) => ({ tab, ...v }))
    .sort((a, b) => b.clicks + b.suggestions - (a.clicks + a.suggestions));
}
