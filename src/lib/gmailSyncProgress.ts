export type GmailSyncStep =
  | 'idle'
  | 'preparing'
  | 'fetching_gmail'
  | 'prefiltering'
  | 'extracting_ai'
  | 'extracting_attachment'
  | 'fallback_parsing'
  | 'saving_results'
  | 'completed'
  | 'partial_failed'
  | 'failed';

export type GmailSyncProgressStatus = 'idle' | 'running' | 'completed' | 'partial_failed' | 'failed';
export type GmailSyncEtaConfidence = 'calculating' | 'low' | 'medium' | 'high';

export interface GmailSyncProgress {
  syncRunId?: string;
  status: GmailSyncProgressStatus;
  currentStep: GmailSyncStep;
  currentStepLabel: string;
  startedAt: string | null;
  updatedAt: string | null;
  finishedAt?: string | null;
  totalFound: number;
  totalEstimated: number;
  totalProcessed: number;
  gmailPagesFetched: number;
  gmailHasNextPage: boolean;
  prefilteredCount: number;
  aiQueueCount: number;
  aiProcessedCount: number;
  attachmentProcessedCount: number;
  fallbackProcessedCount: number;
  autoAcceptedCount: number;
  needsReviewCount: number;
  autoSkippedCount: number;
  autoRejectedCount: number;
  duplicateCount: number;
  retryLaterCount: number;
  failedCount: number;
  currentBatch: number;
  totalBatches: number;
  elapsedMs: number;
  estimatedTotalMs: number | null;
  remainingMs: number | null;
  estimatedFinishAt: string | null;
  emailsPerSecond: number;
  averageMsPerEmail: number | null;
  averageMsPerAiEmail: number | null;
  averageMsPerFallbackEmail: number | null;
  averageMsPerAttachmentEmail: number | null;
  etaConfidence: GmailSyncEtaConfidence;
  warningMessage?: string | null;
}

export type GmailSyncProgressPatch = Partial<
  Omit<
    GmailSyncProgress,
    | 'currentStepLabel'
    | 'elapsedMs'
    | 'estimatedTotalMs'
    | 'remainingMs'
    | 'estimatedFinishAt'
    | 'emailsPerSecond'
    | 'averageMsPerEmail'
    | 'averageMsPerAiEmail'
    | 'averageMsPerFallbackEmail'
    | 'averageMsPerAttachmentEmail'
    | 'etaConfidence'
  >
>;

const STEP_LABELS: Record<GmailSyncStep, string> = {
  idle: 'Menunggu sinkronisasi',
  preparing: 'Menyiapkan sinkronisasi...',
  fetching_gmail: 'Mengambil email dari Gmail...',
  prefiltering: 'Memfilter email transaksi...',
  extracting_ai: 'Mengekstrak data dengan AI...',
  extracting_attachment: 'Membaca dokumen lampiran...',
  fallback_parsing: 'Menjalankan fallback parser...',
  saving_results: 'Menyimpan hasil ke CashFlow...',
  completed: 'Sinkronisasi selesai',
  partial_failed: 'Selesai dengan beberapa catatan',
  failed: 'Sinkronisasi gagal',
};

export function getGmailSyncStepLabel(step: GmailSyncStep): string {
  return STEP_LABELS[step] || STEP_LABELS.idle;
}

export function createInitialGmailSyncProgress(
  syncRunId?: string | null,
  patch: GmailSyncProgressPatch = {},
): GmailSyncProgress {
  const now = new Date().toISOString();
  return deriveGmailSyncProgress(null, {
    syncRunId: syncRunId || undefined,
    status: 'running',
    currentStep: 'preparing',
    startedAt: now,
    updatedAt: now,
    totalFound: 0,
    totalEstimated: 0,
    totalProcessed: 0,
    gmailPagesFetched: 0,
    gmailHasNextPage: false,
    prefilteredCount: 0,
    aiQueueCount: 0,
    aiProcessedCount: 0,
    attachmentProcessedCount: 0,
    fallbackProcessedCount: 0,
    autoAcceptedCount: 0,
    needsReviewCount: 0,
    autoSkippedCount: 0,
    autoRejectedCount: 0,
    duplicateCount: 0,
    retryLaterCount: 0,
    failedCount: 0,
    currentBatch: 0,
    totalBatches: 0,
    warningMessage: null,
    ...patch,
  });
}

