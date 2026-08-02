/**
 * Gmail Sync Routes for CashFlow
 * Logs, settings, and run history
 */
import { getTurso } from '../lib/turso.js';
import { requireAuth } from '../middleware/authMiddleware.js';
import { notifyUser } from '../lib/sse.js';
import crypto from 'node:crypto';

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

export function registerGmailRoutes(app) {
  // GET /api/gmail/token — Get current Google OAuth access token for Gmail API
  app.get('/api/gmail/token', requireAuth, async (req, res) => {
    try {
      const turso = getTurso();
      const userId = req.user.id;

      const result = await turso.execute({
        sql: `SELECT accessToken, refreshToken FROM account WHERE userId = ? AND providerId = 'google' ORDER BY createdAt DESC LIMIT 1`,
        args: [userId],
      });

      if (result.rows.length === 0 || !result.rows[0].accessToken) {
        return res.status(404).json({ error: 'Token akses Gmail belum ditemukan. Silakan berikan izin akses Gmail.' });
      }

      res.json({
        accessToken: result.rows[0].accessToken,
        refreshToken: result.rows[0].refreshToken || null,
      });
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
      } = req.body;

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
      const { autoSyncEnabled, syncIntervalMinutes, maxEmailsPerSync, autoApproveThreshold, lastSyncAt } = req.body;
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
      const limit = parseInt(req.query.limit || '20', 10);

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
      const { id } = req.params;
      const { status, completedAt, totalEmails, processed, accepted, rejected, skipped, failed, errorMessage } = req.body;

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
