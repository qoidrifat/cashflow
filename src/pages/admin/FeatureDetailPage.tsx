// CF-055: Admin Monitoring — per-feature call history detail page
import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, RefreshCw, AlertTriangle, CheckCircle2, ShieldAlert,
  ChevronLeft, ChevronRight, ChevronDown, Activity, Clock, XCircle,
} from 'lucide-react';
import Header from '../../components/layout/Header';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import { useAuthStore } from '../../store/useAuthStore';
import { fetchFeatureCalls } from '../../services/adminMetrics';
import type {
  FeatureCall, FeatureCallsResponse, FeatureCallStatus,
} from '../../types/metrics';
import { cn } from '../../lib/utils';

const FEATURE_LABELS: Record<string, string> = {
  gmail_sync: 'Gmail Sync',
  agent_search: 'Agent Search',
  ocr_receipt: 'OCR Receipt',
  insight_generator: 'Insight Generator',
};

const VALID_FEATURES = Object.keys(FEATURE_LABELS);

const STATUS_TABS: { key: FeatureCallStatus; label: string }[] = [
  { key: 'all', label: 'Semua' },
  { key: 'success', label: 'Berhasil' },
  { key: 'failed', label: 'Gagal' },
];

const PAGE_SIZE = 20;

function formatIdr(value: number): string {
  return 'Rp ' + Math.round(value).toLocaleString('id-ID');
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('id-ID', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function isFailed(status: string): boolean {
  return status !== 'success';
}

export default function FeatureDetailPage() {
  const { feature = '' } = useParams<{ feature: string }>();
  const navigate = useNavigate();
  const { firebaseUser } = useAuthStore();

  const [data, setData] = useState<FeatureCallsResponse | null>(null);
  const [status, setStatus] = useState<FeatureCallStatus>('all');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ code?: string; message: string } | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const knownFeature = VALID_FEATURES.includes(feature);
  const label = FEATURE_LABELS[feature] || feature;

  const load = useCallback(async () => {
    if (!knownFeature) {
      setError({ message: 'Fitur tidak dikenal.' });
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetchFeatureCalls(undefined, undefined, feature, status, page, PAGE_SIZE);
      setData(res);
    } catch (err) {
      const typed = err as Error & { code?: string };
      setError({ code: typed.code, message: typed.message || 'Gagal memuat riwayat panggilan.' });
    } finally {
      setLoading(false);
    }
  }, [feature, knownFeature, status, page]);

  useEffect(() => {
    if (firebaseUser?.uid) void load();
  }, [firebaseUser?.uid, load]);

  // Reset page when status filter changes.
  const onChangeStatus = (next: FeatureCallStatus) => {
    if (next === status) return;
    setStatus(next);
    setPage(1);
    setExpanded(null);
  };

  const summary = data?.summary;
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const items = data?.items ?? [];

  return (
    <div>
      <Header title="Detail Fitur" />
      <div className="mx-auto max-w-5xl space-y-5 p-4 lg:p-6">
        {/* Top bar */}
        <div className="flex items-center justify-between gap-3">
          <Button
            variant="ghost"
            size="sm"
            icon={<ArrowLeft className="h-4 w-4" />}
            onClick={() => navigate('/admin/monitoring')}
          >
            Kembali
          </Button>
          <Button
            variant="outline"
            size="sm"
            icon={<RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />}
            onClick={load}
            disabled={loading}
          >
            Refresh
          </Button>
        </div>

        <div>
          <h1 className="text-2xl font-black text-app-text">{label}</h1>
          <p className="text-sm text-app-muted mt-1">Riwayat panggilan AI 30 hari terakhir.</p>
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
                  {error.code === 'ADMIN_METRICS_403' ? 'Akses ditolak' : 'Tidak dapat memuat data'}
                </h3>
                <p className="mt-1 text-sm text-app-muted">
                  {error.code === 'ADMIN_METRICS_403'
                    ? 'Halaman ini khusus admin. Email kamu tidak terdaftar sebagai admin.'
                    : error.message}
                </p>
              </div>
              {error.code !== 'ADMIN_METRICS_403' && knownFeature && (
                <Button variant="outline" size="sm" onClick={load}>Coba Lagi</Button>
              )}
            </div>
          </Card>
        )}

        {/* Summary cards */}
        {!error && summary && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <SummaryCard icon={<Activity className="h-4 w-4" />} label="Total Calls" value={String(summary.totalCalls)} accent="text-primary-500" />
            <SummaryCard icon={<CheckCircle2 className="h-4 w-4" />} label="Success Rate" value={`${Math.round(summary.successRate * 100)}%`} accent="text-mint-500" />
            <SummaryCard icon={<XCircle className="h-4 w-4" />} label="Gagal" value={String(summary.failureCount)} accent="text-red-500" />
            <SummaryCard icon={<Clock className="h-4 w-4" />} label="Avg Time" value={`${summary.avgTimeMs} ms`} accent="text-blue-500" />
          </div>
        )}

        {/* Status filter tabs */}
        {!error && (
          <div className="flex items-center gap-2" role="tablist" aria-label="Filter status panggilan">
            {STATUS_TABS.map((tab) => (
              <button
                key={tab.key}
                role="tab"
                aria-selected={status === tab.key}
                onClick={() => onChangeStatus(tab.key)}
                className={cn(
                  'px-3 py-1.5 rounded-xl text-xs font-bold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400',
                  status === tab.key
                    ? 'bg-primary-500 text-white shadow-sm shadow-primary-500/25'
                    : 'bg-app-hover/70 text-app-muted hover:text-app-text',
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}

        {/* Loading skeleton */}
        {loading && !error && (
          <div className="space-y-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <Card key={i}><div className="animate-pulse h-12 bg-app-hover rounded-xl" /></Card>
            ))}
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && items.length === 0 && (
          <Card>
            <div className="py-10 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-app-hover/80 text-app-subtle">
                <Activity className="h-5 w-5" />
              </div>
              <p className="text-sm font-bold text-app-text">Belum ada panggilan</p>
              <p className="mt-1 text-sm text-app-muted">
                {status === 'failed'
                  ? 'Tidak ada panggilan gagal pada rentang ini.'
                  : status === 'success'
                  ? 'Tidak ada panggilan berhasil pada rentang ini.'
                  : 'Fitur ini belum memiliki riwayat panggilan AI.'}
              </p>
            </div>
          </Card>
        )}

        {/* Call history list */}
        {!loading && !error && items.length > 0 && (
          <Card className="p-0 overflow-hidden">
            {/* Desktop header */}
            <div className="hidden sm:grid grid-cols-12 gap-2 px-4 py-2.5 border-b border-app-border bg-app-hover/40 text-[11px] font-bold uppercase tracking-wide text-app-subtle">
              <div className="col-span-4">Waktu</div>
              <div className="col-span-2">Status</div>
              <div className="col-span-2 text-right">Token</div>
              <div className="col-span-2 text-right">Biaya</div>
              <div className="col-span-2 text-right">Durasi</div>
            </div>
            <div className="divide-y divide-app-border">
              {items.map((call) => (
                <CallRow
                  key={call.id}
                  call={call}
                  expanded={expanded === call.id}
                  onToggle={() => setExpanded((prev) => (prev === call.id ? null : call.id))}
                />
              ))}
            </div>
          </Card>
        )}

        {/* Pagination */}
        {!loading && !error && total > 0 && (
          <div className="flex items-center justify-between">
            <p className="text-xs text-app-subtle">
              Halaman {page} dari {totalPages} · {total} panggilan
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                icon={<ChevronLeft className="h-4 w-4" />}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1 || loading}
              >
                Sebelumnya
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages || loading}
              >
                Berikutnya
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryCard({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent: string }) {
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

function StatusBadge({ status }: { status: string }) {
  const failed = isFailed(status);
  return (
    <span className={cn(
      'inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full',
      failed
        ? 'bg-red-50 text-red-600 dark:bg-red-500/12 dark:text-red-300'
        : 'bg-mint-50 text-mint-600 dark:bg-mint-500/12 dark:text-mint-300',
    )}>
      {failed ? <AlertTriangle className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
      {status}
    </span>
  );
}

function CallRow({ call, expanded, onToggle }: { call: FeatureCall; expanded: boolean; onToggle: () => void }) {
  const failed = isFailed(call.status);
  const canExpand = failed && !!call.errorMessage;

  return (
    <div className="px-4 py-3">
      <div className="grid grid-cols-12 gap-2 items-center">
        <div className="col-span-12 sm:col-span-4 flex items-center gap-2">
          {canExpand ? (
            <button
              onClick={onToggle}
              aria-expanded={expanded}
              aria-label={expanded ? 'Sembunyikan detail error' : 'Tampilkan detail error'}
              className="flex items-center gap-1.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 rounded"
            >
              <ChevronDown className={cn('h-4 w-4 text-app-subtle transition-transform', expanded && 'rotate-180')} />
              <span className="text-sm text-app-text">{formatDateTime(call.createdAt)}</span>
            </button>
          ) : (
            <span className="text-sm text-app-text pl-[22px]">{formatDateTime(call.createdAt)}</span>
          )}
        </div>
        <div className="col-span-6 sm:col-span-2">
          <StatusBadge status={call.status} />
        </div>
        <div className="col-span-6 sm:col-span-2 text-right text-sm text-app-text">
          {formatTokens(call.totalTokens)}
          <span className="text-app-subtle"> tok</span>
        </div>
        <div className="col-span-6 sm:col-span-2 text-right text-sm text-app-text">
          {formatIdr(call.costIdr)}
        </div>
        <div className="col-span-6 sm:col-span-2 text-right text-sm text-app-text">
          {call.executionTimeMs == null ? '—' : `${call.executionTimeMs} ms`}
        </div>
      </div>

      {/* Expandable error log */}
      {canExpand && expanded && (
        <div className="mt-3 rounded-xl border border-red-200 bg-red-50/70 p-3 dark:border-red-400/20 dark:bg-red-500/8">
          <p className="text-[11px] font-bold uppercase tracking-wide text-red-600 dark:text-red-300 mb-1">
            Log Error
          </p>
          <p className="text-xs text-app-text break-words whitespace-pre-wrap font-mono">
            {call.errorMessage}
          </p>
          {call.provider && (
            <p className="mt-2 text-[11px] text-app-subtle">
              Provider: {call.provider}{call.model ? ` · ${call.model}` : ''}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
