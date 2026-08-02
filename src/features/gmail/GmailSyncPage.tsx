import { useEffect, useState, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Mail,
  RefreshCw,
  CheckCircle,
  XCircle,
  AlertCircle,
  Shield,
  Loader2,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  CopyPlus,
  Bug,
  EyeOff,
  Filter,
  History,
  Clock,
  Calendar,
  ChevronRight,
} from 'lucide-react';
import CategoryIcon from '../../components/ui/CategoryIcon';
import { useAuthStore } from '../../store/useAuthStore';
import { useAppStore } from '../../store/useAppStore';
import { clearGmailAccessToken, signInWithGoogleGmail } from '../../services/authService';
import { fetchTransactionEmails, fetchEmailsById, formatGmailDate, getTomorrow } from '../../services/gmailService';
import {
  getExistingFinalGmailMessageIds,
  getFailedEmailIds,
  upsertGmailSyncLogs,
  getGmailSyncLogsPaginated,
} from '../../services/gmailSyncLogService';
import { extractWithGemini, checkGeminiHealth, isConfigErrorCode } from '../../services/geminiService';
import { buildFallbackTransactionFromEmail } from '../../lib/geminiFallbackParser';
import { GEMINI_ERROR_CODES, isQuotaOrCreditsError } from '../../lib/geminiErrors';
import { addTransaction, DuplicateTransactionError } from '../../services/transactionService';
import { triggerGmailSyncNotification } from '../../services/notificationTriggers';
import { initSupabase } from '../../config/supabase';
import { classifyEmail, extractDomain } from '../../lib/gmailClassifier';
import { evaluateLocalGmailParser, shouldSendToAi, type LocalParserResult } from '../../lib/gmailLocalParser';
import { logger } from '../../lib/logger';
import {
  createSyncRun,
  finishSyncRun,
  getSyncRuns,
  getSyncTypeLabel,
  getSyncStatusLabel,
  updateSyncRun,
} from '../../services/gmailSyncRunService';
import type { GmailSyncRun } from '../../services/gmailSyncRunService';
import { getGmailSyncDateRangeDisplay } from '../../services/gmailService';
import GmailSyncEtaCard from './GmailSyncEtaCard';
import Header from '../../components/layout/Header';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import EmptyState from '../../components/ui/EmptyState';
import { cn } from '../../lib/utils';
import {
  getGmailSyncSettings,
  toggleAutoSync,
  updateLastSyncResult,
  shouldRunAutoSync,
} from '../../services/gmailSyncSettingsService';
import AutoSyncStatus from './AutoSyncStatus';
import { calculateConfidenceScore, suggestDecision } from '../../lib/confidenceScorer';
import { validateAndFinalize, checkPreSkipRules } from '../../lib/aiDecisionValidator';
import {
  processDocumentContent,
  getCombinedTextForAI,
  isTrustedForDocumentExtraction,
} from '../../lib/gmailDocumentExtractor';
import {
  extractOrderIdFromSubject,
  isTravelProvider,
  isPaymentReceipt,
  isRelatedDocument,
  getOrderDedupeKey,
  detectTravelProvider,
} from '../../lib/tiketDedupe';
import { buildTransactionNote, sanitizeTransactionNote } from '../../lib/transactionNoteBuilder';
import type { NoteContext } from '../../lib/transactionNoteBuilder';
import type { ExtractedTransaction, PaymentMethod, TransactionType, SyncEmailStatus, SyncEmailDebug, AutoDecision } from '../../types';
import {
  createInitialGmailSyncProgress,
  deriveGmailSyncProgress,
  isGmailSyncProgress,
  type GmailSyncProgress,
  type GmailSyncProgressPatch,
} from '../../lib/gmailSyncProgress';

// ===================== Types =====================

interface SyncEmail {
  id: string;
  subject: string;
  from: string;
  date: string;
  body?: string;  // Email body untuk retry/mark-as-transaction
  status: SyncEmailStatus;
  amount?: number | null;
  confidence?: number | null;
  merchant?: string | null;
  category?: string | null;
  paymentMethod?: string | null;
  transactionType?: TransactionType;
  description?: string | null;
  /** Catatan transaksi yang jelas — menjelaskan transaksi untuk apa */
  note?: string | null;
  extracted?: ExtractedTransaction | null;
  reason?: string;
  debug?: SyncEmailDebug;
}

interface ProcessingStats {
  total: number;
  processed: number;
  pendingReview: number;
  approved: number;
  rejected: number;
  autoAcceptedCount: number;
  autoRejected: number;
  skipped: number;
  duplicate: number;
  failed: number;
  retryLater: number;
  configError: number;
}

// ===================== Constants =====================

const AI_CONCURRENCY = 1;
const AI_BATCH_SIZE = 10;
const AI_REQUEST_DELAY_MS = 1500;
const BATCH_DELAY_MS = AI_REQUEST_DELAY_MS;
const MAX_AI_RETRIES = 2; // Max retries per email for rate-limited/network errors
const LOGS_PAGE_SIZE = 100; // Maksimal email per halaman untuk UI pagination
const SYNC_PROGRESS_PERSIST_INTERVAL_MS = 2500;

const RETRYABLE_STATUSES: ReadonlySet<SyncEmailStatus> = new Set(['failed', 'retry_later']);

function mergeEmailResults(current: SyncEmail[], results: SyncEmail[]): SyncEmail[] {
  const resultById = new Map(results.map((email) => [email.id, email]));
  const currentIds = new Set(current.map((email) => email.id));
  const updated = current.map((email) => {
    const next = resultById.get(email.id);
    return next ? { ...next, body: next.body || email.body } : email;
  });
  const newResults = results.filter((email) => !currentIds.has(email.id));
  return [...newResults, ...updated];
}

async function persistGmailSyncResults(userId: string | undefined, results: SyncEmail[], syncRunId?: string | null): Promise<void> {
  if (!userId || results.length === 0) return;

  const logs = results.map((email) => {
    const fallbackRecovered = email.status === 'needs_review' && email.debug?.fallbackUsed;
    const shouldStoreErrorMessage =
      fallbackRecovered ||
      email.status === 'needs_review' ||
      email.status === 'failed' ||
      email.status === 'retry_later' ||
      email.status === 'config_error' ||
      email.status === 'auto_rejected' ||
      (email.status === 'skipped' && Boolean(email.reason)) ||
      (email.status === 'auto_skipped' && Boolean(email.reason));

    return {
      userId,
      messageId: email.id,
      syncRunId: syncRunId ?? undefined,
      subject: email.subject,
      sender: email.from,
      emailDate: email.date,
      prefilterStatus: email.debug?.prefilterDecision,
      aiCalled: email.debug?.aiCalled ?? false,
      aiParsed: email.debug?.aiParsedSuccessful ?? false,
      finalStatus: email.status,
      status: email.status,
      confidenceScore: email.confidence ?? undefined,
      errorMessage: shouldStoreErrorMessage
        ? fallbackRecovered
          ? 'Gemini gagal, fallback parser berhasil membuat kandidat transaksi'
          : email.reason
        : undefined,
      metadata: {
        errorCode: email.debug?.aiErrorCode,
        fallbackUsed: email.debug?.fallbackUsed ?? false,
        finalStatus: email.status,
        skipReason: email.debug?.skipReason,
        matchedRule: email.debug?.matchedRule,
        detectedPromoAmount: email.debug?.detectedPromoAmount,
        amountIgnored: email.debug?.amountIgnored,
        source: 'gmail_sync',
        parserSource: email.debug?.modelUsed || null,
        parserVersion: email.debug?.aiCalled ? 'ai-proxy' : 'rules-first-2026-06-21',
        extractedNote: email.note || null,
        noteSource: email.note ? (email.status === 'auto_accepted' ? 'ai_builder' : 'builder') : null,
      },
      extractedNote: email.note || undefined,
      scannedAt: new Date(),
    };
  });

  try {
    await upsertGmailSyncLogs(logs);
  } catch (error) {
    logger.warn('[GmailSync] Gagal menyimpan log Gmail Sync secara bulk', error);
    throw error;
  }
}

// ===================== Status Config =====================

const STATUS_CONFIG: Record<SyncEmailStatus, { label: string; color: string; bg: string }> = {
  auto_accepted: { label: 'Diterima Otomatis', color: 'text-mint-500', bg: 'bg-mint-50 dark:bg-mint-500/12' },
  auto_skipped: { label: 'Dilewati Otomatis', color: 'text-app-subtle', bg: 'bg-app-hover/60' },
  auto_rejected: { label: 'Ditolak Otomatis', color: 'text-soft-amber', bg: 'bg-amber-50 dark:bg-amber-500/12' },
  needs_review: { label: 'Perlu Review', color: 'text-amber-500', bg: 'bg-amber-50 dark:bg-amber-500/12' },
  pending_review: { label: 'Pending Review', color: 'text-amber-500', bg: 'bg-amber-50 dark:bg-amber-500/12' },
  approved: { label: 'Disetujui', color: 'text-mint-500', bg: 'bg-mint-50 dark:bg-mint-500/12' },
  rejected: { label: 'Ditolak', color: 'text-red-500', bg: 'bg-red-50 dark:bg-red-500/12' },
  skipped: { label: 'Dilewati', color: 'text-app-subtle', bg: 'bg-app-hover/80' },
  duplicate: { label: 'Duplikat', color: 'text-soft-purple', bg: 'bg-purple-50 dark:bg-purple-500/12' },
  failed: { label: 'Gagal Teknis', color: 'text-red-500', bg: 'bg-red-50 dark:bg-red-500/12' },
  retry_later: { label: 'Coba Lagi Nanti', color: 'text-blue-500', bg: 'bg-blue-50 dark:bg-blue-500/12' },
  config_error: { label: 'Config Error', color: 'text-rose-500', bg: 'bg-rose-50 dark:bg-rose-500/12' },
  gmail_permission_required: { label: 'Butuh Izin Gmail', color: 'text-blue-500', bg: 'bg-blue-50 dark:bg-blue-500/12' },
  paused_config_error: { label: 'Config Error', color: 'text-rose-500', bg: 'bg-rose-50 dark:bg-rose-500/12' },
};

// ===================== Component =====================

