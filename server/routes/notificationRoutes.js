/**
 * Notification Routes for CashFlow
 *
 * P1-2 (Validation Layer): POST /api/notifications divalidasi via
 * server/lib/validation.js (gagal → 400 VALIDATION_ERROR, JANGAN PERNAH 401).
 * Kontrol keamanan P1-4 DIPERTAHANKAN apa adanya: sanitizeNotificationMetadata
 * untuk `metadata`, cap 200-karakter dedupeKey (slice, bukan 400), dan clamp
 * GET limit/offset/type/unreadOnly (semantik parseInt() TIDAK sama dengan
 * validateInt — handler GET dibiarkan tak tersentuh).
 */
import { getTurso } from '../lib/turso.js';
import { requireAuth } from '../middleware/authMiddleware.js';
import { notifyUser } from '../lib/sse.js';
import { notifyGmailReviewResult } from '../services/gmailNotifier.js';
import {
  sanitizeNotificationMetadata,
  corroborateGmailReviewResult,
  GMAIL_REVIEW_RESULTS,
} from '../lib/notificationGuard.js';
import {
  validateBody,
  sendValidationError,
  validateRequiredString,
  validateOptionalString,
  validateEnum,
  validateBoolean,
  validateId,
} from '../lib/validation.js';
import { logger } from '../lib/logger.js';
import crypto from 'node:crypto';

// Whitelist type: SAMA PERSIS dengan NotificationType (src/types/index.ts) dan
// notificationFilterOptions (src/features/notifications/utils/notificationDisplay.ts)
// — termasuk set yang sudah dipakai filter GET di bawah. Semua producer
// notifikasi via HTTP adalah client-side (notificationService.ts /
// notificationTriggers.ts / useAppStore) dan selalu memakai salah satu nilai
// ini; producer server (alertNotifier) INSERT langsung ke DB sehingga tidak
// pernah tertolak validator ini.
export const NOTIFICATION_TYPES = new Set([
  'transaction', 'budget', 'gmail', 'system',
  'success', 'warning', 'error', 'info',
]);

/** NotificationPriority (src/types/index.ts). Default POST 'normal' (perilaku lama). */
export const NOTIFICATION_PRIORITIES = ['low', 'normal', 'high'];

/**
 * actionHref: string opsional, http/https absolut ATAU path relatif — JANGAN
 * over-restrict (client memakai path router seperti '/gmail-sync'). Skema lain
 * (javascript:, data:, ...) ditolak fail-closed sebagai vektor XSS navigasi.
 */
export function validateActionHref(value, opts) {
  const result = validateOptionalString(value, { field: opts?.field ?? 'actionHref', max: 500 });
  if (!result.ok || result.value === undefined) return result;
  const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(result.value);
  if (hasScheme && !/^https?:\/\//i.test(result.value)) {
    return { ok: false, error: 'actionHref harus URL http/https atau path relatif.' };
  }
  return result;
}

/**
 * Skema POST /api/notifications (di-export untuk unit test).
 *
 * `dedupeKey` & `metadata` SENGAJA tidak ada di skema: keduanya diproses dari
 * req.body dengan kontrol lama yang wajib dipertahankan byte-for-byte
 * (dedupeKey slice 200 karakter; metadata via sanitizeNotificationMetadata).
 */
export const NOTIFICATION_CREATE_SCHEMA = {
  type: { validate: validateEnum, options: { field: 'type', values: NOTIFICATION_TYPES, required: true } },
  priority: { validate: validateEnum, options: { field: 'priority', values: NOTIFICATION_PRIORITIES } },
  title: { validate: validateRequiredString, options: { field: 'title', max: 200 } },
  message: { validate: validateRequiredString, options: { field: 'message', max: 1000 } },
  read: { validate: validateBoolean, options: { field: 'read' } },
  actionLabel: { validate: validateOptionalString, options: { field: 'actionLabel', max: 100 } },
  actionHref: { validate: validateActionHref },
};

