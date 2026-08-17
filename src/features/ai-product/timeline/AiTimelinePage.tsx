/**
 * AI Timeline (P9 — Sprint 1.5) · /ai/timeline
 *
 * "Perjalanan finansialmu bersama AI": riwayat longitudinal hasil AI
 * (insight, rekomendasi, percakapan, feedback, memory) dengan:
 *   - Filter event type (Semua/Insights/Rekomendasi/Percakapan/Feedback/Memory)
 *   - Pengelompokan tanggal: Hari Ini → Kemarin → Minggu Ini → Sebelumnya
 *   - Kartu event: ikon type, judul, isi, badge confidence, status, timestamp
 *   - Detail view: apa yang AI katakan, mengapa (evidence), sumber, kapan,
 *     status, feedback terkait (P9 §16)
 *   - Status actions: Tandai Selesai / Buang (state machine P9 §12)
 *   - Pagination keyset "Muat lebih" (P9 §18) + feedback loop per event
 *
 * Semua engine murni presentasi; data dari /api/ai-product/timeline.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  History,
  Loader2,
  RotateCcw,
  Trash2,
  X,
  type LucideIcon,
} from 'lucide-react';
import Header from '../../../components/layout/Header';
import Card from '../../../components/ui/Card';
import EmptyState from '../../../components/ui/EmptyState';
import { ChartSkeleton } from '../../../components/ui/Skeleton';
import AiConfidenceBadge from '../components/AiConfidenceBadge';
import AiFeedbackButtons from '../components/AiFeedbackButtons';
import AiTrustMeta from '../components/AiTrustMeta';
import { cn, formatCurrency } from '../../../lib/utils';
import { groupTimeline } from '../../../lib/timelineGroup';
import {
  EVENT_TYPE_META,
  TIMELINE_FILTERS,
  STATUS_META,
  eventTypeLabel,
} from './eventMeta';
import {
  listTimeline,
  getTimelineEvent,
  updateTimelineStatus,
  trackAiProductEvent,
  type TimelineRecord,
  type TimelineDetail,
} from '../../../services/aiProductService';

const PAGE_SIZE = 20;

/** Rendering evidence dari payload JSON — HANYA primitives aman (P9 §10). */
function renderPayloadEvidence(payload?: string): Array<{ label: string; value: string }> {
  if (!payload) return [];
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];

  const LABELS: Record<string, string> = {
    periodDays: 'Periode',
    expense: 'Pengeluaran',
    income: 'Pemasukan',
    topCategory: 'Kategori teratas',
    month: 'Bulan',
    year: 'Tahun',
    category: 'Kategori',
    key: 'Preferensi',
    action: 'Aksi',
    feature: 'Fitur',
    rating: 'Rating',
  };
  const MONEY_KEYS = new Set(['expense', 'income']);
  const ACTION_LABELS: Record<string, string> = { set: 'Diperbarui', delete: 'Dihapus' };

  const out: Array<{ label: string; value: string }> = [];
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    const label = LABELS[k] || k;
    if (typeof v === 'number') {
      out.push({ label, value: MONEY_KEYS.has(k) ? formatCurrency(v) : String(v) });
    } else if (typeof v === 'string') {
      if (k === 'action' && ACTION_LABELS[v]) out.push({ label, value: ACTION_LABELS[v] });
      else out.push({ label, value: v });
    } else if (typeof v === 'boolean') {
      out.push({ label, value: v ? 'Ya' : 'Tidak' });
    }
  }
  return out.slice(0, 8);
}

/**
 * Parsing created_at → Date. DB SQLite `datetime('now')` menyimpan UTC dengan
 * format space ('YYYY-MM-DD HH:MM:SS') — TANPA timezone suffix. Tambahkan 'Z'
 * agar diinterpretasikan UTC (konsisten dengan TimelineSection di AiHubPage);
 * ISO dengan zone (Z/offset) dibiarkan apa adanya.
 */
