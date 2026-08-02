/**
 * Notification Routes for CashFlow
 */
import { getTurso } from '../lib/turso.js';
import { requireAuth } from '../middleware/authMiddleware.js';
import { notifyUser } from '../lib/sse.js';
import { notifyGmailReviewResult } from '../services/gmailNotifier.js';
import crypto from 'node:crypto';

export function registerNotificationRoutes(app) {
  // GET /api/notifications
  app.get('/api/notifications', requireAuth, async (req, res) => {
    try {
      const turso = getTurso();
      const userId = req.user.id;

      const result = await turso.execute({
        sql: `SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`,
        args: [userId],
      });

      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/notifications
  app.post('/api/notifications', requireAuth, async (req, res) => {
    try {
      const turso = getTurso();
      const userId = req.user.id;
      const id = crypto.randomUUID();
      const {
        type,
        priority = 'normal',
        title,
        message,
        read = false,
        actionLabel,
        actionHref,
        dedupeKey: dedupeKeyRaw,
        metadata = {},
      } = req.body;
      const now = new Date().toISOString();
      const dedupeKey = String(dedupeKeyRaw || '');

      if (dedupeKey) {
        // Upsert by dedupeKey
        await turso.execute({
          sql: `INSERT INTO notifications (id, user_id, type, priority, title, message, read, action_label, action_href, dedupe_key, metadata, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(user_id, dedupe_key) DO UPDATE SET
                  title = excluded.title,
                  message = excluded.message,
                  read = excluded.read,
                  priority = excluded.priority,
                  created_at = excluded.created_at`,
          args: [
            id,
            userId,
            type,
            priority,
            title,
            message,
            read ? 1 : 0,
            actionLabel || null,
            actionHref || null,
            dedupeKey,
            JSON.stringify(metadata),
            now,
          ],
        });
      } else {
        await turso.execute({
          sql: `INSERT INTO notifications (id, user_id, type, priority, title, message, read, action_label, action_href, metadata, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            id,
            userId,
            type,
            priority,
            title,
            message,
            read ? 1 : 0,
            actionLabel || null,
            actionHref || null,
            JSON.stringify(metadata),
            now,
          ],
        });
      }

      notifyUser(userId, 'notification:new', { id, title });

      // Channel eksternal untuk hasil review Gmail (webhook + email) — agar user
      // tahu walau app tidak terbuka. Fire-and-forget, non-blocking (gmailNotifier
      // tidak pernah melempar).
      //
      // GATE: hanya `metadata.source === 'gmail_review'` DAN `metadata.emailId` ada.
      // JANGAN pakai prefix dedupeKey `gmail-review-` — itu juga dipakai notifikasi
      // RINGKASAN HARIAN "menunggu review" (buildGmailReviewKey(date) →
      // `gmail-review-<tanggal>`), yang bukan aksi approve/reject per-email dan
      // tidak boleh memicu webhook/email.
      const isGmailReview = metadata?.source === 'gmail_review' && !!metadata?.emailId;
      if (isGmailReview) {
        notifyGmailReviewResult({
          userId,
          userEmail: req.user?.email || null,
          result: {
            status: metadata?.result || 'failed',
            emailId: metadata.emailId,
            merchant: metadata?.merchant || null,
            amount: typeof metadata?.amount === 'number' ? metadata.amount : null,
            message: metadata?.errorMessage || metadata?.message || null,
          },
        }).catch(() => {
          // never throw — channel eksternal tidak boleh mengganggu respons
        });
      }

      res.json({ id });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/notifications/:id/read — mark as read
  app.put('/api/notifications/:id/read', requireAuth, async (req, res) => {
    try {
      const turso = getTurso();
      const userId = req.user.id;
      const { id } = req.params;

      await turso.execute({
        sql: `UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?`,
        args: [id, userId],
      });

      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/notifications/read-all — mark all as read
  app.put('/api/notifications/read-all', requireAuth, async (req, res) => {
    try {
      const turso = getTurso();
      const userId = req.user.id;

      await turso.execute({
        sql: `UPDATE notifications SET read = 1 WHERE user_id = ?`,
        args: [userId],
      });

      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/notifications/:id — delete notification
  app.delete('/api/notifications/:id', requireAuth, async (req, res) => {
    try {
      const turso = getTurso();
      const userId = req.user.id;
      const { id } = req.params;

      await turso.execute({
        sql: `DELETE FROM notifications WHERE id = ? AND user_id = ?`,
        args: [id, userId],
      });

      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}
