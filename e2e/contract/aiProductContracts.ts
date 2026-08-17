/**
 * API Contract — namespace /api/ai-product/* (drift guard, 2026-08-09).
 *
 * Source of truth: docs/api/ai-product-api.md (satu-satunya referensi kontrak).
 * Memvalidasi bentuk response endpoint AI product terhadap kontrak — field
 * wajib + tipe. Bila server berubah bentuk (field hilang/rename/tipe berubah)
 * → test merah → drift terdeteksi sebelum user terkena dampak.
 *
 * Referensi bentuk response: server/routes/{aiProductRoutes,conversationRoutes}.js
 * (bukan client types — server adalah pihak yang menghasilkan response).
 */
import type { APIResponse } from 'playwright/test';

type Check = (v: unknown) => boolean;

const isObject: Check = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const isArray: Check = Array.isArray;
const isNumber: Check = (v) => typeof v === 'number';
const isString: Check = (v) => typeof v === 'string';
const isBoolean: Check = (v) => typeof v === 'boolean';
/** Kolom nullable SQLite: null ATAU tipe yang diharapkan. */
const isNullOr = (check: Check): Check => (v) => v === null || check(v);
/** Kolom opsional: absen ATAU tipe yang diharapkan. */
const isOpt = (check: Check): Check => (v) => v === undefined || check(v);

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

// ===================== Contract =====================

export interface Contract {
  label: string;
  validate: (body: unknown) => boolean;
  describe: () => string;
}

// ===================== Shapes namespace /api/ai-product/* =====================

const TIMELINE_ITEM: Record<string, Check> = {
  id: isString,
  feature: isString,
  event_type: isString,
  status: isString,
  title: isString,
  body: isOpt(isString), // '' bila kosong — opsional di kontrak
  confidence: isOpt(isNullOr(isNumber)), // number 0-1 ATAU null — tidak pernah dikarang
  payload: isOpt(isString), // string JSON
  created_at: isOpt(isString),
};

export const timelineListContract: Contract = {
  label: 'GET /api/ai-product/timeline',
  validate: (body) => {
    if (!isObject(body)) return false;
    const b = body as Record<string, unknown>;
    if (!isArray(b.items) || !isBoolean(b.hasMore)) return false;
    return (b.items as Record<string, unknown>[]).every((item) => hasShape(item, TIMELINE_ITEM));
  },
  describe: () => 'items[] (id,feature,event_type,status,title,body?,confidence:number|null,payload?,created_at?), hasMore:boolean',
};

const FEEDBACK_ROW: Record<string, Check> = {
  id: isString,
  feature: isString,
  item_id: isNullOr(isString), // ''/null bila tidak terkait timeline (P9 §13) — bare SELECT passthrough, toleran NULL
  rating: isString,
  reason: isNullOr(isString), // ''/null bila kosong
  created_at: isString,
};

export const feedbackListContract: Contract = {
  label: 'GET /api/ai-product/feedback',
  validate: (body) => {
    if (!isArray(body)) return false;
    return (body as Record<string, unknown>[]).every((row) => hasShape(row, FEEDBACK_ROW));
  },
  describe: () => 'array row: id,feature,item_id(string|null),rating,reason(string|null),created_at',
};

const MEMORY_ROW: Record<string, Check> = {
  id: isString,
  category: isString,
  key: isString,
  value: isString,
  source: isString, // manual | ai_inferred
  created_at: isString,
  updated_at: isString,
};

export const memoryListContract: Contract = {
  label: 'GET /api/ai-product/memory',
  validate: (body) => {
    if (!isArray(body)) return false;
    return (body as Record<string, unknown>[]).every((row) => hasShape(row, MEMORY_ROW));
  },
  describe: () => 'array row: id,category,key,value,source,created_at,updated_at',
};

export const trackPostContract: Contract = {
  label: 'POST /api/ai-product/track',
  validate: (body) => isObject(body) && (body as Record<string, unknown>).ok === true,
  describe: () => '{ ok: true }',
};

export const feedbackPostContract: Contract = {
  label: 'POST /api/ai-product/feedback',
  validate: (body) => isObject(body)
    && isString((body as Record<string, unknown>).id)
    && (body as Record<string, unknown>).ok === true,
  describe: () => '{ id: string, ok: true }',
};

