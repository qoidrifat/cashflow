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

    logger.info(
      { requestId: req.id, method: req.method, path: req.path, route, status, ms: durationMs, userId },
      'request',
    );
  });

  next();
}