export function registerNotificationRoutes(app) {
  // GET /api/notifications?limit=&offset=&type=&unreadOnly= — paginated list
  // (newest first). Filter type/unread diterapkan di SQL WHERE (parameterized)
  // SEBELUM LIMIT/OFFSET — filter client-side setelah paging memotong baris
  // secara diam-diam dan memicu duplikat antar halaman.
  app.get('/api/notifications', requireAuth, async (req, res) => {
    try {
      const turso = getTurso();
      const userId = req.user.id;

      // limit: default & max 100 (previous behavior was hardcoded LIMIT 100).
      const limitParam = Number.parseInt(req.query.limit, 10);
      const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 100) : 100;
      // offset: default 0, clamp to non-negative integer.
      const offsetParam = Number.parseInt(req.query.offset, 10);
      const offset = Number.isFinite(offsetParam) && offsetParam > 0 ? offsetParam : 0;

      // type: whitelist sama dengan notificationFilterOptions di client
      // (src/features/notifications/utils/notificationDisplay.ts).
      const ALLOWED_TYPES = new Set([
        'transaction', 'budget', 'gmail', 'system',
        'success', 'warning', 'error', 'info',
      ]);
      const type = typeof req.query.type === 'string' && ALLOWED_TYPES.has(req.query.type)
        ? req.query.type
        : null;

      // unreadOnly: terima `unreadOnly=1/true` atau alias `read=0/false`.
      const truthy = (v) => v === '1' || v === 'true';
      const unreadOnly = truthy(req.query.unreadOnly)
        || req.query.read === '0'
        || req.query.read === 'false';

      const where = ['user_id = ?'];
      const args = [userId];
      if (type) {
        where.push('type = ?');
        args.push(type);
      }
      if (unreadOnly) {
        where.push('read = 0');
      }

      const result = await turso.execute({
        sql: `SELECT * FROM notifications WHERE ${where.join(' AND ')} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
        args: [...args, limit, offset],
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

      // P1-2: validasi body via shared validation library. Gagal → 400
      // VALIDATION_ERROR (bukan 401). Field tak dikenal dibuang — KECUALI
      // metadata/dedupeKey yang sengaja dibaca langsung dari req.body agar
      // kontrol P1-4 lama berjalan byte-for-byte identik.
      const result = validateBody(req.body, NOTIFICATION_CREATE_SCHEMA);
      if (!result.ok) return sendValidationError(res, result);
      const {
        type,
        priority = 'normal',
        title,
        message,
        read = false,
        actionLabel,
        actionHref,
      } = result.value;
      const { dedupeKey: dedupeKeyRaw, metadata: metadataRaw } = req.body;

      // P1-4 (Notification Metadata Guard): validasi metadata SEBELUM dipakai —
      // wajib plain object, JSON-only, ukuran & jumlah key dibatasi, key
      // prototype-pollution di-strip. Invalid → 400.
      const metadataCheck = sanitizeNotificationMetadata(metadataRaw);
      if (!metadataCheck.ok) {
        return res.status(400).json({ error: metadataCheck.error });
      }
      const metadata = metadataCheck.metadata;

      const now = new Date().toISOString();
      // Cap panjang dedupeKey (index unik (user_id, dedupe_key)) — key sah
      // terpanjang (`gmail-review-<messageId>`) jauh di bawah 200 karakter.
      const dedupeKey = String(dedupeKeyRaw || '').slice(0, 200);

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
      //
      // P1-4 (Notification Metadata Guard): metadata.source TIDAK lagi dipercaya
      // begitu saja — side effect hanya dipicu bila server punya baris
      // `gmail_sync_logs` milik user untuk emailId yang diklaim DAN status log
      // kompatibel dengan hasil yang diklaim. Konten webhook/email diambil dari
      // baris log server (candidate merchant/amount, error_message), BUKAN dari
      // body client — menutup injeksi konten operator lewat POST forjaan.
      const wantsGmailReview = metadata?.source === 'gmail_review'
        && typeof metadata?.emailId === 'string'
        && metadata.emailId.length > 0;
      if (wantsGmailReview) {
        const claimedResult = typeof metadata.result === 'string' && GMAIL_REVIEW_RESULTS.has(metadata.result)
          ? metadata.result
          : 'failed';
        const logResult = await turso.execute({
          sql: `SELECT status, final_status, sender, error_message, metadata
                FROM gmail_sync_logs
                WHERE user_id = ? AND message_id = ?
                LIMIT 1`,
          args: [userId, metadata.emailId],
        });
        const corroborated = corroborateGmailReviewResult({
          logRow: logResult.rows[0] || null,
          emailId: metadata.emailId,
          claimedResult,
        });
        if (corroborated) {
          notifyGmailReviewResult({
            userId,
            userEmail: req.user?.email || null,
            result: corroborated,
          }).catch(() => {
            // never throw — channel eksternal tidak boleh mengganggu respons
          });
        } else {
          // Forgery / status tidak konsisten: notifikasi in-app tetap tersimpan
          // (milik user sendiri), tetapi webhook/email operator DIBLOKIR.
          logger.warn(
            { userId, emailId: metadata.emailId, claimedResult },
            'Notifikasi gmail_review tanpa korelasi log server — side effect webhook/email diblokir',
          );
        }
      }

      res.json({ id });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/notifications/:id/read — mark as read
  app.put('/api/notifications/:id/read', requireAuth, async (req, res) => {
    try {
      // P1-2: tolak id tak valid dengan 400 VALIDATION_ERROR (bukan 401/500).
      const idCheck = validateId(req.params.id, { field: 'id' });
      if (!idCheck.ok) return sendValidationError(res, idCheck);
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
      // P1-2: tolak id tak valid dengan 400 VALIDATION_ERROR (bukan 401/500).
      const idCheck = validateId(req.params.id, { field: 'id' });
      if (!idCheck.ok) return sendValidationError(res, idCheck);
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