export default function GmailSyncPage() {
  const { firebaseUser } = useAuthStore();
  const { addToast, gmailSyncEnabled, setGmailSyncEnabled } = useAppStore();

  const [isConnected, setIsConnected] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [emails, setEmails] = useState<SyncEmail[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [scannedCount, setScannedCount] = useState(0);
  const [progress, setProgress] = useState<string>('');
  const [showDebug, setShowDebug] = useState(false);
  const [expandedEmail, setExpandedEmail] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<SyncEmailStatus | 'all'>('all');
  const [geminiHealth, setGeminiHealth] = useState<{ ok: boolean; status: string; message: string } | null>(null);

  // ===================== Result Pagination State =====================
  // Data hasil scan dimuat dari Supabase dengan pagination (100 per halaman)
  // Riwayat tetap tersimpan meskipun user pindah halaman, refresh, atau logout-login
  const [paginatedLogs, setPaginatedLogs] = useState<import('../../services/gmailSyncLogService').PaginatedSyncLogsResult | null>(null);
  const [logsCurrentPage, setLogsCurrentPage] = useState(1);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [selectedSyncRunId, setSelectedSyncRunId] = useState<string | null>(null);
  // Guard anti-stale-response: request yang lebih lama (mis. mount dengan
  // status=null yang lambat) TIDAK boleh menimpa hasil request filter yang lebih
  // baru. Increment tiap loadPaginatedResults; hanya request dengan id terbaru
  // yang berhak commit state + menurunkan loading flag. (Race ini bisa dilihat
  // user: klik filter "Perlu Review" tapi list kembali menampilkan semua email.)
  const paginatedRequestIdRef = useRef(0);

  // ===================== Sync Run History State =====================
  const [syncRuns, setSyncRuns] = useState<GmailSyncRun[]>([]);
  const [syncRunsLoading, setSyncRunsLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<{ start: string; end: string }>({
    start: '',
    end: '',
  });
  const [activeSyncRunId, setActiveSyncRunId] = useState<string | null>(null);
  const [syncProgress, setSyncProgress] = useState<GmailSyncProgress | null>(null);
  const syncProgressRef = useRef<GmailSyncProgress | null>(null);
  const syncProgressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastPersistedProgressRef = useRef(0);

  // State untuk editable note pada needs_review/pending_review email
  const [noteEditState, setNoteEditState] = useState<Record<string, string>>({});

  // ===================== Auto Sync State =====================
  const [autoSyncSettings, setAutoSyncSettings] = useState<{
    lastSyncedAt: string | null;
    nextSyncAt: string | null;
    lastStatus: string | null;
    lastResultSummary: string | null;
    syncIntervalMinutes: number;
  } | null>(null);
  const autoSyncIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isAutoScanningRef = useRef(false);

  // Track processed messageIds to avoid duplicates across scans
  const processedIdsRef = useRef<Set<string>>(new Set());

  const persistSyncProgress = useCallback(async (
    runId: string | null,
    nextProgress: GmailSyncProgress,
    force = false,
  ) => {
    if (!runId) return;
    const now = Date.now();
    if (!force && now - lastPersistedProgressRef.current < SYNC_PROGRESS_PERSIST_INTERVAL_MS) return;
    lastPersistedProgressRef.current = now;

    await updateSyncRun(runId, {
      totalFound: nextProgress.totalFound,
      totalProcessed: nextProgress.totalProcessed,
      autoAcceptedCount: nextProgress.autoAcceptedCount,
      pendingReviewCount: nextProgress.needsReviewCount,
      skippedCount: nextProgress.autoSkippedCount + nextProgress.autoRejectedCount,
      rejectedCount: nextProgress.autoRejectedCount,
      duplicateCount: nextProgress.duplicateCount,
      failedCount: nextProgress.failedCount,
      retryLaterCount: nextProgress.retryLaterCount,
      metadata: { progress: nextProgress },
    });
  }, []);

  const applySyncProgress = useCallback((
    patch: GmailSyncProgressPatch,
    runId: string | null,
    options: { forcePersist?: boolean } = {},
  ) => {
    const next = deriveGmailSyncProgress(syncProgressRef.current, patch);
    syncProgressRef.current = next;
    setSyncProgress(next);
    setProgress(next.currentStepLabel);
    void persistSyncProgress(runId, next, options.forcePersist);
    return next;
  }, [persistSyncProgress]);

  const startSyncProgress = useCallback((
    runId: string | null,
    patch: GmailSyncProgressPatch = {},
  ) => {
    const next = createInitialGmailSyncProgress(runId, patch);
    syncProgressRef.current = next;
    setSyncProgress(next);
    setProgress(next.currentStepLabel);
    lastPersistedProgressRef.current = 0;
    void persistSyncProgress(runId, next, true);
    return next;
  }, [persistSyncProgress]);

  const getProgressMetadata = useCallback((progressValue?: GmailSyncProgress | null) => ({
    progress: progressValue || syncProgressRef.current,
  }), []);

  useEffect(() => {
    initSupabase();
    setIsConnected(!!firebaseUser);
  }, [firebaseUser]);

  useEffect(() => {
    if (syncProgressTimerRef.current) {
      clearInterval(syncProgressTimerRef.current);
      syncProgressTimerRef.current = null;
    }

    if (syncProgressRef.current?.status !== 'running') {
      return;
    }

    syncProgressTimerRef.current = setInterval(() => {
      const current = syncProgressRef.current;
      if (!current || current.status !== 'running') return;
      const next = deriveGmailSyncProgress(current, {
        warningMessage:
          current.updatedAt && Date.now() - new Date(current.updatedAt).getTime() > 60_000
            ? 'Proses lebih lama dari biasanya.'
            : current.warningMessage,
      });
      syncProgressRef.current = next;
      setSyncProgress(next);
    }, 1000);

    return () => {
      if (syncProgressTimerRef.current) {
        clearInterval(syncProgressTimerRef.current);
        syncProgressTimerRef.current = null;
      }
    };
  }, [syncProgress?.status]);

  // Cek kesehatan Gemini API saat page mount
  useEffect(() => {
    checkGeminiHealth().then((health) => {
      setGeminiHealth(health);
    });
  }, []);

  // ===================== Load Sync Run History =====================
  // Riwayat dimuat dari Supabase setiap kali halaman dibuka
  // Setelah pindah halaman, refresh, atau logout-login, data tetap ada
  const loadSyncRuns = useCallback(async (options: { silent?: boolean } = {}) => {
    if (!firebaseUser?.uid) return;
    if (!options.silent) {
      setSyncRunsLoading(true);
      setHistoryError(null);
    }
    try {
      const runs = await getSyncRuns(firebaseUser.uid, 20);
      setSyncRuns(runs);
      const runningRun = runs.find((run) => run.status === 'running' && isGmailSyncProgress(run.metadata?.progress));
      if (!isScanning && runningRun && isGmailSyncProgress(runningRun.metadata?.progress)) {
        const hydratedProgress = deriveGmailSyncProgress(runningRun.metadata.progress, {
          syncRunId: runningRun.id,
          status: 'running',
        });
        syncProgressRef.current = hydratedProgress;
        setSyncProgress(hydratedProgress);
        setActiveSyncRunId(runningRun.id);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Gagal memuat riwayat Gmail Sync';
      setHistoryError(message);
      logger.warn('[GmailSync] Gagal memuat riwayat:', err);
    } finally {
      if (!options.silent) {
        setSyncRunsLoading(false);
      }
    }
  }, [firebaseUser?.uid, isScanning]);

  useEffect(() => {
    const display = getGmailSyncDateRangeDisplay();
    setDateRange(display);
    void loadSyncRuns();
  }, [loadSyncRuns]);

  useEffect(() => {
    if (!firebaseUser?.uid || isScanning) return;
    const hasRunningRun = syncRuns.some((run) => run.status === 'running');
    if (!hasRunningRun) return;

    const intervalId = setInterval(() => {
      void loadSyncRuns({ silent: true });
    }, 5000);

    return () => clearInterval(intervalId);
  }, [firebaseUser?.uid, isScanning, loadSyncRuns, syncRuns]);

  // ===================== Auto Sync: Load Settings =====================
  useEffect(() => {
    if (!firebaseUser?.uid) return;

    getGmailSyncSettings(firebaseUser.uid).then((settings) => {
      if (settings) {
        setAutoSyncSettings({
          lastSyncedAt: settings.lastSyncedAt,
          nextSyncAt: settings.nextSyncAt,
          lastStatus: settings.lastStatus,
          lastResultSummary: settings.lastResultSummary,
          syncIntervalMinutes: settings.syncIntervalMinutes,
        });

        // Synckan state enabled dari Supabase (lebih otoritatif daripada localStorage)
        if (settings.autoSyncEnabled !== gmailSyncEnabled) {
          setGmailSyncEnabled(settings.autoSyncEnabled);
        }
      }
    });
    // Hanya jalankan sekali saat mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firebaseUser?.uid]);

  // ===================== Auto Sync: Checker Interval =====================
  useEffect(() => {
    // Bersihkan interval sebelumnya jika ada
    if (autoSyncIntervalRef.current) {
      clearInterval(autoSyncIntervalRef.current);
      autoSyncIntervalRef.current = null;
    }

    if (!gmailSyncEnabled || !firebaseUser?.uid || isScanning) {
      return;
    }

    const runAutoScanIfDue = async () => {
      if (isAutoScanningRef.current || isScanning) return;
      if (!firebaseUser?.uid) return;

      const settings = await getGmailSyncSettings(firebaseUser.uid);
      if (!settings || !shouldRunAutoSync(settings)) return;

      isAutoScanningRef.current = true;
      try {
        await handleScanEmails();

        // Update last/next sync setelah scan sukses
        const interval = settings.syncIntervalMinutes;
        await updateLastSyncResult(
          firebaseUser.uid,
          { status: 'completed' },
          interval,
        );

        // Refresh settings
        const updated = await getGmailSyncSettings(firebaseUser.uid);
        if (updated) {
          setAutoSyncSettings({
            lastSyncedAt: updated.lastSyncedAt,
            nextSyncAt: updated.nextSyncAt,
            lastStatus: updated.lastStatus,
            lastResultSummary: updated.lastResultSummary,
            syncIntervalMinutes: updated.syncIntervalMinutes,
          });
        }
      } catch {
        // Error sudah ditangani oleh handleScanEmails
      } finally {
        isAutoScanningRef.current = false;
      }
    };

    // Cek segera saat pertama kali enabled
    runAutoScanIfDue();

    // Checker interval: cek setiap 60 detik apakah sudah waktunya scan
    autoSyncIntervalRef.current = setInterval(runAutoScanIfDue, 60_000);

    // Cleanup saat component unmount atau gmailSyncEnabled berubah
    return () => {
      if (autoSyncIntervalRef.current) {
        clearInterval(autoSyncIntervalRef.current);
        autoSyncIntervalRef.current = null;
      }
      isAutoScanningRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gmailSyncEnabled, firebaseUser?.uid]);

  // ===================== Actions =====================

  const handleConnectGmail = async () => {
    setError(null);
    try {
      await signInWithGoogleGmail();
      setIsConnected(true);
      setHasPermission(true);
      addToast({ type: 'success', title: 'Gmail berhasil terhubung' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Gagal menghubungkan Gmail';
      setError(message);
      setHasPermission(false);
      addToast({ type: 'error', title: 'Gagal', message });
    }
  };

  const handleScanEmails = async () => {
    setIsScanning(true);
    setError(null);
    setProgress('Memindai email dari hari ini mundur sampai 1 Jan 2026...');
    setSyncProgress(null);
    syncProgressRef.current = null;

    // Buat sync run di Supabase agar riwayat tercatat
    let syncRunId: string | null = null;
    const todayStr = new Date().toISOString().split('T')[0];
    if (firebaseUser?.uid) {
      const run = await createSyncRun(firebaseUser.uid, {
        syncType: 'manual',
        dateFrom: '2026-01-01',
        dateTo: todayStr,
      });
      syncRunId = run?.id || null;
      if (syncRunId) {
        setActiveSyncRunId(syncRunId);
        // Simpan metadata range dan sort order
        void updateSyncRun(syncRunId, {
          metadata: {
            rangeMode: 'today_back_to_2026_01_01',
            queryAfter: '2026/01/01',
            queryBefore: formatGmailDate(getTomorrow()),
            displayOrder: 'newest_first',
            userTriggeredAt: new Date().toISOString(),
          },
        });
      }
    }

    try {
      startSyncProgress(syncRunId, {
        currentStep: 'fetching_gmail',
        totalFound: 0,
        totalEstimated: 0,
      });

      const gmailEmails = await fetchTransactionEmails((gmailProgress) => {
        applySyncProgress({
          currentStep: 'fetching_gmail',
          totalFound: gmailProgress.totalFound,
          totalEstimated: gmailProgress.totalEstimated,
          totalProcessed: gmailProgress.detailsFetched,
          gmailPagesFetched: gmailProgress.gmailPagesFetched,
          gmailHasNextPage: gmailProgress.gmailHasNextPage,
        }, syncRunId, { forcePersist: gmailProgress.phase === 'search_page' });
      });
      setScannedCount(gmailEmails.length);

      if (gmailEmails.length === 0) {
        const completedProgress = applySyncProgress({
          status: 'completed',
          currentStep: 'completed',
          totalFound: 0,
          totalEstimated: 0,
          totalProcessed: 0,
          gmailHasNextPage: false,
          finishedAt: new Date().toISOString(),
        }, syncRunId, { forcePersist: true });
        if (syncRunId) {
          await finishSyncRun(syncRunId, {
            status: 'completed',
            totalFound: 0,
            totalProcessed: 0,
            autoAcceptedCount: 0,
            pendingReviewCount: 0,
            skippedCount: 0,
            rejectedCount: 0,
            duplicateCount: 0,
            failedCount: 0,
            retryLaterCount: 0,
            configErrorCount: 0,
            metadata: getProgressMetadata(completedProgress),
          });
          setActiveSyncRunId(null);
          void loadSyncRuns();
        }
        setProgress('');
        addToast({ type: 'info', title: 'Tidak ada email baru', message: 'Tidak ditemukan email transaksi dari Gmail.' });
        setIsScanning(false);
        return;
      }

      setProgress(`Memfilter ${gmailEmails.length} email...`);
      if (firebaseUser?.uid) {
        const existingFinalIds = await getExistingFinalGmailMessageIds(
          firebaseUser.uid,
          gmailEmails.map((email) => email.id),
        );
        existingFinalIds.forEach((id) => processedIdsRef.current.add(id));
      }

      applySyncProgress({
        currentStep: 'prefiltering',
        totalFound: gmailEmails.length,
        totalEstimated: gmailEmails.length,
        gmailHasNextPage: false,
      }, syncRunId, { forcePersist: true });

      // ===================== STEP 1: Prefilter semua email =====================
      const prefiltedEmails = gmailEmails.map((email) => {
        // Cek duplikat (gmailMessageId)
        if (processedIdsRef.current.has(email.id)) {
          return { email, prefilterResult: null, localParserResult: null, duplicate: true };
        }

        // Jalankan prefilter
        const classification = classifyEmail(email.subject, email.body, email.from);
        const localParserResult = classification.decision === 'send_to_ai'
          ? evaluateLocalGmailParser(email)
          : null;
        return { email, prefilterResult: classification, localParserResult, duplicate: false };
      });

      // ===================== STEP 2: Proses batch dengan concurrency limit =====================
      const results: SyncEmail[] = [];
      const aiCandidates = prefiltedEmails.filter(
        (item) =>
          !item.duplicate &&
          item.prefilterResult?.decision === 'send_to_ai' &&
          item.localParserResult &&
          shouldSendToAi(item.localParserResult)
      );
      const totalBatches = aiCandidates.length > 0 ? Math.ceil(aiCandidates.length / AI_BATCH_SIZE) : 0;

      // Proses duplikat & non-AI emails dulu (instant)
      let processedCount = 0;
      for (const item of prefiltedEmails) {
        if (item.duplicate) {
          results.push({
            id: item.email.id,
            subject: item.email.subject,
            from: item.email.from,
            date: item.email.date,
            body: item.email.body,
            status: 'duplicate',
            reason: 'Duplikat: email sudah pernah diproses sebelumnya',
            debug: buildDebugInfo(item.email, 'duplicate', false, false, null, 'duplicate', null),
          });
          processedCount++;
        } else if (item.prefilterResult && item.prefilterResult.decision !== 'send_to_ai') {
          results.push({
            id: item.email.id,
            subject: item.email.subject,
            from: item.email.from,
            date: item.email.date,
            body: item.email.body,
            status: item.prefilterResult.decision === 'auto_rejected' ? 'auto_rejected' : 'skipped',
            reason: item.prefilterResult.reason,
            debug: buildDebugInfo(
              item.email,
              item.prefilterResult.errorCode || item.prefilterResult.decision,
              false,
              false,
              null,
              item.prefilterResult.decision === 'auto_rejected' ? 'auto_rejected' : 'skipped',
              item.prefilterResult.reason,
              item.prefilterResult.errorCode,
              undefined,
              undefined,
              false,
              undefined,
              {
                skipReason: item.prefilterResult.skipReason,
                matchedRule: item.prefilterResult.matchedRule,
                detectedPromoAmount: item.prefilterResult.detectedPromoAmount,
                amountIgnored: item.prefilterResult.amountIgnored,
              },
            ),
          });
          processedCount++;
        } else if (item.localParserResult && item.localParserResult.decision !== 'send_to_ai') {
          results.push(buildSyncEmailFromLocalParser(item.email, item.localParserResult));
          processedCount++;
        }
      }

      const prefilterStats = calculateStats(results);
      applySyncProgress({
        currentStep: aiCandidates.length > 0 ? 'extracting_ai' : 'saving_results',
        totalProcessed: processedCount,
        prefilteredCount: prefiltedEmails.length,
        aiQueueCount: aiCandidates.length,
        currentBatch: aiCandidates.length > 0 ? 1 : 0,
        totalBatches,
        autoAcceptedCount: prefilterStats.autoAcceptedCount,
        needsReviewCount: prefilterStats.pendingReview,
        autoSkippedCount: prefilterStats.skipped,
        autoRejectedCount: prefilterStats.autoRejected,
        duplicateCount: prefilterStats.duplicate,
        retryLaterCount: prefilterStats.retryLater,
        failedCount: prefilterStats.failed,
      }, syncRunId, { forcePersist: true });

      // Proses AI candidates dengan concurrency limit — kirim full email data
      const aiResultsBuffer: SyncEmail[] = [];
      const aiResults = await processBatchWithConcurrency(
        aiCandidates.map((item) => item.email),
        AI_CONCURRENCY,
        async (email, index, total) => {
          setProgress(`Mengekstrak ${index + 1} dari ${total} dengan AI...`);
          return await processSingleEmail(email, email.attachments);
        },
        (result, _index, completed, total) => {
          aiResultsBuffer.push(result);
          const partialResults = [...results, ...aiResultsBuffer];
          const stats = calculateStats(partialResults);
          const currentStep = result.debug?.fallbackUsed
            ? 'fallback_parsing'
            : didUseAttachmentExtraction(result)
              ? 'extracting_attachment'
              : 'extracting_ai';
          applySyncProgress({
            currentStep,
            totalProcessed: processedCount + completed,
            aiProcessedCount: completed,
            fallbackProcessedCount: partialResults.filter((email) => email.debug?.fallbackUsed).length,
            attachmentProcessedCount: partialResults.filter(didUseAttachmentExtraction).length,
            currentBatch: Math.min(totalBatches, Math.max(1, Math.ceil(completed / AI_BATCH_SIZE))),
            totalBatches: totalBatches || Math.ceil(total / AI_BATCH_SIZE),
            autoAcceptedCount: stats.autoAcceptedCount,
            needsReviewCount: stats.pendingReview,
            autoSkippedCount: stats.skipped,
            autoRejectedCount: stats.autoRejected,
            duplicateCount: stats.duplicate,
            retryLaterCount: stats.retryLater,
            failedCount: stats.failed,
            warningMessage: result.status === 'retry_later' ? 'Proses lebih lama karena retry/rate limit.' : null,
          }, syncRunId);
        }
      );

      results.push(...aiResults);

      // Tandai semua messageId sebagai sudah diproses
      // Jika terjadi config error (API disabled, key missing, auth error, dll), hentikan batch
      const hasConfigError = aiResults.some(
        (r) => r.debug?.aiErrorCode && isConfigErrorCode(r.debug.aiErrorCode)
      );

      // Jika terjadi quota/credits error (429, quota exceeded, credits depleted)
      // AI dihentikan tetapi fallback parser tetap berjalan — email ambigu jadi retry_later
      const hasQuotaError = aiResults.some(
        (r) => r.debug?.aiErrorCode && isQuotaOrCreditsError(r.debug.aiErrorCode)
      );

      if (hasConfigError) {
        // Tandai sisa email sebagai skipped, jangan failed massal
        setProgress('Konfigurasi AI bermasalah. Hentikan batch.');

        // Cari error detail untuk pesan yang jelas
        const configErrorMessage =
          aiResults.find((r) => r.debug?.errorDetail)?.reason ||
          'Konfigurasi Gemini AI bermasalah. Periksa server proxy dan API key.';

        setGeminiHealth({
          ok: false,
          status: 'config_error',
          message: configErrorMessage,
        });
      } else if (hasQuotaError) {
        const quotaErrorResult = aiResults.find(
          (r) => r.debug?.aiErrorCode && isQuotaOrCreditsError(r.debug.aiErrorCode)
        );
        const isCredits = quotaErrorResult?.debug?.aiErrorCode === GEMINI_ERROR_CODES.CREDITS_DEPLETED;
        const quotaMessage = isCredits
          ? 'Credit Gemini API habis. CashFlow tetap memproses email dengan fallback parser. Email ambigu ditandai Coba Lagi Nanti.'
          : 'Limit Gemini API tercapai. CashFlow tetap memproses email dengan fallback parser. Email ambigu ditandai Coba Lagi Nanti.';

        setGeminiHealth({
          ok: false,
          status: isCredits ? 'credits_depleted' : 'quota_exceeded',
          message: quotaMessage,
        });
        setProgress(quotaMessage);
      }

      // Tandai hanya email yang bukan retry_later sebagai sudah diproses
      // Email retry_later perlu diproses ulang di scan berikutnya
      const retryLaterIds = new Set(
        results.filter((r) => r.status === 'retry_later').map((r) => r.id)
      );
      gmailEmails.forEach((email) => {
        if (!retryLaterIds.has(email.id)) {
          processedIdsRef.current.add(email.id);
        }
      });

      setEmails(results);
      applySyncProgress({
        currentStep: 'saving_results',
        totalProcessed: results.length,
      }, syncRunId, { forcePersist: true });
      await persistGmailSyncResults(firebaseUser?.uid, results, syncRunId);

      // ===== Auto-insert auto_accepted transactions =====
      const autoAcceptedItems = results.filter(
        (r) => r.status === 'auto_accepted' && r.amount && r.amount >= 1000 && firebaseUser?.uid
      );

      let autoAcceptedCount = 0;
      let autoAcceptedFailedCount = 0;

      for (const item of autoAcceptedItems) {
        if (!firebaseUser?.uid) break;
        try {
          await addTransaction(
            firebaseUser.uid,
            {
              type: item.transactionType || 'expense',
              amount: item.amount!,
              categoryId: slugify(item.category || 'Lainnya'),
              categoryName: item.category || 'Lainnya',
              merchant: item.merchant || item.from,
              paymentMethod: normalizePaymentMethod(item.paymentMethod ?? undefined),
              note: item.note || item.description || item.subject,
              date: normalizeDate(item.date),
            },
            'gmail',
            item.id,
            item.confidence ?? undefined
          );
          autoAcceptedCount++;
        } catch (insertError) {
          if (!(insertError instanceof DuplicateTransactionError)) {
            autoAcceptedFailedCount++;
            logger.warn('[GmailSync] Gagal auto-insert auto_accepted transaction', {
              emailId: item.id,
              error: insertError instanceof Error ? insertError.message : 'Unknown',
            });
          } else {
            autoAcceptedCount++; // Duplicate is fine — counted as processed
          }
        }
      }

      if (autoAcceptedCount > 0) {
        logger.info(`[GmailSync] Auto-accepted ${autoAcceptedCount} transactions (${autoAcceptedFailedCount} failed)`);
      }

      // ===================== STEP 3: Tampilkan summary =====================
      const stats = calculateStats(results);
      const finalProgress = applySyncProgress({
        status: stats.failed > 0 ? 'partial_failed' : 'completed',
        currentStep: stats.failed > 0 ? 'partial_failed' : 'completed',
        totalFound: gmailEmails.length,
        totalEstimated: gmailEmails.length,
        totalProcessed: stats.processed,
        autoAcceptedCount: stats.autoAcceptedCount,
        needsReviewCount: stats.pendingReview,
        autoSkippedCount: stats.skipped,
        autoRejectedCount: stats.autoRejected,
        duplicateCount: stats.duplicate,
        retryLaterCount: stats.retryLater,
        failedCount: stats.failed,
        finishedAt: new Date().toISOString(),
      }, syncRunId, { forcePersist: true });
      const transactionCount = stats.pendingReview;
      
      if (transactionCount > 0) {
        addToast({
          type: 'success',
          title: `Ditemukan ${transactionCount} kandidat transaksi`,
          message: `${gmailEmails.length} email diproses, ${stats.autoRejected + stats.skipped} dilewati, ${stats.failed} gagal, ${stats.retryLater} retry later.`,
        });
      } else {
        addToast({
          type: 'info',
          title: 'Belum ada transaksi baru',
          message: `${gmailEmails.length} email diproses, ${stats.autoRejected + stats.skipped} dilewati, ${stats.failed} gagal, ${stats.retryLater} retry later.`,
        });
      }
      if (firebaseUser?.uid) {
        // Finish sync run dengan summary
        if (syncRunId) {
          await finishSyncRun(syncRunId, {
            status: stats.failed > 0 ? 'partial_failed' : 'completed',
            totalFound: gmailEmails.length,
            totalProcessed: stats.processed,
            autoAcceptedCount: stats.autoAcceptedCount,
            pendingReviewCount: stats.pendingReview,
            skippedCount: stats.skipped + stats.autoRejected,
            rejectedCount: stats.rejected,
            duplicateCount: stats.duplicate,
            failedCount: stats.failed,
            retryLaterCount: stats.retryLater,
            configErrorCount: stats.configError,
            metadata: getProgressMetadata(finalProgress),
          });
          setActiveSyncRunId(null);
          // Refresh riwayat dari Supabase
          void loadSyncRuns();
          // Setelah scan selesai, muat hasil dari Supabase dengan pagination
          setLogsCurrentPage(1);
          setSelectedSyncRunId(syncRunId);
          void loadPaginatedResults(syncRunId, 1);
        }

        void triggerGmailSyncNotification(firebaseUser.uid, {
          pendingCount: stats.pendingReview - stats.autoAcceptedCount,
          autoAcceptedCount: stats.autoAcceptedCount,
          autoSkippedCount: stats.skipped,
          autoRejectedCount: stats.autoRejected,
          failedCount: stats.failed,
          retryLaterCount: stats.retryLater,
          configErrorCount: stats.configError,
          lastBatchId: `scan-${Date.now()}`,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Gagal memindai email';
      // Set sync run sebagai failed
      if (syncRunId) {
        const currentProgress = syncProgressRef.current as GmailSyncProgress | null;
        const failedProgress = applySyncProgress({
          status: 'failed',
          currentStep: 'failed',
          failedCount: currentProgress?.failedCount || 0,
          finishedAt: new Date().toISOString(),
          warningMessage: message,
        }, syncRunId, { forcePersist: true });
        await finishSyncRun(syncRunId, {
          status: 'failed',
          totalFound: currentProgress?.totalFound || scannedCount,
          totalProcessed: currentProgress?.totalProcessed || 0,
          autoAcceptedCount: 0,
          pendingReviewCount: 0,
          skippedCount: 0,
          rejectedCount: 0,
          duplicateCount: 0,
          failedCount: 0,
          retryLaterCount: 0,
          configErrorCount: 0,
          errorCode: 'SCAN_ERROR',
          errorMessage: message,
          metadata: getProgressMetadata(failedProgress),
        });
        setActiveSyncRunId(null);
        void loadSyncRuns();
      }
      setError(message);
      addToast({ type: 'error', title: 'Gagal memindai', message });
    } finally {
      setIsScanning(false);
      setProgress('');
    }
  };

  const handleRetrySingle = async (emailId: string) => {
    const email = emails.find((e) => e.id === emailId);
    if (!email) return;
    if (!RETRYABLE_STATUSES.has(email.status)) {
      addToast({ type: 'info', title: 'Tidak perlu retry', message: 'Hanya email failed atau retry later yang diproses ulang.' });
      return;
    }

    setEmails((prev) =>
      prev.map((e) =>
        e.id === emailId
          ? { ...e, reason: 'Mencoba ekstraksi ulang...' }
          : e
      )
    );

    try {
      // Gunakan body yang tersimpan jika ada
      const emailBody = email.body || email.description || `${email.subject} ${email.from}`;

      const result = await processSingleEmail({
        id: email.id,
        subject: email.subject,
        from: email.from,
        date: email.date,
        body: emailBody,
        threadId: '',
      });

      // Pertahankan body asli untuk retry berikutnya
      const resultWithBody = { ...result, body: email.body || emailBody };
      const nextEmails = mergeEmailResults(emails, [resultWithBody]);
      const nextStats = calculateStats(nextEmails);

      setEmails(nextEmails);
      await persistGmailSyncResults(firebaseUser?.uid, [resultWithBody]);
      if (firebaseUser?.uid) {
        void triggerGmailSyncNotification(firebaseUser.uid, {
          pendingCount: nextStats.pendingReview - nextStats.autoAcceptedCount,
          autoAcceptedCount: nextStats.autoAcceptedCount,
          autoSkippedCount: nextStats.skipped,
          autoRejectedCount: nextStats.autoRejected,
          failedCount: nextStats.failed,
          retryLaterCount: nextStats.retryLater,
          configErrorCount: nextStats.configError,
          lastBatchId: `retry-single-${emailId}`,
        });
      }

      if (result.status === 'pending_review') {
        addToast({ type: 'success', title: 'Ekstraksi ulang berhasil', message: 'Transaksi ditemukan dan menunggu review.' });
      } else {
        addToast({ type: 'info', title: 'Status diperbarui', message: result.reason || `Status: ${result.status}` });
      }
    } catch (err) {
      const failedResult: SyncEmail = {
        ...email,
        status: 'failed',
        reason: err instanceof Error ? err.message : 'Gagal ekstraksi ulang',
      };
      setEmails((prev) =>
        prev.map((e) =>
          e.id === emailId
            ? failedResult
            : e
        )
      );
      await persistGmailSyncResults(firebaseUser?.uid, [failedResult]);
      addToast({ type: 'error', title: 'Gagal ekstraksi ulang', message: err instanceof Error ? err.message : undefined });
    }
  };

  const handleMarkAsTransaction = async (emailId: string) => {
    const email = emails.find((e) => e.id === emailId);
    if (!email) return;

    // Auto-rejected/skipped email yang dianggap valid oleh user
    // Kirim ke AI untuk ekstraksi menggunakan body yang tersimpan
    setEmails((prev) =>
      prev.map((e) =>
        e.id === emailId
          ? { ...e, status: 'pending_review' as SyncEmailStatus, reason: 'Ditandai user sebagai transaksi, mengekstrak...' }
          : e
      )
    );

    try {
      // Gunakan body yang tersimpan jika ada, atau gunakan subject/from sebagai fallback
      const emailBody = email.body || `${email.subject}\n${email.from}\n${email.description || ''}`;

      const result = await processSingleEmail({
        id: email.id,
        subject: email.subject,
        from: email.from,
        date: email.date,
        body: emailBody,
        threadId: '',
      });

      // Pertahankan body asli
      const resultWithBody = { ...result, body: email.body || emailBody };
      setEmails((prev) => prev.map((e) => (e.id === emailId ? resultWithBody : e)));

      if (result.status === 'pending_review') {
        addToast({ type: 'success', title: 'Ekstraksi berhasil', message: 'Transaksi ditemukan dan menunggu review.' });
      }
    } catch (err) {
      // If extraction fails, set as pending_review with original data
      setEmails((prev) =>
        prev.map((e) =>
          e.id === emailId
            ? { ...e, status: 'pending_review' as SyncEmailStatus, reason: 'Menunggu review manual (ditandai user)' }
            : e
        )
      );
    }
  };

  const handleApproveEmail = async (emailId: string) => {
    const email = emails.find((item) => item.id === emailId);
    if (!email || !firebaseUser || !email.amount) return;

    try {
      await addTransaction(
        firebaseUser.uid,
        {
          type: email.transactionType || 'expense',
          amount: email.amount!,
          categoryId: slugify(email.category || 'Lainnya'),
          categoryName: email.category || 'Lainnya',
          merchant: email.merchant || email.from,
          paymentMethod: normalizePaymentMethod(email.paymentMethod ?? undefined),
          note: noteEditState[emailId] ?? email.note ?? email.description ?? email.subject,
          date: normalizeDate(email.date),
        },
        'gmail',
        email.id,
        email.confidence ?? undefined
      );

      // Clear note edit state for this email
      setNoteEditState((prev) => {
        const next = { ...prev };
        delete next[emailId];
        return next;
      });

      setEmails((prev) =>
        prev.map((e) => (e.id === emailId ? { ...e, status: 'approved' as SyncEmailStatus } : e))
      );
      addToast({ type: 'success', title: 'Transaksi Gmail berhasil disimpan' });
    } catch (approveError) {
      if (approveError instanceof DuplicateTransactionError) {
        setEmails((prev) =>
          prev.map((e) => (e.id === emailId ? { ...e, status: 'duplicate' as SyncEmailStatus, reason: 'Transaksi serupa sudah pernah disimpan' } : e))
        );
        addToast({
          type: 'warning',
          title: 'Transaksi duplikat',
          message: 'Email ini tidak disimpan karena transaksi serupa sudah ada.',
        });
        return;
      }

      addToast({
        type: 'error',
        title: 'Gagal menyimpan transaksi',
        message: approveError instanceof Error ? approveError.message : undefined,
      });
    }
  };

  const handleRejectEmail = (emailId: string) => {
    setEmails((prev) =>
      prev.map((e) => (e.id === emailId ? { ...e, status: 'rejected' as SyncEmailStatus, reason: 'Ditolak oleh user' } : e))
    );
  };

  /**
   * Parse failed email using fallback regex parser directly
   */
  const handleParseWithFallback = async (emailId: string) => {
    const email = emails.find((e) => e.id === emailId);
    if (!email) return;

    const fallbackResult = buildFallbackTransactionFromEmail(
      email.from,
      email.subject,
      email.body || email.description || email.subject,
      email.date,
    );

    if (fallbackResult.finalStatus === 'skipped') {
      const skippedEmail: SyncEmail = {
        ...email,
        status: 'skipped',
        amount: null,
        confidence: null,
        merchant: null,
        category: null,
        paymentMethod: null,
        reason: fallbackResult.reason,
        debug: {
          ...email.debug,
          aiParsedSuccessful: false,
          finalStatus: 'skipped',
          fallbackUsed: false,
          extractedAmount: null,
          errorDetail: fallbackResult.reason,
          aiErrorCode: fallbackResult.errorCode,
          skipReason: fallbackResult.errorCode === 'PROMO_CASHBACK_SKIPPED' ? 'promo_cashback' : email.debug?.skipReason,
          matchedRule: fallbackResult.matchedRule,
          detectedPromoAmount: fallbackResult.detectedPromoAmount,
          amountIgnored: fallbackResult.amountIgnored,
          modelUsed: email.debug?.modelUsed,
        } as SyncEmailDebug,
      };

      setEmails((prev) => prev.map((e) => (e.id === emailId ? skippedEmail : e)));
      await persistGmailSyncResults(firebaseUser?.uid, [skippedEmail]);
      addToast({ type: 'info', title: 'Email dilewati', message: 'Promo cashback, bukan transaksi aktual.' });
      return;
    }

    if (fallbackResult.success && fallbackResult.data) {
      const extracted = fallbackResult.data;
      const amount = typeof extracted.amount === 'number' && extracted.amount >= 1000 ? extracted.amount : null;

      // Generate note dari builder
      const fallbackNote = buildTransactionNote({
        subject: email.subject,
        sender: email.from,
        merchant: extracted.merchant || null,
        category: extracted.category || null,
        amount: amount,
        transactionType: normalizeTransactionType(extracted.transaction_type) || null,
        paymentMethod: extracted.payment_method || null,
        aiNote: null,
        aiDescription: extracted.description || null,
        fallbackNote: extracted.reason || null,
        body: email.body || '',
      });

      setEmails((prev) =>
        prev.map((e) =>
          e.id === emailId
            ? {
                ...e,
                status: amount ? 'pending_review' as SyncEmailStatus : 'skipped' as SyncEmailStatus,
                amount,
                confidence: extracted.confidence_score,
                merchant: extracted.merchant || email.from,
                category: extracted.category || 'Lainnya',
                paymentMethod: extracted.payment_method || 'Lainnya',
                transactionType: normalizeTransactionType(extracted.transaction_type),
                description: `Diparse via fallback: ${extracted.reason || 'Fallback berhasil'}`,
                note: fallbackNote,
                extracted,
                reason: amount ? 'Menunggu review (diparse via fallback)' : 'Dilewati: nominal tidak ditemukan',
                debug: {
                  ...e.debug,
                  aiParsedSuccessful: true,
                  finalStatus: amount ? 'pending_review' : 'skipped',
                  fallbackUsed: true,
                  extractedAmount: amount,
                  errorDetail: 'Fallback regex berhasil',
                  confidenceScore: extracted.confidence_score ?? null,
                  modelUsed: e.debug?.modelUsed,
                } as SyncEmailDebug,
              }
            : e
        )
      );

      if (amount) {
        addToast({ type: 'success', title: 'Fallback berhasil', message: 'Transaksi ditemukan menggunakan fallback parser.' });
      } else {
        addToast({ type: 'info', title: 'Fallback gagal', message: 'Tidak ditemukan nominal transaksi.' });
      }
    } else {
      setEmails((prev) =>
        prev.map((e) =>
          e.id === emailId
            ? { ...e, status: 'skipped' as SyncEmailStatus, reason: `Dilewati: ${fallbackResult.reason}` }
            : e
        )
      );
      addToast({ type: 'info', title: 'Fallback gagal', message: fallbackResult.reason });
    }
  };

  /**
   * Skip/tandai dilewati email
   */
  const handleSkipEmail = (emailId: string) => {
    setEmails((prev) =>
      prev.map((e) =>
        e.id === emailId
          ? { ...e, status: 'skipped' as SyncEmailStatus, reason: 'Dilewati oleh user' }
          : e
      )
    );
    addToast({ type: 'info', title: 'Email dilewati' });
  };

  const handleResetScan = () => {
    setEmails([]);
    setScannedCount(0);
    setError(null);
    setProgress('');
    processedIdsRef.current = new Set();
    setNoteEditState({});
    addToast({ type: 'info', title: 'Hasil scan direset' });
  };

  /**
   * Retry all previously failed emails from Supabase + Gmail API
   */
  const handleRetryFailedEmails = async () => {
    if (!firebaseUser) return;

    setIsScanning(true);
    setProgress('Mengambil data email gagal dari database...');
    setError(null);
    setSyncProgress(null);
    syncProgressRef.current = null;

    // Buat sync run untuk retry
    let retrySyncRunId: string | null = null;
    const todayStr = new Date().toISOString().split('T')[0];
    const run = await createSyncRun(firebaseUser.uid, {
      syncType: 'retry_failed',
      dateFrom: '2026-01-01',
      dateTo: todayStr,
    });
    retrySyncRunId = run?.id || null;
    if (retrySyncRunId) setActiveSyncRunId(retrySyncRunId);

    try {
      startSyncProgress(retrySyncRunId, {
        currentStep: 'preparing',
      });

      // Step 1: Query Supabase untuk messageId yang failed
      const failedEmails = await getFailedEmailIds(firebaseUser.uid, 200);

      if (failedEmails.length === 0) {
        const completedProgress = applySyncProgress({
          status: 'completed',
          currentStep: 'completed',
          totalFound: 0,
          totalEstimated: 0,
          totalProcessed: 0,
          finishedAt: new Date().toISOString(),
        }, retrySyncRunId, { forcePersist: true });
        if (retrySyncRunId) {
          await finishSyncRun(retrySyncRunId, {
            status: 'completed',
            totalFound: 0,
            totalProcessed: 0,
            autoAcceptedCount: 0,
            pendingReviewCount: 0,
            skippedCount: 0,
            rejectedCount: 0,
            duplicateCount: 0,
            failedCount: 0,
            retryLaterCount: 0,
            configErrorCount: 0,
            metadata: getProgressMetadata(completedProgress),
          });
          setActiveSyncRunId(null);
          void loadSyncRuns();
        }
        addToast({ type: 'info', title: 'Tidak ada email gagal', message: 'Tidak ditemukan email dengan status failed di database.' });
        setIsScanning(false);
        setProgress('');
        return;
      }

      setProgress(`Mengambil ${failedEmails.length} email dari Gmail...`);
      applySyncProgress({
        currentStep: 'fetching_gmail',
        totalFound: failedEmails.length,
        totalEstimated: failedEmails.length,
      }, retrySyncRunId, { forcePersist: true });

      const messageIds = failedEmails;
      const gmailEmails = await fetchEmailsById(messageIds, (gmailProgress) => {
        applySyncProgress({
          currentStep: 'fetching_gmail',
          totalFound: gmailProgress.totalFound,
          totalEstimated: gmailProgress.totalEstimated,
          totalProcessed: gmailProgress.detailsFetched,
        }, retrySyncRunId);
      });

      if (gmailEmails.length === 0) {
        const failedProgress = applySyncProgress({
          status: 'failed',
          currentStep: 'failed',
          totalFound: failedEmails.length,
          totalEstimated: failedEmails.length,
          totalProcessed: 0,
          failedCount: failedEmails.length,
          finishedAt: new Date().toISOString(),
          warningMessage: 'Tidak bisa mengambil email dari Gmail. Periksa koneksi dan izin akses.',
        }, retrySyncRunId, { forcePersist: true });
        if (retrySyncRunId) {
          await finishSyncRun(retrySyncRunId, {
            status: 'failed',
            totalFound: failedEmails.length,
            totalProcessed: 0,
            autoAcceptedCount: 0,
            pendingReviewCount: 0,
            skippedCount: 0,
            rejectedCount: 0,
            duplicateCount: 0,
            failedCount: failedEmails.length,
            retryLaterCount: 0,
            configErrorCount: 0,
            errorCode: 'GMAIL_FETCH_EMPTY',
            errorMessage: 'Tidak bisa mengambil email dari Gmail.',
            metadata: getProgressMetadata(failedProgress),
          });
          setActiveSyncRunId(null);
          void loadSyncRuns();
        }
        addToast({ type: 'error', title: 'Gagal', message: 'Tidak bisa mengambil email dari Gmail. Periksa koneksi dan izin akses.' });
        setIsScanning(false);
        setProgress('');
        return;
      }

      setProgress(`Memproses ${gmailEmails.length} email dengan AI...`);
      applySyncProgress({
        currentStep: 'extracting_ai',
        totalFound: gmailEmails.length,
        totalEstimated: gmailEmails.length,
        totalProcessed: 0,
        aiQueueCount: gmailEmails.length,
        currentBatch: gmailEmails.length > 0 ? 1 : 0,
        totalBatches: Math.ceil(gmailEmails.length / AI_BATCH_SIZE),
      }, retrySyncRunId, { forcePersist: true });

      // Step 3: Proses dengan pipeline baru
      const retryResultsBuffer: SyncEmail[] = [];
      const results = await processBatchWithConcurrency(
        gmailEmails,
        AI_CONCURRENCY,
        async (email, index, total) => {
          setProgress(`Mengekstrak ${index + 1} dari ${total} dengan AI...`);
          return await processSingleEmail(email);
        },
        (result, _index, completed, total) => {
          retryResultsBuffer.push(result);
          const stats = calculateStats(retryResultsBuffer);
          const totalBatches = Math.ceil(total / AI_BATCH_SIZE);
          applySyncProgress({
            currentStep: result.debug?.fallbackUsed ? 'fallback_parsing' : 'extracting_ai',
            totalProcessed: completed,
            aiProcessedCount: completed,
            fallbackProcessedCount: retryResultsBuffer.filter((email) => email.debug?.fallbackUsed).length,
            attachmentProcessedCount: retryResultsBuffer.filter(didUseAttachmentExtraction).length,
            currentBatch: Math.min(totalBatches, Math.max(1, Math.ceil(completed / AI_BATCH_SIZE))),
            totalBatches,
            autoAcceptedCount: stats.autoAcceptedCount,
            needsReviewCount: stats.pendingReview,
            autoSkippedCount: stats.skipped,
            autoRejectedCount: stats.autoRejected,
            duplicateCount: stats.duplicate,
            retryLaterCount: stats.retryLater,
            failedCount: stats.failed,
            warningMessage: result.status === 'retry_later' ? 'Proses lebih lama karena retry/rate limit.' : null,
          }, retrySyncRunId);
        }
      );

      const nextEmails = mergeEmailResults(emails, results);
      setEmails(nextEmails);
      applySyncProgress({
        currentStep: 'saving_results',
        totalProcessed: results.length,
      }, retrySyncRunId, { forcePersist: true });
      await persistGmailSyncResults(firebaseUser.uid, results, retrySyncRunId);

      // Update processedIds
      results.forEach((email) => {
        if (email.status !== 'retry_later') {
          processedIdsRef.current.add(email.id);
        }
      });

      // Summary
      const retryStats = calculateStats(results);
      const nextStats = calculateStats(nextEmails);
      const finalRetryProgress = applySyncProgress({
        status: retryStats.failed > 0 || retryStats.configError > 0 ? 'partial_failed' : 'completed',
        currentStep: retryStats.failed > 0 || retryStats.configError > 0 ? 'partial_failed' : 'completed',
        totalFound: gmailEmails.length,
        totalEstimated: gmailEmails.length,
        totalProcessed: retryStats.processed,
        autoAcceptedCount: retryStats.autoAcceptedCount,
        needsReviewCount: retryStats.pendingReview,
        autoSkippedCount: retryStats.skipped,
        autoRejectedCount: retryStats.autoRejected,
        duplicateCount: retryStats.duplicate,
        retryLaterCount: retryStats.retryLater,
        failedCount: retryStats.failed,
        finishedAt: new Date().toISOString(),
      }, retrySyncRunId, { forcePersist: true });
      const successCount = retryStats.pendingReview;
      const skipCount = retryStats.skipped + retryStats.autoRejected;
      const failCount = retryStats.failed;

      addToast({
        type: successCount > 0 ? 'success' : 'info',
        title: `Retry selesai: ${gmailEmails.length} email`,
        message: `${successCount} berhasil, ${skipCount} dilewati, ${failCount} gagal, ${retryStats.retryLater} retry later.`,
      });
      void triggerGmailSyncNotification(firebaseUser.uid, {
        pendingCount: nextStats.pendingReview - nextStats.autoAcceptedCount,
        autoAcceptedCount: nextStats.autoAcceptedCount,
        autoSkippedCount: nextStats.skipped,
        autoRejectedCount: nextStats.autoRejected,
        failedCount: nextStats.failed,
        retryLaterCount: nextStats.retryLater,
        configErrorCount: nextStats.configError,
        lastBatchId: `retry-failed-${Date.now()}`,
      });

      // Finish retry sync run
      if (retrySyncRunId) {
        await finishSyncRun(retrySyncRunId, {
          status: retryStats.failed > 0 || retryStats.configError > 0 ? 'partial_failed' : 'completed',
          totalFound: gmailEmails.length,
          totalProcessed: retryStats.processed,
          autoAcceptedCount: retryStats.autoAcceptedCount,
          pendingReviewCount: retryStats.pendingReview,
          skippedCount: retryStats.skipped + retryStats.autoRejected,
          rejectedCount: retryStats.rejected,
          duplicateCount: retryStats.duplicate,
          failedCount: retryStats.failed,
          retryLaterCount: retryStats.retryLater,
          configErrorCount: retryStats.configError,
          metadata: getProgressMetadata(finalRetryProgress),
        });
        setActiveSyncRunId(null);
        void loadSyncRuns();
      }

      setScannedCount((prev) => prev + gmailEmails.length);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Gagal meretry email';
      // Finish retry sync run as failed
      if (retrySyncRunId) {
        const failedProgress = applySyncProgress({
          status: 'failed',
          currentStep: 'failed',
          finishedAt: new Date().toISOString(),
          warningMessage: message,
        }, retrySyncRunId, { forcePersist: true });
        await finishSyncRun(retrySyncRunId, {
          status: 'failed',
          totalFound: 0,
          totalProcessed: 0,
          autoAcceptedCount: 0,
          pendingReviewCount: 0,
          skippedCount: 0,
          rejectedCount: 0,
          duplicateCount: 0,
          failedCount: 0,
          retryLaterCount: 0,
          configErrorCount: 0,
          errorCode: 'RETRY_ERROR',
          errorMessage: message,
          metadata: getProgressMetadata(failedProgress),
        });
        setActiveSyncRunId(null);
        void loadSyncRuns();
      }
      setError(message);
      addToast({ type: 'error', title: 'Gagal retry', message });
    } finally {
      setIsScanning(false);
      setProgress('');
    }
  };

  const toggleExpandEmail = (emailId: string) => {
    setExpandedEmail((prev) => (prev === emailId ? null : emailId));
  };

  // ===================== Load Paginated Results from Supabase =====================
  // Hasil scan dimuat dari Supabase dengan pagination agar tetap tersimpan
  // meskipun user pindah halaman, refresh browser, atau logout-login.
  // Maksimal 100 email per halaman. Semua halaman bisa diakses via pagination.
  const loadPaginatedResults = useCallback(async (_syncRunId?: string | null, page?: number) => {
    if (!firebaseUser?.uid) return;
    const targetPage = page || logsCurrentPage;
    // Tandai request ini sebagai yang terbaru; response stale (id != terbaru)
    // akan diabaikan agar tidak menimpa hasil request yang lebih baru.
    const requestId = ++paginatedRequestIdRef.current;

    setLogsLoading(true);
    setLogsError(null);
    try {
      // Tampilkan hasil lintas SEMUA sync run (syncRunId diabaikan) —
      // baik filter 'all' maupun status tertentu. Server menerapkan filter
      // status; list count selalu cocok dengan summary counter.
      const statusFilter = filterStatus === 'all' ? null : filterStatus;

      const result = await getGmailSyncLogsPaginated(firebaseUser.uid, {
        page: targetPage,
        pageSize: LOGS_PAGE_SIZE,
        syncRunId: null,
        status: statusFilter,
        sortBy: 'email_date',
        sortOrder: 'desc',
      });
      // Abaikan response stale (request yang lebih baru sudah terlanjur jalan)
      if (requestId !== paginatedRequestIdRef.current) return;
      setPaginatedLogs(result);
      setLogsCurrentPage(targetPage);
      // Populasi state in-memory agar summary cards & filter bar tetap tampil
      // meskipun halaman di-refresh (email diambil dari log Supabase)
      if (result.data.length > 0) {
        setEmails((prev) => {
          if (prev.length > 0) return prev;
          return result.data.map((log) => ({
            id: log.messageId,
            subject: log.subject,
            from: log.sender,
            date: log.emailDate || log.scannedAt.toISOString(),
            status: log.status,
            confidence: log.confidenceScore ?? null,
            note: log.extractedNote || null,
            reason: log.errorMessage || undefined,
          }));
        });
      }
    } catch (err) {
      // Abaikan error dari response stale
      if (requestId !== paginatedRequestIdRef.current) return;
      const message = err instanceof Error ? err.message : 'Gagal memuat hasil scan';
      setLogsError(message);
      logger.warn('[GmailSync] Gagal memuat hasil paginated:', err);
    } finally {
      // Hanya request TERBARU yang berhak menurunkan loading flag — request
      // stale yang selesai belakangan tidak boleh menimpa state/loading request
      // yang lebih baru (anti-flaky + anti-flicker).
      if (requestId === paginatedRequestIdRef.current) {
        setLogsLoading(false);
      }
    }
  }, [firebaseUser?.uid, logsCurrentPage, filterStatus]);

  // Muat hasil scan terbaru saat halaman pertama kali dibuka
  // Riwayat hasil scan tetap ada meskipun user pindah halaman/refresh/logout-login
  useEffect(() => {
    if (!firebaseUser?.uid) return;
    // Muat hasil dari sync run terakhir yang selesai. Jika belum ada sync run,
    // tetap muat SEMUA log lintas run — loadPaginatedResults mengabaikan syncRunId
    // dan menampilkan seluruh hasil dari gmail_sync_logs (termasuk summary cards).
    const latestCompleted = syncRuns.find(r => r.status === 'completed' || r.status === 'partial_failed');
    const targetRun = latestCompleted || syncRuns[0];
    setSelectedSyncRunId(targetRun?.id ?? null);
    void loadPaginatedResults(targetRun?.id ?? null, 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncRuns, firebaseUser?.uid]);

  // Reload paginated results when filter changes
  useEffect(() => {
    if (paginatedLogs && firebaseUser?.uid) {
      void loadPaginatedResults(selectedSyncRunId, 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterStatus]);

  const handlePageChange = useCallback(async (newPage: number) => {
    if (newPage < 1 || (paginatedLogs && newPage > paginatedLogs.totalPages)) return;
    setLogsCurrentPage(newPage);
    if (firebaseUser?.uid) {
      await loadPaginatedResults(selectedSyncRunId, newPage);
    }
  }, [firebaseUser?.uid, loadPaginatedResults, selectedSyncRunId, paginatedLogs]);

  // ===================== Computed =====================

  // Ringkasan summary cards dihitung dari TOTAL semua email (via paginatedLogs.summary,
  // yang dihitung service dari seluruh dataset sebelum pagination), bukan hanya halaman
  // pertama. Fallback ke perhitungan dari emails saat paginatedLogs belum dimuat.
  const summaryCounts = paginatedLogs?.summary ?? {
    autoAccepted: emails.filter((e) => e.status === 'auto_accepted').length,
    needsReview: emails.filter((e) => e.status === 'needs_review' || e.status === 'pending_review').length,
    skippedRejected: emails.filter((e) => ['auto_skipped', 'auto_rejected', 'skipped', 'rejected'].includes(e.status)).length,
    error: emails.filter((e) => ['failed', 'retry_later', 'config_error', 'paused_config_error'].includes(e.status)).length,
    total: emails.length,
  };

  const canScanAgain = !isScanning && emails.length > 0;

  // ===================== Render =====================

  return (
    <div>
      <Header title="Gmail Sync" />

      <div className="p-4 lg:p-6 space-y-5 max-w-4xl mx-auto">
        {/* Connect section */}
        <Card>
          <div className="flex items-start gap-4">
            <div className={cn(
              'w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0',
              isConnected
                ? 'bg-mint-50 dark:bg-mint-500/12'
                : 'bg-app-hover/80'
            )}>
              <Mail className={cn(
                'w-6 h-6',
                isConnected ? 'text-mint-500' : 'text-app-subtle'
              )} />
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-app-text mb-1">
                {isConnected ? 'Gmail Terhubung' : 'Hubungkan Gmail'}
              </h3>
              <p className="text-xs text-app-muted mb-3">
                {isConnected
                  ? 'CashFlow memindai email terbaru terlebih dahulu, lalu mundur sampai 1 Januari 2026.'
                  : 'Hubungkan akun Gmail untuk mendeteksi transaksi secara otomatis'}
              </p>
              {!isConnected ? (
                <Button variant="primary" size="sm" onClick={handleConnectGmail}>
                  Hubungkan Gmail
                </Button>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="flex items-center gap-1 text-xs text-mint-500">
                    <CheckCircle className="w-3 h-3" />
                    Terhubung
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={isScanning}
                    icon={<RefreshCw className="w-4 h-4" />}
                    onClick={handleScanEmails}
                  >
                    {isScanning ? 'Memindai...' : 'Scan Email'}
                  </Button>
                  {canScanAgain && (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<RotateCcw className="w-4 h-4" />}
                        onClick={handleResetScan}
                      >
                        Reset Hasil
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<RotateCcw className="w-4 h-4" />}
                        loading={isScanning}
                        onClick={handleRetryFailedEmails}
                      >
                        Retry Failed
                      </Button>
                    </>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      clearGmailAccessToken();
                      setHasPermission(false);
                      addToast({ type: 'info', title: 'Token Gmail direset', message: 'Klik Hubungkan Gmail untuk meminta izin ulang.' });
                    }}
                  >
                    Reset Izin
                  </Button>
                </div>
              )}
            </div>
          </div>
        </Card>

        {/* Progress indicator */}
        {isScanning && syncProgress ? (
          <GmailSyncEtaCard progress={syncProgress} />
        ) : isScanning && progress ? (
          <Card variant="outlined">
            <div className="flex items-center gap-3">
              <Loader2 className="w-4 h-4 animate-spin text-primary-500" />
              <p className="text-xs text-app-muted">{progress}</p>
            </div>
          </Card>
        ) : null}

        {/* Error state */}
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl p-4 bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-800/20"
          >
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-red-800 dark:text-red-300">Error</p>
                <p className="text-xs text-red-600 dark:text-red-400 mt-1">{error}</p>
              </div>
            </div>
          </motion.div>
        )}

        {/* Gemini health / config error banner */}
        {geminiHealth && !geminiHealth.ok && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl p-4 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/30"
          >
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                  Konfigurasi AI Bermasalah
                </p>
                <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                  {geminiHealth.message}
                </p>
                <p className="text-[10px] text-amber-600 dark:text-amber-500 mt-2">
                  Untuk menggunakan Gmail Sync dengan AI:
                </p>
                <ol className="text-[10px] text-amber-600 dark:text-amber-500 mt-1 list-decimal list-inside space-y-0.5">
                  <li>Buka Google Cloud Console → Pilih project → Aktifkan Generative Language API</li>
                  <li>Buat atau gunakan API key yang sudah ada</li>
                  <li>Isi <code className="bg-amber-100 dark:bg-amber-800/30 px-1 rounded">GEMINI_API_KEY</code> di file <code className="bg-amber-100 dark:bg-amber-800/30 px-1 rounded">server/.env</code></li>
                  <li>Jalankan <code className="bg-amber-100 dark:bg-amber-800/30 px-1 rounded">npm run dev:server</code> di terminal</li>
                  <li>Refresh halaman ini dan coba Scan Email lagi</li>
                </ol>
              </div>
            </div>
          </motion.div>
        )}

        {/* Gemini health status indicator */}
        {geminiHealth && geminiHealth.ok && (
          <Card variant="outlined">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-mint-500" />
              <span className="text-xs text-app-muted">
                Gemini AI siap digunakan
              </span>
            </div>
          </Card>
        )}

        {/* Auto Sync Status — integrated component */}
        {isConnected && firebaseUser?.uid && (
          <AutoSyncStatus
            userId={firebaseUser.uid}
            gmailSyncEnabled={gmailSyncEnabled}
            onToggle={(enabled) => {
              setGmailSyncEnabled(enabled);
              addToast({
                type: 'info',
                title: enabled ? 'Auto Sync Aktif' : 'Auto Sync Nonaktif',
                message: enabled
                  ? 'CashFlow akan mengecek email transaksi secara berkala saat aplikasi aktif.'
                  : 'Pengecekan otomatis dihentikan. Kamu tetap bisa scan manual.',
              });
            }}
          />
        )}

        {/* Summary cards — dihitung dari total semua email (bukan hanya halaman pertama) */}
        {(emails.length > 0 || (paginatedLogs && paginatedLogs.summary.total > 0)) && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <StatCard label="Diterima" value={summaryCounts.autoAccepted} color="text-mint-500" />
            <StatCard label="Perlu Review" value={summaryCounts.needsReview} color="text-amber-500" />
            <StatCard label="Dilewati/Ditolak" value={summaryCounts.skippedRejected} color="text-app-subtle" />
            <StatCard label="Error" value={summaryCounts.error} color="text-red-500" />
          </div>
        )}

        {/* Filter bar */}
        {emails.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <Filter className="w-3.5 h-3.5 text-app-subtle" />
            {(['all', 'auto_accepted', 'needs_review', 'approved', 'auto_skipped', 'auto_rejected', 'failed', 'retry_later', 'duplicate', 'paused_config_error'] as const).map((status) => (
              <button
                key={status}
                onClick={() => setFilterStatus(status)}
                className={cn(
                  'px-2.5 py-1 rounded-lg text-[10px] font-medium transition-all',
                  filterStatus === status
                    ? 'bg-primary-50 dark:bg-primary-500/12 text-primary-600 dark:text-primary-200'
                    : 'text-app-subtle hover:text-app-text'
                )}
              >
                {status === 'all' ? 'Semua' : STATUS_CONFIG[status]?.label || status}
              </button>
            ))}
          </div>
        )}

        {/* Loading state untuk paginated results */}
        {logsLoading && (
          <Card variant="outlined">
            <div className="flex items-center gap-3">
              <Loader2 className="w-4 h-4 animate-spin text-primary-500" />
              <p className="text-xs text-app-muted">Memuat hasil scan...</p>
            </div>
          </Card>
        )}

        {/* Error state untuk paginated results */}
        {logsError && !logsLoading && (
          <div className="rounded-2xl p-4 bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-800/20">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium text-red-800 dark:text-red-300">Gagal memuat hasil scan</p>
                <p className="text-xs text-red-600 dark:text-red-400 mt-1">{logsError}</p>
              </div>
              <button
                onClick={() => loadPaginatedResults(selectedSyncRunId, logsCurrentPage)}
                className="text-xs font-medium text-red-600 dark:text-red-400 hover:text-red-800 flex items-center gap-1"
              >
                <RefreshCw className="w-3 h-3" />
                Coba Lagi
              </button>
            </div>
          </div>
        )}

        {/* Email list — menampilkan hasil dari Supabase dengan pagination 100 per halaman */}
        {!logsLoading && !logsError && paginatedLogs && paginatedLogs.data.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-app-text">
                {filterStatus === 'all' ? `Hasil Scan Email` : STATUS_CONFIG[filterStatus]?.label}
              </h3>
              <span className="text-[10px] text-app-muted">
                Menampilkan {Math.min((paginatedLogs.page - 1) * paginatedLogs.pageSize + 1, paginatedLogs.total)}-{Math.min(paginatedLogs.page * paginatedLogs.pageSize, paginatedLogs.total)} dari {paginatedLogs.total} email
              </span>
            </div>
            {paginatedLogs.data.map((log, i) => {
              // Map dari GmailSyncLog ke SyncEmail untuk EmailCard
              // Gunakan log.messageId (Gmail message ID) sebagai id agar cocok dengan in-memory emails state
              const email: SyncEmail = {
                id: log.messageId,
                subject: log.subject,
                from: log.sender,
                date: log.emailDate || log.scannedAt.toISOString(),
                status: log.status,
                confidence: log.confidenceScore ?? null,
                note: log.extractedNote || null,
                reason: log.errorMessage || (log.status === 'auto_skipped' || log.status === 'auto_rejected' || log.status === 'skipped' || log.status === 'rejected'
                  ? log.metadata?.skipReason as string | undefined
                  : undefined),
              };
              return (
                <EmailCard
                  key={`${log.messageId}-${log.status}`}
                  email={email}
                  index={i}
                  isExpanded={expandedEmail === log.messageId}
                  showDebug={showDebug}
                  noteEditState={noteEditState}
                  onNoteChange={(emailId, value) => setNoteEditState((prev) => ({ ...prev, [emailId]: value }))}
                  onToggleExpand={() => toggleExpandEmail(log.messageId)}
                  onApprove={() => handleApproveEmail(log.messageId)}
                  onReject={() => handleRejectEmail(log.messageId)}
                  onRetry={() => handleRetrySingle(log.messageId)}
                  onMarkAsTransaction={() => handleMarkAsTransaction(log.messageId)}
                  onParseWithFallback={() => handleParseWithFallback(log.messageId)}
                  onSkip={() => handleSkipEmail(log.messageId)}
                />
              );
            })}
          </div>
        )}

        {/* Pagination controls — maksimal 100 per halaman */}
        {paginatedLogs && paginatedLogs.totalPages > 1 && (
          <div className="flex items-center justify-between px-1 py-2">
            <button
              onClick={() => handlePageChange(paginatedLogs.page - 1)}
              disabled={!paginatedLogs.hasPreviousPage || logsLoading}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
                paginatedLogs.hasPreviousPage && !logsLoading
                  ? 'text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-500/12'
                  : 'text-app-subtle cursor-not-allowed opacity-50'
              )}
            >
              ← Sebelumnya
            </button>

            <span className="text-xs text-app-muted">
              Halaman {paginatedLogs.page} dari {paginatedLogs.totalPages}
            </span>

            <button
              onClick={() => handlePageChange(paginatedLogs.page + 1)}
              disabled={!paginatedLogs.hasNextPage || logsLoading}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
                paginatedLogs.hasNextPage && !logsLoading
                  ? 'text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-500/12'
                  : 'text-app-subtle cursor-not-allowed opacity-50'
              )}
            >
              Berikutnya →
            </button>
          </div>
        )}

        {/* Empty / initial state */}
        {isConnected && emails.length === 0 && !isScanning && !error && (
          <EmptyState
            icon={<Mail className="w-8 h-8" />}
            title="Belum ada scan"
            description="Tekan tombol Scan Email untuk mulai mendeteksi transaksi dari Gmail. Email promo dan newsletter akan ditolak otomatis."
            action={
              <Button
                variant="primary"
                size="sm"
                icon={<RefreshCw className="w-4 h-4" />}
                onClick={handleScanEmails}
              >
                Scan Email
              </Button>
            }
          />
        )}

        {/* Debug toggle */}          {emails.length > 0 && (
          <div className="flex items-center justify-between">
            <button
              onClick={() => setShowDebug(!showDebug)}
              className="flex items-center gap-1.5 text-[10px] text-app-subtle hover:text-app-text transition-colors"
            >
              {showDebug ? (
                <><EyeOff className="w-3 h-3" /> Sembunyikan Debug</>
              ) : (
                <><Bug className="w-3 h-3" /> Tampilkan Debug Info</>
              )}
            </button>
            <span className="text-[10px] text-app-subtle">{emails.length} email</span>
          </div>
        )}

        {/* Riwayat Sync — Data dari Supabase, tetap ada setelah pindah halaman/refresh/logout */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-app-subtle" />
            <h3 className="text-sm font-semibold text-app-text">Riwayat Sinkronisasi</h3>
          </div>

          {/* Date Range Info */}
          {dateRange.start && (
            <Card variant="outlined">
              <div className="flex items-center gap-3">
                <Calendar className="w-4 h-4 text-primary-500" />
                <div className="text-xs">
                  <span className="text-app-muted">Range data: </span>
                  <span className="font-medium text-app-text">{dateRange.start}</span>
                  <span className="text-app-muted"> sampai </span>
                  <span className="font-medium text-app-text">{dateRange.end}</span>
                  <span className="text-app-muted"> · Urutan: terbaru ke terlama</span>
                </div>
              </div>
            </Card>
          )}

          {/* Loading State */}
          {syncRunsLoading && (
            <Card variant="outlined">
              <div className="flex items-center gap-3">
                <Loader2 className="w-4 h-4 animate-spin text-primary-500" />
                <p className="text-xs text-app-muted">Memuat riwayat sinkronisasi...</p>
              </div>
            </Card>
          )}

          {/* Error State */}
          {historyError && !syncRunsLoading && (
            <div className="rounded-2xl p-4 bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-800/20">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-red-800 dark:text-red-300">Gagal memuat riwayat</p>
                  <p className="text-xs text-red-600 dark:text-red-400 mt-1">{historyError}</p>
                </div>
                <button
                  onClick={() => void loadSyncRuns()}
                  className="text-xs font-medium text-red-600 dark:text-red-400 hover:text-red-800 flex items-center gap-1"
                >
                  <RefreshCw className="w-3 h-3" />
                  Coba Lagi
                </button>
              </div>
            </div>
          )}

          {/* Empty State — Belum pernah sync */}
          {!syncRunsLoading && !historyError && syncRuns.length === 0 && (
            <EmptyState
              icon={<History className="w-8 h-8" />}
              title="Belum ada riwayat sinkronisasi"
              description="Mulai scan Gmail untuk memindai email transaksi dari terbaru sampai 1 Januari 2026."
              action={
                !isScanning && isConnected ? (
                  <Button
                    variant="primary"
                    size="sm"
                    icon={<RefreshCw className="w-4 h-4" />}
                    onClick={handleScanEmails}
                  >
                    Scan Email Sekarang
                  </Button>
                ) : null
              }
            />
          )}

          {/* Sync Runs List */}
          {!syncRunsLoading && syncRuns.length > 0 && (
            <div className="space-y-2">
              {syncRuns.map((run) => {
                const isExpanded = expandedRunId === run.id;
                const totalActionable = run.failedCount + run.retryLaterCount + run.configErrorCount;
                const runDuration = run.finishedAt
                  ? Math.round((new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()) / 1000)
                  : null;
                const runProgress = isGmailSyncProgress(run.metadata?.progress)
                  ? deriveGmailSyncProgress(run.metadata.progress, {
                      syncRunId: run.id,
                      status: run.status === 'running' ? 'running' : run.metadata.progress.status,
                    })
                  : null;

                return (
                  <motion.div
                    key={run.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                  >
                    <Card>
                      <div className="space-y-3">
                        {/* Header row */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 min-w-0">
                            {/* Status dot */}
                            <span className={cn(
                              'w-2 h-2 rounded-full flex-shrink-0',
                              run.status === 'completed' ? 'bg-mint-500' :
                              run.status === 'running' || run.id === activeSyncRunId ? 'bg-blue-500 animate-pulse' :
                              run.status === 'partial_failed' ? 'bg-amber-500' :
                              run.status === 'failed' ? 'bg-red-500' :
                              'bg-app-subtle'
                            )} />
                            {/* Sync type label */}
                            <span className="text-xs font-semibold text-app-text">
                              {getSyncTypeLabel(run.syncType)}
                            </span>
                            {/* Status badge */}
                            <span className={cn(
                              'text-[10px] font-medium px-1.5 py-0.5 rounded-full',
                              run.status === 'completed' ? 'text-mint-500 bg-mint-50 dark:bg-mint-500/12' :
                              run.status === 'running' || run.id === activeSyncRunId ? 'text-blue-500 bg-blue-50 dark:bg-blue-500/12' :
                              run.status === 'partial_failed' ? 'text-amber-500 bg-amber-50 dark:bg-amber-500/12' :
                              run.status === 'failed' ? 'text-red-500 bg-red-50 dark:bg-red-500/12' :
                              'text-app-subtle bg-app-hover/80'
                            )}>
                              {getSyncStatusLabel(run.status)}
                            </span>
                          </div>
                          {/* Date */}
                          <span className="text-[10px] text-app-subtle flex-shrink-0">
                            {new Date(run.startedAt).toLocaleDateString('id-ID', {
                              day: 'numeric',
                              month: 'short',
                              year: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </div>

                        {/* Stats row */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                          <div className="p-2 rounded-lg bg-app-hover/60">
                            <p className="text-[10px] text-app-subtle">Diproses</p>
                            <p className="text-sm font-semibold text-app-text">
                              {run.totalProcessed}
                              <span className="text-[10px] text-app-muted font-normal">/{run.totalFound}</span>
                            </p>
                          </div>
                          {run.autoAcceptedCount > 0 && (
                            <div className="p-2 rounded-lg bg-app-hover/60">
                              <p className="text-[10px] text-app-subtle">Diterima</p>
                              <p className="text-sm font-semibold text-mint-500">{run.autoAcceptedCount}</p>
                            </div>
                          )}
                          {run.pendingReviewCount > 0 && (
                            <div className="p-2 rounded-lg bg-app-hover/60">
                              <p className="text-[10px] text-app-subtle">Perlu Review</p>
                              <p className="text-sm font-semibold text-amber-500">{run.pendingReviewCount}</p>
                            </div>
                          )}
                          {(run.skippedCount + run.rejectedCount) > 0 && (
                            <div className="p-2 rounded-lg bg-app-hover/60">
                              <p className="text-[10px] text-app-subtle">Dilewati</p>
                              <p className="text-sm font-semibold text-app-subtle">{run.skippedCount + run.rejectedCount}</p>
                            </div>
                          )}
                          {totalActionable > 0 && (
                            <div className="p-2 rounded-lg bg-red-50 dark:bg-red-900/10">
                              <p className="text-[10px] text-app-subtle">Error</p>
                              <p className="text-sm font-semibold text-red-500">{totalActionable}</p>
                            </div>
                          )}
                          {runDuration !== null && (
                            <div className="p-2 rounded-lg bg-app-hover/60">
                              <p className="text-[10px] text-app-subtle flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                Durasi
                              </p>
                              <p className="text-sm font-semibold text-app-text">
                                {runDuration < 60 ? `${runDuration}d` : `${Math.floor(runDuration / 60)}m`}
                              </p>
                            </div>
                          )}
                        </div>

                        {run.status === 'running' && runProgress && (
                          <GmailSyncEtaCard
                            progress={runProgress}
                            title={getSyncTypeLabel(run.syncType)}
                            compact
                          />
                        )}

                        {/* Error message */}
                        {run.errorMessage && (
                          <p className="text-[10px] text-red-500 italic">{run.errorMessage}</p>
                        )}

                        {/* Expand button */}
                        <button
                          onClick={() => setExpandedRunId(isExpanded ? null : run.id)}
                          className="flex items-center gap-1 text-[10px] text-app-subtle hover:text-app-text transition-colors"
                        >
                          <ChevronDown className={cn('w-3 h-3 transition-transform', isExpanded && 'rotate-180')} />
                          {isExpanded ? 'Sembunyikan Detail' : 'Lihat Detail'}
                        </button>

                        {/* Expanded detail */}
                        {isExpanded && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            className="space-y-1.5"
                          >
                            <div className="grid grid-cols-2 gap-2 text-[10px]">
                              <div className="p-2 rounded-lg bg-app-hover/40">
                                <span className="text-app-subtle">Range Tanggal</span>
                                <p className="font-medium text-app-text mt-0.5">
                                  {run.dateFrom ? new Date(run.dateFrom + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '-'}
                                  {' — '}
                                  {run.dateTo ? new Date(run.dateTo + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '-'}
                                </p>
                              </div>
                              <div className="p-2 rounded-lg bg-app-hover/40">
                                <span className="text-app-subtle">Tipe Sync</span>
                                <p className="font-medium text-app-text mt-0.5">{getSyncTypeLabel(run.syncType)}</p>
                              </div>
                              <div className="p-2 rounded-lg bg-app-hover/40">
                                <span className="text-app-subtle">Mulai</span>
                                <p className="font-medium text-app-text mt-0.5">
                                  {new Date(run.startedAt).toLocaleString('id-ID', {
                                    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                                  })}
                                </p>
                              </div>
                              <div className="p-2 rounded-lg bg-app-hover/40">
                                <span className="text-app-subtle">Selesai</span>
                                <p className="font-medium text-app-text mt-0.5">
                                  {run.finishedAt
                                    ? new Date(run.finishedAt).toLocaleString('id-ID', {
                                        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                                      })
                                    : '-'}
                                </p>
                              </div>
                            </div>

                            <div className="p-2 rounded-lg bg-app-hover/40 text-[10px]">
                              <span className="text-app-subtle">Rincian</span>
                              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 mt-1">
                                <span>Diterima: <strong className="text-app-text">{run.autoAcceptedCount}</strong></span>
                                <span>Perlu Review: <strong className="text-app-text">{run.pendingReviewCount}</strong></span>
                                <span>Dilewati: <strong className="text-app-text">{run.skippedCount}</strong></span>
                                <span>Ditolak: <strong className="text-app-text">{run.rejectedCount}</strong></span>
                                <span>Duplikat: <strong className="text-app-text">{run.duplicateCount}</strong></span>
                                <span>Gagal: <strong className="text-red-500">{run.failedCount}</strong></span>
                                <span>Retry Later: <strong className="text-blue-500">{run.retryLaterCount}</strong></span>
                                <span>Config Error: <strong className="text-rose-500">{run.configErrorCount}</strong></span>
                              </div>
                            </div>

                            {run.errorMessage && (
                              <div className="p-2 rounded-lg bg-red-50 dark:bg-red-900/10 text-[10px]">
                                <span className="text-red-500 font-medium">Error: </span>
                                <span className="text-red-600 dark:text-red-400">{run.errorMessage}</span>
                              </div>
                            )}
                          </motion.div>
                        )}
                      </div>
                    </Card>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>

        {/* Privacy note */}
        <Card variant="outlined">
          <div className="flex items-start gap-3">
            <Shield className="w-5 h-5 text-primary-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-medium text-app-text mb-1">
                Privasi & Keamanan
              </p>
              <p className="text-[10px] text-app-subtle leading-relaxed">
                Kami hanya membaca email transaksi dari bank, e-wallet, marketplace, dan layanan pembayaran.
                Isi email lengkap tidak disimpan ke database. Hanya data transaksi hasil ekstraksi yang
                disimpan setelah kamu setujui. Kamu bisa memutuskan akses kapan saja.
              </p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

// ===================== Sub-components =====================

interface StatCardProps {
  label: string;
  value: number;
  color: string;
}

function StatCard({ label, value, color }: StatCardProps) {
  return (
    <Card>
      <p className="text-[10px] text-app-subtle">{label}</p>
      <p className={cn('text-lg font-bold', color)}>{value}</p>
    </Card>
  );
}

interface EmailCardProps {
  email: SyncEmail;
  index: number;
  isExpanded: boolean;
  showDebug: boolean;
  onToggleExpand: () => void;
  onApprove: () => void;
  onReject: () => void;
  onRetry: () => void;
  onMarkAsTransaction: () => void;
  onParseWithFallback?: () => void;
  onSkip?: () => void;
  /** State + setter untuk editable note pada needs_review/pending_review */
  noteEditState: Record<string, string>;
  onNoteChange: (emailId: string, value: string) => void;
}

function EmailCard({
  email,
  index,
  isExpanded,
  showDebug,
  onToggleExpand,
  onApprove,
  onReject,
  onRetry,
  onMarkAsTransaction,
  onParseWithFallback,
  onSkip,
  noteEditState,
  onNoteChange,
}: EmailCardProps) {
  const config = STATUS_CONFIG[email.status] || STATUS_CONFIG.failed;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.02 }}
    >
      <Card>
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium text-app-text truncate">
                {email.subject}
              </p>
              {/* Status badge */}
              <span className={cn(
                'text-[10px] font-medium px-1.5 py-0.5 rounded-full whitespace-nowrap',
                config.color,
                config.bg
              )}>
                {config.label}
              </span>
              {email.confidence && email.confidence >= 0.8 && (
                <span className="text-[10px] font-medium text-mint-500 dark:text-mint-200 bg-mint-50 dark:bg-mint-500/12 px-1.5 py-0.5 rounded-full">
                  {Math.round(email.confidence * 100)}%
                </span>
              )}
              {/* Fallback badge */}
              {email.debug?.fallbackUsed && (
                <span className="text-[10px] font-medium text-soft-purple bg-purple-50 dark:bg-purple-500/12 px-1.5 py-0.5 rounded-full">
                  Parsed by Fallback
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-xs text-app-subtle">{email.from}</span>
              <span className="text-xs text-app-subtle">&middot;</span>
              <span className="text-xs text-app-subtle">
                {new Date(email.date).toLocaleDateString('id-ID')}
              </span>
            </div>

            {/* Amount & merchant */}
            {(email.amount || email.merchant) && (
              <div className="flex items-center gap-2 mt-1">
                {email.amount && (
                  <p className="text-sm font-semibold text-app-text tabular-nums">
                    Rp {email.amount.toLocaleString('id-ID')}
                  </p>
                )}
                {email.merchant && (
                  <span className="text-[10px] text-app-subtle">{email.merchant}</span>
                )}
                {email.category && (
                  <span className="inline-flex items-center gap-1">
                    <CategoryIcon
                      name={email.category}
                      size="sm"
                      animated
                      animationVariant={email.status === 'retry_later' ? 'warning' : email.status === 'pending_review' ? 'review' : email.status === 'approved' ? 'success' : 'soft'}
                    />
                    <span className="text-[10px] text-app-subtle">{email.category}</span>
                  </span>
                )}
              </div>
            )}

            {/* Reason */}
            {/* Transaction note — editable untuk needs_review/pending_review, statis untuk auto_accepted */}
            {(email.status === 'needs_review' || email.status === 'pending_review') && (
              <div className="mt-1.5 space-y-1">
                <span className="text-[10px] font-medium text-app-subtle">Catatan transaksi</span>
                <textarea
                  value={noteEditState[email.id] ?? email.note ?? ''}
                  onChange={(e) => onNoteChange(email.id, e.target.value)}
                  className="w-full rounded-lg px-2.5 py-1.5 text-[11px] app-field resize-none"
                  rows={2}
                  placeholder="Deskripsi singkat transaksi..."
                />
              </div>
            )}
            {email.note && email.status === 'auto_accepted' && (
              <div className="mt-1 flex items-start gap-1.5">
                <span className="text-[10px] font-medium text-app-subtle flex-shrink-0">Catatan:</span>
                <p className="text-[10px] text-app-text line-clamp-2">
                  {email.note}
                </p>
              </div>
            )}

            {email.reason && (
              <p className="text-[10px] text-app-subtle mt-1 italic">
                {email.reason}
              </p>
            )}

            {/* Debug info (expandable) */}
            {showDebug && email.debug && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="mt-2 p-2 rounded-lg bg-app-hover/80 text-[10px] font-mono space-y-0.5"
              >
                <DebugRow label="Message ID" value={email.debug.gmailMessageId} />
                <DebugRow label="Domain" value={email.debug.senderDomain} />
                <DebugRow label="Prefilter" value={email.debug.prefilterDecision} />
                <DebugRow label="AI Called" value={String(email.debug.aiCalled)} />
                <DebugRow label="AI Parsed" value={String(email.debug.aiParsedSuccessful)} />
                <DebugRow label="Amount" value={email.debug.extractedAmount !== null ? String(email.debug.extractedAmount) : '-'} />
                <DebugRow label="Merchant" value={email.debug.extractedMerchant || '-'} />
                <DebugRow label="Confidence" value={email.debug.confidenceScore !== null ? `${Math.round(email.debug.confidenceScore * 100)}%` : '-'} />
                <DebugRow label="Final Status" value={email.debug.finalStatus} />
                {email.debug.errorDetail && (
                  <DebugRow label="Error" value={email.debug.errorDetail} />
                )}
                {email.debug.aiErrorCode && (
                  <DebugRow label="Error Code" value={email.debug.aiErrorCode} />
                )}
                <DebugRow label="Fallback" value={email.debug.fallbackUsed ? 'Yes' : 'No'} />
                {email.debug.skipReason && (
                  <DebugRow label="Skip Reason" value={email.debug.skipReason} />
                )}
                {email.debug.matchedRule && (
                  <DebugRow label="Matched Rule" value={email.debug.matchedRule} />
                )}
                {typeof email.debug.detectedPromoAmount === 'number' && (
                  <DebugRow label="Promo Amount" value={`Rp ${email.debug.detectedPromoAmount.toLocaleString('id-ID')}`} />
                )}
                {email.debug.amountIgnored && (
                  <DebugRow label="Amount Ignored" value="true" />
                )}
                {email.debug.rawResponse && (
                  <DebugRow label="Raw AI" value={email.debug.rawResponse.substring(0, 200)} />
                )}
                {email.debug.cleanedResponse && (
                  <DebugRow label="Cleaned" value={email.debug.cleanedResponse.substring(0, 200)} />
                )}
                {email.debug.modelUsed && (
                  <DebugRow label="Model" value={email.debug.modelUsed} />
                )}
              </motion.div>
            )}

            {/* Expanded detail */}
            {isExpanded && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="mt-2 space-y-1"
              >
                {email.description && (
                  <p className="text-[10px] text-app-muted leading-relaxed">
                    {email.description}
                  </p>
                )}
                {email.paymentMethod && (
                  <p className="text-[10px] text-app-subtle">
                    Pembayaran: {email.paymentMethod}
                  </p>
                )}
                {email.transactionType && (
                  <p className="text-[10px] text-app-subtle">
                    Tipe: {email.transactionType === 'expense' ? 'Pengeluaran' : email.transactionType === 'income' ? 'Pemasukan' : email.transactionType}
                  </p>
                )}
              </motion.div>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex flex-col items-end gap-1 ml-2 sm:ml-3">
            {/* Expand/collapse */}
            <button
              onClick={onToggleExpand}
              className="p-1 rounded-lg text-app-subtle hover:text-app-text hover:bg-app-hover transition-colors"
              title="Lihat detail"
            >
              {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>

            {/* Contextual actions */}
            {(email.status === 'pending_review' || email.status === 'needs_review') && (
              <div className="flex gap-1">
                <button
                  onClick={onApprove}
                  className="p-2 rounded-xl bg-mint-50 dark:bg-mint-900/20 text-mint-500 hover:bg-mint-100 dark:hover:bg-mint-900/40 transition-colors"
                  title="Setujui"
                >
                  <CheckCircle className="w-4 h-4" />
                </button>
                <button
                  onClick={onReject}
                  className="p-2 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-500 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors"
                  title="Tolak"
                >
                  <XCircle className="w-4 h-4" />
                </button>
              </div>
            )}

            {(email.status === 'failed' || email.status === 'retry_later') && (
              <div className="flex gap-1">
                <button
                  onClick={onRetry}
                  className="p-2 rounded-xl bg-amber-50 dark:bg-amber-900/20 text-amber-500 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors"
                  title="Coba Ekstrak Ulang"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
                {email.status === 'failed' && onParseWithFallback && (
                  <button
                    onClick={onParseWithFallback}
                    className="p-2 rounded-xl bg-purple-50 dark:bg-purple-900/20 text-soft-purple hover:bg-purple-100 dark:hover:bg-purple-900/40 transition-colors"
                    title="Parse dengan Fallback"
                  >
                    <CopyPlus className="w-4 h-4" />
                  </button>
                )}
                {onSkip && (
                  <button
                    onClick={onSkip}
                    className="p-2 rounded-xl bg-app-hover/80 text-app-subtle hover:text-app-text transition-colors"
                    title="Tandai Dilewati"
                  >
                    <XCircle className="w-4 h-4" />
                  </button>
                )}
              </div>
            )}

            {(email.status === 'auto_rejected' || email.status === 'skipped') && (
              <button
                onClick={onMarkAsTransaction}
                className="p-2 rounded-xl bg-primary-50 dark:bg-primary-900/20 text-primary-500 hover:bg-primary-100 dark:hover:bg-primary-900/40 transition-colors"
                title="Tandai sebagai Transaksi"
              >
                <CopyPlus className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </Card>
    </motion.div>
  );
}

function DebugRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="text-app-subtle w-20 flex-shrink-0">{label}:</span>
      <span className="text-app-text break-all">{value}</span>
    </div>
  );
}

// ===================== Batch Processing =====================

/**
 * Process emails with concurrency limit
 */
async function processBatchWithConcurrency<T>(
  items: T[],
  concurrency: number,
  processor: (item: T, index: number, total: number) => Promise<SyncEmail>,
  onResult?: (result: SyncEmail, index: number, completed: number, total: number) => void,
): Promise<SyncEmail[]> {
  const results: SyncEmail[] = [];
  const total = items.length;
  let currentIndex = 0;
  let completed = 0;

  async function worker(): Promise<void> {
    while (currentIndex < total) {
      const index = currentIndex++;
      try {
        const result = await processor(items[index], index, total);
        results.push(result);
        completed++;
        onResult?.(result, index, completed, total);
      } catch (error) {
        // Worker error — shouldn't happen since processor handles errors
        const item = items[index] as any;
        const failedResult: SyncEmail = {
          id: item.id || `unknown-${index}`,
          subject: item.subject || 'Unknown',
          from: item.from || 'Unknown',
          date: item.date || new Date().toISOString(),
          status: 'failed',
          reason: error instanceof Error ? error.message : 'Unknown worker error',
        };
        results.push(failedResult);
        completed++;
        onResult?.(failedResult, index, completed, total);
      }

      // Delay between items to avoid rate limiting
      if (currentIndex < total) {
        await delay(BATCH_DELAY_MS);
      }
    }
  }

  // Start workers
  const workers = Array.from({ length: Math.min(concurrency, total) }, () => worker());
  await Promise.all(workers);

  return results;
}

/**
 * Process single email: prefilter → AI extract (if needed) → auto-decision
 *
 * AUTO-FIRST, REVIEW-BY-EXCEPTION flow:
 *   1. Prefilter + pre-skip rules (promo, card activation, dll)
 *   2. AI extraction (if needed)
 *   3. Fallback parser (if AI fails)
 *   4. Validator menentukan keputusan final:
 *      - auto_accepted  → langsung masuk transactions
 *      - auto_skipped   → dilewati, bukan transaksi
 *      - auto_rejected  → promo/newsletter ditolak
 *      - needs_review   → ambigu, perlu dicek user
 *      - retry_later    → error sementara
 *      - config_error   → konfigurasi bermasalah
 *      - failed         → bug teknis nyata
 */
async function processSingleEmail(
  email: {
    id: string;
    subject: string;
    from: string;
    date: string;
    body: string;
    threadId?: string;
    fullContent?: string;
    attachments?: Array<{
      attachmentId: string;
      filename: string;
      mimeType: string;
      size: number;
      extractedText?: string;
    }>;
  },
  attachmentsArg?: Array<{
    attachmentId: string;
    filename: string;
    mimeType: string;
    size: number;
    extractedText?: string;
  }>,
): Promise<SyncEmail> {
  try {
    // ===== STEP 1: Prefilter + Pre-skip rules =====
    // Cek pre-skip rules dulu (promo, card activation, welcome, dll)
    const preSkip = checkPreSkipRules(email.from, email.subject, email.body);
    if (preSkip) {
      return {
        id: email.id,
        subject: email.subject,
        from: email.from,
        date: email.date,
        status: preSkip.status,
        reason: preSkip.reason,
        debug: buildDebugInfo(
          email,
          preSkip.reasonCode,
          false, false, null, preSkip.status, preSkip.reason, preSkip.reasonCode,
          undefined, undefined, false, undefined,
          { skipReason: preSkip.reasonCode === 'PROMO_CASHBACK_SKIPPED' ? 'promo_cashback' : undefined },
        ),
      };
    }

    // Original prefilter untuk sisanya
    const classification = classifyEmail(email.subject, email.body, email.from);

    // ===== STEP 2: Send to AI (jika prefilter setuju) =====
    let extracted: ExtractedTransaction | null = null;
    let aiParsedSuccessful = true;
    let aiError: string | null = null;
    let aiErrorCode: string | undefined;
    let rawResponse: string | undefined;
    let cleanedResponse: string | undefined;
    let errorModelUsed: string | undefined;
    let usedFallback = false;
    const localParserResult = classification.decision === 'send_to_ai'
      ? evaluateLocalGmailParser(email)
      : null;
    if (localParserResult && localParserResult.decision !== 'send_to_ai') {
      return buildSyncEmailFromLocalParser(email, localParserResult);
    }

    let fallbackParseResult: ReturnType<typeof buildFallbackTransactionFromEmail> | null =
      localParserResult?.fallbackResult || null;

    // Hanya panggil AI jika prefilter lolos
    if (classification.decision === 'send_to_ai' && (!localParserResult || shouldSendToAi(localParserResult))) {
      try {
        const aiInput = buildAiInputForEmail(email, localParserResult);
        extracted = await extractWithGemini(aiInput, {
          subject: email.subject,
          sender: email.from,
          emailDate: email.date,
        });
      } catch (aiError_) {
        aiParsedSuccessful = false;
        const aiErr = aiError_ instanceof Error ? aiError_ : new Error('Unknown AI error');
        aiError = aiErr.message;
        aiErrorCode = (aiErr as any).errorCode as string | undefined;
        rawResponse = (aiErr as any).rawResponse as string | undefined;
        cleanedResponse = (aiErr as any).cleanedResponse as string | undefined;
        errorModelUsed = (aiErr as any).modelUsed as string | undefined;

        // Config error → stop batch
        if (aiErrorCode && isConfigErrorCode(aiErrorCode)) {
          return {
            id: email.id, subject: email.subject, from: email.from, date: email.date,
            status: 'config_error',
            reason: `Konfigurasi AI bermasalah: ${aiError}`,
            debug: buildDebugInfo(email, classification.decision, true, false, null, 'config_error', aiError, aiErrorCode, rawResponse, cleanedResponse, undefined, errorModelUsed),
          };
        }

        // Fallback parser — selalu coba ketika AI gagal
        fallbackParseResult = fallbackParseResult || buildFallbackTransactionFromEmail(
          email.from, email.subject, email.body, email.date,
        );

        if (fallbackParseResult.success && fallbackParseResult.data) {
          extracted = fallbackParseResult.data;
          usedFallback = true;
        }
      }
    }

    // Jika AI tidak dipanggil (prefilter skip), coba fallback untuk sender terpercaya
    if (!extracted && !aiErrorCode) {
      fallbackParseResult = fallbackParseResult || buildFallbackTransactionFromEmail(
        email.from, email.subject, email.body, email.date,
      );
      if (fallbackParseResult.success && fallbackParseResult.data) {
        extracted = fallbackParseResult.data;
        usedFallback = true;
        aiParsedSuccessful = false;
      }
    }

    // ===== DOCUMENT EXTRACTION: Jika AI & fallback gagal, coba ekstrak dari dokumen =====
    if (!extracted && isTrustedForDocumentExtraction(email.from)) {
      const docResult = processDocumentContent(
        email.body,
        email.fullContent,
        (attachmentsArg && attachmentsArg.length > 0) ? attachmentsArg : email.attachments,
      );

      if (docResult.hasAmount && docResult.extractedAmount && docResult.extractedAmount >= 1000) {
        // Found amount in document content — create a fallback-like result
        const confidence = docResult.orderId ? 0.72 : 0.65;
        fallbackParseResult = {
          success: true,
          data: {
            is_transaction: true,
            transaction_type: 'expense',
            amount: docResult.extractedAmount,
            currency: 'IDR',
            date: undefined,
            merchant: inferMerchantFromSender(email.from),
            category: inferCategoryFromSender(email.from),
            payment_method: inferPaymentMethodFromSender(email.from),
            description: `Nominal ditemukan di dokumen email: ${email.subject}`.substring(0, 200),
            confidence_score: confidence,
            reason: `Nominal ditemukan di dokumen lampiran/body (order: ${docResult.orderId || 'N/A'})`,
          },
          reason: 'Document extraction berhasil menemukan nominal',
          confidence,
          finalStatus: 'pending_review',
          errorCode: 'ATTACHMENT_AMOUNT_FOUND',
          amount: docResult.extractedAmount,
          fallbackUsed: true,
        };
        extracted = fallbackParseResult.data || null;
        usedFallback = true;
        aiParsedSuccessful = false;
      } else if (isTravelProvider(email.from)) {
        // Travel provider email without amount — check if it's a related document (e-ticket)
        const orderId = extractOrderIdFromSubject(email.subject);
        if (orderId && isRelatedDocument(email.subject, email.body)) {
          return {
            id: email.id,
            subject: email.subject,
            from: email.from,
            date: email.date,
            status: 'auto_skipped',
            amount: null,
            confidence: null,
            merchant: inferMerchantFromSender(email.from),
            reason: `Dokumen terkait (${inferMerchantFromSender(email.from)}) — nominal ada di email bukti pembayaran terpisah (Order ID: ${orderId})`,
            debug: buildDebugInfo(
              email, 'related_document',
              false, false, null, 'auto_skipped',
              'Dokumen terkait, bukan bukti pembayaran',
              'RELATED_DOCUMENT_SKIPPED',
            ),
          };
        }
      }
    }

    // ===== BUILD TRANSACTION NOTE =====
    // Buat catatan transaksi yang jelas dari konteks email
    const noteContext: NoteContext = {
      subject: email.subject,
      sender: email.from,
      merchant: extracted?.merchant || fallbackParseResult?.data?.merchant || null,
      category: extracted?.category || fallbackParseResult?.data?.category || null,
      amount: extracted?.amount || fallbackParseResult?.amount || null,
      transactionType: normalizeTransactionType(
        extracted?.transaction_type || fallbackParseResult?.data?.transaction_type,
      ) || null,
      paymentMethod: extracted?.payment_method || fallbackParseResult?.data?.payment_method || null,
      aiNote: extracted?.note || null,
      aiDescription: extracted?.description || null,
      fallbackNote: fallbackParseResult?.data?.description || null,
      body: email.body,
    };
    const transactionNote = buildTransactionNote(noteContext);

    // ===== STEP 3: Auto-decision via Validator =====
    // Validator menentukan final status berdasarkan semua sinyal
    const validatorResult = validateAndFinalize(
      email.from,
      email.subject,
      email.body,
      email.date,
      extracted,
      aiErrorCode,
      fallbackParseResult
        ? {
            success: fallbackParseResult.success,
            amount: fallbackParseResult.amount,
            confidence: fallbackParseResult.confidence,
            finalStatus: fallbackParseResult.finalStatus,
            data: fallbackParseResult.data,
          }
        : null,
      false, // isDuplicate — akan dicek di handleScanEmails
    );

    const finalAmount = extracted?.amount || fallbackParseResult?.amount || null;

    // ===== STEP 4: Execute decision =====
    switch (validatorResult.finalStatus) {
      case 'auto_accept': {
        // Transaksi langsung diterima otomatis!
        return {
          id: email.id,
          subject: email.subject,
          from: email.from,
          date: email.date,
          status: 'auto_accepted',
          amount: typeof finalAmount === 'number' && finalAmount >= 1000 ? finalAmount : null,
          confidence: validatorResult.confidenceScore,
          merchant: extracted?.merchant || fallbackParseResult?.data?.merchant || email.from,
          category: extracted?.category || fallbackParseResult?.data?.category || 'Lainnya',
          paymentMethod: extracted?.payment_method || fallbackParseResult?.data?.payment_method || 'Lainnya',
          transactionType: normalizeTransactionType(
            extracted?.transaction_type || fallbackParseResult?.data?.transaction_type,
          ),
          description: usedFallback
            ? `Diparse via fallback: ${extracted?.reason || 'Fallback berhasil'}`.substring(0, 500)
            : extracted?.description,
          note: transactionNote,
          extracted,
          reason: validatorResult.reason,
          debug: buildDebugInfo(
            email, classification.decision || 'send_to_ai',
            true, aiParsedSuccessful,
            typeof finalAmount === 'number' ? finalAmount : null,
            'auto_accepted', validatorResult.reason,
            validatorResult.errorCode,
            rawResponse, cleanedResponse, usedFallback, errorModelUsed,
          ),
        };
      }

      case 'needs_review': {
        // Ambigu — butuh review user
        return {
          id: email.id,
          subject: email.subject,
          from: email.from,
          date: email.date,
          status: 'needs_review',
          amount: typeof finalAmount === 'number' && finalAmount >= 1000 ? finalAmount : null,
          confidence: validatorResult.confidenceScore,
          merchant: extracted?.merchant || fallbackParseResult?.data?.merchant || email.from,
          category: extracted?.category || fallbackParseResult?.data?.category || 'Lainnya',
          paymentMethod: extracted?.payment_method || fallbackParseResult?.data?.payment_method || 'Lainnya',
          transactionType: normalizeTransactionType(
            extracted?.transaction_type || fallbackParseResult?.data?.transaction_type,
          ),
          description: usedFallback
            ? `Diparse via fallback: ${extracted?.reason || 'Fallback berhasil'}`.substring(0, 500)
            : extracted?.description,
          note: transactionNote,
          extracted,
          reason: validatorResult.reason,
          debug: buildDebugInfo(
            email, classification.decision || 'send_to_ai',
            true, aiParsedSuccessful,
            typeof finalAmount === 'number' ? finalAmount : null,
            'needs_review', validatorResult.reason,
            validatorResult.errorCode || aiErrorCode,
            rawResponse, cleanedResponse, usedFallback, errorModelUsed,
          ),
        };
      }

      case 'auto_reject': {
        return {
          id: email.id,
          subject: email.subject,
          from: email.from,
          date: email.date,
          status: 'auto_rejected',
          amount: null,
          confidence: validatorResult.confidenceScore,
          merchant: null,
          category: null,
          paymentMethod: null,
          reason: validatorResult.reason,
          debug: buildDebugInfo(
            email, classification.decision || 'auto_rejected',
            false, false, null, 'auto_rejected', validatorResult.reason,
            validatorResult.errorCode,
            rawResponse, cleanedResponse, false, errorModelUsed,
          ),
        };
      }

      case 'auto_skip':
      default: {
        return {
          id: email.id,
          subject: email.subject,
          from: email.from,
          date: email.date,
          status: 'auto_skipped',
          amount: null,
          confidence: validatorResult.confidenceScore || null,
          merchant: null,
          category: null,
          paymentMethod: null,
          reason: validatorResult.reason,
          debug: buildDebugInfo(
            email, classification.decision || 'skipped',
            aiParsedSuccessful !== undefined, aiParsedSuccessful,
            null, 'auto_skipped', validatorResult.reason,
            validatorResult.errorCode,
            rawResponse, cleanedResponse, usedFallback, errorModelUsed,
            {
              skipReason: validatorResult.errorCode,
              matchedRule: undefined,
              detectedPromoAmount: null,
              amountIgnored: false,
            },
          ),
        };
      }
    }
  } catch (error) {
    // Catch-all: unexpected error → failed
    return {
      id: email.id,
      subject: email.subject,
      from: email.from,
      date: email.date,
      status: 'failed',
      reason: error instanceof Error ? error.message : 'Gagal memproses email',
      debug: buildDebugInfo(
        email, 'unknown', false, false, null, 'failed',
        error instanceof Error ? error.message : 'Unknown error',
      ),
    };
  }
}

// ===================== Helper Functions =====================

function inferMerchantFromSender(sender: string): string {
  const s = sender.toLowerCase();
  if (s.includes('tiket.com')) return 'tiket.com';
  if (s.includes('kai')) return 'PT. KAI';
  if (s.includes('agoda')) return 'Agoda';
  if (s.includes('traveloka')) return 'Traveloka';
  if (s.includes('grab')) return 'Grab';
  if (s.includes('shopee')) return 'Shopee';
  if (s.includes('tokopedia')) return 'Tokopedia';
  if (s.includes('blibli')) return 'Blibli';
  return 'Unknown';
}

function inferCategoryFromSender(sender: string): string {
  const s = sender.toLowerCase();
  if (s.includes('tiket') || s.includes('traveloka') || s.includes('agoda')) return 'Travel';
  if (s.includes('kai')) return 'Transportasi';
  if (s.includes('grab') || s.includes('gojek')) return 'Transportasi';
  if (s.includes('shopee') || s.includes('tokopedia')) return 'Belanja';
  return 'Lainnya';
}

function inferPaymentMethodFromSender(sender: string): string {
  const s = sender.toLowerCase();
  if (s.includes('tiket') || s.includes('agoda') || s.includes('traveloka')) return 'transfer-bank';
  if (s.includes('shopee') || s.includes('tokopedia')) return 'e-wallet';
  return 'transfer-bank';
}

function isTemporaryGeminiError(errorCode?: string): boolean {
  return (
    errorCode === GEMINI_ERROR_CODES.UNKNOWN ||
    errorCode === GEMINI_ERROR_CODES.TEMPORARY_ERROR ||
    errorCode === GEMINI_ERROR_CODES.NETWORK_ERROR ||
    errorCode === GEMINI_ERROR_CODES.MODEL_UNAVAILABLE ||
    errorCode === GEMINI_ERROR_CODES.EMPTY_RESPONSE ||
    errorCode === GEMINI_ERROR_CODES.TIMEOUT ||
    errorCode === GEMINI_ERROR_CODES.RATE_LIMITED
  );
}

function buildDebugInfo(
  email: { id: string; subject: string; from: string },
  prefilterDecision: string,
  aiCalled: boolean,
  aiParsedSuccessful: boolean,
  extractedAmount: number | null,
  finalStatus: string,
  errorDetail: string | null,
  aiErrorCode?: string,
  rawResponse?: string,
  cleanedResponse?: string,
  fallbackUsed?: boolean,
  modelUsed?: string,
  extra?: Pick<SyncEmailDebug, 'skipReason' | 'matchedRule' | 'detectedPromoAmount' | 'amountIgnored'>,
): SyncEmailDebug {
  return {
    gmailMessageId: email.id,
    senderDomain: extractDomain(email.from),
    subjectClassification: email.subject.substring(0, 80),
    prefilterDecision,
    aiCalled,
    aiParsedSuccessful,
    extractedAmount,
    extractedMerchant: null,
    confidenceScore: null,
    finalStatus,
    errorDetail,
    aiErrorCode,
    rawResponse: rawResponse?.substring(0, 500),
    cleanedResponse: cleanedResponse?.substring(0, 500),
    fallbackUsed,
    modelUsed,
    skipReason: extra?.skipReason,
    matchedRule: extra?.matchedRule,
    detectedPromoAmount: extra?.detectedPromoAmount,
    amountIgnored: extra?.amountIgnored,
  };
}

function buildSyncEmailFromLocalParser(
  email: {
    id: string;
    subject: string;
    from: string;
    date: string;
    body: string;
  },
  localResult: LocalParserResult,
): SyncEmail {
  const extracted = localResult.extracted || null;
  const amount = extracted?.amount || localResult.fallbackResult?.amount || null;
  const status: SyncEmailStatus =
    localResult.decision === 'auto_accept'
      ? 'auto_accepted'
      : localResult.decision === 'auto_reject'
        ? 'auto_rejected'
        : 'auto_skipped';

  const noteContext: NoteContext = {
    subject: email.subject,
    sender: email.from,
    merchant: extracted?.merchant || null,
    category: extracted?.category || null,
    amount: amount || null,
    transactionType: normalizeTransactionType(extracted?.transaction_type) || null,
    paymentMethod: extracted?.payment_method || null,
    aiNote: null,
    aiDescription: null,
    fallbackNote: extracted?.description || localResult.reason,
    body: email.body,
  };

  return {
    id: email.id,
    subject: email.subject,
    from: email.from,
    date: email.date,
    body: email.body,
    status,
    amount: status === 'auto_accepted' ? amount : null,
    confidence: localResult.confidence,
    merchant: status === 'auto_accepted' ? extracted?.merchant || email.from : null,
    category: status === 'auto_accepted' ? extracted?.category || 'Lainnya' : null,
    paymentMethod: status === 'auto_accepted' ? extracted?.payment_method || 'Lainnya' : null,
    transactionType: normalizeTransactionType(extracted?.transaction_type),
    description: extracted?.description || localResult.reason,
    note: status === 'auto_accepted' ? buildTransactionNote(noteContext) : null,
    extracted,
    reason: localResult.reason,
    debug: buildDebugInfo(
      email,
      `local_${localResult.decision}`,
      false,
      false,
      typeof amount === 'number' ? amount : null,
      status,
      localResult.reason,
      localResult.errorCode,
      undefined,
      undefined,
      Boolean(localResult.fallbackResult?.fallbackUsed || localResult.extracted),
      localResult.parserSource,
      {
        matchedRule: localResult.matchedRule,
        skipReason: localResult.errorCode,
      },
    ),
  };
}

function didUseAttachmentExtraction(email: SyncEmail): boolean {
  return (
    email.debug?.aiErrorCode === 'ATTACHMENT_AMOUNT_FOUND' ||
    email.reason?.toLowerCase().includes('dokumen lampiran') === true ||
    email.description?.toLowerCase().includes('dokumen email') === true
  );
}

function buildAiInputForEmail(
  email: {
    subject: string;
    from: string;
    date: string;
    body: string;
    fullContent?: string;
    attachments?: Array<{ extractedText?: string }>;
  },
  localResult?: LocalParserResult | null,
): string {
  const combined = getCombinedTextForAI(email.body, email.fullContent, email.attachments);
  const cleaned = combined
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 6000);

  return [
    `Subject: ${email.subject}`,
    `Sender: ${email.from}`,
    `Tanggal email: ${email.date}`,
    `Alasan butuh AI: ${localResult?.reason || 'Email ambigu setelah rules lokal'}`,
    localResult?.fallbackResult?.amount ? `Nominal kandidat parser lokal: ${localResult.fallbackResult.amount}` : '',
    '',
    'Isi email ringkas:',
    cleaned,
  ].filter(Boolean).join('\n');
}

function calculateStats(emails: SyncEmail[]): ProcessingStats {
  const stats: ProcessingStats = {
    total: emails.length,
    processed: emails.length,
    pendingReview: 0,
    autoAcceptedCount: 0,
    approved: 0,
    rejected: 0,
    autoRejected: 0,
    skipped: 0,
    duplicate: 0,
    failed: 0,
    retryLater: 0,
    configError: 0,
  };

  for (const email of emails) {
    switch (email.status) {
      case 'auto_accepted': stats.autoAcceptedCount++; break;
      case 'needs_review':
      case 'pending_review': stats.pendingReview++; break;
      case 'approved': stats.approved++; break;
      case 'rejected': stats.rejected++; break;
      case 'auto_skipped':
      case 'skipped': stats.skipped++; break;
      case 'auto_rejected': stats.autoRejected++; break;
      case 'duplicate': stats.duplicate++; break;
      case 'failed': stats.failed++; break;
      case 'retry_later': stats.retryLater++; break;
      case 'config_error': stats.configError++; break;
      case 'gmail_permission_required': stats.configError++; break;
      case 'paused_config_error': stats.configError++; break;
    }
  }

  return stats;
}

function normalizeTransactionType(type?: TransactionType): TransactionType {
  if (type === 'income' || type === 'expense' || type === 'transfer' || type === 'refund') return type;
  return 'expense';
}

function normalizePaymentMethod(method?: string): PaymentMethod {
  const normalized = (method || '').toLowerCase();
  if (normalized.includes('qris')) return 'qris';
  if (normalized.includes('wallet') || normalized.includes('gopay') || normalized.includes('ovo') || normalized.includes('dana')) return 'e-wallet';
  if (normalized.includes('debit')) return 'kartu-debit';
  if (normalized.includes('kredit') || normalized.includes('credit')) return 'kartu-kredit';
  if (normalized.includes('transfer') || normalized.includes('bank')) return 'transfer-bank';
  if (normalized.includes('cash')) return 'cash';
  return 'lainnya-payment';
}

function normalizeDate(date: string): string {
  const parsedDate = new Date(date);
  if (Number.isNaN(parsedDate.getTime())) return new Date().toISOString().split('T')[0];
  return parsedDate.toISOString().split('T')[0];
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, 'dan')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'lainnya';
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
