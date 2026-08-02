import { apiGet, apiPost } from '../config/api';
import type { GmailSyncLog, SyncEmailStatus } from '../types';
import { mapGmailSyncLog } from './supabaseMappers';
import { useAuthStore } from '../store/useAuthStore';

export interface GmailSyncSummary {
  /** Jumlah email yang diterima otomatis (auto_accepted) */
  autoAccepted: number;
  /** Jumlah email yang perlu review (needs_review + pending_review) */
  needsReview: number;
  /** Jumlah email yang dilewati/ditolak (auto_skipped, auto_rejected, skipped, rejected) */
  skippedRejected: number;
  /** Jumlah email error (failed, retry_later, config_error, paused_config_error) */
  error: number;
  /** Total semua email */
  total: number;
}

export interface PaginatedSyncLogsResult {
  data: GmailSyncLog[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  /** Ringkasan status dihitung dari SELURUH email (bukan hanya halaman aktif) */
  summary: GmailSyncSummary;
}

/**
 * Hitung ringkasan status dari seluruh log (sebelum pagination) sehingga
 * summary cards menampilkan total yang benar meski hanya halaman 1 yang tampil.
 */
function buildGmailSyncSummary(logs: GmailSyncLog[]): GmailSyncSummary {
  let autoAccepted = 0;
  let needsReview = 0;
  let skippedRejected = 0;
  let error = 0;
  for (const log of logs) {
    const st = log.status || log.finalStatus;
    if (st === 'auto_accepted') {
      autoAccepted++;
    } else if (st === 'needs_review' || st === 'pending_review') {
      needsReview++;
    } else if (st === 'auto_skipped' || st === 'auto_rejected' || st === 'skipped' || st === 'rejected') {
      skippedRejected++;
    } else if (st === 'failed' || st === 'retry_later' || st === 'config_error' || st === 'paused_config_error') {
      error++;
    }
  }
  return { autoAccepted, needsReview, skippedRejected, error, total: logs.length };
}

export async function getGmailSyncLogsPaginated(
  arg1: any,
  arg2?: any,
): Promise<PaginatedSyncLogsResult> {
  const options = typeof arg1 === 'object' ? arg1 : arg2 || {};
  try {
    const page = options.page || 1;
    const pageSize = options.pageSize || 100;

    // Pass server-side filter/sort/pagination params ke /api/gmail/logs.
    // Server mengembalikan { data, total, page, pageSize, summary } saat
    // includeSummary=1; filter syncRunId/status/search dan sort kini diproses di DB.
    const params = new URLSearchParams();
    params.set('limit', '2000');
    params.set('includeSummary', '1');
    params.set('page', String(page));
    params.set('pageSize', String(pageSize));
    if (options.syncRunId) params.set('syncRunId', String(options.syncRunId));
    if (options.status && options.status !== 'all') params.set('status', String(options.status));
    if (options.search) params.set('search', String(options.search));
    if (options.sortBy) params.set('sortBy', String(options.sortBy));
    if (options.sortOrder) params.set('sortOrder', String(options.sortOrder));

    const res = await apiGet<any>(`/api/gmail/logs?${params.toString()}`);

    // Response baru: { data, total, page, pageSize, summary }
    if (res && Array.isArray(res.data)) {
      const rows = (res.data || []).map(mapGmailSyncLog);
      const total = Number(res.total ?? rows.length);
      const totalPages = total > 0 ? Math.ceil(total / pageSize) : 1;
      return {
        data: rows,
        page,
        pageSize,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
        summary: res.summary ?? buildGmailSyncSummary(rows),
      };
    }

    // Fallback: server lama mengembalikan array polos → filter & paginasi di client
    const allLogs = ((res as any[]) || []).map(mapGmailSyncLog);
    const summary = buildGmailSyncSummary(allLogs);
    let data = allLogs;

    if (options.syncRunId) {
      data = data.filter((l) => l.syncRunId === options.syncRunId);
    }
    if (options.status && options.status !== 'all') {
      const targetStatus = options.status;
      data = data.filter((l) => {
        const st = l.status || l.finalStatus;
        if (targetStatus === 'needs_review') return st === 'needs_review' || st === 'pending_review';
        if (targetStatus === 'auto_skipped') return st === 'auto_skipped' || st === 'skipped';
        if (targetStatus === 'auto_rejected') return st === 'auto_rejected' || st === 'rejected';
        if (targetStatus === 'paused_config_error' || targetStatus === 'config_error') return st === 'config_error' || st === 'paused_config_error';
        return st === targetStatus;
      });
    }
    if (options.search) {
      const q = options.search.toLowerCase();
      data = data.filter((l) => (l.subject || '').toLowerCase().includes(q) || (l.sender || '').toLowerCase().includes(q));
    }

    const total = data.length;
    const totalPages = total > 0 ? Math.ceil(total / pageSize) : 1;
    const startIndex = (page - 1) * pageSize;
    const paginatedData = data.slice(startIndex, startIndex + pageSize);

    return {
      data: paginatedData,
      page,
      pageSize,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
      summary,
    };
  } catch {
    return {
      data: [],
      page: 1,
      pageSize: 0,
      total: 0,
      totalPages: 0,
      hasNextPage: false,
      hasPreviousPage: false,
      summary: { autoAccepted: 0, needsReview: 0, skippedRejected: 0, error: 0, total: 0 },
    };
  }
}

export async function createGmailSyncLog(arg1: any, arg2?: any): Promise<string> {
  const data = typeof arg1 === 'object' ? arg1 : arg2 || {};
  try {
    const res = await apiPost<{ id: string }>('/api/gmail/logs', data);
    return res.id;
  } catch {
    return `local-log-${Date.now()}`;
  }
}

export async function upsertGmailSyncLogs(arg1: any, arg2?: any): Promise<void> {
  const logs: Partial<GmailSyncLog>[] = Array.isArray(arg1) ? arg1 : Array.isArray(arg2) ? arg2 : [];
  for (const log of logs) {
    await createGmailSyncLog(log);
  }
}

export async function getGmailSyncLogs(arg1?: any, arg2?: any): Promise<GmailSyncLog[]> {
  const limit = typeof arg1 === 'number' ? arg1 : typeof arg2 === 'number' ? arg2 : 100;
  try {
    const rows = await apiGet<any[]>(`/api/gmail/logs?limit=${limit}`);
    return (rows || []).map(mapGmailSyncLog);
  } catch {
    return [];
  }
}

export async function getExistingFinalGmailMessageIds(arg1?: any, arg2?: any): Promise<Set<string>> {
  const logs = await getGmailSyncLogs(arg1, arg2);
  const ids = new Set<string>();
  for (const log of logs) {
    if (log.messageId) ids.add(log.messageId);
  }
  return ids;
}

export async function getFailedEmailIds(arg1?: any, arg2?: any): Promise<string[]> {
  const logs = await getGmailSyncLogs(arg1, arg2);
  return logs.filter((l) => l.status === 'failed' || l.finalStatus === 'failed').map((l) => l.messageId);
}