export function deriveGmailSyncProgress(
  previous: GmailSyncProgress | null,
  patch: GmailSyncProgressPatch = {},
  nowDate = new Date(),
): GmailSyncProgress {
  const now = nowDate.toISOString();
  const base = previous || createBareProgress(now);
  const nextBase = {
    ...base,
    ...patch,
    updatedAt: now,
  };

  const currentStep = nextBase.currentStep || 'idle';
  const status = nextBase.status || 'idle';
  const startedAt = nextBase.startedAt || now;
  const startedMs = new Date(startedAt).getTime();
  const nowMs = nowDate.getTime();
  const elapsedMs = status === 'idle' ? 0 : clampNonNegative(nowMs - startedMs);
  const totalEstimated = Math.max(
    finiteNumber(nextBase.totalEstimated),
    finiteNumber(nextBase.totalFound),
    finiteNumber(nextBase.totalProcessed),
  );
  const totalProcessed = Math.min(finiteNumber(nextBase.totalProcessed), Math.max(totalEstimated, finiteNumber(nextBase.totalProcessed)));
  const progressRatio = totalEstimated > 0 ? Math.min(totalProcessed / totalEstimated, 1) : 0;
  const averageMsPerEmail = totalProcessed > 0 ? elapsedMs / totalProcessed : null;
  const emailsPerSecond = elapsedMs > 0 && totalProcessed > 0 ? totalProcessed / (elapsedMs / 1000) : 0;

  let estimatedTotalMs: number | null = null;
  let remainingMs: number | null = null;
  if (status === 'completed' || status === 'partial_failed') {
    estimatedTotalMs = elapsedMs;
    remainingMs = 0;
  } else if (status === 'failed') {
    estimatedTotalMs = elapsedMs;
    remainingMs = 0;
  } else if (totalEstimated === 0) {
    estimatedTotalMs = totalProcessed === 0 ? null : elapsedMs;
    remainingMs = totalProcessed === 0 ? null : 0;
  } else if (progressRatio > 0) {
    estimatedTotalMs = elapsedMs / progressRatio;
    remainingMs = Math.max(0, estimatedTotalMs - elapsedMs);
  }

  if (
    previous?.remainingMs !== null &&
    previous?.remainingMs !== undefined &&
    remainingMs !== null &&
    status === 'running' &&
    !nextBase.warningMessage
  ) {
    const jumpsUp = remainingMs > previous.remainingMs * 1.6;
    remainingMs = jumpsUp ? remainingMs : previous.remainingMs * 0.75 + remainingMs * 0.25;
    estimatedTotalMs = elapsedMs + remainingMs;
  }

  const etaConfidence = getEtaConfidence(progressRatio, totalEstimated, Boolean(nextBase.gmailHasNextPage), status);
  const estimatedFinishAt =
    remainingMs !== null && status === 'running'
      ? new Date(nowMs + remainingMs).toISOString()
      : status === 'completed' || status === 'partial_failed' || status === 'failed'
        ? now
        : null;

  return {
    ...nextBase,
    currentStep,
    currentStepLabel: getGmailSyncStepLabel(currentStep),
    startedAt,
    updatedAt: now,
    finishedAt:
      status === 'completed' || status === 'partial_failed' || status === 'failed'
        ? nextBase.finishedAt || now
        : nextBase.finishedAt || null,
    totalFound: finiteNumber(nextBase.totalFound),
    totalEstimated,
    totalProcessed,
    gmailPagesFetched: finiteNumber(nextBase.gmailPagesFetched),
    gmailHasNextPage: Boolean(nextBase.gmailHasNextPage),
    prefilteredCount: finiteNumber(nextBase.prefilteredCount),
    aiQueueCount: finiteNumber(nextBase.aiQueueCount),
    aiProcessedCount: finiteNumber(nextBase.aiProcessedCount),
    attachmentProcessedCount: finiteNumber(nextBase.attachmentProcessedCount),
    fallbackProcessedCount: finiteNumber(nextBase.fallbackProcessedCount),
    autoAcceptedCount: finiteNumber(nextBase.autoAcceptedCount),
    needsReviewCount: finiteNumber(nextBase.needsReviewCount),
    autoSkippedCount: finiteNumber(nextBase.autoSkippedCount),
    autoRejectedCount: finiteNumber(nextBase.autoRejectedCount),
    duplicateCount: finiteNumber(nextBase.duplicateCount),
    retryLaterCount: finiteNumber(nextBase.retryLaterCount),
    failedCount: finiteNumber(nextBase.failedCount),
    currentBatch: finiteNumber(nextBase.currentBatch),
    totalBatches: finiteNumber(nextBase.totalBatches),
    elapsedMs,
    estimatedTotalMs: finiteOrNull(estimatedTotalMs),
    remainingMs: finiteOrNull(remainingMs),
    estimatedFinishAt,
    emailsPerSecond,
    averageMsPerEmail: finiteOrNull(averageMsPerEmail),
    averageMsPerAiEmail: nextBase.aiProcessedCount > 0 ? elapsedMs / finiteNumber(nextBase.aiProcessedCount) : null,
    averageMsPerFallbackEmail: nextBase.fallbackProcessedCount > 0 ? elapsedMs / finiteNumber(nextBase.fallbackProcessedCount) : null,
    averageMsPerAttachmentEmail: nextBase.attachmentProcessedCount > 0 ? elapsedMs / finiteNumber(nextBase.attachmentProcessedCount) : null,
    etaConfidence,
    warningMessage: nextBase.warningMessage || null,
  };
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return 'Menghitung estimasi...';
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 10) return '< 10 detik';
  if (seconds < 60) return `${seconds} detik`;

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) {
    return `${minutes} menit ${String(remainingSeconds).padStart(2, '0')} detik`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours} jam ${String(remainingMinutes).padStart(2, '0')} menit`;
}

export function formatCountdown(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '--:--';
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function formatEstimatedFinishTime(value: string | Date | null | undefined): string {
  if (!value) return '--:--';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '--:--';
  return date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

export function isGmailSyncProgress(value: unknown): value is GmailSyncProgress {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<GmailSyncProgress>;
  return typeof candidate.status === 'string' && typeof candidate.currentStep === 'string';
}

function createBareProgress(now: string): GmailSyncProgress {
  return {
    status: 'idle',
    currentStep: 'idle',
    currentStepLabel: getGmailSyncStepLabel('idle'),
    startedAt: null,
    updatedAt: now,
    finishedAt: null,
    totalFound: 0,
    totalEstimated: 0,
    totalProcessed: 0,
    gmailPagesFetched: 0,
    gmailHasNextPage: false,
    prefilteredCount: 0,
    aiQueueCount: 0,
    aiProcessedCount: 0,
    attachmentProcessedCount: 0,
    fallbackProcessedCount: 0,
    autoAcceptedCount: 0,
    needsReviewCount: 0,
    autoSkippedCount: 0,
    autoRejectedCount: 0,
    duplicateCount: 0,
    retryLaterCount: 0,
    failedCount: 0,
    currentBatch: 0,
    totalBatches: 0,
    elapsedMs: 0,
    estimatedTotalMs: null,
    remainingMs: null,
    estimatedFinishAt: null,
    emailsPerSecond: 0,
    averageMsPerEmail: null,
    averageMsPerAiEmail: null,
    averageMsPerFallbackEmail: null,
    averageMsPerAttachmentEmail: null,
    etaConfidence: 'calculating',
    warningMessage: null,
  };
}

function getEtaConfidence(
  progressRatio: number,
  totalEstimated: number,
  gmailHasNextPage: boolean,
  status: GmailSyncProgressStatus,
): GmailSyncEtaConfidence {
  if (status === 'completed' || status === 'partial_failed' || status === 'failed') return 'high';
  if (totalEstimated <= 0 || progressRatio <= 0.05) return 'calculating';
  if (gmailHasNextPage || progressRatio <= 0.2) return 'low';
  if (progressRatio <= 0.6) return 'medium';
  return 'high';
}

function finiteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function finiteOrNull(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Math.max(0, value);
}

function clampNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}
