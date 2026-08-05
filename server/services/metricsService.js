/**
 * CF-053: MetricsService — records and queries CashFlow custom metrics.
 *
 * PRINCIPLES:
 * - Recording is NON-BLOCKING (fire-and-forget; errors swallowed internally).
 * - Uses the Turso/libSQL client (server-side) via getTurso().
 *   (Migrasi: sebelumnya memakai Supabase query-builder API yang tidak
 *   kompatibel dengan libSQL — semua endpoint admin metrics 500. Kini raw SQL
 *   dengan prepared statements.)
 * - Never logs PII/raw email body/base64/financial values to metadata.
 */

import crypto from 'node:crypto';
import { getTurso } from '../lib/turso.js';
import { AI_PRICING, USD_TO_IDR } from '../config/metricsConfig.js';
import { notifyTriggeredAlerts } from './alertNotifier.js';
import { aggregateAgentSearchEngagement, emptyAgentSearchEngagement } from '../lib/agentSearchEngagement.js';

function getMetricsClient() {
  return getTurso();
}

/**
 * Normalisasi bound waktu (ISO '2026-08-02T09:22:43.123Z' atau 'YYYY-MM-DD
 * HH:MM:SS') ke format kolom created_at DB: datetime('now') → 'YYYY-MM-DD
 * HH:MM:SS'. LATEN BUG (ditemukan Sprint 4): created_at disimpan space-format,
 * tapi route mengirim from/to ISO — string-comparison `created_at >= '...T...'`
 * selalu FALSE ('T' > ' ') → bucket "today" admin metrics 0 rows.
 */
function toDbTime(value) {
  if (!value) return value;
  const s = String(value);
  if (!s.includes('T')) return s;
  return s.replace('T', ' ').replace(/\.\d{1,3}Z?$/, '').replace(/Z$/, '');
}

/** Clamp rentang query ke maksimal MAX_RANGE_DAYS (H-1 — cegah scan tak terbatas). */
const MAX_RANGE_DAYS = 90;
function clampRange({ from, to, maxDays = MAX_RANGE_DAYS } = {}) {
  const maxMs = maxDays * 86400_000;
  let f = from || null;
  const t = to || null;
  if (f && !t && new Date(f).getTime() < Date.now() - maxMs) {
    f = new Date(Date.now() - maxMs).toISOString();
  }
  if (f && t) {
    const diffMs = new Date(t).getTime() - new Date(f).getTime();
    if (diffMs > maxMs) {
      f = new Date(new Date(t).getTime() - maxMs).toISOString();
    }
  }
  return { from: f, to: t };
}

/** Bangun WHERE + args untuk filter usage umum. */
function buildUsageWhere({ from, to, feature = null, status = 'all' } = {}) {
  const clauses = [];
  const args = [];
  if (from) { clauses.push('created_at >= ?'); args.push(toDbTime(from)); }
  if (to) { clauses.push('created_at <= ?'); args.push(toDbTime(to)); }
  if (feature) { clauses.push('feature = ?'); args.push(feature); }
  if (status === 'success') {
    clauses.push(`status = 'success'`);
  } else if (status === 'failed') {
    clauses.push(`status IN ('error', 'timeout', 'rate_limited')`);
  }
  return { where: clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '', args };
}

/**
 * Calculate estimated cost from token counts.
 * @returns {{ costUsd: number, costIdr: number }}
 */
export function calculateCost(provider, _model, promptTokens = 0, completionTokens = 0) {
  const pricing = AI_PRICING[provider];
  if (!pricing) return { costUsd: 0, costIdr: 0 };

  let costUsd = 0;
  if (pricing.perQueryUsd !== undefined) {
    costUsd = pricing.perQueryUsd;
  } else {
    const inputCost = (Number(promptTokens) || 0) / 1_000_000 * pricing.input;
    const outputCost = (Number(completionTokens) || 0) / 1_000_000 * pricing.output;
    costUsd = inputCost + outputCost;
  }

  const costIdr = costUsd * USD_TO_IDR;
  return {
    costUsd: Math.round(costUsd * 1_000_000) / 1_000_000,
    costIdr: Math.round(costIdr * 100) / 100,
  };
}

/**
 * Record an AI usage metric. NON-BLOCKING — returns a promise that never rejects.
 */
