/**
 * CF-053: MetricsService — records and queries CashFlow custom metrics.
 *
 * PRINCIPLES:
 * - Recording is NON-BLOCKING (fire-and-forget; errors swallowed internally).
 * - Uses the Supabase service-role client (server-side, explicit intent).
 * - Never logs PII/raw email body/base64/financial values to metadata.
 */

import { getTurso } from '../lib/turso.js';
import { AI_PRICING, USD_TO_IDR } from '../config/metricsConfig.js';

function getMetricsClient() {
  return getTurso();
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
    await client.from('ai_usage_metrics').insert({
      user_id: userId,
      feature,
      provider,
      model,
      prompt_tokens: Math.max(0, Math.round(Number(promptTokens) || 0)),
      completion_tokens: Math.max(0, Math.round(Number(completionTokens) || 0)),
      estimated_cost_usd: costUsd,
      estimated_cost_idr: costIdr,
      execution_time_ms: executionTimeMs == null ? null : Math.round(executionTimeMs),
      status,
      error_message: errorMessage ? String(errorMessage).slice(0, 500) : null,
      metadata: sanitizeMetadata(metadata),
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
    await client.from('system_metrics').insert({
      metric_name: metricName,
      metric_value: Number(metricValue) || 0,
      feature,
      user_id: userId,
      metadata: sanitizeMetadata(metadata),
    });
  } catch {
    // swallow
  }
}

/**
 * Remove sensitive keys/values from metadata before storage.
 */
function sanitizeMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object') return {};
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

// ===================== Query Functions =====================

/**
 * Aggregate AI usage over a date range.
 */
export async function getAIUsageSummary({ from, to, feature = null } = {}) {
  const client = getMetricsClient();
  if (!client) return emptyUsageSummary();

  let query = client.from('ai_usage_metrics').select('*');
  if (from) query = query.gte('created_at', from);
  if (to) query = query.lte('created_at', to);
  if (feature) query = query.eq('feature', feature);

  const { data, error } = await query;
  if (error || !data) return emptyUsageSummary();

  return aggregateUsage(data);
}

function aggregateUsage(rows) {
  let costIdr = 0;
  let costUsd = 0;
  let tokens = 0;
  let timeSum = 0;
  let timeCount = 0;
  const features = {};

  for (const r of rows) {
    costIdr += Number(r.estimated_cost_idr) || 0;
    costUsd += Number(r.estimated_cost_usd) || 0;
    tokens += Number(r.total_tokens) || 0;
    if (r.execution_time_ms != null) {
      timeSum += Number(r.execution_time_ms) || 0;
      timeCount += 1;
    }
    const f = r.feature || 'unknown';
    if (!features[f]) features[f] = { costIdr: 0, costUsd: 0, tokens: 0, calls: 0, success: 0 };
    features[f].costIdr += Number(r.estimated_cost_idr) || 0;
    features[f].costUsd += Number(r.estimated_cost_usd) || 0;
    features[f].tokens += Number(r.total_tokens) || 0;
    features[f].calls += 1;
    if (r.status === 'success') features[f].success += 1;
  }

  const featureSummary = {};
  for (const [f, v] of Object.entries(features)) {
    featureSummary[f] = {
      costIdr: Math.round(v.costIdr * 100) / 100,
      costUsd: Math.round(v.costUsd * 1_000_000) / 1_000_000,
      tokens: v.tokens,
      calls: v.calls,
      successRate: v.calls > 0 ? Math.round((v.success / v.calls) * 1000) / 1000 : 0,
    };
  }

  return {
    costIdr: Math.round(costIdr * 100) / 100,
    costUsd: Math.round(costUsd * 1_000_000) / 1_000_000,
    tokens,
    calls: rows.length,
    avgTimeMs: timeCount > 0 ? Math.round(timeSum / timeCount) : 0,
    features: featureSummary,
  };
}

function emptyUsageSummary() {
  return { costIdr: 0, costUsd: 0, tokens: 0, calls: 0, avgTimeMs: 0, features: {} };
}

/**
 * Daily cost trend over a date range.
 */
export async function getCostTrend({ from, to } = {}) {
  const client = getMetricsClient();
  if (!client) return [];

  let query = client.from('ai_usage_metrics').select('created_at, estimated_cost_idr, total_tokens');
  if (from) query = query.gte('created_at', from);
  if (to) query = query.lte('created_at', to);

  const { data, error } = await query;
  if (error || !data) return [];

  const byDay = {};
  for (const r of data) {
    const day = String(r.created_at).slice(0, 10);
    if (!byDay[day]) byDay[day] = { date: day, costIdr: 0, tokens: 0, calls: 0 };
    byDay[day].costIdr += Number(r.estimated_cost_idr) || 0;
    byDay[day].tokens += Number(r.total_tokens) || 0;
    byDay[day].calls += 1;
  }
  return Object.values(byDay)
    .map((d) => ({ ...d, costIdr: Math.round(d.costIdr * 100) / 100 }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Query system metrics with summary stats.
 */
export async function getSystemMetrics({ metricName, from, to, feature = null } = {}) {
  const client = getMetricsClient();
  if (!client) return { data: [], summary: { total: 0, avg: 0, min: 0, max: 0, count: 0 } };

  let query = client.from('system_metrics').select('*').order('created_at', { ascending: false }).limit(1000);
  if (metricName) query = query.eq('metric_name', metricName);
  if (feature) query = query.eq('feature', feature);
  if (from) query = query.gte('created_at', from);
  if (to) query = query.lte('created_at', to);

  const { data, error } = await query;
  if (error || !data) return { data: [], summary: { total: 0, avg: 0, min: 0, max: 0, count: 0 } };

  const values = data.map((r) => Number(r.metric_value) || 0);
  const total = values.reduce((a, b) => a + b, 0);
  return {
    data,
    summary: {
      total: Math.round(total * 100) / 100,
      avg: values.length ? Math.round((total / values.length) * 100) / 100 : 0,
      min: values.length ? Math.min(...values) : 0,
      max: values.length ? Math.max(...values) : 0,
      count: values.length,
    },
  };
}

/**
 * Feature health: success rate, failure count, avg time, total calls.
 */
export async function getFeatureHealth({ feature, from, to } = {}) {
  const client = getMetricsClient();
  if (!client) return { feature, totalCalls: 0, successRate: 0, failureCount: 0, avgTimeMs: 0 };

  let query = client.from('ai_usage_metrics').select('status, execution_time_ms').eq('feature', feature);
  if (from) query = query.gte('created_at', from);
  if (to) query = query.lte('created_at', to);

  const { data, error } = await query;
  if (error || !data) return { feature, totalCalls: 0, successRate: 0, failureCount: 0, avgTimeMs: 0 };

  const total = data.length;
  const success = data.filter((r) => r.status === 'success').length;
  const failureCount = total - success;
  const times = data.map((r) => Number(r.execution_time_ms) || 0).filter((t) => t > 0);
  const avgTimeMs = times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : 0;

  return {
    feature,
    totalCalls: total,
    successRate: total > 0 ? Math.round((success / total) * 1000) / 1000 : 0,
    failureCount,
    avgTimeMs,
  };
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
  const summary = await getFeatureHealth({ feature, from, to });

  const client = getMetricsClient();
  if (!client) {
    return { feature, summary, page: safePage, pageSize: safeSize, total: 0, items: [] };
  }

  let query = client
    .from('ai_usage_metrics')
    .select(
      'id, created_at, provider, model, prompt_tokens, completion_tokens, total_tokens, estimated_cost_idr, execution_time_ms, status, error_message, metadata',
      { count: 'exact' },
    )
    .eq('feature', feature);

  if (from) query = query.gte('created_at', from);
  if (to) query = query.lte('created_at', to);
  if (status === 'success') query = query.eq('status', 'success');
  else if (status === 'failed') query = query.in('status', FAILED_STATUSES);

  const fromIdx = (safePage - 1) * safeSize;
  const toIdx = fromIdx + safeSize - 1;
  query = query.order('created_at', { ascending: false }).range(fromIdx, toIdx);

  const { data, error, count } = await query;
  if (error || !data) {
    return { feature, summary, page: safePage, pageSize: safeSize, total: 0, items: [] };
  }

  const items = data.map((r) => ({
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
    metadata: sanitizeMetadata(r.metadata),
  }));

  return {
    feature,
    summary,
    page: safePage,
    pageSize: safeSize,
    total: Number(count) || 0,
    items,
  };
}

/**
 * Evaluate alert rules against recent data.
 */
export async function checkAlerts() {
  const client = getMetricsClient();
  if (!client) return [];

  const { data: rules, error } = await client.from('alert_rules').select('*').eq('is_active', true);
  if (error || !rules) return [];

  const results = [];
  for (const rule of rules) {
    const windowStart = new Date(Date.now() - rule.window_minutes * 60_000).toISOString();
    let currentValue = 0;

    try {
      if (rule.metric_name === 'estimated_cost_idr') {
        const { data } = await client
          .from('ai_usage_metrics')
          .select('estimated_cost_idr')
          .gte('created_at', windowStart);
        currentValue = (data || []).reduce((a, r) => a + (Number(r.estimated_cost_idr) || 0), 0);
      } else if (rule.metric_name.endsWith('_rate')) {
        currentValue = await computeRate(client, rule.metric_name, windowStart);
      } else {
        const { data } = await client
          .from('system_metrics')
          .select('metric_value')
          .eq('metric_name', rule.metric_name)
          .gte('created_at', windowStart);
        currentValue = (data || []).reduce((a, r) => a + (Number(r.metric_value) || 0), 0);
      }
    } catch {
      currentValue = 0;
    }

    const triggered = evaluateCondition(currentValue, rule.condition, Number(rule.threshold));
    if (triggered) {
      client.from('alert_rules').update({ last_triggered_at: new Date().toISOString() }).eq('id', rule.id).then(() => {}, () => {});
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
  return results;
}

async function computeRate(client, metricName, windowStart) {
  // e.g. agent_search_error_rate, ocr_failure_rate
  const feature = metricName.startsWith('agent_search') ? 'agent_search'
    : metricName.startsWith('ocr') ? 'ocr_receipt' : null;
  if (!feature) return 0;
  const { data } = await client
    .from('ai_usage_metrics')
    .select('status')
    .eq('feature', feature)
    .gte('created_at', windowStart);
  if (!data || data.length === 0) return 0;
  const failures = data.filter((r) => r.status !== 'success').length;
  return failures / data.length;
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
  getSystemMetrics,
  getFeatureHealth,
  getFeatureCalls,
  sanitizeErrorMessage,
  checkAlerts,
};