export const memoryUpsertContract: Contract = {
  label: 'POST /api/ai-product/memory',
  validate: (body) => isObject(body)
    && isString((body as Record<string, unknown>).id)
    && (body as Record<string, unknown>).ok === true,
  describe: () => '{ id: string, ok: true }',
};

export const timelinePostContract: Contract = {
  label: 'POST /api/ai-product/timeline',
  validate: (body) => isObject(body)
    && isString((body as Record<string, unknown>).id)
    && (body as Record<string, unknown>).ok === true
    && isString((body as Record<string, unknown>).event_type),
  describe: () => '{ id: string, ok: true, event_type: string }',
};

export const timelineStatusPatchContract: Contract = {
  label: 'PATCH /api/ai-product/timeline/:id/status',
  validate: (body) => isObject(body)
    && (body as Record<string, unknown>).success === true
    && isString((body as Record<string, unknown>).id)
    && isString((body as Record<string, unknown>).status),
  describe: () => '{ success: true, id: string, status: string }',
};

// Shape §5 docs/api/ai-product-api.md — ConversationAnswer (subset wajib).
const CONVERSATION_STATS: Record<string, Check> = {
  income: isNumber,
  expense: isNumber,
  net: isNumber,
  prevIncome: isNumber,
  prevExpense: isNumber,
  prevNet: isNumber,
  expenseDeltaPct: isNullOr(isNumber),
  incomeDeltaPct: isNullOr(isNumber),
  transactionCount: isNumber,
  expenseCount: isNumber,
  incomeCount: isNumber,
  hasData: isBoolean,
};

export const conversationPostContract: Contract = {
  label: 'POST /api/ai-product/conversation',
  validate: (body) => {
    if (!isObject(body)) return false;
    const b = body as Record<string, unknown>;
    if (b.success !== true || !isString(b.query) || !isNumber(b.periodDays)) return false;
    if (!isObject(b.period)) return false;
    const period = b.period as Record<string, unknown>;
    if (!isString(period.startDate) || !isString(period.endDate) || !isString(period.label)) return false;
    if (!hasShape(b.stats as Record<string, unknown>, CONVERSATION_STATS)) return false;
    // narrative
    if (!isObject(b.narrative)) return false;
    const narrative = b.narrative as Record<string, unknown>;
    if (!isString(narrative.summary)) return false;
    if (!isArray(narrative.insights) || !isArray(narrative.recommendations)) return false;
    if (!(narrative.insights as Record<string, unknown>[]).every(
      (i) => isString(i.title) && isString(i.detail) && isString(i.severity),
    )) return false;
    if (!(narrative.recommendations as Record<string, unknown>[]).every(
      (r) => isString(r.title) && isString(r.action),
    )) return false;
    // chart + kumpulan data
    if (!isObject(b.chart) || !isArray((b.chart as Record<string, unknown>).daily)) return false;
    if (!((b.chart as Record<string, unknown>).daily as Record<string, unknown>[]).every(
      (d) => isString(d.date) && isNumber(d.income) && isNumber(d.expense),
    )) return false;
    for (const key of ['categories', 'topMerchants', 'topTransactions']) {
      if (!isArray(b[key])) return false;
    }
    if (!(b.topTransactions as Record<string, unknown>[]).every(
      (t) => isString(t.id) && isString(t.merchant) && isString(t.categoryName) && isNumber(t.amount),
    )) return false;
    // trust + requestId
    if (!isObject(b.trust) || !isString((b.trust as Record<string, unknown>).source)) return false;
    if (!isString(b.requestId)) return false;
    return true;
  },
  describe: () => 'success:true, query, periodDays, period{startDate,endDate,label}, stats{income,expense,net,prev*,deltaPct:number|null,counts,hasData}, narrative{summary,insights[],recommendations[]}, chart.daily[], categories[], topMerchants[], topTransactions[], trust{source,...}, requestId',
};

/** Shape 400 §0 — { error: string, errorCode: "VALIDATION_ERROR", details: string[] }. */
export const validationErrorContract: Contract = {
  label: '400 VALIDATION_ERROR (§0)',
  validate: (body) => isObject(body)
    && isString((body as Record<string, unknown>).error)
    && (body as Record<string, unknown>).errorCode === 'VALIDATION_ERROR'
    && isArray((body as Record<string, unknown>).details),
  describe: () => '{ error: string, errorCode: "VALIDATION_ERROR", details: string[] }',
};