export async function recordAIUsage({
  feature,
  provider,
  model = null,
  promptTokens = 0,
  completionTokens = 0,
  executionTimeMs = null,
  status = 'success',
  errorMessage = null,
  userId = null,
  metadata = {},
}) {
  try {
    const client = getMetricsClient();
    if (!client) return;
    const { costUsd, costIdr } = calculateCost(provider, model, promptTokens, completionTokens);
    await client.execute({
      sql: `INSERT INTO ai_usage_metrics
            (id, user_id, feature, provider, model, prompt_tokens, completion_tokens,
             estimated_cost_usd, estimated_cost_idr, execution_time_ms, status, error_message, metadata)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        crypto.randomUUID(),
        userId ?? null,
        feature,
        provider,
        model,
        Math.max(0, Math.round(Number(promptTokens) || 0)),
        Math.max(0, Math.round(Number(completionTokens) || 0)),
        costUsd,
        costIdr,
        executionTimeMs == null ? null : Math.round(executionTimeMs),
        status,
        errorMessage ? String(errorMessage).slice(0, 500) : null,
        JSON.stringify(sanitizeMetadata(metadata)),
      ],
    });
  } catch {
    // swallow — metrics must never break the feature
  }
}

/**
 * Record a system metric. NON-BLOCKING.
 */
export async function recordSystemMetric({
  metricName,
  metricValue = 1,
  feature = null,
  userId = null,
  metadata = {},
}) {
  try {
    const client = getMetricsClient();
    if (!client) return;
    await client.execute({
      sql: `INSERT INTO system_metrics (id, metric_name, metric_value, feature, user_id, metadata)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [
        crypto.randomUUID(),
        metricName,
        Number(metricValue) || 0,
        feature,
        userId,
        JSON.stringify(sanitizeMetadata(metadata)),
      ],
    });
  } catch {
    // swallow
  }
}

/**
 * Remove sensitive keys/values from metadata before storage.
 */
function sanitizeMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {};
  const SENSITIVE = /(token|secret|key|jwt|authorization|credential|base64|image|body|raw|password|email)/i;
  const output = {};
  for (const [k, v] of Object.entries(metadata)) {
    if (SENSITIVE.test(k)) continue;
    if (typeof v === 'string' && v.length > 200) {
      output[k] = v.slice(0, 200);
    } else if (typeof v === 'object' && v !== null) {
      continue; // skip nested objects to avoid accidental PII
    } else {
      output[k] = v;
    }
  }
  return output;
}

