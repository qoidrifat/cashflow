/**
 * Privacy Routes (P0.2 Data Export · P0.3 Account Deletion).
 *
 *   GET    /api/privacy/export   — export JSON semua data user (portabilitas)
 *   DELETE /api/privacy/account  — hapus akun + SEMUA data user (irreversible)
 *
 * PRINSIP:
 *   - requireAuth — authority SELALU dari session terautentikasi (req.user.id);
 *     TIDAK PERNAH menerima userId dari body/query.
 *   - Semua query user-scoped (WHERE user_id = req.user.id) + parameterized.
 *   - Export TIDAK memuat secret (OAuth token, session token, password hash —
 *     tabel account/session/verification tidak diexport).
 *   - Deletion EKSPLISIT per-tabel (bukan bergantung FK cascade — pragma
 *     foreign_keys OFF di libsql batch) dalam SATU batch ATOMIK + audit.
 *   - Konfirmasi eksplisit: body { confirmation: 'DELETE' } — email saja
 *     tidak cukup (bukan confirmation authority).
 *   - Idempoten: delete kedua → 404 ACCOUNT_NOT_FOUND (akun sudah dihapus).
 *
 * Detail & keputusan desain: docs/security/ACCOUNT_DATA_EXPORT.md,
 * docs/security/ACCOUNT_DELETION.md.
 */
import { requireAuth } from '../middleware/authMiddleware.js';
import { getTurso } from '../lib/turso.js';
import { buildAdminAuditStatement } from '../lib/adminAudit.js';
import { validateBody, validateRequiredString } from '../lib/validation.js';
import { logger } from '../lib/logger.js';

export const EXPORT_VERSION = '1.0';

/** Konfirmasi wajib untuk DELETE akun (eksplisit, bukan sekadar login). */
export const DELETE_CONFIRMATION_PHRASE = 'DELETE';

function sendPrivacyError(res, status, code, message) {
  return res.status(status).json({ ok: false, code, error: message, message });
}

/** SELECT user-scoped sederhana → rows (table = konstanta hardcoded, bukan input). */
async function fetchRows(turso, table, userIdCol, userId) {
  const result = await turso.execute({ sql: `SELECT * FROM ${table} WHERE ${userIdCol} = ?`, args: [userId] });
  return (result.rows || []).map((r) => ({ ...r }));
}

/** ============================ EXPORT ============================ */

/**
 * GET /api/privacy/export — JSON lengkap data user.
 * Response versi: EXPORT_VERSION (1.0). Tidak memuat secret; tidak memuat
 * telemetry mentah (system_metrics/ai_usage_metrics = analytics internal,
 * bukan konten user — keputusan didokumentasikan di ACCOUNT_DATA_EXPORT.md).
 */
async function handleExport(req, res) {
  const userId = req.user.id;
  const turso = getTurso();
  if (!turso) {
    return sendPrivacyError(res, 500, 'PRIVACY_EXPORT_FAILED', 'Database tidak tersedia. Coba lagi nanti.');
  }

  try {
    const [userRows, legacyUserRows, profileRows, categories, transactions, fraudFlags,
      budgets, recurring, gmailLogs, gmailSettings, gmailRuns, wallets, goals,
      subscriptions, notifications, aiFeedback, aiMemory, aiTimeline] = await Promise.all([
      turso.execute({ sql: 'SELECT * FROM user WHERE id = ?', args: [userId] }),
      turso.execute({ sql: 'SELECT * FROM users WHERE id = ?', args: [userId] }),
      turso.execute({ sql: 'SELECT * FROM profiles WHERE user_id = ?', args: [userId] }),
      fetchRows(turso, 'categories', 'user_id', userId),
      fetchRows(turso, 'transactions', 'user_id', userId),
      fetchRows(turso, 'fraud_flags', 'user_id', userId),
      fetchRows(turso, 'budgets', 'user_id', userId),
      fetchRows(turso, 'recurring_transactions', 'user_id', userId),
      fetchRows(turso, 'gmail_sync_logs', 'user_id', userId),
      turso.execute({ sql: 'SELECT * FROM gmail_sync_settings WHERE user_id = ?', args: [userId] }),
      fetchRows(turso, 'gmail_sync_runs', 'user_id', userId),
      fetchRows(turso, 'wallet_accounts', 'user_id', userId),
      fetchRows(turso, 'saving_goals', 'user_id', userId),
      fetchRows(turso, 'subscriptions', 'user_id', userId),
      fetchRows(turso, 'notifications', 'user_id', userId),
      fetchRows(turso, 'ai_feedback', 'user_id', userId),
      fetchRows(turso, 'ai_memory', 'user_id', userId),
      fetchRows(turso, 'ai_timeline', 'user_id', userId),
    ]);

    const user = (userRows.rows || [])[0] ? { ...userRows.rows[0] } : null;
    const legacyUser = (legacyUserRows.rows || [])[0] ? { ...legacyUserRows.rows[0] } : null;
    const profile = (profileRows.rows || [])[0] ? { ...profileRows.rows[0] } : null;
    const settings = (gmailSettings.rows || [])[0] ? { ...gmailSettings.rows[0] } : null;

    const payload = {
      exportVersion: EXPORT_VERSION,
      schemaVersion: EXPORT_VERSION,
      generatedAt: new Date().toISOString(),
      user,
      legacyUser,
      profile,
      transactions,
      categories,
      budgets,
      recurringTransactions: recurring,
      fraudFlags,
      gmailSync: { logs: gmailLogs, settings, runs: gmailRuns },
      wallets,
      savingGoals: goals,
      subscriptions,
      notifications,
      ai: { feedback: aiFeedback, memory: aiMemory, timeline: aiTimeline },
    };

    // Observability (non-PII, pola system_metrics): export berhasil.
    try {
      await turso.execute({
        sql: `INSERT INTO system_metrics (id, metric_name, metric_value, feature, user_id, metadata, created_at)
              VALUES (lower(hex(randomblob(16))), 'privacy_export_completed', 1, 'privacy', ?, '{}', datetime('now'))`,
        args: [userId],
      });
    } catch (metricErr) {
      logger.warn({ err: metricErr?.message }, 'Observability privacy_export_completed gagal — export tetap dikirim');
    }

    return res.json({ ok: true, exportVersion: EXPORT_VERSION, ...payload });
  } catch (error) {
    logger.error({ err: error?.message }, 'Export data gagal');
    return sendPrivacyError(res, 500, 'PRIVACY_EXPORT_FAILED', 'Gagal membuat export data. Coba lagi nanti.');
  }
}

