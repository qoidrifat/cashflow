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
 *   GET /api/admin/metrics/cache
 *   POST /api/admin/users/:id/suspend   (revoke semua sesi user + audit trail)
 *
 * Auth: req.user dari authMiddleware (Better Auth) + ADMIN_EMAILS env.
 *
 * P1-2 G4 (Validation Layer — gap-fill): parameter query yang tadinya lolos
 * tanpa validasi kini memakai shared library server/lib/validation.js:
 *   - /system: metric_name → validateOptionalString (trim, max 191; kosong/absen
 *     → null = tanpa filter). from/to & feature whitelist tetap seperti lama.
 *   - /feature/:feature/calls: page & page_size → validateInt clamp [1,100000]
 *     / [1,100] — string non-integer yang tadinya diam-diam jadi default kini
 *     ditolak 400 (fail-closed); nilai numerik di luar rentang tetap di-clamp.
 * Semua kegagalan validasi → 400 bentuk DOMAIN `{ ok:false,
 * code:'ADMIN_METRICS_400', message }` via sendAdminError — BUKAN bentuk
 * generik sendValidationError, dan JANGAN PERNAH 401.
 */
import metricsService from '../services/metricsService.js';
import { getAdminEmails, FEATURES } from '../config/metricsConfig.js';
import { getAICacheStats, clearAICache } from '../lib/aiCache.js';
import { getTurso } from '../lib/turso.js';
import { buildFeedbackPriorityReport } from '../lib/feedbackMetrics.js';
import { validateInt, validateOptionalString, validateQuery } from '../lib/validation.js';
import { buildAdminAuditStatement, recordAdminAudit } from '../lib/adminAudit.js';
import { logger } from '../lib/logger.js';

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
    : status === 404 ? (error.message || 'Sumber daya tidak ditemukan.')
    : 'Terjadi error saat memuat data monitoring.';
  return res.status(status).json({ ok: false, code: `ADMIN_METRICS_${status}`, message });
}

// ===================== User Suspend (admin security, 2026-08-09) =============
// Logout paksa / suspend: hapus SEMUA sesi target user dari tabel `session`
// (revokasi server-side seketika — request berikutnya dengan cookie lama →
// get-session null). Sama efektifnya dengan sign-out per sesi, tapi menjangkau
// SEMUA device sekaligus (user tidak perlu tahu).
//
// Audit trail: tiap suspend dicatat ke tabel `admin_audit_log` (actor + target
// email eksplisit — log keamanan, bukan observability; PII diperbolehkan di
// sini). DELETE sesi + INSERT audit dijalankan DALAM SATU batch (transaksi
// atomik): audit tidak pernah hilang walau revoke berhasil.
//
// SQL dipisah sebagai konstanta (dieksekusi sebagai prepared statements —
// argumen tidak pernah di-interpolasi → anti-injection) dan di-assert unit test.
// ADMIN_AUDIT_INSERT_SQL menangkap jumlah sesi SEBELUM revoke via subquery
// dalam transaksi batch yang sama — record audit memuat deletedSessions asli
// (bukan null). Urutan batch: INSERT audit DULU (count = kondisi pra-revoke),
// lalu DELETE sesi.
export const ADMIN_SUSPEND_FIND_USER_SQL = 'SELECT id, email FROM user WHERE id = ?';
export const ADMIN_SUSPEND_DELETE_SESSIONS_SQL = 'DELETE FROM session WHERE userId = ?';

/**
 * Kirim kegagalan validasi shared-library sebagai 400 bentuk domain
 * ADMIN_METRICS_400 (bukan bentuk generik sendValidationError).
 */
function sendAdminValidationError(res, result) {
  const err = new Error(result?.error || 'Parameter tidak valid.');
  err.status = 400;
  return sendAdminError(res, err);
}

/** Skema query GET /system — gap-fill P1-2 G4: metric_name sebelumnya tanpa validasi. */
const SYSTEM_QUERY_SCHEMA = {
  metric_name: { validate: validateOptionalString, options: { max: 191 } },
};

/** Skema query per-user telemetry (view per-user P10.2): userId opsional, max 191. */
const TELEMETRY_QUERY_SCHEMA = {
  userId: { validate: validateOptionalString, options: { max: 191 } },
};

/** Skema query GET /feature/:feature/calls — clamp pola lama dipertahankan. */
const FEATURE_CALLS_QUERY_SCHEMA = {
  page: { validate: validateInt, options: { min: 1, max: 100000, clamp: true } },
  page_size: { validate: validateInt, options: { min: 1, max: 100, clamp: true } },
};