function parseTimelineDate(value: string): Date | null {
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/.test(value);
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  const d = new Date(hasZone ? normalized : `${normalized}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Parsing created_at (space-format DB / ISO) → label lokal. */
function formatEventDate(value?: string): string {
  if (!value) return '';
  const d = parseTimelineDate(value);
  if (!d) return value;
  return d.toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function AiTimelinePage() {
  const [filter, setFilter] = useState('all');
  const [items, setItems] = useState<TimelineRecord[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TimelineDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const beforeRef = useRef<{ createdAt?: string; id?: string } | undefined>(undefined);
  // Item yang sudah pernah dirender — anti double-count recommendation_shown
  // saat pagination "Muat lebih" / filter berganti (P10.2 telemetry).
  // Persisten SELURUH umur mount (TIDAK di-reset di load(reset=true)):
  //   - StrictMode dev double-mount memanggil load() dua kali → kedua panggilan
  //     berbagi Set ini → fire SEKALI per item (anti overcount).
  //   - Filter berganti memanggil load(true) → item yang sudah tampil TIDAK
  //     re-fire (anti double-count lintas filter); item baru tetap fire.
  //   - Remount (navigasi keluar-masuk halaman) = instance baru = Set baru →
  //     fire ulang = exposure baru yang SAH (semantik P10.2e: per page view).
  const trackedIdsRef = useRef<Set<string>>(new Set());
  // Guard stale-response: counter MONOTONIK per panggilan load(). Hanya response
  // dari request PALING BARU yang boleh menulis state — response lama yang tiba
  // belakangan dibuang. Latar belakang (bug nyata ditemukan e2e/ai-status-machine):
  //   - StrictMode dev double-mount memicu load() 2× (filter 'all') + ganti filter
  //     memicu load() lagi → response 'all' yang lambat bisa tiba SETELAH response
  //     filter → menimpa list dengan data basi.
  //   - Lebih parah: response basi yang tiba setelah optimistic update status
  //     (tombol Selesai) menimpa status 'completed' kembali ke 'new' — tombol
  //     aksi muncul lagi (UI tidak konsisten dengan DB) walau PATCH sukses.
  // Dengan guard ini, state UI selalu mencerminkan request terbaru (server truth
  // saat request dikirim); optimistic update tetap menang karena tak ada load
  // yang lebih baru setelahnya (klik Selesai tidak memanggil load).
  const loadSeqRef = useRef(0);

  const load = useCallback(async (reset: boolean) => {
    const seq = ++loadSeqRef.current;
    try {
      setError(null);
      if (reset) {
        setLoading(true);
        beforeRef.current = undefined;
        // trackedIdsRef TIDAK di-reset di sini — lihat komentar deklarasi
        // (guard persisten per mount; reset hanya terjadi saat remount).
      } else {
        setLoadingMore(true);
      }
      const page = await listTimeline({
        eventType: filter === 'all' ? undefined : filter,
        before: reset ? undefined : beforeRef.current?.createdAt,
        beforeId: reset ? undefined : beforeRef.current?.id,
        limit: PAGE_SIZE,
      });
      // Response basi (bukan request terbaru) → buang tanpa menulis state apa pun
      // (termasuk items & telemetry — item basi tidak boleh re-fire exposure).
      if (seq !== loadSeqRef.current) return;
      setItems((prev) => (reset ? page.items : [...prev, ...page.items]));
      // P10.2 telemetry: fire SEKALI per item (trackedIdsRef):
      //   - ai_result_shown untuk SEMUA event (P10.2i — denominator Feedback
      //     Rate: kartu AI feedback-capable yang ditampilkan)
      //   - recommendation_shown hanya untuk event_type recommendation
      //     (P10.2 — denominator CTR, scoping konsisten dengan _opened)
      // KEDUANYA di dalam guard — StrictMode dev double-mount memanggil load()
      // dua kali; tanpa guard, recommendation_shown ter-inflasi 2×.
      const tracked = trackedIdsRef.current;
      page.items.forEach((it) => {
        if (!tracked.has(it.id)) {
          tracked.add(it.id);
          trackAiProductEvent('ai_result_shown', { feature: it.feature, itemId: it.id, eventType: it.event_type }).catch(() => {});
          if (it.event_type === 'recommendation') {
            trackAiProductEvent('recommendation_shown', { feature: it.feature, itemId: it.id, eventType: it.event_type }).catch(() => {});
          }
        }
      });
      setHasMore(page.hasMore);
      if (page.items.length > 0) {
        const last = page.items[page.items.length - 1];
        // Cursor lengkap (created_at + id) — tie-break keyset komposit (P9).
        beforeRef.current = { createdAt: last.created_at, id: last.id };
      }
    } catch (err) {
      if (seq !== loadSeqRef.current) return;
      setError(err instanceof Error ? err.message : 'Gagal memuat timeline.');
    } finally {
      if (seq === loadSeqRef.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [filter]);

  useEffect(() => {
    load(true);
  }, [load]);



  const openDetail = useCallback(async (id: string) => {
    setExpandedId(id);
    setDetail(null);
    setDetailLoading(true);
    // P10.2 telemetry: numerator CTR — HANYA untuk event_type recommendation
    // (konsisten dengan denominator shown yang juga filter recommendation).
    // Tidak di-dedupe (berbeda dengan _shown): open adalah aksi user, tiap buka
    // = engagement baru — sengaja, bukan exposure (dokumentasi P10.1 §3).
    const evtType = items.find((it) => it.id === id)?.event_type;
    if (evtType === 'recommendation') {
      trackAiProductEvent('recommendation_opened', { feature: 'timeline', itemId: id, eventType: evtType }).catch(() => {});
    }
    try {
      const d = await getTimelineEvent(id);
      setDetail(d);
      // P9 §12: buka detail → status new→viewed (fire-and-forget, deterministik).
      if (d.status === 'new') {
        updateTimelineStatus(id, 'viewed').catch(() => {});
        setItems((prev) => prev.map((it) => (it.id === id ? { ...it, status: 'viewed' } : it)));
      }
    } catch (err) {
      setDetail({ id, feature: 'other', event_type: 'other', status: 'new', title: 'Gagal memuat detail', feedback: [] } as TimelineDetail);
    } finally {
      setDetailLoading(false);
    }
  }, [items]);

  const applyStatus = useCallback(async (id: string, status: string) => {
    const prev = items.find((it) => it.id === id);
    setItems((cur) => cur.map((it) => (it.id === id ? { ...it, status } : it)));
    try {
      await updateTimelineStatus(id, status);
      if (expandedId === id && detail) setDetail((d) => (d ? { ...d, status } : d));
    } catch {
      // rollback optimistik
      if (prev) setItems((cur) => cur.map((it) => (it.id === id ? prev : it)));
    }
  }, [items, expandedId, detail]);

  const grouped = useMemo(() => groupTimeline(items), [items]);

  return (
    <div>
      <Header title="AI Timeline" />
      <div className="mx-auto max-w-3xl p-4 lg:p-6">
        {/* Hero */}
        <Card className="overflow-hidden border-primary-200/60 bg-gradient-to-br from-primary-50 via-app-card to-soft-purple/40 dark:border-primary-400/20 dark:from-primary-500/10 dark:via-app-card dark:to-soft-purple/10">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-500 to-soft-purple text-white shadow-lg shadow-primary-500/25">
              <History className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-app-text">Perjalanan finansialmu bersama AI</h2>
              <p className="text-xs text-app-subtle">
                Lihat apa yang AI katakan sebelumnya, mengapa, dan bagaimana kondisimu berubah sejak saat itu.
              </p>
            </div>
          </div>
        </Card>

        {/* Filter event type */}
        <div className="mt-4 flex flex-wrap gap-1.5" role="group" aria-label="Filter jenis event">
          {TIMELINE_FILTERS.map((opt) => {
            const Icon: LucideIcon = opt.icon;
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => setFilter(opt.key)}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors',
                  filter === opt.key
                    ? 'bg-primary-600 text-white shadow-sm'
                    : 'border border-app-border bg-app-card text-app-muted hover:border-primary-500/40 hover:bg-primary-500/10 hover:text-app-text',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {opt.label}
              </button>
            );
          })}
        </div>

        {/* Body */}
        {loading ? (
          <div className="mt-4 space-y-3">
            <ChartSkeleton />
            <ChartSkeleton />
            <ChartSkeleton />
          </div>
        ) : error && items.length === 0 ? (
          <Card className="mt-4">
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <p className="text-sm text-red-500">{error}</p>
              <button
                type="button"
                onClick={() => load(true)}
                className="inline-flex items-center gap-1.5 rounded-full bg-primary-500 px-4 py-1.5 text-xs font-semibold text-white hover:bg-primary-600"
              >
                <RotateCcw className="h-3.5 w-3.5" /> Coba lagi
              </button>
            </div>
          </Card>
        ) : items.length === 0 ? (
          <Card className="mt-4">
            <EmptyState
              icon={<History className="h-8 w-8" />}
              title="Belum ada aktivitas AI"
              description="Saat AI memberikan insight, rekomendasi, atau menjawab pertanyaanmu, riwayatnya akan muncul di sini."
            />
          </Card>
        ) : (
          <>
            {grouped.map((section) => (
              <section key={section.key} className="mt-5">
                <h3 className="mb-2 px-1 text-[11px] font-bold uppercase tracking-[0.14em] text-app-subtle">
                  {section.label}
                </h3>
                <div className="space-y-2.5">
                  {section.items.map((event) => (
                    <TimelineEventCard
                      key={event.id}
                      event={event}
                      expanded={expandedId === event.id}
                      detail={expandedId === event.id ? detail : null}
                      detailLoading={expandedId === event.id && detailLoading}
                      onToggle={() =>
                        expandedId === event.id ? setExpandedId(null) : openDetail(event.id)
                      }
                      onComplete={() => applyStatus(event.id, 'completed')}
                      onDismiss={() => applyStatus(event.id, 'dismissed')}
                    />
                  ))}
                </div>
              </section>
            ))}

            {hasMore && (
              <div className="mt-4 flex justify-center">
                <button
                  type="button"
                  disabled={loadingMore}
                  onClick={() => load(false)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-app-border bg-app-card px-4 py-2 text-xs font-semibold text-app-text transition-colors hover:border-primary-500/40 hover:bg-primary-500/10 disabled:opacity-50"
                >
                  {loadingMore ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  Muat lebih
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Kartu event ──────────────────────────────────────────────────────────────

interface TimelineEventCardProps {
  event: TimelineRecord;
  expanded: boolean;
  detail: TimelineDetail | null;
  detailLoading: boolean;
  onToggle: () => void;
  onComplete: () => void;
  onDismiss: () => void;
}

function TimelineEventCard({
  event,
  expanded,
  detail,
  detailLoading,
  onToggle,
  onComplete,
  onDismiss,
}: TimelineEventCardProps) {
  const meta = EVENT_TYPE_META[event.event_type] || EVENT_TYPE_META.other;
  const Icon: LucideIcon = meta.icon;
  const status = STATUS_META[event.status];
  const evidence = renderPayloadEvidence(event.payload);

  return (
    <Card className="!p-3.5">
      <div className="flex items-start gap-3">
        <div className={cn('mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', meta.iconTone)}>
          <Icon className="h-4 w-4" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="text-sm font-semibold text-app-text">{event.title}</p>
            <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold', meta.chipTone)}>
              {eventTypeLabel(event.event_type)}
            </span>
            {status && (
              <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold', status.tone)}>
                <status.icon className="h-3 w-3" />
                {status.label}
              </span>
            )}
          </div>

          {event.body && !expanded && (
            <p className="mt-1 text-xs leading-relaxed text-app-muted line-clamp-3">{event.body}</p>
          )}

          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-app-subtle">
            {typeof event.confidence === 'number' && <AiConfidenceBadge score={event.confidence} hidePercent />}
            <span>{formatEventDate(event.created_at)}</span>
          </div>

          {/* Aksi */}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onToggle}
              aria-label={`${expanded ? 'Tutup detail' : 'Lihat detail'} ${event.title}`}
              aria-expanded={expanded}
              className="inline-flex items-center gap-1 rounded-full border border-app-border px-2.5 py-1 text-[11px] font-medium text-app-text transition-colors hover:border-primary-500/40 hover:bg-primary-500/10"
            >
              {expanded ? <ChevronDown className="h-3 w-3 rotate-180" /> : <ChevronDown className="h-3 w-3" />}
              {expanded ? 'Tutup' : 'Lihat Detail'}
            </button>
            {(event.status === 'new' || event.status === 'viewed') && (
              <>
                <button
                  type="button"
                  onClick={onComplete}
                  aria-label={`Tandai selesai ${event.title}`}
                  className="inline-flex items-center gap-1 rounded-full border border-mint-500/30 bg-mint-500/10 px-2.5 py-1 text-[11px] font-medium text-mint-600 dark:text-mint-300 transition-colors hover:bg-mint-500/20"
                >
                  <CheckCircle2 className="h-3 w-3" /> Selesai
                </button>
                <button
                  type="button"
                  onClick={onDismiss}
                  aria-label={`Buang ${event.title}`}
                  className="inline-flex items-center gap-1 rounded-full border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-[11px] font-medium text-red-500 transition-colors hover:bg-red-500/20"
                >
                  <X className="h-3 w-3" /> Buang
                </button>
              </>
            )}
            <AiFeedbackButtons feature={event.feature} itemId={event.id} ariaLabel={`Feedback ${event.title}`} />
          </div>

          {/* Detail panel (P9 §16) */}
          {expanded && (
            <div className="mt-3 rounded-xl border border-app-border bg-app-bg/50 p-3">
              {detailLoading ? (
                <ChartSkeleton />
              ) : detail ? (
                <div className="space-y-3">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-wide text-app-subtle">Apa yang AI katakan</p>
                    <p className="mt-1 text-xs leading-relaxed text-app-text">
                      {detail.body || detail.title}
                    </p>
                  </div>

                  {evidence.length > 0 && (
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-wide text-app-subtle">Mengapa AI mengatakan ini</p>
                      <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
                        {evidence.map((ev) => (
                          <div key={ev.label}>
                            <dt className="text-[10px] text-app-subtle">{ev.label}</dt>
                            <dd className="text-xs font-medium tabular-nums text-app-text">{ev.value}</dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  )}

                  {typeof detail.confidence === 'number' && (
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-bold uppercase tracking-wide text-app-subtle">Confidence</span>
                      <AiConfidenceBadge score={detail.confidence} showExplanation />
                    </div>
                  )}

                  <AiTrustMeta
                    model={{
                      source: 'rule-based',
                      feature: detail.feature,
                      dataCoverage: `Sumber: ${detail.feature}`,
                      timestamp: detail.created_at,
                    }}
                  />

                  {detail.feedback.length > 0 && (
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-wide text-app-subtle">Feedback kamu</p>
                      <ul className="mt-1 space-y-1">
                        {detail.feedback.map((f, i) => (
                          <li key={i} className="flex flex-wrap items-center gap-2 text-[11px] text-app-text">
                            <span className="rounded-full border border-app-border bg-app-card px-2 py-0.5 font-medium">
                              {f.rating}
                            </span>
                            {f.reason && <span className="text-app-muted">{f.reason}</span>}
                            <span className="text-[10px] text-app-subtle">{formatEventDate(f.created_at)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <p className="flex items-center gap-1 text-[10px] text-app-subtle">
                    <Trash2 className="h-3 w-3" />
                    Status: {detail.status}
                  </p>
                </div>
              ) : (
                <p className="text-xs text-app-muted">Detail tidak tersedia.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
