/**
 * AI Product Experience Routes (Sprint 1.5)
 *
 * Lapisan "trust & learning" untuk seluruh hasil AI:
 *   1. ai_feedback  — feedback pengguna (👍/👎 + alasan) → dataset evaluasi.
 *      Feedback TIDAK langsung mengubah AI; hanya disimpan (pipeline: feedback →
 *      evaluation dataset → future training).
 *   2. ai_memory    — preferensi personal AI (user-scoped, editable, deletable,
 *      transparan) yang bisa dipakai prompt personalisasi.
 *   3. ai_timeline  — riwayat rekomendasi AI: menjelaskan "apa yang berubah &
 *      mengapa" antar periode.
 *
 * Semua write-endpoint divalidasi via server/lib/validation.js (pola P1-2):
 * gagal validasi → 400 VALIDATION_ERROR, JANGAN PERNAH 401.
 *
 * Endpoints:
 *   POST   /api/ai-product/feedback             — simpan feedback
 *   GET    /api/ai-product/feedback?feature=..  — daftar feedback user (opsi filter)
 *   GET    /api/ai-product/memory               — daftar preferensi user
 *   POST   /api/ai-product/memory               — upsert preferensi (category+key unik)
 *   PUT    /api/ai-product/memory/:id           — update value/source preferensi
 *   DELETE /api/ai-product/memory/:id           — hapus preferensi
 *   GET    /api/ai-product/timeline             — daftar timeline AI user
 *   POST   /api/ai-product/timeline             — tambah entri timeline (auto-timestamp)
 */
import { getTurso } from '../lib/turso.js';
import { requireAuth } from '../middleware/authMiddleware.js';
import crypto from 'node:crypto';
import {
  validateBody,
  sendValidationError,
  validateRequiredString,
  validateOptionalString,
  validateEnum,
  validateId,
} from '../lib/validation.js';

// ================= Enum kanonik =================

/** Rating feedback — opsi yang sama dengan komponen AiFeedbackButtons. */
export const FEEDBACK_RATINGS = ['helpful', 'not_helpful', 'mismatched', 'irrelevant', 'already_done', 'skip'];

/** Feature AI yang bisa diberi feedback / punya timeline. */
export const AI_FEATURES = ['advisor', 'insight', 'fraud', 'search', 'ocr', 'health', 'simulation', 'memory'];

/** Kategori preferensi AI Memory. */
export const MEMORY_CATEGORIES = ['spending_habit', 'payment_preference', 'budget_style', 'subscription', 'goal', 'note'];

/** Sumber preferensi. */
export const MEMORY_SOURCES = ['manual', 'ai_inferred'];

/** Batas listing default. */
const DEFAULT_LIMIT = 50;

// ================= Skema validasi (di-export untuk unit test) =================

export const FEEDBACK_CREATE_SCHEMA = {
  feature: { validate: validateEnum, options: { field: 'feature', values: AI_FEATURES, required: true } },
  itemId: { validate: validateOptionalString, options: { field: 'itemId', max: 100 } },
  rating: { validate: validateEnum, options: { field: 'rating', values: FEEDBACK_RATINGS, required: true } },
  reason: { validate: validateOptionalString, options: { field: 'reason', max: 500 } },
};

export const MEMORY_UPSERT_SCHEMA = {
  category: { validate: validateEnum, options: { field: 'category', values: MEMORY_CATEGORIES, required: true } },
  key: { validate: validateRequiredString, options: { field: 'key', max: 80 } },
  value: { validate: validateRequiredString, options: { field: 'value', max: 300 } },
  source: { validate: validateEnum, options: { field: 'source', values: MEMORY_SOURCES } },
};

export const MEMORY_UPDATE_SCHEMA = {
  value: { validate: validateRequiredString, options: { field: 'value', max: 300 } },
  source: { validate: validateEnum, options: { field: 'source', values: MEMORY_SOURCES } },
};

export const TIMELINE_CREATE_SCHEMA = {
  feature: { validate: validateEnum, options: { field: 'feature', values: AI_FEATURES, required: true } },
  title: { validate: validateRequiredString, options: { field: 'title', max: 200 } },
  body: { validate: validateOptionalString, options: { field: 'body', max: 2000 } },
  confidence: { validate: (v, o) => {
    if (v === undefined || v === null) return { ok: true, value: undefined };
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 && n <= 1
      ? { ok: true, value: n }
      : { ok: false, error: 'confidence harus angka 0-1.', errors: ['confidence harus angka 0-1.'] };
  }, options: { field: 'confidence' } },
  payload: { validate: (v, o) => {
    if (v === undefined || v === null) return { ok: true, value: undefined };
    if (typeof v !== 'object' || Array.isArray(v)) return { ok: false, error: 'payload harus objek JSON.', errors: ['payload harus objek JSON.'] };
    let raw = '';
    try { raw = JSON.stringify(v); } catch { raw = ''; }
    if (!raw || raw.length > 8000) return { ok: false, error: 'payload terlalu besar (maks 8KB).', errors: ['payload terlalu besar (maks 8KB).'] };
    return { ok: true, value: raw };
  }, options: { field: 'payload' } },
};

/** Tolak id path param tak valid dengan 400 VALIDATION_ERROR (bukan 401/500). */
function rejectInvalidId(res, rawId) {
  const check = validateId(rawId, { field: 'id' });
  if (!check.ok) {
    sendValidationError(res, check);
    return false;
  }
  return true;
}

