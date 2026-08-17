/**
 * ConversationAnswer — jawaban kaya Natural Conversation (Sprint 1.5 — P8).
 *
 * Menyusun respons AI menjadi alur visual:
 *   ringkasan → grafik harian → kategori → transaksi terbesar → insight → aksi,
 * dilengkapi trust metadata (AiTrustMeta) & feedback loop (AiFeedbackButtons).
 *
 * Komponen presentasi murni — data datang dari server (conversationService).
 * Memakai recharts (shared chunk dinamis — tidak menambah entry chunk).
 */
import { useEffect, useRef } from 'react';
import { ArrowRight, Lightbulb, ListChecks, Receipt, Store, TrendingDown, TrendingUp, Wallet } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ConversationAnswer as ConversationAnswerData } from '../../../services/conversationService';
import { cn, formatCurrency, formatCurrencyCompact } from '../../../lib/utils';
import type { ExplainabilityModel } from '../../../lib/explainability';
import Card from '../../../components/ui/Card';
import AiTrustMeta from '../components/AiTrustMeta';
import AiFeedbackButtons from '../components/AiFeedbackButtons';
import { trackAiProductEvent } from '../../../services/aiProductService';

const SEVERITY_STYLES: Record<string, string> = {
  high: 'bg-red-500/12 text-red-600 dark:text-red-300 border-red-500/30',
  medium: 'bg-amber-500/12 text-amber-600 dark:text-amber-300 border-amber-500/30',
  low: 'bg-mint-500/12 text-mint-600 dark:text-mint-300 border-mint-500/30',
};

/** Tanggal pendek "12 Agu" dari YYYY-MM-DD. */
function formatDayShort(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
}

/** Nominal dengan tanda untuk selisih negatif (formatCurrency memakai abs). */
function signedCurrency(value: number): string {
  return value < 0 ? `-${formatCurrency(value)}` : formatCurrency(value);
}

/**
 * Badge delta % — tone mengikuti konteks:
 * pengeluaran naik = buruk (merah), pemasukan naik = baik (hijau) saat reverse.
 */
function DeltaBadge({ pct, reverse = false }: { pct: number | null; reverse?: boolean }) {
  if (pct === null || pct === undefined) return null;
  const up = pct > 0;
  const good = reverse ? up : !up;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold tabular-nums',
        good
          ? 'border-mint-500/30 bg-mint-500/12 text-mint-600 dark:text-mint-300'
          : 'border-red-500/30 bg-red-500/12 text-red-600 dark:text-red-300',
      )}
      title={reverse ? 'Perubahan pemasukan vs periode sebelumnya' : 'Perubahan pengeluaran vs periode sebelumnya'}
    >
      {up ? '▲' : pct < 0 ? '▼' : '•'} {Math.abs(pct)}%
    </span>
  );
}

/** Tooltip chart kustom — konsisten dengan tema aplikasi (bukan default white). */
function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-app-border bg-app-card px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-semibold text-app-text">{formatDayShort(String(label || ''))}</p>
      {payload.map((p) => (
        <p key={p.name} className={cn('tabular-nums', p.name === 'Pemasukan' ? 'text-mint-600 dark:text-mint-300' : 'text-red-500')}>
          {p.name}: {formatCurrency(Number(p.value) || 0)}
        </p>
      ))}
    </div>
  );
}