function parseBoundary(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  // ISO datetime (ada 'T' atau ':') → langsung new Date(); YYYY-MM-DD polos
  // → tafsirkan UTC midnight (spesifikasi ES Date-only = UTC). Hindari
  // ambiguitas TZ admin Asia/Jakarta yang mengharapkan hari lokal.
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T00:00:00Z`);
  }
  return new Date(value);
}

function parseDateRange(req, defaultDays = 7) {
  const to = parseBoundary(req.query.to, new Date());
  const from = parseBoundary(req.query.from, new Date(Date.now() - defaultDays * 86400_000));
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    const err = new Error('Parameter from/to harus tanggal ISO valid.');
    err.status = 400;
    throw err;
  }
  return { from: from.toISOString(), to: to.toISOString() };
}

export function registerAdminMetricsRoutes(app) {
  // GET /api/admin/metrics/ai-usage?from&to&feature
  // Sprint 2 (Cost Monitoring): response juga memuat `cacheByFeature` (cache-hit
  // per fitur dari system_metrics) dan `trendByFeature` (cost trend per fitur
  // untuk line chart multi-seri). `feature` query memfilter summary + trend
  // (grafik fitur tunggal). Semua additive terhadap bentuk lama.
  app.get('/api/admin/metrics/ai-usage', async (req, res) => {
    try {
      await resolveAdmin(req);
      const { from, to } = parseDateRange(req);
      const feature = req.query.feature && FEATURES.includes(req.query.feature) ? req.query.feature : null;
      const [summary, trend, trendByFeature, cacheByFeature] = await Promise.all([
        metricsService.getAIUsageSummary({ from, to, feature }),
        metricsService.getCostTrend({ from, to, feature }),
        metricsService.getCostTrendByFeature({ from, to, feature }),
        metricsService.getCacheHitByFeature({ from, to }),
      ]);
      return res.json({ ok: true, summary, trend, trendByFeature, cacheByFeature });
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
      // P1-2 G4 gap-fill: metric_name divalidasi sebelum dipakai sebagai argumen SQL.
      const sysQuery = validateQuery(req.query, SYSTEM_QUERY_SCHEMA);
      if (!sysQuery.ok) return sendAdminValidationError(res, sysQuery);
      const result = await metricsService.getSystemMetrics({
        metricName: sysQuery.value.metric_name || null, from, to, feature,
      });
      return res.json({ ok: true, ...result });
    } catch (error) {
      return sendAdminError(res, error);
    }
  });

  // GET /api/admin/metrics/agent-search-engagement — suggested queries + CTR
  // (Sprint 1.9). Agregasi dari system_metrics agent_search_count/_click/
  // _suggestion_used; CTR = klik hasil ÷ jumlah pencarian.
  app.get('/api/admin/metrics/agent-search-engagement', async (req, res) => {
    try {
      await resolveAdmin(req);
      const { from, to } = parseDateRange(req);
      const result = await metricsService.getAgentSearchEngagement({ from, to });
      return res.json({ ok: true, ...result });
    } catch (error) {
      return sendAdminError(res, error);
    }
  });

  // GET /api/admin/metrics/retention — D1/D7/D14/D28 (P10.2): cohort dari
  // tabel user (createdAt) + sinyal user_active → lib murni retentionMetrics.
  // Guard sample: cohort < 10 user tidak dilaporkan; total < 10 →
  // cohortGuardActive (panel admin menampilkan empty state).
  app.get('/api/admin/metrics/retention', async (req, res) => {
    try {
      await resolveAdmin(req);
      const { from, to } = parseDateRange(req);
      const result = await metricsService.getRetentionMetrics({ from, to });
      return res.json(result);
    } catch (error) {
      return sendAdminError(res, error);
    }
  });

  // GET /api/admin/metrics/recommendation-engagement — funnel rekomendasi
  // (P10.2): recommendation_shown/_opened dari system_metrics → CTR =
  // opened ÷ shown. Admin-only; agregasi deterministik (lib murni).
  // Opsional ?userId= → funnel scoped ke satu user (view per-user admin).
  app.get('/api/admin/metrics/recommendation-engagement', async (req, res) => {
    try {
      await resolveAdmin(req);
      const { from, to } = parseDateRange(req);
      const q = validateQuery(req.query, TELEMETRY_QUERY_SCHEMA);
      if (!q.ok) return sendAdminValidationError(res, q);
      const result = await metricsService.getRecommendationEngagement({ from, to, userId: q.value.userId || null });
      return res.json({ ok: true, ...result });
    } catch (error) {
      return sendAdminError(res, error);
    }
  });

  // GET /api/admin/metrics/feedback-rate — Feedback Rate (P10.2i):
  // ai_feedback ÷ ai_result_shown (tampilan kartu AI feedback-capable).
  // Admin-only; agregasi deterministik (lib murni feedbackRate.js).
  // Opsional ?userId= → scoped ke satu user (view per-user admin).
  app.get('/api/admin/metrics/feedback-rate', async (req, res) => {
    try {
      await resolveAdmin(req);
      const { from, to } = parseDateRange(req);
      const q = validateQuery(req.query, TELEMETRY_QUERY_SCHEMA);
      if (!q.ok) return sendAdminValidationError(res, q);
      const result = await metricsService.getFeedbackRate({ from, to, userId: q.value.userId || null });
      return res.json({ ok: true, ...result });
    } catch (error) {
      return sendAdminError(res, error);
    }
  });

  // GET /api/admin/metrics/telemetry-users — daftar user dengan aktivitas
  // telemetry AI pada rentang (recommendation_shown/_opened/ai_result_shown +
  // ai_feedback), label email/name dari tabel user (Better Auth). Sumber
  // dropdown "view per-user" di panel Rekomendasi AI & Feedback Rate — QA
  // memverifikasi telemetry satu user tanpa query Turso manual (P10.2).
  app.get('/api/admin/metrics/telemetry-users', async (req, res) => {
    try {
      await resolveAdmin(req);
      const { from, to } = parseDateRange(req);
      const q = validateQuery(req.query, TELEMETRY_QUERY_SCHEMA);
      if (!q.ok) return sendAdminValidationError(res, q);
      const result = await metricsService.getTelemetryUsers({ from, to });
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
      // P1-2 G4 gap-fill: page/page_size via validateInt clamp. Nilai numerik
      // di luar rentang tetap di-clamp (pola lama), tetapi string non-integer
      // kini ditolak 400 fail-closed (tadinya diam-diam jadi default).
      const callsQuery = validateQuery(req.query, FEATURE_CALLS_QUERY_SCHEMA);
      if (!callsQuery.ok) return sendAdminValidationError(res, callsQuery);
      const page = callsQuery.value.page ?? 1;
      const pageSize = callsQuery.value.page_size ?? 20;

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

  // GET /api/admin/metrics/cache — statistik AI response cache (LRU, Sprint 3)
  app.get('/api/admin/metrics/cache', async (req, res) => {
    try {
      await resolveAdmin(req);
      const stats = getAICacheStats();
      const total = stats.hits + stats.misses;
      const hitRate = total > 0 ? Math.round((stats.hits / total) * 1000) / 1000 : 0;
      return res.json({ ok: true, ...stats, hitRate });
    } catch (error) {
      return sendAdminError(res, error);
    }
  });

  // GET /api/admin/metrics/feedback-summary — prioritas perbaikan prompt dari
  // dataset ai_feedback (Sprint 1.5). Admin-only; agregasi deterministik via
  // lib/feedbackMetrics (per feature/rating → priorityScore + action plan).
  // Catatan dataset: query memuat SEMUA baris (tanpa LIMIT) — cocok untuk
  // tooling admin; bila tabel tumbuh besar, agregasi bisa dipindah ke SQL
  // (GROUP BY feature, rating) — konsisten dengan catatan di script CLI.
  app.get('/api/admin/metrics/feedback-summary', async (req, res) => {
    try {
      await resolveAdmin(req);
      const turso = getTurso();
      const result = await turso.execute({
        sql: 'SELECT feature, rating FROM ai_feedback ORDER BY created_at ASC',
        args: [],
      });
      const rows = (result.rows || []).map((r) => ({
        feature: String(r.feature || ''),
        rating: String(r.rating || ''),
      }));
      const report = buildFeedbackPriorityReport(rows);
      return res.json({ ok: true, ...report });
    } catch (error) {
      return sendAdminError(res, error);
    }
  });

  // POST /api/admin/metrics/cache/clear — invalidasi AI response cache (ops/admin)
  // AI_SEMANTIC_CACHE (P2): lapisan invalidation eksplisit untuk skenario
  // prompt/schema berubah atau kualitas hasil menurun. Semua statistik di-reset
  // bersama store (clearAICache). Wajib admin — pola resolveAdmin yang sama.
  app.post('/api/admin/metrics/cache/clear', async (req, res) => {
    try {
      await resolveAdmin(req);
      const before = getAICacheStats();
      clearAICache();
      return res.json({ ok: true, cleared: true, before });
    } catch (error) {
      return sendAdminError(res, error);
    }
  });

  // POST /api/admin/users/:id/suspend — logout paksa: hapus SEMUA sesi user
  // (tabel `session` WHERE userId) + tulis admin_audit_log. Wajib admin
  // (resolveAdmin). Guard:
  //   - id kosong / > 191 char → 400 (fail-closed; dipakai sebagai prepared arg).
  //   - target == admin sendiri → 400 (jangan revoke sesi sendiri via endpoint;
  //     gunakan sign-out biasa — mencegah lockout admin tak sengaja).
  //   - user tidak ada → 404 (bukan 200 kosong — audit hanya untuk user nyata).
  //   - DELETE + INSERT audit dalam SATU batch → atomik (audit tidak hilang).
  // Response: { ok, action:'user_suspend', user:{id,email}, deletedSessions }.
  app.post('/api/admin/users/:id/suspend', async (req, res) => {
    try {
      const admin = await resolveAdmin(req);

      const targetId = String(req.params.id || '').trim();
      if (!targetId || targetId.length > 191) {
        const err = new Error('id user tidak valid.');
        err.status = 400;
        throw err;
      }
      if (targetId === admin.userId) {
        const err = new Error('Tidak dapat men-suspend akun sendiri. Gunakan sign-out biasa.');
        err.status = 400;
        throw err;
      }

      const turso = getTurso();
      if (!turso) {
        const err = new Error('Database tidak tersedia.');
        err.status = 500;
        throw err;
      }

      // Lookup target user — email dipakai untuk audit trail.
      const find = await turso.execute({ sql: ADMIN_SUSPEND_FIND_USER_SQL, args: [targetId] });
      const target = (find?.rows || [])[0];
      if (!target) {
        const err = new Error('User tidak ditemukan.');
        err.status = 404;
        throw err;
      }
      const targetEmail = String(target.email || '');

      // Revoke SEMUA sesi + catat audit — SATU batch atomik (helper
      // buildAdminAuditStatement — single source of truth INSERT audit).
      // Batch = satu transaksi → audit tidak pernah hilang walau revoke
      // berhasil; keduanya gagal bersama bila DB error. deletedSessions dibaca
      // dari rowsAffected statement DELETE (dalam batch yang sama — akurat).
      const auditStmt = buildAdminAuditStatement({
        action: 'user_suspend',
        actorUserId: admin.userId,
        actorEmail: admin.email,
        targetUserId: targetId,
        targetEmail,
        metadata: { sourceIp: req.ip || '' },
        result: 'success',
        requestId: req.id,
      });
      const results = await turso.batch([
        { sql: auditStmt.sql, args: auditStmt.args },
        { sql: ADMIN_SUSPEND_DELETE_SESSIONS_SQL, args: [targetId] },
      ]);
      const deletedSessions = Number(results?.[1]?.rowsAffected ?? 0);

      return res.json({ ok: true, action: 'user_suspend', user: { id: targetId, email: targetEmail }, deletedSessions });
    } catch (error) {
      // P0.3: audit DENIED (403) & FAILURE (5xx) — best-effort (fail-open:
      // kegagalan audit TIDAK menimpa respons yang sudah benar). 401 tanpa
      // user tidak diaudit (tidak ada actor); 400/404 (validasi/not-found)
      // TIDAK diaudit (noise tanpa nilai keamanan — bukan percobaan gagal).
      const status = error?.status || 500;
      const actor = req.user;
      if (actor?.id && (status === 403 || status >= 500)) {
        try {
          await recordAdminAudit(getTurso(), {
            action: 'user_suspend',
            actorUserId: actor.id,
            actorEmail: actor.email,
            targetUserId: req.params?.id || null,
            metadata: { sourceIp: req.ip || '' },
            result: status === 403 ? 'denied' : 'failure',
            requestId: req.id,
          });
        } catch (auditErr) {
          logger.warn({ err: auditErr?.message }, 'Admin audit (denied/failure) gagal ditulis — operasi utama tetap dilanjutkan');
        }
      }
      return sendAdminError(res, error);
    }
  });
}
