/**
 * Natural Conversation Routes (Sprint 1.5 — P8)
 *
 * POST /api/ai-product/conversation
 *   Pertanyaan finansial natural ("Kenapa uangku habis minggu ini?") → jawaban
 *   kaya: ringkasan → grafik harian → kategori → transaksi → insight → aksi.
 *
 * Alur:
 *   1. Validasi body (query ≤200, periodDays ∈ {7,30,90}).
 *   2. Ambil transaksi user pada periode + periode sebelumnya (1 query).
 *   3. Agregasi DETERMINISTIK (lib/conversationAggregator.js — pure).
 *   4. Gemini (generateGeminiText) untuk narasi; bila gagal/tidak valid →
 *      fallback rule-based (buildConversationFallback) — TIDAK pernah raw error.
 *   5. Catat ke ai_timeline (fire-and-forget).
 *
 * Pola error mengikuti P1-2: validasi gagal → 400 VALIDATION_ERROR.
 */
import { getTurso } from '../lib/turso.js';
import { requireAuth } from '../middleware/authMiddleware.js';
import { validateBody, sendValidationError, validateRequiredString } from '../lib/validation.js';
import { logger } from '../lib/logger.js';
import metricsService from '../services/metricsService.js';
import { createRequestId, parseGeminiResponse, generateGeminiText } from '../lib/vertexContext.js';
import { insertTimelineEvent } from '../lib/timelineEvents.js';
import {
  DEFAULT_PERIOD_DAYS,
  PERIOD_DAYS_OPTIONS,
  computeDateRange,
  aggregateConversationStats,
  buildConversationPrompt,
  buildConversationFallback,
  normalizeConversationNarrative,
  conversationPeriodLabel,
} from '../lib/conversationAggregator.js';

/**
 * Error contract 500 (audit API — shape kanonik §0 di docs/api/ai-product-api.md):
 * route melempar ke global handler (server/middleware/errorHandler.js) via
 * `next(err)` dengan metadata yang relevan; handler merespons
 * `{ success:false, error, errorCode, requestId, ... }`.
 */
export const CONVERSATION_ERROR_CODE = 'CONVERSATION_FAILED';
export const CONVERSATION_ERROR_MESSAGE = 'Gagal menganalisis percakapan. Coba lagi sebentar.';

/**
 * Mount metadata error conversation (murni — di-export untuk unit test).
 * `errorCode` yang sudah ter-set oleh error lain TIDAK ditimpa (preserve).
 */
export function attachConversationError(err, requestId) {
  err.errorCode = err.errorCode || CONVERSATION_ERROR_CODE;
  err.userMessage = CONVERSATION_ERROR_MESSAGE;
  err.requestId = requestId;
  return err;
}

/** Validator periodDays: opsional, harus angka 7 | 30 | 90 (string '7' ditolak). */
function validatePeriodDays(value, opts) {
  const field = opts?.field || 'periodDays';
  if (value === undefined || value === null) return { ok: true, value: undefined };
  const n = typeof value === 'number' ? value : NaN;
  return PERIOD_DAYS_OPTIONS.includes(n)
    ? { ok: true, value: n }
    : { ok: false, error: `${field} harus 7, 30, atau 90.`, errors: [`${field} harus 7, 30, atau 90.`] };
}

/** Skema validasi body (di-export untuk unit test). */
export const CONVERSATION_CREATE_SCHEMA = {
  query: { validate: validateRequiredString, options: { field: 'query', max: 200 } },
  periodDays: { validate: validatePeriodDays, options: { field: 'periodDays' } },
};

/**
 * Catat jawaban ke ai_timeline (P9 — via lib timelineEvents, event_type
 * 'conversation') — fire-and-forget, kegagalan tidak menggagalkan respons.
 * Confidence 0.8 dipakai conversation (interpretasi "Yakin") — konsisten
 * dengan perilaku lama sebelum P9.
 */
async function recordTimeline(userId, query, narrative, stats, periodDays) {
  try {
    await insertTimelineEvent(getTurso(), userId, {
      feature: 'conversation',
      title: String(query || '').slice(0, 200),
      body: String(narrative?.summary || '').slice(0, 2000),
      confidence: 0.8,
      payload: {
        periodDays,
        expense: stats?.expense ?? 0,
        income: stats?.income ?? 0,
        topCategory: stats?.categories?.[0]?.name ?? null,
      },
    });
  } catch (err) {
    logger.warn({ message: err.message }, 'Conversation timeline record gagal (diabaikan)');
  }
}

