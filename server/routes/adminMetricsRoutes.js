/**
 * Admin Monitoring Routes (CF-053) — P4.14 ekstraksi dari index.js
 *
 * Endpoints:
 *   GET /api/admin/metrics/ai-usage
 *   GET /api/admin/metrics/system
 *   GET /api/admin/metrics/summary
 *   GET /api/admin/metrics/feature-health
 *   GET /api/admin/metrics/feature/:feature/calls
 *   GET /api/admin/metrics/alerts
 *
 * Auth: req.user dari authMiddleware (Better Auth) + ADMIN_EMAILS env.
 */
import metricsService from '../services/metricsService.js';
import { getAdminEmails, FEATURES } from '../config/metricsConfig.js';

/**
 * Resolve admin user dari session Better Auth (req.user diisi authMiddleware).
 * Admin = email di ADMIN_EMAILS env.
 * Migrasi dari validasi Supabase JWT — kini memakai cookie session Better Auth
 * yang sama dengan seluruh route lain (CF-053 admin monitoring fix).
 */
async function resolveAdmin(req) {
  const user = req.user;
  if (!user?.email) {
    const err = new Error('Autentikasi diperlukan. Silakan login terlebih dahulu.');
    err.status = 401;
    throw err;
  }
  const email = String(user.email).toLowerCase();
  const admins = getAdminEmails();
  if (admins.length === 0 || !admins.includes(email)) {
    const err = new Error('Akses ditolak. Hanya admin yang dapat mengakses monitoring.');
    err.status = 403;
    throw err;
  }
  return { userId: user.id, email };
}

function sendAdminError(res, error) {
  const status = error?.status || 500;
  const message = status === 401 ? 'Autentikasi diperlukan.'
    : status === 403 ? 'Akses ditolak. Khusus admin.'
    : status === 400 ? (error.message || 'Parameter tidak valid.')
    : 'Terjadi error saat memuat data monitoring.';
  return res.status(status).json({ ok: false, code: `ADMIN_METRICS_${status}`, message });
}

function parseDateRange(req, defaultDays = 7) {
  const to = req.query.to ? new Date(req.query.to) : new Date();
  const from = req.query.from ? new Date(req.query.from) : new Date(Date.now() - defaultDays * 86400_000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    const err = new Error('Parameter from/to harus tanggal ISO valid.');
    err.status = 400;
    throw err;
  }
  return { from: from.toISOString(), to: to.toISOString() };
}

export function registerAdminMetricsRoutes(app) {
  // GET /api/admin/metrics/ai-usage?from&to&feature
  app.get('/api/admin/metrics/ai-usage', async (req, res) => {
    try {
      await resolveAdmin(req);
      const { from, to } = parseDateRange(req);
      const feature = req.query.feature && FEATURES.includes(req.query.feature) ? req.query.feature : null;
      const summary = await metricsService.getAIUsageSummary({ from, to, feature });
      const trend = await metricsService.getCostTrend({ from, to });
      return res.json({ ok: true, summary, trend });
    } catch (error) {
      return sendAdminError(res, error);
    }
  });

  // GET /api/admin/metrics/system?metric_name&from&to&feature
  app.get('/api/admin/metrics/system', async (req, res) => {
    try {
      await resolveAdmin(req);
      const { from, to } = parseDateRange(req);
      const feature = req.query.feature && FEATURES.includes(req.query.feature) ? req.query.feature : null;
      const result = await metricsService.getSystemMetrics({
        metricName: req.query.metric_name || null, from, to, feature,
      });
      return res.json({ ok: true, ...result });
    } catch (error) {
      return sendAdminError(res, error);
    }
  });

  // GET /api/admin/metrics/summary — today/week/month + per-feature
  app.get('/api/admin/metrics/summary', async (req, res) => {
    try {
      await resolveAdmin(req);
      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
      const monthAgo = new Date(Date.now() - 30 * 86400_000).toISOString();
      const nowIso = now.toISOString();

      const [today, week, month] = await Promise.all([
        metricsService.getAIUsageSummary({ from: startOfDay, to: nowIso }),
        metricsService.getAIUsageSummary({ from: weekAgo, to: nowIso }),
        metricsService.getAIUsageSummary({ from: monthAgo, to: nowIso }),
      ]);

      return res.json({
        ok: true,
        today: { costIdr: today.costIdr, tokens: today.tokens, calls: today.calls, avgTimeMs: today.avgTimeMs },
        week: { costIdr: week.costIdr, tokens: week.tokens, calls: week.calls, avgTimeMs: week.avgTimeMs },
        month: { costIdr: month.costIdr, tokens: month.tokens, calls: month.calls, avgTimeMs: month.avgTimeMs },
        features: week.features,
      });
    } catch (error) {
      return sendAdminError(res, error);
    }
  });

  // GET /api/admin/metrics/feature-health?feature&from&to
  app.get('/api/admin/metrics/feature-health', async (req, res) => {
    try {
      await resolveAdmin(req);
      const { from, to } = parseDateRange(req);
      const feature = req.query.feature;
      if (feature && !FEATURES.includes(feature)) {
        const err = new Error('feature tidak valid.');
        err.status = 400;
        throw err;
      }
      if (feature) {
        const health = await metricsService.getFeatureHealth({ feature, from, to });
        return res.json({ ok: true, health: [health] });
      }
      const all = await Promise.all(FEATURES.map((f) => metricsService.getFeatureHealth({ feature: f, from, to })));
      return res.json({ ok: true, health: all });
    } catch (error) {
      return sendAdminError(res, error);
    }
  });

  // GET /api/admin/metrics/feature/:feature/calls?status&from&to&page&page_size
  app.get('/api/admin/metrics/feature/:feature/calls', async (req, res) => {
    try {
      await resolveAdmin(req);
      const { from, to } = parseDateRange(req, 30);
      const feature = req.params.feature;
      if (!FEATURES.includes(feature)) {
        const err = new Error('feature tidak valid.');
        err.status = 400;
        throw err;
      }
      const allowedStatus = ['all', 'success', 'failed'];
      const status = allowedStatus.includes(req.query.status) ? req.query.status : 'all';
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const pageSize = Math.min(100, Math.max(1, parseInt(req.query.page_size, 10) || 20));

      const result = await metricsService.getFeatureCalls({ feature, status, from, to, page, pageSize });
      return res.json({ ok: true, ...result });
    } catch (error) {
      return sendAdminError(res, error);
    }
  });

  // GET /api/admin/metrics/alerts
  app.get('/api/admin/metrics/alerts', async (req, res) => {
    try {
      await resolveAdmin(req);
      const alerts = await metricsService.checkAlerts();
      return res.json({ ok: true, alerts });
    } catch (error) {
      return sendAdminError(res, error);
    }
  });
}