/** ============================ ACCOUNT DELETION ============================ */

/**
 * DELETE statement per tabel user-owned (ORDER = dependency-aware, walau FK
 * pragma OFF saat batch — eksplisit & terdokumentasi, tidak bergantung cascade).
 */
export const ACCOUNT_DELETE_STATEMENTS = [
  { sql: 'DELETE FROM gmail_sync_runs WHERE user_id = ?', label: 'gmail_sync_runs' },
  { sql: 'DELETE FROM gmail_sync_settings WHERE user_id = ?', label: 'gmail_sync_settings' },
  { sql: 'DELETE FROM gmail_sync_logs WHERE user_id = ?', label: 'gmail_sync_logs' },
  { sql: 'DELETE FROM fraud_flags WHERE user_id = ?', label: 'fraud_flags' },
  { sql: 'DELETE FROM transactions WHERE user_id = ?', label: 'transactions' },
  { sql: 'DELETE FROM recurring_transactions WHERE user_id = ?', label: 'recurring_transactions' },
  { sql: 'DELETE FROM budgets WHERE user_id = ?', label: 'budgets' },
  { sql: 'DELETE FROM categories WHERE user_id = ?', label: 'categories' },
  { sql: 'DELETE FROM wallet_accounts WHERE user_id = ?', label: 'wallet_accounts' },
  { sql: 'DELETE FROM saving_goals WHERE user_id = ?', label: 'saving_goals' },
  { sql: 'DELETE FROM subscriptions WHERE user_id = ?', label: 'subscriptions' },
  { sql: 'DELETE FROM notifications WHERE user_id = ?', label: 'notifications' },
  { sql: 'DELETE FROM ai_feedback WHERE user_id = ?', label: 'ai_feedback' },
  { sql: 'DELETE FROM ai_memory WHERE user_id = ?', label: 'ai_memory' },
  { sql: 'DELETE FROM ai_timeline WHERE user_id = ?', label: 'ai_timeline' },
  // Telemetry user-specific (privacy: ikut dihapus; aggregate global tidak).
  { sql: 'DELETE FROM system_metrics WHERE user_id = ?', label: 'system_metrics' },
  { sql: 'DELETE FROM ai_usage_metrics WHERE user_id = ?', label: 'ai_usage_metrics' },
  // Legacy identity.
  { sql: 'DELETE FROM user_sessions WHERE user_id = ?', label: 'user_sessions' },
  { sql: 'DELETE FROM profiles WHERE user_id = ?', label: 'profiles' },
  // Better Auth.
  { sql: 'DELETE FROM session WHERE userId = ?', label: 'session' },
  { sql: 'DELETE FROM account WHERE userId = ?', label: 'account' },
];

/** Lookup user better-auth — email dipakai untuk verification cleanup. */
export const ACCOUNT_FIND_USER_SQL = 'SELECT id, email FROM user WHERE id = ?';
/** Verification better-auth (identifier = email) — baris OTP/verify. */
export const ACCOUNT_DELETE_VERIFICATION_SQL = 'DELETE FROM verification WHERE identifier = ?';
export const ACCOUNT_DELETE_USER_SQL = 'DELETE FROM user WHERE id = ?';
export const ACCOUNT_DELETE_LEGACY_USER_SQL = 'DELETE FROM users WHERE id = ?';