export function registerConversationRoutes(app) {
  app.post('/api/ai-product/conversation', requireAuth, async (req, res, next) => {
    const startedAt = Date.now();
    const requestId = req.id || createRequestId('conv');
    const result = validateBody(req.body, CONVERSATION_CREATE_SCHEMA);
    if (!result.ok) return sendValidationError(res, result);

    const { query, periodDays } = result.value;
    const days = periodDays ?? DEFAULT_PERIOD_DAYS;
    const range = computeDateRange(days);

    // Telemetry (PRODUCT_METRICS §6): conversation valid dimulai — denominator
    // untuk conversation_completion_rate. Hanya setelah validasi lolos (400
    // bukan percakapan). Non-PII: hanya user_id + periodDays.
    metricsService.recordSystemMetric({
      metricName: 'ai_conversation_started',
      feature: 'conversation',
      userId: req.user.id,
      metadata: { periodDays: days },
    }).catch(() => {});

    try {
      const turso = getTurso();
      const rowsResult = await turso.execute({
        sql: `SELECT id, type, amount, category_name, merchant, note, date
              FROM transactions
              WHERE user_id = ? AND date >= ? AND date <= ?
              ORDER BY date ASC`,
        args: [req.user.id, range.prevStartDate, range.endDate],
      });

      const stats = aggregateConversationStats(rowsResult.rows, range);
      const periodLabel = conversationPeriodLabel(days);
      const dataCoverage = stats.hasData
        ? `Transaksi ${periodLabel} (${stats.expenseCount} pengeluaran, ${stats.incomeCount} pemasukan)`
        : `Belum ada transaksi pada ${periodLabel}`;

      const trust = {
        source: 'rule-based',
        feature: 'conversation',
        processingTimeMs: Date.now() - startedAt,
        dataCoverage,
        timestamp: new Date().toISOString(),
      };

      let narrative = null;

      if (stats.hasData) {
        const prompt = buildConversationPrompt({ query, periodDays: days, stats, periodLabel });
        try {
          const generated = await generateGeminiText(prompt, {
            feature: 'conversation',
            userId: req.user.id,
            metricMeta: { requestId, periodDays: days },
            // Cache aman: key hash berisi prompt lengkap (termasuk statistik),
            // jadi pertanyaan yang sama dengan data yang sama → cache hit.
            cacheTtlMs: 60 * 60 * 1000,
          });
          const raw = generated && generated.text;
          if (raw) {
            const parsed = parseGeminiResponse(raw);
            if (parsed.success && parsed.data && typeof parsed.data === 'object') {
              narrative = normalizeConversationNarrative(parsed.data);
              trust.source = 'gemini';
              trust.model = generated.modelUsed || 'gemini-2.5-flash';
              trust.processingTimeMs = Date.now() - startedAt;
            }
          }
        } catch (err) {
          logger.warn({ requestId, message: err.message }, 'Conversation Gemini gagal — pakai fallback rule-based');
        }
      }

      if (!narrative) {
        // Set source ke rule-based agar trust meta & telemetry `source` akurat:
        // Gemini mungkin merespons tapi narasinya gagal dinormalisasi → tetap
        // dianggap fallback (bukan gemini) di UI maupun metrics.
        trust.source = 'rule-based';
        narrative = buildConversationFallback({ query, periodDays: days, stats });
        trust.fallbackReason = stats.hasData
          ? 'Gemini tidak tersedia saat ini — hasil dihitung dari aturan lokal yang deterministik.'
          : 'Belum ada data transaksi pada periode ini — hasil disusun dari aturan lokal.';
        trust.processingTimeMs = Date.now() - startedAt;
      }

      // Timeline fire-and-forget (jangan blokir respons).
      recordTimeline(req.user.id, query, narrative, stats, days);

      // Telemetry: conversation selesai (success). `source` gemini|rule-based +
      // `fallback` bool → memungkinkan fallback_rate (sinyal keandalan AI).
      metricsService.recordSystemMetric({
        metricName: 'ai_conversation_completed',
        feature: 'conversation',
        userId: req.user.id,
        metadata: {
          periodDays: days,
          source: trust.source,
          fallback: Boolean(trust.fallbackReason),
        },
      }).catch(() => {});

      return res.json({
        success: true,
        query,
        periodDays: days,
        period: { startDate: range.startDate, endDate: range.endDate, label: periodLabel },
        stats,
        narrative,
        chart: { daily: stats.daily },
        categories: stats.categories,
        topMerchants: stats.topMerchants,
        topTransactions: stats.topTransactions,
        trust,
        requestId,
      });
    } catch (err) {
      logger.error({ requestId, message: err.message }, 'Conversation error');
      metricsService.recordSystemMetric({
        metricName: 'ai_conversation_failed',
        feature: 'conversation',
        userId: req.user.id,
        metadata: { periodDays: days },
      }).catch(() => {});
      // Audit API: serahkan ke global handler (index.js → errorHandler.js)
      // agar shape kanonik §0 terpenuhi (error + errorCode + requestId) —
      // userMessage spesifik conversation dipasang di sini, bukan hardcode
      // di handler.
      return next(attachConversationError(err, requestId));
    }
  });
}
