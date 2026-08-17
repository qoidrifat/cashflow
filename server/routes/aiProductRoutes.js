/**
 * AI Product Experience Routes (Sprint 1.5 + P9)
 *
 * Lapisan "trust & learning" untuk seluruh hasil AI:
 *   1. ai_feedback  — feedback pengguna (👍/👎 + alasan) → dataset evaluasi.
 *      Feedback TIDAK langsung mengubah AI; hanya disimpan (pipeline: feedback →
 *      evaluation dataset → future training).
 *   2. ai_memory    — preferensi personal AI (user-scoped, editable, deletable,
 *      transparan) yang bisa dipakai prompt personalisasi.
 *   3. ai_timeline  — riwayat rekomendasi AI: menjelaskan "apa yang berubah &
 *      mengapa" antar periode. P9: event_type (insight/recommendation/
 *      conversation/feedback/memory_update/risk/other), status (new/viewed/
 *      completed/dismissed) dengan transisi state machine deterministik,
 *      pagination keyset (before+id), detail + feedback terkait.
 *
 * Semua write-endpoint divalidasi via server/lib/validation.js (pola P1-2):
 * gagal validasi → 400 VALIDATION_ERROR, JANGAN PERNAH 401.
 *
 * Endpoints:
 *   POST   /api/ai-product/feedback             — simpan feedback (+ event timeline)
 *   GET    /api/ai-product/feedback?feature=..  — daftar feedback user (opsi filter)
 *   GET    /api/ai-product/memory               — daftar preferensi user
 *   POST   /api/ai-product/memory               — upsert preferensi (+ event timeline)
 *   PUT    /api/ai-product/memory/:id           — update value/source preferensi
 *   DELETE /api/ai-product/memory/:id           — hapus preferensi (+ event timeline)
 *   GET    /api/ai-product/timeline             — daftar timeline (pagination keyset)
 *   GET    /api/ai-product/timeline/:id         — detail event + feedback terkait
 *   POST   /api/ai-product/timeline             — tambah entri timeline (auto-timestamp)
 *   PATCH  /api/ai-product/timeline/:id/status  — transisi status (state machine)
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
import {
  EVENT_TYPES,
  TIMELINE_STATUSES,
  canTransition,
  insertTimelineEvent,
  buildFeedbackEvent,
  buildMemoryEvent,
  eventTypeFromFeature,
} from '../lib/timelineEvents.js';

/**
 * Event telemetry frontend → system_metrics (P10.2 — Closed Beta Instrumentation).
 * Pola /api/agent-search/track: additive, non-PII, fire-and-forget di sisi
 * recorder. Event yang boleh direkam (whitelist — klien tidak bisa invent
 * nama event):
 *   - ai_hub_view          — halaman AI Hub dibuka (exposure)
 *   - recommendation_shown — rekomendasi dirender/terlihat (denominator CTR)
 *   - recommendation_opened — rekomendasi dibuka (numerator CTR)
 *   - ai_result_shown      — kartu hasil AI yang feedback-capable ditampilkan
 *                            (denominator Feedback Rate — P10.2i: tampilan
 *                            kartu AI, bukan page view; fired di SEMUA surface
 *                            yang punya AiFeedbackButtons: timeline events,
 *                            hub insight/health/simulation, advisor, chat)
 * Metadata minimal: { feature, itemId, eventType? } — TANPA query/isi konten
 * (privacy). `eventType` opsional (enum timeline kanonik — panel admin bisa
 * memecah CTR per event type, bukan hanya per feature; P10.2d).
 */
export const TRACK_EVENTS = ['ai_hub_view', 'recommendation_shown', 'recommendation_opened', 'ai_result_shown'];

/** Skema POST /track — field tak dikenal dibuang validateBody. */
export const TRACK_CREATE_SCHEMA = {
  event: { validate: validateEnum, options: { field: 'event', values: TRACK_EVENTS, required: true } },
  feature: { validate: validateOptionalString, options: { field: 'feature', max: 64 } },
  itemId: { validate: validateOptionalString, options: { field: 'itemId', max: 100 } },
  eventType: { validate: validateEnum, options: { field: 'eventType', values: EVENT_TYPES } },
};
import { logger } from '../lib/logger.js';
import metricsService from '../services/metricsService.js';

// ================= Enum kanonik =================

/** Rating feedback — opsi yang sama dengan komponen AiFeedbackButtons. */
export const FEEDBACK_RATINGS = ['helpful', 'not_helpful', 'mismatched', 'irrelevant', 'already_done', 'skip'];

/** Feature AI yang bisa diberi feedback / punya timeline. */
export const AI_FEATURES = ['advisor', 'insight', 'fraud', 'search', 'ocr', 'health', 'simulation', 'memory', 'conversation'];

/** Kategori preferensi AI Memory. */
export const MEMORY_CATEGORIES = ['spending_habit', 'payment_preference', 'budget_style', 'subscription', 'goal', 'note'];

/** Sumber preferensi. */
export const MEMORY_SOURCES = ['manual', 'ai_inferred'];

