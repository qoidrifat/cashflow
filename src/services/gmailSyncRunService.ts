import { apiGet, apiPost, apiPut } from '../config/api';
import { useAuthStore } from '../store/useAuthStore';

export type SyncRunType = 'manual' | 'initial_history' | 'auto_background' | 'retry_failed';
export type SyncRunStatus = 'running' | 'completed' | 'partial_failed' | 'failed' | 'cancelled';

export interface GmailSyncRun {
  id: string;
  userId: string;
  syncType: SyncRunType;
  status: SyncRunStatus;
  startedAt: string;
  finishedAt: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  totalFound: number;
  totalProcessed: number;
  autoAcceptedCount: number;
  pendingReviewCount: number;
  skippedCount: number;
  rejectedCount: number;
  duplicateCount: number;
  failedCount: number;
  retryLaterCount: number;
  configErrorCount: number;
  lastPageToken: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSyncRunInput {
  syncType: SyncRunType;
  dateFrom?: string;
  dateTo?: string;
}

export interface UpdateSyncRunPatch {
  status?: SyncRunStatus;
  totalFound?: number;
  totalProcessed?: number;
  autoAcceptedCount?: number;
  pendingReviewCount?: number;
  skippedCount?: number;
  rejectedCount?: number;
  duplicateCount?: number;
  failedCount?: number;
  retryLaterCount?: number;
  configErrorCount?: number;
  lastPageToken?: string;
  errorCode?: string;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
}

function resolveUser(arg1: any): string {
  if (typeof arg1 === 'string') return arg1;
  return useAuthStore.getState().authUser?.uid || '';
}

export async function createSyncRun(
  arg1: string | CreateSyncRunInput,
  arg2?: CreateSyncRunInput,
): Promise<GmailSyncRun | null> {
  const userId = resolveUser(arg1);
  const input: CreateSyncRunInput = typeof arg1 === 'object' ? arg1 : arg2 || { syncType: 'manual' };
  try {
    const res = await apiPost<{ id: string }>('/api/gmail/runs', input);
    const now = new Date().toISOString();
    return {
      id: res.id,
      userId,
      syncType: input.syncType,
      status: 'running',
      startedAt: now,
      finishedAt: null,
      dateFrom: input.dateFrom || null,
      dateTo: input.dateTo || null,
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
      lastPageToken: null,
      errorCode: null,
      errorMessage: null,
      metadata: {},
      createdAt: now,
      updatedAt: now,
    };
  } catch {
    return null;
  }
}

export async function updateSyncRun(
  arg1: string,
  arg2: string | UpdateSyncRunPatch,
  arg3?: UpdateSyncRunPatch,
): Promise<void> {
  const runId = typeof arg2 === 'string' ? arg2 : arg1;
  const patch = typeof arg2 === 'object' ? arg2 : arg3 || {};
  try {
    await apiPut(`/api/gmail/runs/${runId}`, patch);
  } catch {}
}

export async function finishSyncRun(
  arg1: string,
  arg2: string | UpdateSyncRunPatch,
  arg3?: UpdateSyncRunPatch,
): Promise<void> {
  return updateSyncRun(arg1, arg2, arg3);
}

export async function getRecentSyncRuns(
  arg1?: string | number | { limit?: number },
  arg2?: number,
): Promise<GmailSyncRun[]> {
  const limit = typeof arg1 === 'number' ? arg1 : typeof arg2 === 'number' ? arg2 : typeof arg1 === 'object' ? arg1.limit || 10 : 10;
  try {
    const rows = await apiGet<any[]>(`/api/gmail/runs?limit=${limit}`);
    return (rows || []).map((r) => {
      // metadata disimpan sebagai JSON string di Turso; parse aman agar breakdown
      // (Perlu Review, Duplikat, Retry Later, Config Error, Tipe Sync, range) tampil.
      let metadata: Record<string, unknown> = {};
      try {
        const parsed = typeof r.metadata === 'string' && r.metadata ? JSON.parse(r.metadata) : r.metadata;
        if (parsed && typeof parsed === 'object') metadata = parsed;
      } catch {
        metadata = {};
      }
      const m = metadata as Record<string, any>;
      return {
        id: r.id,
        userId: r.user_id,
        syncType: m.syncType || 'manual',
        status: r.status,
        startedAt: r.started_at,
        finishedAt: r.completed_at,
        dateFrom: m.dateFrom || null,
        dateTo: m.dateTo || null,
        totalFound: r.total_emails || 0,
        totalProcessed: r.processed || 0,
        autoAcceptedCount: r.accepted || 0,
        pendingReviewCount: m.pendingReviewCount || 0,
        skippedCount: r.skipped || 0,
        rejectedCount: r.rejected || 0,
        duplicateCount: m.duplicateCount || 0,
        failedCount: r.failed || 0,
        retryLaterCount: m.retryLaterCount || 0,
        configErrorCount: m.configErrorCount || 0,
        lastPageToken: null,
        errorCode: null,
        errorMessage: r.error_message || null,
        metadata,
        createdAt: r.started_at,
        updatedAt: r.completed_at || r.started_at,
      };
    });
  } catch {
    return [];
  }
}

export async function getSyncRuns(
  arg1?: string | number | { limit?: number },
  arg2?: number,
): Promise<GmailSyncRun[]> {
  return getRecentSyncRuns(arg1, arg2);
}

export async function getActiveSyncRun(userId?: string): Promise<GmailSyncRun | null> {
  const runs = await getRecentSyncRuns(userId, 5);
  return runs.find((r) => r.status === 'running') || null;
}

export function getSyncTypeLabel(type: SyncRunType): string {
  switch (type) {
    case 'manual': return 'Manual Scan';
    case 'initial_history': return 'History Scan';
    case 'auto_background': return 'Auto Sync';
    case 'retry_failed': return 'Retry Failed';
    default: return type;
  }
}

export function getSyncStatusLabel(status: SyncRunStatus): string {
  switch (status) {
    case 'running': return 'Sedang Berjalan';
    case 'completed': return 'Selesai';
    case 'partial_failed': return 'Selesai Sebagian';
    case 'failed': return 'Gagal';
    case 'cancelled': return 'Dibatalkan';
    default: return status;
  }
}
