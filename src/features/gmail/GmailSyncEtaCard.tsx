import { Activity, Clock, Gauge, TimerReset } from 'lucide-react';
import { motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';
import {
  formatCountdown,
  formatDuration,
  formatEstimatedFinishTime,
  type GmailSyncProgress,
} from '../../lib/gmailSyncProgress';

interface GmailSyncEtaCardProps {
  progress: GmailSyncProgress | null;
  title?: string;
  compact?: boolean;
}

const CONFIDENCE_LABEL: Record<GmailSyncProgress['etaConfidence'], string> = {
  calculating: 'Menghitung estimasi...',
  low: 'Estimasi awal',
  medium: 'Estimasi sementara',
  high: 'Sisa waktu',
};

export default function GmailSyncEtaCard({
  progress,
  title = 'Memindai Gmail & mengekstrak transaksi',
  compact = false,
}: GmailSyncEtaCardProps) {
  if (!progress) return null;

  const progressPercent =
    progress.totalEstimated > 0
      ? Math.min(100, Math.max(0, (progress.totalProcessed / progress.totalEstimated) * 100))
      : 0;
  const isIndeterminate = progress.status === 'running' && progress.totalEstimated === 0;
  const showCountdown = progress.status === 'running' && progress.etaConfidence !== 'calculating';
  const remainingLabel =
    progress.remainingMs !== null && progress.remainingMs <= 1000 && progress.totalProcessed > 0
      ? 'Hampir selesai...'
      : showCountdown
        ? formatCountdown(progress.remainingMs)
        : formatDuration(progress.remainingMs);

  // Kontras light-mode (audit P3.x): nilai `text-sm font-semibold` (14px,
  // bukan large-text 18.66px bold) butuh 4.5:1 → -500 GAGAL di light
  // (mint 2.37 / amber 2.00 / red 3.51 / blue 3.43 / violet 3.95 vs bg
  // app-hover/60 #f7f7f7); -700 LULUS (4.69–6.52:1) + dark:-300 untuk dark.
  const breakdown = [
    { label: 'Diterima', value: progress.autoAcceptedCount, tone: 'text-mint-700 dark:text-mint-300' },
    { label: 'Review', value: progress.needsReviewCount, tone: 'text-amber-700 dark:text-amber-300' },
    { label: 'Skip', value: progress.autoSkippedCount, tone: 'text-app-subtle' },
    { label: 'Ditolak', value: progress.autoRejectedCount, tone: 'text-red-700 dark:text-red-300' },
    { label: 'Duplikat', value: progress.duplicateCount, tone: 'text-purple-700 dark:text-purple-300' },
    { label: 'Retry', value: progress.retryLaterCount, tone: 'text-blue-700 dark:text-blue-300' },
    { label: 'Gagal', value: progress.failedCount, tone: 'text-red-700 dark:text-red-300' },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        'rounded-2xl border border-app bg-app-card shadow-sm',
        compact ? 'p-3' : 'p-4 sm:p-5'
      )}
      role="status"
      aria-live="polite"
    >
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-app-text">{title}</p>
            <p className="mt-1 text-xs text-app-muted">{progress.currentStepLabel}</p>
          </div>
          <span className="shrink-0 rounded-full border border-app px-2.5 py-1 text-[10px] font-medium text-app-subtle">
            {Math.round(progressPercent)}%
          </span>
        </div>

        <div className="space-y-2">
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
            <div
              className={cn(
                'h-full rounded-full bg-gradient-to-r from-emerald-500 via-blue-500 to-violet-500 transition-all duration-500 ease-out',
                isIndeterminate && 'w-1/3 animate-pulse'
              )}
              style={isIndeterminate ? undefined : { width: `${progressPercent}%` }}
            />
          </div>
          <div className="flex items-center justify-between gap-2 text-[11px] text-app-subtle">
            <span>
              {progress.totalProcessed} / {progress.totalEstimated || progress.totalFound || 0} email diproses
            </span>
            {progress.currentBatch > 0 && progress.totalBatches > 0 && (
              <span>Batch {progress.currentBatch}/{progress.totalBatches}</span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Metric
            icon={<TimerReset className="h-3.5 w-3.5" />}
            label={CONFIDENCE_LABEL[progress.etaConfidence]}
            value={remainingLabel}
          />
          <Metric
            icon={<Clock className="h-3.5 w-3.5" />}
            label="Estimasi selesai"
            value={formatEstimatedFinishTime(progress.estimatedFinishAt)}
          />
          <Metric
            icon={<Gauge className="h-3.5 w-3.5" />}
            label="Kecepatan"
            value={`${progress.emailsPerSecond.toFixed(1)} email/detik`}
          />
        </div>

        {progress.warningMessage && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-700 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-300">
            {progress.warningMessage}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-7">
          {breakdown.map((item) => (
            <div key={item.label} className="rounded-xl bg-app-hover/60 px-2.5 py-2">
              <p className="text-[10px] text-app-subtle">{item.label}</p>
              <p className={cn('text-sm font-semibold', item.tone)}>{item.value}</p>
            </div>
          ))}
        </div>

        {(progress.aiQueueCount > 0 || progress.fallbackProcessedCount > 0 || progress.attachmentProcessedCount > 0) && (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2 text-[10px] text-app-subtle">
              <span className="inline-flex items-center gap-1 rounded-full bg-app-hover/70 px-2 py-1">
                <Activity className="h-3 w-3" /> AI {progress.aiProcessedCount}/{progress.aiQueueCount}
              </span>
              <span className="rounded-full bg-app-hover/70 px-2 py-1">Fallback {progress.fallbackProcessedCount}</span>
              <span className="rounded-full bg-app-hover/70 px-2 py-1">Lampiran {progress.attachmentProcessedCount}</span>
            </div>
            <p className="text-[10px] text-app-subtle">
              AI hanya memproses email yang ambigu agar sinkronisasi lebih cepat.
            </p>
          </div>
        )}
      </div>
    </motion.div>
  );
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl bg-app-hover/60 p-3">
      <p className="flex items-center gap-1.5 text-[10px] font-medium text-app-subtle">
        {icon}
        {label}
      </p>
      <p className="mt-1 text-base font-semibold text-app-text">{value}</p>
    </div>
  );
}
