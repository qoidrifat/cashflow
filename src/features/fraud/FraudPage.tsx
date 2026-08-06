/**
 * Fraud Protection — Review Page (Sprint 1.1 — Core Product).
 *
 * Menutup gap UI design doc FRAUD_DETECTION_DESIGN.md ("UI halaman detail flag"):
 * daftar flag fraud dengan detail (rule, severity, deskripsi, skor risiko,
 * keputusan & alasan AI) + aksi "Tandai sudah dicek" (POST /api/fraud/flags/:id/review).
 *
 * Backend + service (getFraudFlags / reviewFraudFlag) sudah ada sejak Sprint 1;
 * halaman ini adalah konsumen UI-nya.
 */
import { useEffect, useMemo, useState } from 'react';
import { ShieldAlert, ShieldCheck, CheckCircle2, Bot, FileWarning } from 'lucide-react';
import { useAuthStore } from '../../store/useAuthStore';
import { useAppStore } from '../../store/useAppStore';
import {
  getFraudPageData,
  reviewFraudFlag,
  FRAUD_RULE_LABELS,
  FRAUD_SEVERITY_LABELS,
} from '../../services/fraudService';
import { cn, formatCurrency, formatDate } from '../../lib/utils';
import type { FraudFlag, FraudSummary } from '../../types';
import Header from '../../components/layout/Header';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import EmptyState from '../../components/ui/EmptyState';
import ErrorState from '../../components/ui/ErrorState';

type FilterTab = 'open' | 'all';

const SEVERITY_CHIP: Record<string, string> = {
  critical: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
  high: 'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300',
  medium: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  low: 'bg-slate-100 text-slate-600 dark:bg-slate-500/15 dark:text-slate-300',
};

const DECISION_CHIP: Record<string, string> = {
  allow: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  review: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  block: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
};

