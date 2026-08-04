/**
 * Gmail Sync Routes for CashFlow
 * Logs, settings, and run history
 */
import { getTurso } from '../lib/turso.js';
import { requireAuth } from '../middleware/authMiddleware.js';
import { notifyUser } from '../lib/sse.js';
import { sanitizeNotificationMetadata } from '../lib/notificationGuard.js';
import {
  validateRequiredString,
  validateOptionalString,
  validateEnum,
  validateInt,
  validateAmount,
  validateIsoDate,
  validateBoolean,
  validateId,
  validateBody,
  validateQuery,
  sendValidationError,
} from '../lib/validation.js';
import crypto from 'node:crypto';

/**
 * Status email Gmail sync yang valid untuk field status/finalStatus pada
 * POST /api/gmail/logs. Sumber derivasi (P1-2 Group G3):
 *  - src/types/index.ts — union `SyncEmailStatus` (14 nilai).
 *  - buildGmailSyncSummary di file ini & alias filter GET /api/gmail/logs.
 *  - src/features/gmail/GmailSyncPage.tsx + e2e/helpers/gmailReview.ts
 *    (seed needs_review → approved/rejected/duplicate).
 */
const GMAIL_SYNC_LOG_STATUSES = [
  'auto_accepted',
  'auto_skipped',
  'auto_rejected',
  'needs_review',
  'pending_review',
  'approved',
  'rejected',
  'skipped',
  'duplicate',
  'failed',
  'retry_later',
  'config_error',
  'gmail_permission_required',
  'paused_config_error',
];

/** Status sync run — sumber: src/services/gmailSyncRunService.ts (SyncRunStatus). */
const GMAIL_SYNC_RUN_STATUSES = ['running', 'completed', 'partial_failed', 'failed', 'cancelled'];

/** Batas atas counter sync run (anti payload absurd; nilai riil < 1000/run). */
const SYNC_RUN_COUNTER_MAX = 1_000_000;

/**
 * Validator metadata log Gmail (kontrak ValidationResult dari lib/validation).
 * Memakai ulang sanitizeNotificationMetadata (notificationGuard.js): wajib
 * plain object, ≤8KB, ≤64 key, key prototype-pollution di-strip. Absen → {}
 * (kompatibel dengan perilaku lama `metadata = {}`).
 */
function validateGmailLogMetadata(value, opts) {
  const field = opts?.field || 'metadata';
  const result = sanitizeNotificationMetadata(value);
  if (!result.ok) return { ok: false, error: `${field}: ${result.error}` };
  return { ok: true, value: result.metadata };
}

/** Skema validasi POST /api/gmail/logs (P1-2). Field di luar skema di-strip. */
const GMAIL_LOG_BODY_SCHEMA = {
  // Wajib: kunci unik ON CONFLICT(user_id, message_id) — semua caller riil
  // (GmailSyncPage upsert + seed e2e gmailReview.ts) selalu mengirimnya.
  messageId: { validate: validateRequiredString, options: { max: 191 } },
  subject: { validate: validateOptionalString, options: { max: 500 } },
  sender: { validate: validateOptionalString, options: { max: 320 } },
  senderDomain: { validate: validateOptionalString, options: { max: 255 } },
  // gmailService.getGmailMessageDate selalu menghasilkan ISO toISOString().
  emailDate: validateIsoDate,
  prefilterStatus: { validate: validateOptionalString, options: { max: 100 } },
  aiCalled: validateBoolean,
  aiParsed: validateBoolean,
  status: { validate: validateEnum, options: { values: GMAIL_SYNC_LOG_STATUSES } },
  finalStatus: { validate: validateEnum, options: { values: GMAIL_SYNC_LOG_STATUSES } },
  errorMessage: { validate: validateOptionalString, options: { max: 1000 } },
  extractedTransactionId: { validate: validateOptionalString, options: { max: 191 } },
  // Confidence skor AI: 0..1 (confidenceScorer.ts).
  confidenceScore: { validate: validateAmount, options: { max: 1 } },
  syncRunId: { validate: validateOptionalString, options: { max: 191 } },
  errorCode: { validate: validateOptionalString, options: { max: 100 } },
  fallbackUsed: validateBoolean,
  extractedNote: { validate: validateOptionalString, options: { max: 1000 } },
  metadata: validateGmailLogMetadata,
};