export function registerAiProductRoutes(app) {
  // ================= FEEDBACK =================
  app.post('/api/ai-product/feedback', requireAuth, async (req, res) => {
    try {
      const turso = getTurso();
      const userId = req.user.id;
      const result = validateBody(req.body, FEEDBACK_CREATE_SCHEMA);
      if (!result.ok) return sendValidationError(res, result);
      const { feature, itemId = '', rating, reason = '' } = result.value;
      const id = crypto.randomUUID();

      await turso.execute({
        sql: `INSERT INTO ai_feedback (id, user_id, feature, item_id, rating, reason, created_at)
              VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
        args: [id, userId, feature, itemId, rating, reason],
      });
      res.status(201).json({ id, ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/ai-product/feedback', requireAuth, async (req, res) => {
    try {
      const turso = getTurso();
      const userId = req.user.id;
      const feature = typeof req.query.feature === 'string' ? req.query.feature.trim() : '';
      // Clamp limit ke [1, 200] — nilai negatif/0 tidak boleh sampai ke SQL LIMIT.
      const limit = Math.max(1, Math.min(Number(req.query.limit) || DEFAULT_LIMIT, 200));

      const rows = feature
        ? (await turso.execute({
          sql: `SELECT id, feature, item_id, rating, reason, created_at FROM ai_feedback
                WHERE user_id = ? AND feature = ? ORDER BY created_at DESC LIMIT ?`,
          args: [userId, feature, limit],
        })).rows
        : (await turso.execute({
          sql: `SELECT id, feature, item_id, rating, reason, created_at FROM ai_feedback
                WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
          args: [userId, limit],
        })).rows;

      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ================= MEMORY (preferensi AI) =================
  app.get('/api/ai-product/memory', requireAuth, async (req, res) => {
    try {
      const turso = getTurso();
      const userId = req.user.id;
      const result = await turso.execute({
        sql: `SELECT id, category, key, value, source, created_at, updated_at
              FROM ai_memory WHERE user_id = ? ORDER BY category ASC, key ASC`,
        args: [userId],
      });
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/ai-product/memory', requireAuth, async (req, res) => {
    try {
      const turso = getTurso();
      const userId = req.user.id;
      const result = validateBody(req.body, MEMORY_UPSERT_SCHEMA);
      if (!result.ok) return sendValidationError(res, result);
      const { category, key, value, source = 'manual' } = result.value;

      // Upsert: (user_id, category, key) UNIQUE → insert atau update value.
      await turso.execute({
        sql: `INSERT INTO ai_memory (id, user_id, category, key, value, source, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
              ON CONFLICT(user_id, category, key) DO UPDATE SET
                value = excluded.value,
                source = excluded.source,
                updated_at = datetime('now')`,
        args: [crypto.randomUUID(), userId, category, key, value, source],
      });

      const idResult = await turso.execute({
        sql: `SELECT id FROM ai_memory WHERE user_id = ? AND category = ? AND key = ?`,
        args: [userId, category, key],
      });
      res.json({ id: idResult.rows[0]?.id, ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/ai-product/memory/:id', requireAuth, async (req, res) => {
    try {
      if (!rejectInvalidId(res, req.params.id)) return;
      const turso = getTurso();
      const userId = req.user.id;
      const { id } = req.params;
      const result = validateBody(req.body, MEMORY_UPDATE_SCHEMA);
      if (!result.ok) return sendValidationError(res, result);
      const { value, source } = result.value;

      await turso.execute({
        sql: `UPDATE ai_memory SET value = ?, source = ?, updated_at = datetime('now')
              WHERE id = ? AND user_id = ?`,
        args: [value, source || 'manual', id, userId],
      });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/ai-product/memory/:id', requireAuth, async (req, res) => {
    try {
      if (!rejectInvalidId(res, req.params.id)) return;
      const turso = getTurso();
      const userId = req.user.id;
      const { id } = req.params;

      await turso.execute({
        sql: `DELETE FROM ai_memory WHERE id = ? AND user_id = ?`,
        args: [id, userId],
      });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ================= TIMELINE =================
  app.get('/api/ai-product/timeline', requireAuth, async (req, res) => {
    try {
      const turso = getTurso();
      const userId = req.user.id;
      const feature = typeof req.query.feature === 'string' ? req.query.feature.trim() : '';
      // Clamp limit ke [1, 200] — nilai negatif/0 tidak boleh sampai ke SQL LIMIT.
      const limit = Math.max(1, Math.min(Number(req.query.limit) || DEFAULT_LIMIT, 200));

      const rows = feature
        ? (await turso.execute({
          sql: `SELECT id, feature, title, body, confidence, payload, created_at
                FROM ai_timeline WHERE user_id = ? AND feature = ? ORDER BY created_at DESC LIMIT ?`,
          args: [userId, feature, limit],
        })).rows
        : (await turso.execute({
          sql: `SELECT id, feature, title, body, confidence, payload, created_at
                FROM ai_timeline WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
          args: [userId, limit],
        })).rows;

      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/ai-product/timeline', requireAuth, async (req, res) => {
    try {
      const turso = getTurso();
      const userId = req.user.id;
      const result = validateBody(req.body, TIMELINE_CREATE_SCHEMA);
      if (!result.ok) return sendValidationError(res, result);
      const { feature, title, body = '', confidence, payload } = result.value;
      const id = crypto.randomUUID();

      await turso.execute({
        sql: `INSERT INTO ai_timeline (id, user_id, feature, title, body, confidence, payload, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        args: [id, userId, feature, title, body, confidence ?? null, payload ?? '{}'],
      });
      res.status(201).json({ id, ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}