export default function FraudPage() {
  const authUser = useAuthStore((s) => s.authUser);
  const addToast = useAppStore((s) => s.addToast);

  const [flags, setFlags] = useState<FraudFlag[]>([]);
  const [summary, setSummary] = useState<FraudSummary | null>(null);
  const [filter, setFilter] = useState<FilterTab>('open');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  const load = async () => {
    if (!authUser) return;
    setLoading(true);
    setError(null);
    try {
      const { flags: flagsData, summary: summaryData } = await getFraudPageData(100);
      setFlags(flagsData);
      setSummary(summaryData);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser]);

  const openFlags = useMemo(() => flags.filter((f) => f.status === 'open'), [flags]);
  const visibleFlags = filter === 'open' ? openFlags : flags;

  const handleReview = async (flag: FraudFlag) => {
    setReviewingId(flag.id);
    const ok = await reviewFraudFlag(flag.id);
    setReviewingId(null);
    if (ok) {
      addToast({
        type: 'success',
        title: 'Ditandai sudah dicek',
        message: 'Flag ini tidak lagi muncul di daftar perlu dicek.',
      });
      setFlags((prev) => prev.map((f) => (f.id === flag.id ? { ...f, status: 'reviewed' } : f)));
      setSummary((prev) => (prev ? { ...prev, openCount: Math.max(0, prev.openCount - 1) } : prev));
    } else {
      addToast({
        type: 'error',
        title: 'Gagal menyimpan',
        message: 'Tidak dapat memperbarui status flag. Coba lagi sebentar.',
      });
    }
  };

  return (
    <div>
      <Header title="Perlindungan Fraud" />

      <div className="p-4 lg:p-6 space-y-4 max-w-4xl mx-auto">
        {/* Summary strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-500/12 flex items-center justify-center">
              <ShieldAlert className="w-5 h-5 text-amber-600 dark:text-amber-300" />
            </div>
            <div>
              <p className="text-[11px] text-app-subtle">Perlu dicek</p>
              <p className="text-lg font-bold text-app-text">{summary?.openCount ?? '—'}</p>
            </div>
          </Card>
          <Card className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-app-hover flex items-center justify-center">
              <FileWarning className="w-5 h-5 text-app-text" />
            </div>
            <div>
              <p className="text-[11px] text-app-subtle">Total flag</p>
              <p className="text-lg font-bold text-app-text">{summary?.totalCount ?? '—'}</p>
            </div>
          </Card>
          <Card className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-50 dark:bg-red-500/12 flex items-center justify-center">
              <ShieldAlert className="w-5 h-5 text-red-500 dark:text-red-300" />
            </div>
            <div>
              <p className="text-[11px] text-app-subtle">Tinggi / Kritis</p>
              <p className="text-lg font-bold text-app-text">
                {(summary?.bySeverity.high ?? 0) + (summary?.bySeverity.critical ?? 0)}
              </p>
            </div>
          </Card>
          <Card className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-500/12 flex items-center justify-center">
              <ShieldCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-300" />
            </div>
            <div>
              <p className="text-[11px] text-app-subtle">Sudah dicek</p>
              <p className="text-lg font-bold text-app-text">
                {Math.max(0, (summary?.totalCount ?? 0) - (summary?.openCount ?? 0))}
              </p>
            </div>
          </Card>
        </div>

        {/* Filter */}
        <div className="flex items-center gap-2">
          {(['open', 'all'] as FilterTab[]).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setFilter(tab)}
              aria-pressed={filter === tab}
              className={cn(
                'px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors',
                filter === tab
                  ? 'bg-primary-500 text-white shadow-sm shadow-primary-500/25'
                  : 'bg-app-hover text-app-subtle hover:text-app-text',
              )}
            >
              {tab === 'open' ? `Perlu dicek (${openFlags.length})` : 'Semua'}
            </button>
          ))}
        </div>

        {loading ? (
          <Card>
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="animate-pulse space-y-2 py-1">
                  <div className="h-4 w-1/3 bg-app-hover rounded" />
                  <div className="h-3 w-2/3 bg-app-hover/70 rounded" />
                </div>
              ))}
            </div>
          </Card>
        ) : error ? (
          <ErrorState error={error} title="Gagal Memuat Flag Fraud" onRetry={load} />
        ) : visibleFlags.length === 0 ? (
          <Card>
            {filter === 'open' && openFlags.length === 0 && (flags.length > 0 || (summary?.totalCount ?? 0) > 0) ? (
              <EmptyState
                icon={<ShieldCheck className="w-8 h-8" />}
                title="Semua flag sudah dicek"
                description="Tidak ada aktivitas mencurigakan yang menunggu verifikasi."
              />
            ) : (
              <EmptyState
                icon={<ShieldCheck className="w-8 h-8" />}
                title="Belum ada aktivitas mencurigakan"
                description="Rule engine memindai setiap transaksi baru secara otomatis. Flag akan muncul di sini bila ada anomali terdeteksi."
              />
            )}
          </Card>
        ) : (
          <ul className="space-y-3">
            {visibleFlags.map((flag) => {
              const aiReasons = Array.isArray(flag.ruleData?.aiReasons)
                ? (flag.ruleData.aiReasons as string[])
                : [];
              const aiConfidence = typeof flag.ruleData?.aiConfidence === 'number'
                ? flag.ruleData.aiConfidence
                : 0;
              return (
              <li key={flag.id} data-testid={`fraud-flag-${flag.id}`}>
                <Card>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-app-text truncate">
                          {flag.merchant || 'Transaksi'}
                        </p>
                        {typeof flag.amount === 'number' && (
                          <span className="text-sm font-semibold text-app-text">
                            {formatCurrency(flag.amount)}
                          </span>
                        )}
                        {flag.date && (
                          <span className="text-xs text-app-subtle">{formatDate(flag.date)}</span>
                        )}
                      </div>

                      <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-primary-500/10 text-primary-600 dark:text-primary-300">
                          {FRAUD_RULE_LABELS[flag.flagType] || flag.flagType}
                        </span>
                        <span className={cn('text-[11px] font-semibold px-2 py-0.5 rounded-full', SEVERITY_CHIP[flag.severity])}>
                          {FRAUD_SEVERITY_LABELS[flag.severity] || flag.severity}
                        </span>
                        {flag.decision && (
                          <span className={cn('text-[11px] font-semibold px-2 py-0.5 rounded-full inline-flex items-center gap-1', DECISION_CHIP[flag.decision])}>
                            <Bot className="w-3 h-3" aria-hidden="true" />
                            AI: {flag.decision === 'allow' ? 'Aman' : flag.decision === 'review' ? 'Perlu review' : 'Blokir'}
                          </span>
                        )}
                        {aiConfidence > 0 && (
                          <span
                            title="Keyakinan model AI terhadap skor risiko (L2)"
                            className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-app-hover text-app-subtle"
                          >
                            Keyakinan {Math.round(aiConfidence * 100)}%
                          </span>
                        )}
                      </div>

                      <p className="mt-2 text-xs leading-relaxed text-app-muted">
                        {flag.description}
                      </p>

                      {/* Skor risiko */}
                      {typeof flag.riskScore === 'number' && (
                        <div className="mt-2.5 max-w-xs">
                          <div className="flex items-center justify-between text-[11px] text-app-subtle mb-1">
                            <span>Skor risiko</span>
                            <span className="font-semibold text-app-text">
                              {Math.round(flag.riskScore * 100)}%
                            </span>
                          </div>
                          <div className="h-1.5 rounded-full bg-app-hover overflow-hidden">
                            <div
                              className={cn(
                                'h-full rounded-full',
                                flag.riskScore >= 0.75
                                  ? 'bg-red-500'
                                  : flag.riskScore >= 0.5
                                    ? 'bg-amber-500'
                                    : 'bg-emerald-500',
                              )}
                              style={{ width: `${Math.min(100, flag.riskScore * 100)}%` }}
                            />
                          </div>
                        </div>
                      )}

                      {/* Alasan AI (L2) */}
                      {aiReasons.length > 0 && (
                        <div className="mt-3 rounded-xl bg-app-hover/60 p-3">
                          <p className="text-[11px] font-semibold text-app-subtle mb-1 inline-flex items-center gap-1">
                            <Bot className="w-3.5 h-3.5" aria-hidden="true" /> Alasan AI
                          </p>
                          <ul className="list-disc pl-4 space-y-0.5">
                            {aiReasons.map((reason, i) => (
                              <li key={i} className="text-xs text-app-muted">
                                {reason}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>

                    <div className="shrink-0">
                      {flag.status === 'open' ? (
                        <Button
                          size="sm"
                          variant="outline"
                          loading={reviewingId === flag.id}
                          onClick={() => handleReview(flag)}
                          icon={<CheckCircle2 className="w-4 h-4" />}
                        >
                          Sudah dicek
                        </Button>
                      ) : (
                        <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-300 inline-flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                          Sudah dicek
                        </span>
                      )}
                    </div>
                  </div>
                </Card>
              </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
