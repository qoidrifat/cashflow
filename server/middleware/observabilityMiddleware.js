/**
 * Observability Middleware (Sprint 2 — OBSERVABILITY_REVIEW).
 *
 * 1. requestIdMiddleware — req.id dari header x-request-id (client) atau generate;
 *    echo ke response header agar klien bisa correlate request ↔ log/metrics.
 * 2. httpMetricsMiddleware — log request structured (pino) + catat HTTP metrics
 *    (http_2xx/3xx/4xx/5xx_total, http_latency_ms) ke system_metrics (non-blocking).
 *    Di-skip: SSE (/api/events, koneksi long-lived) + semua health endpoint
 *    (/api/health, /api/gemini/health, /api/agent-search/health) — polling
 *    load balancer/uptime monitor tidak boleh membanjiri system_metrics.
 *
 * Non-blocking: kegagalan pencatatan metrics ditelan di metricsService (tidak
 * pernah memengaruhi respons utama).
 */
import crypto from 'node:crypto';
import { logger } from '../lib/logger.js';
import metricsService from '../services/metricsService.js';

/**
 * Sinyal aktivitas user kanonik untuk retention (D1/D7/D14/D28 — PRODUCT_METRICS §5).
 * Dicatat di httpMetricsMiddleware (yang sudah skip health/SSE): satu baris
 * `user_active` per user per hari UTC (dedupe via SELECT → INSERT non-blocking).
 * non-PII: hanya user_id internal + hari UTC (metadata { day }).
 */
export async function recordUserActive(userId) {
  if (!userId) return;
  try {
    const now = new Date();
    const day = now.toISOString().slice(0, 10); // UTC
    // Batas hari UTC (string-comparison aman: kolom created_at space-format
    // 'YYYY-MM-DD HH:MM:SS' — prefix 'YYYY-MM-DD' terbanding sama).
    const todayStartUtc = `${day} 00:00:00`;
    const client = metricsService.getMetricsClient && metricsService.getMetricsClient();
    if (!client) return;
    const { rows } = await client.execute({
      sql: `SELECT 1 AS x FROM system_metrics
            WHERE metric_name = 'user_active' AND user_id = ? AND created_at >= ? LIMIT 1`,
      args: [userId, todayStartUtc],
    });
    if (rows.length > 0) return; // sudah tercatat hari ini — dedupe
    await metricsService.recordSystemMetric({
      metricName: 'user_active',
      feature: 'app',
      userId,
      metadata: { day },
    });
    // CATATAN (race): SELECT→INSERT tidak atomik — 2 request konkuren user sama
    // bisa menulis 2 baris di hari sama. Analitik WAJIB pakai COUNT(DISTINCT
    // user_id), bukan SUM(metric_value). Volume beta (10-30 user) dapat diterima.
  } catch {
    // non-blocking — kegagalan tidak boleh memengaruhi request
  }
}

export function requestIdMiddleware(req, res, next) {
  const incoming = req.headers['x-request-id'];
  req.id = (Array.isArray(incoming) ? incoming[0] : incoming)
    || `req_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  res.setHeader('x-request-id', req.id);
  next();
}

export function httpMetricsMiddleware(req, res, next) {
  const start = Date.now();

  res.on('finish', () => {
    if (req.path === '/api/events') return; // SSE long-lived
    if (req.path.endsWith('/health')) return; // load balancer / uptime polling

    const durationMs = Date.now() - start;
    const status = res.statusCode;
    const cls = status >= 500 ? '5xx' : status >= 400 ? '4xx' : status >= 300 ? '3xx' : '2xx';
    const route = req.route?.path || req.path;
    const meta = { route, method: req.method, requestId: req.id };
    const userId = req.user?.id || null;

    metricsService.recordSystemMetric({
      metricName: `http_${cls}_total`,
      metricValue: 1,
      feature: 'http',
      userId,
      metadata: meta,
    });
    metricsService.recordSystemMetric({
      metricName: 'http_latency_ms',
      metricValue: durationMs,
      feature: 'http',
      userId,
      metadata: meta,
    });
    // Retention signal: satu baris user_active per user per hari (dedupe di
    // recordUserActive). Fire-and-forget — tidak memblokir respons.
    if (userId) {
      recordUserActive(userId).catch(() => {});
    }

    logger.info(
      { requestId: req.id, method: req.method, path: req.path, route, status, ms: durationMs, userId },
      'request',
    );
  });

  next();
}