/** Batas listing default timeline (P9 §18: 20 events, clamp 1-100). */
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

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

/** Skema PATCH status timeline — enum status P9 (§12). */
export const TIMELINE_STATUS_UPDATE_SCHEMA = {
  status: { validate: validateEnum, options: { field: 'status', values: TIMELINE_STATUSES, required: true } },
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

/** Clamp limit query [1, MAX_LIMIT] — nilai negatif/0 tidak boleh sampai SQL. */
function clampLimit(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(1, Math.min(Math.round(n), MAX_LIMIT)) : DEFAULT_LIMIT;
}

/**
 * Rekam event feedback ke timeline bila feedback TIDAK terkait event timeline
 * (itemId merujuk ai_timeline user → korelasi via item_id, tanpa duplikat —
 * P9 §13). Fire-and-forget: kegagalan tidak menggagalkan respons feedback.
 */
function recordFeedbackEvent(userId, feature, rating, reason, itemId) {
  (async () => {
    try {
      const turso = getTurso();
      let related = false;
      if (itemId) {
        const check = await turso.execute({
          sql: 'SELECT 1 AS x FROM ai_timeline WHERE id = ? AND user_id = ?',
          args: [itemId, userId],
        });
        related = check.rows.length > 0;
      }
      if (!related) {
        await insertTimelineEvent(turso, userId, buildFeedbackEvent({ feature, rating, reason }));
      }
    } catch (err) {
      logger.warn({ message: err.message }, 'Feedback timeline record gagal (diabaikan)');
    }
  })();
}

/** Rekam event memory_update (set/delete) — fire-and-forget (P9 §14). */
function recordMemoryEvent(userId, category, key, action) {
  insertTimelineEvent(getTurso(), userId, buildMemoryEvent({ category, key, action }))
    .catch((err) => logger.warn({ message: err.message }, 'Memory timeline record gagal (diabaikan)'));
}

export function registerAiProductRoutes(app) {
  // ================= TRACK (P10.2 — telemetry frontend) =================
  /**
   * POST /api/ai-product/track — record event exposure/engagement (non-PII).
   * requireAuth: user-scoped (analytics perlu cohort). 400 VALIDATION_ERROR
   * bila event tidak dikenal / payload tidak valid. Recorder non-blocking.
   */
  app.post('/api/ai-product/track', requireAuth, async (req, res) => {
    try {
      const result = validateBody(req.body, TRACK_CREATE_SCHEMA);
      if (!result.ok) return sendValidationError(res, result);
      const { event, feature = null, itemId = null, eventType = null } = result.value;
      metricsService.recordSystemMetric({
        metricName: event,
        feature: feature || 'ai_hub',
        userId: req.user.id,
        metadata: { feature, itemId, eventType },
      }).catch(() => {});
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

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
      recordFeedbackEvent(userId, feature, rating, reason, itemId);
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
      recordMemoryEvent(userId, category, key, 'set');
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

      // Ambil metadata dulu agar event memory_delete punya konteks (P9 §14).
      const found = await turso.execute({
        sql: 'SELECT category, key FROM ai_memory WHERE id = ? AND user_id = ?',
        args: [id, userId],
      });
      const meta = found.rows[0];
      if (!meta) return res.status(404).json({ error: 'Preferensi tidak ditemukan.' });

      await turso.execute({
        sql: `DELETE FROM ai_memory WHERE id = ? AND user_id = ?`,
        args: [id, userId],
      });
      recordMemoryEvent(userId, meta.category, meta.key, 'delete');
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ================= TIMELINE (P9) =================

  /**
   * GET /api/ai-product/timeline — pagination KEYSET (created_at, id):
   *   ?feature=       filter feature (opsional)
   *   ?eventType=     filter event_type kanonik (opsional)
   *   ?before=<ts>    cursor — created_at event terakhir yang sudah dilihat
   *                   (keyset komposit: created_at < ? OR (created_at = ? AND id < ?))
   *   ?limit=         default 20, clamp [1, 100]
   * Respons: { items, hasMore } — item DESC (terbaru dulu).
   * Observability: timeline_view (system_metrics, non-PII).
   */
  app.get('/api/ai-product/timeline', requireAuth, async (req, res) => {
    try {
      const turso = getTurso();
      const userId = req.user.id;
      const feature = typeof req.query.feature === 'string' ? req.query.feature.trim() : '';
      const eventType = typeof req.query.eventType === 'string' ? req.query.eventType.trim() : '';
      const before = typeof req.query.before === 'string' ? req.query.before.trim().slice(0, 40) : '';
      // beforeId = id event terakhir (tie-break keyset). WAJIB dikirim bersama
      // before oleh client; fallback `created_at < ?` bila tanpa id (tie pada
      // created_at yang sama bisa skip/duplikat — klien baru selalu kirim).
      const beforeId = typeof req.query.beforeId === 'string' ? req.query.beforeId.trim().slice(0, 64) : '';
      const limit = clampLimit(req.query.limit);

      const clauses = ['user_id = ?'];
      const args = [userId];
      if (feature) { clauses.push('feature = ?'); args.push(feature); }
      if (eventType && EVENT_TYPES.includes(eventType)) { clauses.push('event_type = ?'); args.push(eventType); }
      if (before && beforeId) {
        clauses.push('(created_at < ? OR (created_at = ? AND id < ?))');
        args.push(before, before, beforeId);
      } else if (before) {
        clauses.push('created_at < ?');
        args.push(before);
      }

      // SELECT limit+1 → hasMore = ada baris kelebihan (pagination token).
      const { rows } = await turso.execute({
        sql: `SELECT id, feature, event_type, status, title, body, confidence, payload, created_at
              FROM ai_timeline WHERE ${clauses.join(' AND ')}
              ORDER BY created_at DESC, id DESC LIMIT ?`,
        args: [...args, limit + 1],
      });

      const hasMore = rows.length > limit;
      const items = (hasMore ? rows.slice(0, limit) : rows).map((r) => ({
        ...r,
        confidence: r.confidence == null ? null : Number(r.confidence),
      }));

      metricsService.recordSystemMetric({
        metricName: 'timeline_view',
        feature: eventType || feature || 'all',
        userId,
      }).catch(() => {});

      res.json({ items, hasMore });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/ai-product/timeline/:id — detail event + feedback terkait
   * (P9 §13: feedback dikaitkan via item_id → ditampilkan tanpa duplikat).
   * User-scoped: event user lain → 404 (bukan leak).
   * Observability: timeline_event_open.
   */
  app.get('/api/ai-product/timeline/:id', requireAuth, async (req, res) => {
    try {
      if (!rejectInvalidId(res, req.params.id)) return;
      const turso = getTurso();
      const userId = req.user.id;
      const { id } = req.params;

      const result = await turso.execute({
        sql: `SELECT id, feature, event_type, status, title, body, confidence, payload, created_at
              FROM ai_timeline WHERE id = ? AND user_id = ?`,
        args: [id, userId],
      });
      const row = result.rows[0];
      if (!row) return res.status(404).json({ error: 'Timeline event tidak ditemukan.' });

      const feedbackResult = await turso.execute({
        sql: `SELECT rating, reason, created_at FROM ai_feedback
              WHERE item_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 10`,
        args: [id, userId],
      });

      metricsService.recordSystemMetric({
        metricName: 'timeline_event_open',
        feature: row.event_type || 'other',
        userId,
      }).catch(() => {});

      res.json({
        ...row,
        confidence: row.confidence == null ? null : Number(row.confidence),
        feedback: feedbackResult.rows,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * PATCH /api/ai-product/timeline/:id/status — transisi status DETERMINISTIK
   * (P9 §12): new→viewed|completed|dismissed · viewed→completed|dismissed ·
   * completed/dismissed final. Transisi tidak valid → 400 VALIDATION_ERROR.
   * Observability: timeline_status_update.
   */
  app.patch('/api/ai-product/timeline/:id/status', requireAuth, async (req, res) => {
    try {
      if (!rejectInvalidId(res, req.params.id)) return;
      const turso = getTurso();
      const userId = req.user.id;
      const { id } = req.params;
      const result = validateBody(req.body, TIMELINE_STATUS_UPDATE_SCHEMA);
      if (!result.ok) return sendValidationError(res, result);
      const nextStatus = result.value.status;

      const current = await turso.execute({
        sql: 'SELECT status, feature, event_type FROM ai_timeline WHERE id = ? AND user_id = ?',
        args: [id, userId],
      });
      const row = current.rows[0];
      if (!row) return res.status(404).json({ error: 'Timeline event tidak ditemukan.' });

      if (!canTransition(row.status, nextStatus)) {
        return sendValidationError(res, {
          ok: false,
          error: `Tidak bisa mengubah status dari "${row.status}" ke "${nextStatus}".`,
          errors: [`Tidak bisa mengubah status dari "${row.status}" ke "${nextStatus}".`],
        });
      }

      await turso.execute({
        sql: 'UPDATE ai_timeline SET status = ? WHERE id = ? AND user_id = ?',
        args: [nextStatus, id, userId],
      });

      metricsService.recordSystemMetric({
        metricName: 'timeline_status_update',
        feature: row.event_type || row.feature || 'other',
        userId,
        metadata: { from: row.status, to: nextStatus },
      }).catch(() => {});

      res.json({ success: true, id, status: nextStatus });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/ai-product/timeline — event_type dihitung SERVER dari feature
   * (klien tidak bisa set event_type sendiri). status default 'new'.
   */
  app.post('/api/ai-product/timeline', requireAuth, async (req, res) => {
    try {
      const turso = getTurso();
      const userId = req.user.id;
      const result = validateBody(req.body, TIMELINE_CREATE_SCHEMA);
      if (!result.ok) return sendValidationError(res, result);
      const { feature, title, body = '', confidence, payload } = result.value;
      const id = await insertTimelineEvent(turso, userId, {
        feature,
        title,
        body,
        confidence: confidence ?? null,
        payload: payload ?? undefined,
      });
      res.status(201).json({ id, ok: true, event_type: eventTypeFromFeature(feature) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}
