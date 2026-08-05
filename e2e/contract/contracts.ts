/**
 * API Contract — source of truth ringan untuk deteksi schema drift (P3.10).
 *
 * Setiap endpoint inti punya validator minimal field-wajib + tipe. Bila server
 * berubah bentuk response (field hilang/rename/type berubah), contract test
 * merah → drift terdeteksi otomatis sebelum user terkena dampak.
 *
 * Referensi bentuk response: server/routes/*.js (bukan client types — server
 * adalah pihak yang menghasilkan response).
 */
import type { APIResponse } from 'playwright/test';

/** Validator: `value` memenuhi predikat tipe. */
type Check = (v: unknown) => boolean;

const isObject: Check = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const isArray: Check = Array.isArray;
const isNumber: Check = (v) => typeof v === 'number';
const isString: Check = (v) => typeof v === 'string';
const isBoolean: Check = (v) => typeof v === 'boolean';
/** Kolom INTEGER SQLite (0/1) yang di-map server sebagai number ATAU boolean. */
const isBoolOrNum: Check = (v) => isBoolean(v) || isNumber(v);

/** Semua key wajib ada dan lolos check-nya. */
function hasShape(obj: Record<string, unknown>, shape: Record<string, Check>): boolean {
  if (!isObject(obj)) return false;
  return Object.entries(shape).every(([key, check]) => key in obj && check(obj[key]));
}

/** Ambil body JSON mentah dari response (bisa object ATAU array). */
export async function bodyOf(resp: APIResponse): Promise<unknown> {
  try {
    return await resp.json() as unknown;
  } catch {
    return undefined;
  }
}

// ===================== Contracts =====================

export interface Contract {
  label: string;
  /** Validasi body response penuh — return true bila sesuai kontrak. */
  validate: (body: unknown) => boolean;
  /** Pesan drift yang informatif. */
  describe: () => string;
}

const GMAIL_LOG_ROW: Record<string, Check> = {
  id: isString,
  user_id: isString,
  message_id: isString,
  subject: isString,
  sender: isString,
  status: isString,
  scanned_at: isString,
};

const GMAIL_SUMMARY: Record<string, Check> = {
  autoAccepted: isNumber,
  needsReview: isNumber,
  skippedRejected: isNumber,
  error: isNumber,
  total: isNumber,
};

export const gmailLogsContract: Contract = {
  label: '/api/gmail/logs?includeSummary=1',
  validate: (body) => {
    if (!isObject(body)) return false;
    const b = body as Record<string, unknown>;
    if (!isArray(b.data)) return false;
    if (!isNumber(b.total) || !isNumber(b.page) || !isNumber(b.pageSize)) return false;
    if (!isObject(b.summary)) return false;
    if (!hasShape(b.summary as Record<string, unknown>, GMAIL_SUMMARY)) return false;
    const rows = b.data as Record<string, unknown>[];
    return rows.every((row) => hasShape(row, GMAIL_LOG_ROW));
  },
  describe: () => 'data[] (row: id,user_id,message_id,subject,sender,status,scanned_at), total, page, pageSize, summary{autoAccepted,needsReview,skippedRejected,error,total}',
};

export const transactionsPaginatedContract: Contract = {
  label: '/api/transactions/paginated',
  validate: (body) => {
    if (!isObject(body)) return false;
    const b = body as Record<string, unknown>;
    if (!isArray(b.data)) return false;
    if (!isNumber(b.total) || !isNumber(b.page) || !isNumber(b.pageSize)) return false;
    if (!isNumber(b.totalPages)) return false;
    if (typeof b.hasNextPage !== 'boolean' || typeof b.hasPreviousPage !== 'boolean') return false;
    const rows = b.data as Record<string, unknown>[];
    if (rows.length > 0) {
      return rows.every(
        (row) => isString(row.id) && isString(row.type) && isNumber(row.amount) && isString(row.date),
      );
    }
    return true; // halaman kosong tetap valid (kontrak struktur tetap)
  },
  describe: () => 'data[] (row: id,type,amount,date), total, page, pageSize, totalPages, hasNextPage, hasPreviousPage',
};

export const transactionsListContract: Contract = {
  label: '/api/transactions',
  validate: (body) => {
    if (!isArray(body)) return false;
    const rows = body as unknown as Record<string, unknown>[];
    return rows.every(
      (row) => isString(row.id) && isString(row.type) && isNumber(row.amount) && isString(row.date),
    );
  },
  describe: () => 'array row: id,type,amount,date',
};