/**
 * Skema validasi PUT /api/gmail/settings. Default & rentang diturunkan dari
 * GET /api/gmail/settings fallback (60 menit, 25 email, threshold 0.88).
 *  - syncIntervalMinutes: 1 menit – 24 jam (1440).
 *  - maxEmailsPerSync: 1 – 500.
 *  - autoApproveThreshold: 0..1 (validateAmount menolak negatif, max 1).
 * Catatan: caller riil (gmailSyncSettingsService.ts) juga mengirim field
 * lastSyncedAt/lastStatus/... yang TIDAK dipakai server — di-strip tanpa
 * error (perilaku lama: diabaikan via destructuring).
 */
const GMAIL_SETTINGS_BODY_SCHEMA = {
  autoSyncEnabled: validateBoolean,
  syncIntervalMinutes: { validate: validateInt, options: { min: 1, max: 1440 } },
  maxEmailsPerSync: { validate: validateInt, options: { min: 1, max: 500 } },
  autoApproveThreshold: { validate: validateAmount, options: { max: 1 } },
  lastSyncAt: validateIsoDate,
};

/** Skema validasi PUT /api/gmail/runs/:id — hanya field yang dipakai server. */
const GMAIL_RUN_PATCH_SCHEMA = {
  status: { validate: validateEnum, options: { values: GMAIL_SYNC_RUN_STATUSES } },
  completedAt: validateIsoDate,
  totalEmails: { validate: validateInt, options: { min: 0, max: SYNC_RUN_COUNTER_MAX } },
  processed: { validate: validateInt, options: { min: 0, max: SYNC_RUN_COUNTER_MAX } },
  accepted: { validate: validateInt, options: { min: 0, max: SYNC_RUN_COUNTER_MAX } },
  rejected: { validate: validateInt, options: { min: 0, max: SYNC_RUN_COUNTER_MAX } },
  skipped: { validate: validateInt, options: { min: 0, max: SYNC_RUN_COUNTER_MAX } },
  failed: { validate: validateInt, options: { min: 0, max: SYNC_RUN_COUNTER_MAX } },
  errorMessage: { validate: validateOptionalString, options: { max: 1000 } },
};

/**
 * Hitung ringkasan status dari seluruh baris gmail_sync_logs.
 * Menggunakan final_status jika status kosong, supaya konsisten dengan mapper client.
 */