export default function ConversationAnswer({ answer }: { answer: ConversationAnswerData }) {
  const { stats, narrative, chart, categories, topMerchants, topTransactions, trust, period } = answer;

  // P10.2i telemetry: denominator Feedback Rate — jawaban chat feedback-capable
  // ditampilkan. Fire sekali per jawaban (mount komponen); non-PII. Guard ref:
  // StrictMode dev double-mount memanggil effect dua kali — tanpa guard,
  // ai_result_shown conversation ter-inflasi 2× di dev (audit P10.2 dedup).
  // Setiap jawaban baru = instance komponen baru = ref baru = exposure baru
  // yang SAH (per jawaban, bukan per mount ke halaman).
  const shownFiredRef = useRef(false);
  useEffect(() => {
    if (!shownFiredRef.current) {
      shownFiredRef.current = true;
      trackAiProductEvent('ai_result_shown', { feature: 'conversation' }).catch(() => {});
    }
  }, []);

  const trustModel: ExplainabilityModel = {
    source: trust?.source === 'gemini' ? 'gemini' : 'rule-based',
    model: trust?.model,
    feature: 'conversation',
    processingTimeMs: trust?.processingTimeMs,
    dataCoverage: trust?.dataCoverage,
    timestamp: trust?.timestamp,
  };

  return (
    <div className="space-y-3">
      {/* 1. Ringkasan */}
      <Card className="overflow-hidden border-primary-200/60 bg-gradient-to-br from-primary-50 via-app-card to-mint-50/60 dark:border-primary-400/20 dark:from-primary-500/10 dark:via-app-card dark:to-mint-400/10">
        <div className="flex items-start gap-2.5">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary-500/12 text-primary-600 dark:text-primary-300">
            <Wallet className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary-600 dark:text-primary-300">
              Ringkasan · {period.label}
            </p>
            <p className="mt-1 text-sm leading-relaxed text-app-text">{narrative.summary}</p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-app-border/50 pt-2.5">
          <AiTrustMeta model={trustModel} />
          <AiFeedbackButtons feature="conversation" ariaLabel="Beri feedback jawaban AI" />
        </div>
      </Card>

      {/* 2. Angka kunci */}
      <div className="grid gap-2.5 sm:grid-cols-3">
        <KeyStat
          label="Pengeluaran"
          value={formatCurrency(stats.expense)}
          sub={stats.expenseDeltaPct !== null ? `vs ${period.label}` : 'tidak ada basis perbandingan'}
          icon={<TrendingDown className="h-4 w-4" />}
          tone="bg-red-50 dark:bg-red-500/12 text-red-500 dark:text-red-300"
          badge={<DeltaBadge pct={stats.expenseDeltaPct} />}
        />
        <KeyStat
          label="Pemasukan"
          value={formatCurrency(stats.income)}
          sub={stats.incomeDeltaPct !== null ? `vs ${period.label}` : 'tidak ada basis perbandingan'}
          icon={<TrendingUp className="h-4 w-4" />}
          tone="bg-mint-50 dark:bg-mint-500/12 text-mint-600 dark:text-mint-300"
          badge={<DeltaBadge pct={stats.incomeDeltaPct} reverse />}
        />
        <KeyStat
          label="Selisih (Net)"
          value={signedCurrency(stats.net)}
          sub={`${stats.transactionCount} transaksi tercatat`}
          icon={<Wallet className="h-4 w-4" />}
          tone="bg-primary-50 dark:bg-primary-500/12 text-primary-600 dark:text-primary-300"
        />
      </div>

      {/* 3. Grafik harian */}
      <Card>
        <h3 className="mb-1 text-sm font-semibold text-app-text">Tren harian</h3>
        <p className="mb-3 text-xs text-app-subtle">Pemasukan vs pengeluaran per hari</p>
        <div className="h-52 w-full" role="img" aria-label="Grafik batang Pemasukan dan Pengeluaran per hari">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chart.daily} margin={{ top: 4, right: 4, left: -8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-app-border/50" vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={(v: string) => formatDayShort(v)}
                tick={{ fontSize: 10, fill: 'currentColor' }}
                className="text-app-subtle"
                minTickGap={28}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tickFormatter={(v: number) => formatCurrencyCompact(Number(v))}
                tick={{ fontSize: 10, fill: 'currentColor' }}
                className="text-app-subtle"
                axisLine={false}
                tickLine={false}
                width={54}
              />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: 'currentColor', opacity: 0.06 }} />
              <Legend wrapperStyle={{ fontSize: 11, color: 'currentColor' }} iconType="circle" iconSize={8} />
              <Bar name="Pemasukan" dataKey="income" fill="#10b981" radius={[3, 3, 0, 0]} maxBarSize={18} />
              <Bar name="Pengeluaran" dataKey="expense" fill="#ef4444" radius={[3, 3, 0, 0]} maxBarSize={18} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* 4. Kategori */}
      <Card>
        <h3 className="mb-3 text-sm font-semibold text-app-text">Kategori pengeluaran teratas</h3>
        {categories.length === 0 ? (
          <p className="text-xs text-app-muted">Belum ada pengeluaran pada periode ini.</p>
        ) : (
          <ul className="space-y-2.5">
            {categories.map((c) => (
              <li key={c.name}>
                <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                  <span className="font-medium text-app-text">{c.name}</span>
                  <span className="tabular-nums text-app-muted">
                    {formatCurrency(c.amount)} · {c.count} transaksi · {c.pct}%
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-app-hover">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-primary-500 to-red-400 transition-all duration-700"
                    style={{ width: `${Math.min(100, c.pct)}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* 5. Transaksi terbesar */}
      <Card>
        <div className="mb-3 flex items-center gap-2">
          <Receipt className="h-4 w-4 text-app-subtle" />
          <h3 className="text-sm font-semibold text-app-text">Transaksi pengeluaran terbesar</h3>
        </div>
        {topTransactions.length === 0 ? (
          <p className="text-xs text-app-muted">Belum ada pengeluaran pada periode ini.</p>
        ) : (
          <ul className="divide-y divide-app-border/60">
            {topTransactions.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-app-text">{t.merchant || t.note || 'Tanpa keterangan'}</p>
                  <p className="truncate text-[11px] text-app-muted">
                    {t.categoryName} · {formatDayShort(t.date)}
                  </p>
                </div>
                <span className="shrink-0 text-xs font-bold tabular-nums text-app-text">{formatCurrency(t.amount)}</span>
              </li>
            ))}
          </ul>
        )}
        {topMerchants.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-app-border/60 pt-2.5">
            <Store className="h-3.5 w-3.5 text-app-subtle" />
            {topMerchants.map((m) => (
              <span key={m.merchant} className="rounded-full border border-app-border bg-app-bg px-2 py-0.5 text-[10px] font-medium text-app-muted">
                {m.merchant} · {formatCurrencyCompact(m.amount)}
              </span>
            ))}
          </div>
        )}
      </Card>

      {/* 6. Insight */}
      {narrative.insights.length > 0 && (
        <Card>
          <div className="mb-3 flex items-center gap-2">
            <Lightbulb className="h-4 w-4 text-amber-500" />
            <h3 className="text-sm font-semibold text-app-text">Insight</h3>
          </div>
          <ul className="space-y-2">
            {narrative.insights.map((ins, i) => (
              <li key={`${ins.title}-${i}`} className="flex items-start gap-2.5 rounded-xl border border-app-border bg-app-bg/50 p-2.5">
                <span className={cn('mt-0.5 inline-flex shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide', SEVERITY_STYLES[ins.severity] || SEVERITY_STYLES.low)}>
                  {ins.severity}
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-app-text">{ins.title}</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-app-muted">{ins.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* 7. Rekomendasi / aksi */}
      {narrative.recommendations.length > 0 && (
        <Card>
          <div className="mb-3 flex items-center gap-2">
            <ListChecks className="h-4 w-4 text-mint-600 dark:text-mint-300" />
            <h3 className="text-sm font-semibold text-app-text">Langkah yang bisa kamu ambil</h3>
          </div>
          <ul className="space-y-2">
            {narrative.recommendations.map((rec, i) => (
              <li key={`${rec.title}-${i}`} className="rounded-xl border border-app-border bg-app-bg/50 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-app-text">{rec.title}</p>
                  <Link
                    to={rec.href || '/transactions'}
                    className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary-500/10 px-2.5 py-1 text-[11px] font-semibold text-primary-600 dark:text-primary-300 hover:bg-primary-500/20 transition-colors"
                  >
                    Buka <ArrowRight className="h-3 w-3" />
                  </Link>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-app-muted">{rec.action}</p>
                {rec.impact && <p className="mt-1 text-[10px] text-mint-600 dark:text-mint-300">{rec.impact}</p>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function KeyStat({
  label,
  value,
  sub,
  icon,
  tone,
  badge,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
  tone: string;
  badge?: React.ReactNode;
}) {
  return (
    <Card className="!p-3.5">
      <div className="flex items-center justify-between gap-2">
        <div className={cn('flex h-8 w-8 items-center justify-center rounded-xl', tone)}>{icon}</div>
        {badge}
      </div>
      <p className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-app-subtle">{label}</p>
      <p className="text-lg font-black tabular-nums text-app-text">{value}</p>
      {sub && <p className="text-[10px] text-app-muted">{sub}</p>}
    </Card>
  );
}