/** Parse metadata TEXT JSON dengan aman (bisa string dari DB). */
function parseMetadata(value) {
  if (value == null || value === '') return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

// ===================== Query Functions =====================

/**
 * Aggregate AI usage over a date range (H-1: SQL aggregate — tidak lagi
 * SELECT * lalu agregat di JS; transfer hanya baris ringkas).
 * Bentuk output PERSIS sama (contract-safe):
 *   { costIdr, costUsd, tokens, calls, avgTimeMs, features: { f: { costIdr, costUsd, tokens, calls, successRate } } }
 */
export async function getAIUsageSummary({ from, to, feature = null } = {}) {
  const client = getMetricsClient();
  if (!client) return emptyUsageSummary();

  const clamped = clampRange({ from, to });
  const { where, args } = buildUsageWhere({ from: clamped.from, to: clamped.to, feature });
  try {
    const overall = await client.execute({
      sql: `SELECT
              COALESCE(SUM(estimated_cost_idr), 0) AS cost_idr,
              COALESCE(SUM(estimated_cost_usd), 0) AS cost_usd,
              COALESCE(SUM(total_tokens), 0) AS tokens,
              COUNT(*) AS calls,
              AVG(CASE WHEN execution_time_ms > 0 THEN execution_time_ms END) AS avg_ms
            FROM ai_usage_metrics${where}`,
      args,
    });
    const row = overall.rows[0] || {};

    // Sprint 2 (Cost Monitoring): tambah AVG execution_time_ms per fitur
    // (sebelumnya latency hanya ada di agregat keseluruhan). Additive — bentuk
    // contract summary (today/week/month) tidak berubah.
    const byFeature = await client.execute({
      sql: `SELECT feature,
              COALESCE(SUM(estimated_cost_idr), 0) AS cost_idr,
              COALESCE(SUM(estimated_cost_usd), 0) AS cost_usd,
              COALESCE(SUM(total_tokens), 0) AS tokens,
              COUNT(*) AS calls,
              COALESCE(SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END), 0) AS success,
              AVG(CASE WHEN execution_time_ms > 0 THEN execution_time_ms END) AS avg_ms
            FROM ai_usage_metrics${where}
            GROUP BY feature
            ORDER BY calls DESC`,
      args,
    });

    const featureSummary = {};
    for (const r of byFeature.rows) {
      const calls = Number(r.calls) || 0;
      featureSummary[r.feature || 'unknown'] = {
        costIdr: Math.round((Number(r.cost_idr) || 0) * 100) / 100,
        costUsd: Math.round((Number(r.cost_usd) || 0) * 1_000_000) / 1_000_000,
        tokens: Number(r.tokens) || 0,
        calls,
        avgTimeMs: r.avg_ms == null ? 0 : Math.round(Number(r.avg_ms)),
        successRate: calls > 0 ? Math.round((Number(r.success) / calls) * 1000) / 1000 : 0,
      };
    }

    const calls = Number(row.calls) || 0;
    return {
      costIdr: Math.round((Number(row.cost_idr) || 0) * 100) / 100,
      costUsd: Math.round((Number(row.cost_usd) || 0) * 1_000_000) / 1_000_000,
      tokens: Number(row.tokens) || 0,
      calls,
      avgTimeMs: row.avg_ms == null ? 0 : Math.round(Number(row.avg_ms)),
      features: featureSummary,
    };
  } catch {
    return emptyUsageSummary();
  }
}

function emptyUsageSummary() {
  return { costIdr: 0, costUsd: 0, tokens: 0, calls: 0, avgTimeMs: 0, features: {} };
}

/**
 * Agregasi cache-hit per fitur dari dua kumpulan baris yang SUDAH di-GROUP BY
 * feature (hits & misses). MURNI — tanpa DB, agar bisa di-unit-test (pola sama
 * dengan computeHitRateFromCounts / aggregateAgentSearchEngagement).
 *
 * @param {Array<{feature?: string, total?: number}>} hitRows  baris ai_cache_hit
 * @param {Array<{feature?: string, total?: number}>} missRows baris ai_cache_miss
 * @returns {Array<{feature: string, hits: number, misses: number, hitRate: number}>} urut total aktivitas desc
 */
export function aggregateCacheHitByFeature(hitRows = [], missRows = []) {
  const totals = new Map();
  const bump = (rows, key) => {
    for (const r of rows) {
      const feature = r?.feature || 'unknown';
      const cur = totals.get(feature) || { feature, hits: 0, misses: 0 };
      cur[key] += Number(r?.total) || 0;
      totals.set(feature, cur);
    }
  };
  bump(hitRows, 'hits');
  bump(missRows, 'misses');
  return [...totals.values()]
    .map((x) => ({ ...x, hitRate: computeHitRateFromCounts(x.hits, x.misses) }))
    .sort((a, b) => b.hits + b.misses - (a.hits + a.misses));
}

/**
 * Cache-hit per fitur dalam rentang (Sprint 2 Cost Monitoring). Dua query ringkas
 * (GROUP BY feature atas system_metrics ai_cache_hit / ai_cache_miss — keduanya
 * dicatat vertexContext.js DENGAN kolom feature terisi), lalu agregasi murni.
 */
export async function getCacheHitByFeature({ from, to } = {}) {
  const client = getMetricsClient();
  if (!client) return [];

  const clamped = clampRange({ from, to });
  const build = (metric) => {
    const clauses = ['metric_name = ?', 'feature IS NOT NULL'];
    const args = [metric];
    if (clamped.from) { clauses.push('created_at >= ?'); args.push(toDbTime(clamped.from)); }
    if (clamped.to) { clauses.push('created_at <= ?'); args.push(toDbTime(clamped.to)); }
    return { sql: `SELECT feature, COALESCE(SUM(metric_value), 0) AS total
                  FROM system_metrics WHERE ${clauses.join(' AND ')} GROUP BY feature`, args };
  };

  try {
    const [hits, misses] = await Promise.all([
      client.execute(build('ai_cache_hit')),
      client.execute(build('ai_cache_miss')),
    ]);
    return aggregateCacheHitByFeature(hits.rows, misses.rows);
  } catch {
    return [];
  }
}

/**
 * Daily cost trend over a date range (H-1: SQL GROUP BY hari — bukan agregat JS).
 * Output: [{ date, costIdr, tokens, calls }] diurutkan naik.
 */
export async function getCostTrend({ from, to } = {}) {
  const client = getMetricsClient();
  if (!client) return [];

  const clamped = clampRange({ from, to });
  const { where, args } = buildUsageWhere({ from: clamped.from, to: clamped.to });
  try {
    const { rows } = await client.execute({
      sql: `SELECT substr(created_at, 1, 10) AS day,
              COALESCE(SUM(estimated_cost_idr), 0) AS cost_idr,
              COALESCE(SUM(total_tokens), 0) AS tokens,
              COUNT(*) AS calls
            FROM ai_usage_metrics${where}
            GROUP BY day
            ORDER BY day ASC`,
      args,
    });
    return rows.map((r) => ({
      date: String(r.day),
      costIdr: Math.round((Number(r.cost_idr) || 0) * 100) / 100,
      tokens: Number(r.tokens) || 0,
      calls: Number(r.calls) || 0,
    }));
  } catch {
    return [];
  }
}

/**
 * Query system metrics with summary stats.
 */
export async function getSystemMetrics({ metricName, from, to, feature = null } = {}) {
  const client = getMetricsClient();
  if (!client) return { data: [], summary: { total: 0, avg: 0, min: 0, max: 0, count: 0 } };

  const clauses = [];
  const args = [];
  if (metricName) { clauses.push('metric_name = ?'); args.push(metricName); }
  if (feature) { clauses.push('feature = ?'); args.push(feature); }
  // Sprint 4 (review): normalize ISO bounds ke format kolom space-format (bug laten yang sama).
  if (from) { clauses.push('created_at >= ?'); args.push(toDbTime(from)); }
  if (to) { clauses.push('created_at <= ?'); args.push(toDbTime(to)); }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';

  try {
    const { rows } = await client.execute({
      sql: `SELECT * FROM system_metrics${where} ORDER BY created_at DESC LIMIT 1000`,
      args,
    });

    const values = rows.map((r) => Number(r.metric_value) || 0);
    const total = values.reduce((a, b) => a + b, 0);
    return {
      data: rows,
      summary: {
        total: Math.round(total * 100) / 100,
        avg: values.length ? Math.round((total / values.length) * 100) / 100 : 0,
        min: values.length ? Math.min(...values) : 0,
        max: values.length ? Math.max(...values) : 0,
        count: values.length,
      },
    };
  } catch {
    return { data: [], summary: { total: 0, avg: 0, min: 0, max: 0, count: 0 } };
  }
}

/**
 * Agent Search engagement over a range: counts + top suggested queries + CTR,
 * dari system_metrics (Sprint 1.9). Query SQL ringkas (hanya kolom yang
 * dibutuhkan), lalu agregasi via fungsi murni (lib/agentSearchEngagement.js).
 */
export async function getAgentSearchEngagement({ from, to } = {}) {
  const client = getMetricsClient();
  if (!client) return emptyAgentSearchEngagement();

  const clamped = clampRange({ from, to });
  const clauses = ['metric_name IN (?, ?, ?)'];
  const args = ['agent_search_count', 'agent_search_click', 'agent_search_suggestion_used'];
  if (clamped.from) { clauses.push('created_at >= ?'); args.push(toDbTime(clamped.from)); }
  if (clamped.to) { clauses.push('created_at <= ?'); args.push(toDbTime(clamped.to)); }

  try {
    // LIMIT 5000: dashboard default 7 hari (~700+/hari aman). Untuk window
    // 90-hari pada DB sangat aktif, baris tertua bisa terpotong → undercount
    // (trade-off disengaja: dashboard ringkas vs presisi ekstrem).
    const { rows } = await client.execute({
      sql: `SELECT metric_name, metric_value, metadata
            FROM system_metrics
            WHERE ${clauses.join(' AND ')}
            ORDER BY created_at DESC
            LIMIT 5000`,
      args,
    });
    return aggregateAgentSearchEngagement({
      countRows: rows.filter((r) => r.metric_name === 'agent_search_count'),
      clickRows: rows.filter((r) => r.metric_name === 'agent_search_click'),
      suggestionRows: rows.filter((r) => r.metric_name === 'agent_search_suggestion_used'),
    });
  } catch {
    return emptyAgentSearchEngagement();
  }
}

/**
 * Feature health: success rate, failure count, avg time, total calls (H-1: SQL
 * aggregate — tidak transfer semua rows). Output shape tidak berubah.
 */
export async function getFeatureHealth({ feature, from, to } = {}) {
  const client = getMetricsClient();
  if (!client) return { feature, totalCalls: 0, successRate: 0, failureCount: 0, avgTimeMs: 0 };

  const clamped = clampRange({ from, to });
  const { where, args } = buildUsageWhere({ feature, from: clamped.from, to: clamped.to });
  try {
    const { rows } = await client.execute({
      sql: `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END), 0) AS success,
              AVG(CASE WHEN execution_time_ms > 0 THEN execution_time_ms END) AS avg_ms
            FROM ai_usage_metrics${where}`,
      args,
    });
    const row = rows[0] || {};
    const total = Number(row.total) || 0;
    const success = Number(row.success) || 0;
    return {
      feature,
      totalCalls: total,
      successRate: total > 0 ? Math.round((success / total) * 1000) / 1000 : 0,
      failureCount: total - success,
      avgTimeMs: row.avg_ms == null ? 0 : Math.round(Number(row.avg_ms)),
    };
  } catch {
    return { feature, totalCalls: 0, successRate: 0, failureCount: 0, avgTimeMs: 0 };
  }
}

// Statuses that count as a failed AI call.
const FAILED_STATUSES = ['error', 'timeout', 'rate_limited'];

/**
 * Sanitize an error message for safe display: strip file paths, tokens,
 * JWTs, API keys, and stack traces. Never expose secrets/PII.
 */
export function sanitizeErrorMessage(message) {
  if (!message) return null;
  let text = String(message);
  // Drop everything from the first stack-trace frame onward.
  text = text.split(/\n\s*at\s+/)[0];
  // Redact JWTs (header.payload.signature).
  text = text.replace(/\b[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[redacted-token]');
  // Redact bearer tokens / api keys / long secrets.
  text = text.replace(/(bearer|token|key|secret|password|authorization)\s*[:=]\s*\S+/gi, '$1 [redacted]');
  text = text.replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[redacted]');
  // Redact Windows + POSIX file paths.
  text = text.replace(/[A-Za-z]:\\[^\s'"]+/g, '[path]');
  text = text.replace(/(?:\/[^\s/'"]+){2,}/g, '[path]');
  // Collapse whitespace and cap length.
  text = text.replace(/\s+/g, ' ').trim();
  return text.slice(0, 400) || null;
}

/**
 * Paginated per-call history for a single feature.
 * @param {{ feature: string, status?: 'all'|'success'|'failed', from?: string, to?: string, page?: number, pageSize?: number }} opts
 * @returns {{ feature: string, summary: object, page: number, pageSize: number, total: number, items: object[] }}
 */
export async function getFeatureCalls({
  feature,
  status = 'all',
  from,
  to,
  page = 1,
  pageSize = 20,
} = {}) {
  const safePage = Math.max(1, Math.round(Number(page) || 1));
  const safeSize = Math.min(100, Math.max(1, Math.round(Number(pageSize) || 20)));
  const clamped = clampRange({ from, to });
  const summary = await getFeatureHealth({ feature, from: clamped.from, to: clamped.to });

  const client = getMetricsClient();
  if (!client) {
    return { feature, summary, page: safePage, pageSize: safeSize, total: 0, items: [] };
  }

  const { where, args } = buildUsageWhere({ feature, from: clamped.from, to: clamped.to, status });
  try {
    const { rows: countRows } = await client.execute({
      sql: `SELECT COUNT(*) AS cnt FROM ai_usage_metrics${where}`,
      args,
    });
    const total = Number(countRows[0]?.cnt) || 0;

    const fromIdx = (safePage - 1) * safeSize;
    const { rows } = await client.execute({
      sql: `SELECT id, created_at, provider, model, prompt_tokens, completion_tokens,
                   total_tokens, estimated_cost_idr, execution_time_ms, status, error_message, metadata
            FROM ai_usage_metrics${where}
            ORDER BY created_at DESC
            LIMIT ? OFFSET ?`,
      args: [...args, safeSize, fromIdx],
    });

    const items = rows.map((r) => ({
      id: r.id,
      createdAt: r.created_at,
      provider: r.provider,
      model: r.model,
      promptTokens: Number(r.prompt_tokens) || 0,
      completionTokens: Number(r.completion_tokens) || 0,
      totalTokens: Number(r.total_tokens) || 0,
      costIdr: Math.round((Number(r.estimated_cost_idr) || 0) * 100) / 100,
      executionTimeMs: r.execution_time_ms == null ? null : Number(r.execution_time_ms),
      status: r.status,
      errorMessage: r.status === 'success' ? null : sanitizeErrorMessage(r.error_message),
      metadata: sanitizeMetadata(parseMetadata(r.metadata)),
    }));

    return {
      feature,
      summary,
      page: safePage,
      pageSize: safeSize,
      total,
      items,
    };
  } catch {
    return { feature, summary, page: safePage, pageSize: safeSize, total: 0, items: [] };
  }
}

/**
 * Evaluate alert rules against recent data.
 * H-3 (Sprint 4): hasil di-cache 60 detik (checkAlerts berjalan di request path
 * admin; loop windowed per rule mahal bila tiap buka halaman).
 */
const ALERTS_CACHE_MS = 60_000;
let alertsCache = { value: null, expiresAt: 0 };

export async function checkAlerts() {
  const now = Date.now();
  if (alertsCache.value !== null && now < alertsCache.expiresAt) {
    return alertsCache.value;
  }
  const value = await computeAlerts();
  alertsCache = { value, expiresAt: now + ALERTS_CACHE_MS };
  return value;
}

/**
 * Evaluasi alert TANPA cache — dipakai scheduler berkala (MONITORING_AUDIT
 * gap #7) agar alert dievaluasi & notifikasi terkirim walau tidak ada admin
 * yang membuka dashboard. checkAlerts() (cache 60s) tetap untuk request path.
 */
export async function runAlertEvaluation() {
  return computeAlerts();
}

async function computeAlerts() {
  const client = getMetricsClient();
  if (!client) return [];

  let rules = [];
  try {
    const { rows } = await client.execute({
      sql: `SELECT * FROM alert_rules WHERE is_active = 1`,
      args: [],
    });
    rules = rows;
  } catch {
    return [];
  }

  const results = [];
  const triggeredRules = [];
  for (const rule of rules) {
    // Sprint 4 (review): windowStart harus space-format agar cocok dengan created_at (bug laten).
    const windowStart = toDbTime(new Date(Date.now() - rule.window_minutes * 60_000).toISOString());
    let currentValue = 0;

    try {
      if (rule.metric_name === 'estimated_cost_idr') {
        const { rows } = await client.execute({
          sql: `SELECT estimated_cost_idr FROM ai_usage_metrics WHERE created_at >= ?`,
          args: [windowStart],
        });
        currentValue = (rows || []).reduce((a, r) => a + (Number(r.estimated_cost_idr) || 0), 0);
      } else if (rule.metric_name === 'cache_hit_rate') {
        // Hit rate LRU cache: SUM(ai_cache_hit) / (SUM(ai_cache_hit) + SUM(ai_cache_miss))
        // dalam window. Wajib branch SEBELUM `endsWith('_rate')` — cache_hit_rate
        // juga berakhiran '_rate' tapi bukan error-rate (computeRate tidak paham).
        currentValue = await computeCacheHitRate(client, windowStart);
      } else if (rule.metric_name.endsWith('_rate')) {
        currentValue = await computeRate(client, rule.metric_name, windowStart);
      } else {
        const { rows } = await client.execute({
          sql: `SELECT metric_value FROM system_metrics WHERE metric_name = ? AND created_at >= ?`,
          args: [rule.metric_name, windowStart],
        });
        currentValue = (rows || []).reduce((a, r) => a + (Number(r.metric_value) || 0), 0);
      }
    } catch {
      currentValue = 0;
    }

    const triggered = evaluateCondition(currentValue, rule.condition, Number(rule.threshold));
    if (triggered) {
      client.execute({
        sql: `UPDATE alert_rules SET last_triggered_at = ? WHERE id = ?`,
        args: [new Date().toISOString(), rule.id],
      }).then(() => {}, () => {});
      triggeredRules.push({
        name: rule.name,
        metricName: rule.metric_name,
        status: 'triggered',
        currentValue: Math.round(currentValue * 1000) / 1000,
        threshold: Number(rule.threshold),
        condition: rule.condition,
        windowMinutes: rule.window_minutes,
      });
    }
    results.push({
      name: rule.name,
      metricName: rule.metric_name,
      status: triggered ? 'triggered' : 'ok',
      currentValue: Math.round(currentValue * 1000) / 1000,
      threshold: Number(rule.threshold),
      condition: rule.condition,
      windowMinutes: rule.window_minutes,
    });
  }

  // Alert channel (MONITORING_AUDIT gap #1): kirim notifikasi untuk rule yang
  // baru triggered — fire-and-forget, channel tidak boleh memblokir evaluasi.
  if (triggeredRules.length > 0) {
    notifyTriggeredAlerts(triggeredRules).catch(() => {});
  }

  return results;
}

/**
 * Hit rate AI response cache dalam window (alert rule `cache_hit_rate`):
 * SUM(ai_cache_hit) / (SUM(ai_cache_hit) + SUM(ai_cache_miss)) — dihitung dari
 * system_metrics yang dicatat generateVertexContent (Sprint 3).
 *
 * Bila TIDAK ada aktivitas cache di window (total = 0) → return 1.0 (sehat):
 * tanpa data, tidak ada degradasi yang bisa diukur — jangan trigger alert.
 */
/**
 * Hit rate murni dari dua counter (diekstrak agar bisa di-unit-test tanpa DB).
 * total = 0 (tanpa aktivitas cache) → 1.0 (sehat — tidak ada degradasi terukur).
 */
export function computeHitRateFromCounts(hit, miss) {
  const total = Number(hit) + Number(miss);
  return total > 0 ? Math.round((Number(hit) / total) * 1000) / 1000 : 1;
}

async function computeCacheHitRate(client, windowStart) {
  try {
    const [hits, misses] = await Promise.all([
      client.execute({
        sql: `SELECT COALESCE(SUM(metric_value), 0) AS v FROM system_metrics WHERE metric_name = 'ai_cache_hit' AND created_at >= ?`,
        args: [windowStart],
      }),
      client.execute({
        sql: `SELECT COALESCE(SUM(metric_value), 0) AS v FROM system_metrics WHERE metric_name = 'ai_cache_miss' AND created_at >= ?`,
        args: [windowStart],
      }),
    ]);
    const hit = Number(hits.rows[0]?.v) || 0;
    const miss = Number(misses.rows[0]?.v) || 0;
    return computeHitRateFromCounts(hit, miss);
  } catch {
    return 1; // kegagalan query ≠ degradasi cache — jangan false-positive alert
  }
}

async function computeRate(client, metricName, windowStart) {
  // e.g. agent_search_error_rate, ocr_failure_rate
  const feature = metricName.startsWith('agent_search') ? 'agent_search'
    : metricName.startsWith('ocr') ? 'ocr_receipt' : null;
  if (!feature) return 0;
  try {
    const { rows } = await client.execute({
      sql: `SELECT status FROM ai_usage_metrics WHERE feature = ? AND created_at >= ?`,
      args: [feature, windowStart],
    });
    if (!rows || rows.length === 0) return 0;
    const failures = rows.filter((r) => r.status !== 'success').length;
    return failures / rows.length;
  } catch {
    return 0;
  }
}

function evaluateCondition(value, condition, threshold) {
  if (condition === 'gt') return value > threshold;
  if (condition === 'lt') return value < threshold;
  if (condition === 'eq') return value === threshold;
  return false;
}

export default {
  calculateCost,
  recordAIUsage,
  recordSystemMetric,
  getAIUsageSummary,
  getCostTrend,
  getCacheHitByFeature,
  aggregateCacheHitByFeature,
  getSystemMetrics,
  aggregateAgentSearchEngagement,
  getAgentSearchEngagement,
  getFeatureHealth,
  getFeatureCalls,
  sanitizeErrorMessage,
  checkAlerts,
  runAlertEvaluation,
  computeHitRateFromCounts,
};