function buildGmailSyncSummary(rows) {
  let autoAccepted = 0;
  let needsReview = 0;
  let skippedRejected = 0;
  let error = 0;
  for (const row of rows || []) {
    const st = row.final_status || row.status;
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
  return { autoAccepted, needsReview, skippedRejected, error, total: (rows || []).length };
}

/**
 * Parse accessTokenExpiresAt menjadi epoch milliseconds.
 *
 * Kolom ini INTEGER menurut DDL Better Auth, tapi adapter Kysely/SQLite
 * menyimpan tanggal sebagai string ISO-8601 (TEXT) di praktik — contoh riil:
 * "2026-08-04T14:14:06.143Z". `Number(...)` pada string itu = NaN, sehingga
 * pengecekan expiry lama (yang hanya menerima angka) tidak pernah jalan dan
 * token kedaluwarsa tetap dibagikan.
 *
 * Urutan parse:
 *   - number → epoch seconds/milliseconds (>1e12 = ms, selain itu detik).
 *   - string → Date.parse (ISO-8601); bila NaN fallback ke Number() sec/ms.
 *   - tidak bisa diparse → NaN (caller wajib fail closed).
 */
export function parseAccessTokenExpiryMs(value) {
  if (value === null || value === undefined) return null;
  const toMs = (num) => (num > 1e12 ? num : num * 1000);
  if (typeof value === 'number' && Number.isFinite(value)) {
    return toMs(value);
  }
  const asString = String(value);
  const parsedIso = Date.parse(asString);
  if (Number.isFinite(parsedIso)) return parsedIso;
  const parsedNum = Number(asString);
  if (Number.isFinite(parsedNum)) return toMs(parsedNum);
  return NaN;
}

export function registerGmailRoutes(app) {
  // GET /api/gmail/token — Get current Google OAuth access token for Gmail API
  //
  // P0-3 hardening:
  //   - refreshToken is NEVER selected/returned — it must not leave the server.
  //   - accessTokenExpiresAt is validated with a ~60s safety skew. If the token
  //     is expired (or expires within the skew window) we respond
  //     401 { error: 'token_expired' } so the client clears its cache and falls
  //     back to re-sign-in. Server-side OAuth refresh is a follow-up (out of
  //     scope for P0). The column is INTEGER by DDL but the Better Auth
  //     Kysely/SQLite adapter stores ISO-8601 TEXT in practice, so parsing
  //     handles both (see parseAccessTokenExpiryMs).
  //   - If accessTokenExpiresAt is null/absent the token is treated as valid
  //     (do not break legacy rows without expiry). Unparseable values FAIL
  //     CLOSED with 401 token_expired (never serve a token of unknown age).
  const TOKEN_EXPIRY_SKEW_MS = 60_000;

  app.get('/api/gmail/token', requireAuth, async (req, res) => {
    try {
      const turso = getTurso();
      const userId = req.user.id;

      const result = await turso.execute({
        sql: `SELECT accessToken, accessTokenExpiresAt FROM account WHERE userId = ? AND providerId = 'google' ORDER BY createdAt DESC LIMIT 1`,
        args: [userId],
      });

      if (result.rows.length === 0 || !result.rows[0].accessToken) {
        return res.status(404).json({ error: 'Token akses Gmail belum ditemukan. Silakan berikan izin akses Gmail.' });
      }

      const { accessToken, accessTokenExpiresAt } = result.rows[0];

      if (accessTokenExpiresAt !== null && accessTokenExpiresAt !== undefined) {
        const expiresAtMs = parseAccessTokenExpiryMs(accessTokenExpiresAt);
        // Fail closed: nilai tidak bisa diparse → anggap expired (401),
        // jangan pernah membagikan token dengan masa berlaku tidak diketahui.
        if (!Number.isFinite(expiresAtMs)) {
          return res.status(401).json({ error: 'token_expired' });
        }
        if (expiresAtMs <= Date.now() + TOKEN_EXPIRY_SKEW_MS) {
          return res.status(401).json({ error: 'token_expired' });
        }
      }

      res.json({ accessToken });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/gmail/logs — list sync logs with server-side filter, sort & pagination
  // Query params:
  //   limit       – max rows when page/pageSize is not provided (default 2000)
  //   syncRunId   – filter by sync run
  //   status      – filter by status (aliases applied server-side)
  //   search      – LIKE match on subject/sender
  //   sortBy      – one of: email_date, scanned_at, subject, sender, status
  //   sortOrder   – asc | desc
  //   page/pageSize – server-side pagination
  //   includeSummary – when '1'/'true', returns { data, total, page, pageSize, summary }
  //                    (summary dihitung dari SELURUH email user, tidak difilter)
  app.get('/api/gmail/logs', requireAuth, async (req, res) => {
    try {
      const turso = getTurso();
      const userId = req.user.id;
      const limit = Math.max(1, Math.min(parseInt(req.query.limit || '2000', 10) || 2000, 5000));
      const syncRunId = req.query.syncRunId || null;
      const status = req.query.status || null;
      const search = req.query.search || null;
      const sortOrder = String(req.query.sortOrder || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
      const page = Math.max(1, parseInt(req.query.page || '1', 10) || 1);
      const pageSize = parseInt(req.query.pageSize || '0', 10) || 0;

      // Whitelist kolom sort untuk mencegah SQL injection
      const SORT_COLUMNS = {
        email_date: 'email_date',
        scanned_at: 'scanned_at',
        subject: 'subject',
        sender: 'sender',
        status: 'status',
      };
      const sortCol = SORT_COLUMNS[req.query.sortBy] || 'scanned_at';

      const where = ['user_id = ?'];
      const args = [userId];

      if (syncRunId) {
        where.push('sync_run_id = ?');
        args.push(syncRunId);
      }

      if (status && status !== 'all') {
        // Aliases sama dengan filter client (mis. needs_review ⇔ pending_review)
        const statuses = new Set([status]);
        if (status === 'needs_review') statuses.add('pending_review');
        if (status === 'pending_review') statuses.add('needs_review');
        if (status === 'auto_skipped') statuses.add('skipped');
        if (status === 'skipped') statuses.add('auto_skipped');
        if (status === 'auto_rejected') statuses.add('rejected');
        if (status === 'rejected') statuses.add('auto_rejected');
        if (status === 'config_error') statuses.add('paused_config_error');
        if (status === 'paused_config_error') statuses.add('config_error');
        const placeholders = Array.from(statuses).map(() => '?').join(', ');
        // Cocokkan di status ATAU final_status (data lama bisa beda kolom)
        where.push(`(status IN (${placeholders}) OR final_status IN (${placeholders}))`);
        args.push(...Array.from(statuses), ...Array.from(statuses));
      }

      if (search) {
        where.push('(subject LIKE ? OR sender LIKE ?)');
        const q = `%${search}%`;
        args.push(q, q);
      }

      const whereSql = where.join(' AND ');

      // Summary dihitung dari SEMUA email user (tanpa filter run/status) agar
      // summary cards menampilkan total yang benar, bukan hanya halaman aktif.
      let summary = null;
      if (req.query.includeSummary === '1' || req.query.includeSummary === 'true') {
        const summaryRows = await turso.execute({
          sql: `SELECT status, final_status FROM gmail_sync_logs WHERE user_id = ?`,
          args: [userId],
        });
        summary = buildGmailSyncSummary(summaryRows.rows);
      }

      let rows;
      let total = 0;
      if (pageSize > 0) {
        // Total baris setelah filter — hanya dibutuhkan saat pagination aktif
        const countResult = await turso.execute({
          sql: `SELECT COUNT(*) AS cnt FROM gmail_sync_logs WHERE ${whereSql}`,
          args,
        });
        total = Number(countResult.rows[0]?.cnt || 0);

        const offset = (page - 1) * pageSize;
        const result = await turso.execute({
          sql: `SELECT * FROM gmail_sync_logs WHERE ${whereSql} ORDER BY ${sortCol} ${sortOrder} LIMIT ? OFFSET ?`,
          args: [...args, pageSize, offset],
        });
        rows = result.rows;
      } else {
        const result = await turso.execute({
          sql: `SELECT * FROM gmail_sync_logs WHERE ${whereSql} ORDER BY ${sortCol} ${sortOrder} LIMIT ?`,
          args: [...args, limit],
        });
        rows = result.rows;
        total = rows.length;
      }

      // Backwards-compat: tanpa includeSummary, tetap kirim array polos seperti dulu
      if (summary) {
        res.json({
          data: rows,
          total,
          page,
          pageSize: pageSize > 0 ? pageSize : rows.length,
          summary,
        });
      } else {
        res.json(rows);
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/gmail/logs — create sync log
  app.post('/api/gmail/logs', requireAuth, async (req, res) => {
    try {
      const turso = getTurso();
      const userId = req.user.id;
      const id = crypto.randomUUID();

      const validation = validateBody(req.body, GMAIL_LOG_BODY_SCHEMA);
      if (!validation.ok) return sendValidationError(res, validation);
      const body = validation.value;

      const {
        messageId,
        subject = 'No Subject',
        sender = '',
        senderDomain = '',
        emailDate,
        prefilterStatus,
        aiCalled = false,
        aiParsed = false,
        finalStatus,
        status,
        errorMessage,
        extractedTransactionId = null,
        confidenceScore = null,
        syncRunId = null,
        errorCode = null,
        fallbackUsed = false,
        extractedNote = null,
        metadata = {},
      } = body;

      const now = new Date().toISOString();

      await turso.execute({
        sql: `INSERT INTO gmail_sync_logs 
              (id, user_id, message_id, subject, sender, sender_domain, email_date, prefilter_status, ai_called, ai_parsed, final_status, status, error_message, extracted_transaction_id, confidence_score, sync_run_id, error_code, fallback_used, extracted_note, metadata, scanned_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(user_id, message_id) DO UPDATE SET
                status = excluded.status,
                final_status = excluded.final_status,
                extracted_transaction_id = excluded.extracted_transaction_id,
                error_message = excluded.error_message,
                metadata = excluded.metadata,
                scanned_at = excluded.scanned_at`,
        args: [
          id,
          userId,
          messageId,
          subject,
          sender,
          senderDomain,
          emailDate || null,
          prefilterStatus || null,
          aiCalled ? 1 : 0,
          aiParsed ? 1 : 0,
          finalStatus || status,
          status || finalStatus,
          errorMessage || null,
          extractedTransactionId,
          confidenceScore,
          syncRunId,
          errorCode,
          fallbackUsed ? 1 : 0,
          extractedNote,
          JSON.stringify(metadata),
          now,
        ],
      });

      notifyUser(userId, 'gmail:log', { id, messageId });
      res.json({ id });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/gmail/settings
  app.get('/api/gmail/settings', requireAuth, async (req, res) => {
    try {
      const turso = getTurso();
      const userId = req.user.id;

      const result = await turso.execute({
        sql: `SELECT * FROM gmail_sync_settings WHERE user_id = ?`,
        args: [userId],
      });

      if (result.rows.length === 0) {
        return res.json({
          userId,
          autoSyncEnabled: false,
          syncIntervalMinutes: 60,
          maxEmailsPerSync: 25,
          autoApproveThreshold: 0.88,
          lastSyncAt: null,
        });
      }

      const row = result.rows[0];
      res.json({
        userId: row.user_id,
        autoSyncEnabled: !!row.auto_sync_enabled,
        syncIntervalMinutes: Number(row.sync_interval_minutes),
        maxEmailsPerSync: Number(row.max_emails_per_sync),
        autoApproveThreshold: Number(row.auto_approve_threshold),
        lastSyncAt: row.last_sync_at,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/gmail/settings
  app.put('/api/gmail/settings', requireAuth, async (req, res) => {
    try {
      const turso = getTurso();
      const userId = req.user.id;

      const validation = validateBody(req.body, GMAIL_SETTINGS_BODY_SCHEMA);
      if (!validation.ok) return sendValidationError(res, validation);
      const { autoSyncEnabled, syncIntervalMinutes, maxEmailsPerSync, autoApproveThreshold, lastSyncAt } = validation.value;
      const now = new Date().toISOString();

      await turso.execute({
        sql: `INSERT INTO gmail_sync_settings (user_id, auto_sync_enabled, sync_interval_minutes, max_emails_per_sync, auto_approve_threshold, last_sync_at, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(user_id) DO UPDATE SET
                auto_sync_enabled = COALESCE(excluded.auto_sync_enabled, auto_sync_enabled),
                sync_interval_minutes = COALESCE(excluded.sync_interval_minutes, sync_interval_minutes),
                max_emails_per_sync = COALESCE(excluded.max_emails_per_sync, max_emails_per_sync),
                auto_approve_threshold = COALESCE(excluded.auto_approve_threshold, auto_approve_threshold),
                last_sync_at = COALESCE(excluded.last_sync_at, last_sync_at),
                updated_at = excluded.updated_at`,
        args: [
          userId,
          autoSyncEnabled !== undefined ? (autoSyncEnabled ? 1 : 0) : 0,
          syncIntervalMinutes || 60,
          maxEmailsPerSync || 25,
          autoApproveThreshold || 0.88,
          lastSyncAt || null,
          now,
          now,
        ],
      });

      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/gmail/runs
  app.get('/api/gmail/runs', requireAuth, async (req, res) => {
    try {
      const turso = getTurso();
      const userId = req.user.id;
      // P1-2 quick win: clamp limit via shared validator (1..100); absen → 20
      // (default lama). Nilai non-numerik → 400 (fail-closed).
      const queryCheck = validateQuery(req.query, {
        limit: { validate: validateInt, options: { min: 1, max: 100, clamp: true } },
      });
      if (!queryCheck.ok) return sendValidationError(res, queryCheck);
      const limit = queryCheck.value.limit ?? 20;

      const result = await turso.execute({
        sql: `SELECT * FROM gmail_sync_runs WHERE user_id = ? ORDER BY started_at DESC LIMIT ?`,
        args: [userId, limit],
      });

      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/gmail/runs — start a sync run
  app.post('/api/gmail/runs', requireAuth, async (req, res) => {
    try {
      const turso = getTurso();
      const userId = req.user.id;
      const id = crypto.randomUUID();
      const now = new Date().toISOString();

      await turso.execute({
        sql: `INSERT INTO gmail_sync_runs (id, user_id, status, started_at, total_emails, processed, accepted, rejected, skipped, failed)
              VALUES (?, ?, 'running', ?, 0, 0, 0, 0, 0, 0)`,
        args: [id, userId, now],
      });

      res.json({ id });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/gmail/runs/:id — finish/update a sync run
  app.put('/api/gmail/runs/:id', requireAuth, async (req, res) => {
    try {
      const turso = getTurso();
      const userId = req.user.id;

      const idCheck = validateId(req.params.id, { field: 'runId' });
      if (!idCheck.ok) return sendValidationError(res, idCheck);
      const id = String(idCheck.value);

      const validation = validateBody(req.body, GMAIL_RUN_PATCH_SCHEMA);
      if (!validation.ok) return sendValidationError(res, validation);
      const { status, completedAt, totalEmails, processed, accepted, rejected, skipped, failed, errorMessage } = validation.value;

      const updates = [];
      const args = [];

      if (status !== undefined) { updates.push('status = ?'); args.push(status); }
      if (completedAt !== undefined) { updates.push('completed_at = ?'); args.push(completedAt); }
      if (totalEmails !== undefined) { updates.push('total_emails = ?'); args.push(totalEmails); }
      if (processed !== undefined) { updates.push('processed = ?'); args.push(processed); }
      if (accepted !== undefined) { updates.push('accepted = ?'); args.push(accepted); }
      if (rejected !== undefined) { updates.push('rejected = ?'); args.push(rejected); }
      if (skipped !== undefined) { updates.push('skipped = ?'); args.push(skipped); }
      if (failed !== undefined) { updates.push('failed = ?'); args.push(failed); }
      if (errorMessage !== undefined) { updates.push('error_message = ?'); args.push(errorMessage); }

      if (updates.length > 0) {
        await turso.execute({
          sql: `UPDATE gmail_sync_runs SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`,
          args: [...args, id, userId],
        });
      }

      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}