export const budgetsContract: Contract = {
  label: '/api/budgets',
  validate: (body) => {
    if (!isArray(body)) return false;
    const rows = body as unknown as Record<string, unknown>[];
    return rows.every(
      (row) => isString(row.id) && isString(row.category_id) && isNumber(row.amount)
        && isNumber(row.month) && isNumber(row.year),
    );
  },
  describe: () => 'array row: id,category_id,amount,month,year',
};

export const categoriesContract: Contract = {
  label: '/api/categories',
  validate: (body) => {
    if (!isArray(body)) return false;
    const rows = body as unknown as Record<string, unknown>[];
    return rows.every(
      (row) => isString(row.id) && isString(row.name) && (isString(row.icon) || isString(row.type)),
    );
  },
  describe: () => 'array row: id,name,(icon|type)',
};

export const notificationsContract: Contract = {
  label: '/api/notifications',
  validate: (body) => {
    if (!isArray(body)) return false;
    const rows = body as unknown as Record<string, unknown>[];
    return rows.every(
      (row) => isString(row.id) && isString(row.type) && isString(row.title)
        && isBoolOrNum(row.read) && isString(row.created_at),
    );
  },
  describe: () => 'array row: id,type,title,read(0/1|bool),created_at',
};

export const adminSummaryContract: Contract = {
  label: '/api/admin/metrics/summary',
  validate: (body) => {
    if (!isObject(body)) return false;
    const b = body as Record<string, unknown>;
    if (b.ok !== true) return false;
    for (const key of ['today', 'week', 'month']) {
      const bucket = b[key];
      if (!isObject(bucket)) return false;
      if (!hasShape(bucket as Record<string, unknown>, {
        costIdr: isNumber, tokens: isNumber, calls: isNumber, avgTimeMs: isNumber,
      })) return false;
    }
    return true;
  },
  describe: () => 'ok:true, today/week/month{costIdr,tokens,calls,avgTimeMs}',
};

export const agentSearchConfigContract: Contract = {
  label: '/api/agent-search/config',
  validate: (body) => {
    if (!isObject(body)) return false;
    const b = body as Record<string, unknown>;
    return b.ok === true && isObject(b.config);
  },
  describe: () => 'ok:true, config:object',
};

export const adminAiUsageContract: Contract = {
  label: '/api/admin/metrics/ai-usage',
  validate: (body) => {
    if (!isObject(body)) return false;
    const b = body as Record<string, unknown>;
    if (b.ok !== true) return false;
    if (!isObject(b.summary)) return false;
    if (!isArray(b.trend)) return false;
    // Sprint 2 Cost Monitoring: cache-hit & cost-trend per fitur wajib ada (boleh kosong).
    if (!isArray(b.trendByFeature)) return false;
    if (!isArray(b.cacheByFeature)) return false;
    const summary = b.summary as Record<string, unknown>;
    if (!isNumber(summary.costIdr) || !isNumber(summary.tokens) || !isNumber(summary.calls)) return false;
    if (!isNumber(summary.avgTimeMs)) return false;
    const trendByFeature = b.trendByFeature as Record<string, unknown>[];
    if (!trendByFeature.every((t) => isString(t.date) && isString(t.feature) && isNumber(t.costIdr))) return false;
    const cache = b.cacheByFeature as Record<string, unknown>[];
    return cache.every(
      (c) => isString(c.feature) && isNumber(c.hits) && isNumber(c.misses) && isNumber(c.hitRate),
    );
  },
  describe: () => 'ok:true, summary{costIdr,tokens,calls,avgTimeMs}, trend[], trendByFeature[]{date,feature,costIdr}, cacheByFeature[]{feature,hits,misses,hitRate}',
};

export const adminCacheContract: Contract = {
  label: '/api/admin/metrics/cache',
  validate: (body) => {
    if (!isObject(body)) return false;
    const b = body as Record<string, unknown>;
    if (b.ok !== true) return false;
    return hasShape(b, {
      size: isNumber,
      maxEntries: isNumber,
      hits: isNumber,
      misses: isNumber,
      sets: isNumber,
      evictions: isNumber,
      hitRate: isNumber,
    });
  },
  describe: () => 'ok:true, size,maxEntries,hits,misses,sets,evictions,hitRate (semua number)',
};
