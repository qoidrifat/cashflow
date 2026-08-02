// CF-053: Admin Monitoring Dashboard
import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import {
  DollarSign, Cpu, Activity, Clock, AlertTriangle, CheckCircle2,
  RefreshCw, ShieldAlert,
} from 'lucide-react';
import Header from '../../components/layout/Header';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import { useAuthStore } from '../../store/useAuthStore';
import {
  fetchMetricsSummary, fetchAiUsage, fetchFeatureHealth, fetchAlerts,
} from '../../services/adminMetrics';
import type {
  MetricsSummary, CostTrendPoint, FeatureHealth, AlertStatus,
} from '../../types/metrics';
import { cn } from '../../lib/utils';

const FEATURE_LABELS: Record<string, string> = {
  gmail_sync: 'Gmail Sync',
  agent_search: 'Agent Search',
  ocr_receipt: 'OCR Receipt',
  insight_generator: 'Insight Generator',
};

function formatIdr(value: number): string {
  return 'Rp ' + Math.round(value).toLocaleString('id-ID');
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

export default function MonitoringPage() {
  const { firebaseUser } = useAuthStore();
  const navigate = useNavigate();
  const [summary, setSummary] = useState<MetricsSummary | null>(null);
  const [trend, setTrend] = useState<CostTrendPoint[]>([]);
  const [health, setHealth] = useState<FeatureHealth[]>([]);
  const [alerts, setAlerts] = useState<AlertStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ code?: string; message: string } | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [summaryRes, usageRes, healthRes, alertsRes] = await Promise.all([
        fetchMetricsSummary(),
        fetchAiUsage(),
        fetchFeatureHealth(),
        fetchAlerts(),
      ]);
      setSummary(summaryRes);
      setTrend(usageRes.trend || []);
      setHealth(healthRes.health || []);
      setAlerts(alertsRes.alerts || []);
    } catch (err) {
      const typed = err as Error & { code?: string };
      setError({ code: typed.code, message: typed.message || 'Gagal memuat data monitoring.' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (firebaseUser?.uid) void loadAll();
  }, [firebaseUser?.uid, loadAll]);

  return (
    <div>
      <Header title="Monitoring" />
      <div className="mx-auto max-w-6xl space-y-5 p-4 lg:p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-black text-app-text">AI Cost & Health</h1>
            <p className="text-sm text-app-muted mt-1">Observability biaya AI dan kesehatan fitur CashFlow.</p>
          </div>
          <Button variant="outline" size="sm" icon={<RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />} onClick={loadAll} disabled={loading}>
            Refresh
          </Button>
        </div>

        {/* Error state */}
        {error && (
          <Card className="border-red-200 bg-red-50/70 dark:border-red-400/20 dark:bg-red-500/8">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-red-500 text-white">
                {error.code === 'ADMIN_METRICS_403' ? <ShieldAlert className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-bold text-app-text">
                  {error.code === 'ADMIN_METRICS_403' ? 'Akses ditolak' : 'Tidak dapat memuat data monitoring'}
                </h3>
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

            {/* Cost trend chart */}
            <Card>
              <h3 className="text-sm font-bold text-app-text mb-3">Tren Biaya (7 Hari)</h3>
              {trend.length === 0 ? (
                <EmptyMini message="Belum ada data biaya pada rentang ini." />
              ) : (
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trend} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-app-border" opacity={0.3} />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="currentColor" className="text-app-subtle" />
                      <YAxis tick={{ fontSize: 10 }} stroke="currentColor" className="text-app-subtle" />
                      <Tooltip
                        formatter={(value) => formatIdr(Number(value) || 0)}
                        contentStyle={{ borderRadius: 12, fontSize: 12 }}
                      />
                      <Line type="monotone" dataKey="costIdr" stroke="#10b981" strokeWidth={2} dot={false} name="Biaya" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>

            {/* Per-feature cost breakdown */}
            <Card>
              <h3 className="text-sm font-bold text-app-text mb-3">Biaya per Fitur (7 Hari)</h3>
              {Object.keys(summary.features).length === 0 ? (
                <EmptyMini message="Belum ada penggunaan AI pada rentang ini." />
              ) : (
                <div className="space-y-2">
                  {Object.entries(summary.features).map(([feature, usage]) => (
                    <div key={feature} className="flex items-center justify-between py-2 border-t border-app-border first:border-t-0">
                      <div>
                        <p className="text-sm font-medium text-app-text">{FEATURE_LABELS[feature] || feature}</p>
                        <p className="text-xs text-app-subtle">{usage.calls} calls · {formatTokens(usage.tokens)} token</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold text-app-text">{formatIdr(usage.costIdr)}</p>
                        <p className="text-xs text-app-subtle">{Math.round(usage.successRate * 100)}% sukses</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* Feature health cards */}
            <div>
              <h3 className="text-sm font-bold text-app-text mb-3 px-1">Kesehatan Fitur</h3>
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
                        h.successRate >= 0.9 ? 'bg-mint-50 text-mint-600 dark:bg-mint-500/12 dark:text-mint-300'
                          : h.successRate >= 0.7 ? 'bg-amber-50 text-amber-600 dark:bg-amber-500/12 dark:text-amber-300'
                          : 'bg-red-50 text-red-600 dark:bg-red-500/12 dark:text-red-300'
                      )}>
                        {Math.round(h.successRate * 100)}%
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 mt-3 text-center">
                      <div><p className="text-sm font-bold text-app-text">{h.totalCalls}</p><p className="text-[10px] text-app-subtle">Calls</p></div>
                      <div><p className="text-sm font-bold text-red-500">{h.failureCount}</p><p className="text-[10px] text-app-subtle">Gagal</p></div>
                      <div><p className="text-sm font-bold text-app-text">{h.avgTimeMs}ms</p><p className="text-[10px] text-app-subtle">Avg</p></div>
                    </div>
                    <p className="mt-2 text-[11px] font-medium text-primary-500">Lihat detail →</p>
                  </Card>
                  );
                })}
              </div>
            </div>

            {/* Alerts panel */}
            <Card>
              <h3 className="text-sm font-bold text-app-text mb-3">Alerts</h3>
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
                          ? 'bg-red-50 text-red-600 dark:bg-red-500/12 dark:text-red-300'
                          : 'bg-mint-50 text-mint-600 dark:bg-mint-500/12 dark:text-mint-300'
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
      <p className="text-[10px] text-app-subtle font-medium">{label}</p>
      <p className="text-lg font-black text-app-text mt-0.5">{value}</p>
    </Card>
  );
}

function EmptyMini({ message }: { message: string }) {
  return (
    <div className="py-8 text-center">
      <p className="text-sm text-app-muted">{message}</p>
    </div>
  );
}