/**
 * DELETE /api/privacy/account — hapus akun + SEMUA data (irreversible).
 * Body wajib: { confirmation: 'DELETE' }.
 *
 * Alur (SATU batch atomik — gagal di tengah = rollback penuh, tidak ada
 * half-deleted account):
 *   1. lookup user (404 bila sudah dihapus → idempoten).
 *   2. batch: [hapus semua tabel user-owned, verification (identifier=email),
 *      audit account_delete, user better-auth, users legacy].
 *   3. Observability: system_metrics account_deletion_completed (user_id NULL
 *      — agregat aman, tanpa PII).
 *   Audit: action='account_delete', actor=user (email DI-REDACT menjadi ''
 *      sesuai aturan privasi — audit tidak menyimpan PII yang baru dihapus).
 */
async function handleDeleteAccount(req, res) {
  const userId = req.user.id;
  const userEmail = req.user.email || '';

  // Konfirmasi eksplisit (bukan sekadar login / email).
  const result = validateBody(req.body, {
    confirmation: { validate: validateRequiredString, options: { field: 'confirmation', max: 32 } },
  });
  if (!result.ok || result.value.confirmation !== DELETE_CONFIRMATION_PHRASE) {
    return sendPrivacyError(
      res, 400, 'INVALID_CONFIRMATION',
      `Konfirmasi wajib berupa teks "${DELETE_CONFIRMATION_PHRASE}" untuk menghapus akun.`,
    );
  }

  const turso = getTurso();
  if (!turso) {
    return sendPrivacyError(res, 500, 'ACCOUNT_DELETE_FAILED', 'Database tidak tersedia. Coba lagi nanti.');
  }

  try {
    // 1. Idempotensi + verifikasi akun ada.
    const find = await turso.execute({ sql: ACCOUNT_FIND_USER_SQL, args: [userId] });
    if (!(find.rows || [])[0]) {
      return sendPrivacyError(res, 404, 'ACCOUNT_NOT_FOUND', 'Akun sudah dihapus.');
    }

    // 2. Batch atomik: hapus data → verification → audit → user.
    const statements = [
      ...ACCOUNT_DELETE_STATEMENTS.map((s) => ({ sql: s.sql, args: [userId], label: s.label })),
      { sql: ACCOUNT_DELETE_VERIFICATION_SQL, args: [userEmail] },
      // Audit account_delete — email di-REDACT ('') sesuai aturan privasi
      // (audit menyimpan event + id hash/reference, bukan PII yang baru dihapus).
      { ...buildAdminAuditStatement({
        action: 'account_delete',
        actorUserId: userId,
        actorEmail: '', // redacted — jangan simpan email user yang dihapus
        targetUserId: userId,
        targetEmail: null,
        metadata: {},
        result: 'success',
        requestId: req.id,
      }), label: 'audit' },
      { sql: ACCOUNT_DELETE_USER_SQL, args: [userId], label: 'user' },
      { sql: ACCOUNT_DELETE_LEGACY_USER_SQL, args: [userId], label: 'users' },
      // Observability agregat (tanpa user_id → bukan PII, tetap bisa dihitung admin).
      {
        sql: `INSERT INTO system_metrics (id, metric_name, metric_value, feature, user_id, metadata, created_at)
              VALUES (lower(hex(randomblob(16))), 'account_deletion_completed', 1, 'privacy', NULL, '{}', datetime('now'))`,
        args: [],
        label: 'observability',
      },
    ];

    const results = await turso.batch(statements.map(({ sql, args }) => ({ sql, args })));

    const count = (label) => {
      const idx = statements.findIndex((s) => s.label === label);
      return idx >= 0 ? Number(results?.[idx]?.rowsAffected ?? 0) : 0;
    };

    return res.json({
      ok: true,
      action: 'account_delete',
      deletedSessions: count('session'),
      deletedTransactions: count('transactions'),
      deletedTimeline: count('ai_timeline'),
      deletedFeedback: count('ai_feedback'),
      deletedMemory: count('ai_memory'),
    });
  } catch (error) {
    logger.error({ err: error?.message, requestId: req.id }, 'Account deletion gagal');
    return sendPrivacyError(res, 500, 'ACCOUNT_DELETE_FAILED', 'Gagal menghapus akun. Tidak ada data yang diubah. Coba lagi nanti.');
  }
}

export function registerPrivacyRoutes(app) {
  app.get('/api/privacy/export', requireAuth, handleExport);
  app.delete('/api/privacy/account', requireAuth, handleDeleteAccount);
}
