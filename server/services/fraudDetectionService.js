/**
 * Fraud Detection Service (Sprint 1 — Core Product).
 *
 * Pipeline berlapis (paling murah dulu) — desain: docs/ai/FRAUD_DETECTION_DESIGN.md:
 *   L1 Rule Engine (deterministik, gratis) → berjalan pada SETIAP transaksi baru.
 *   L2 AI Scoring (Gemini, async, di balik FRAUD_AI_SCORING_ENABLED) → hanya
 *     untuk kandidat yang ter-flag; prompt-bounded; failure degrade ke verdict L1.
 *
 * GUARDRAIL: NON-BLOCKING & tidak pernah melempar — deteksi fraud TIDAK boleh
 * menambah latensi/menjatuhkan write transaksi. Semua error di-swallow + log.
 */
import crypto from 'node:crypto';
import { getTurso } from '../lib/turso.js';
import { logger } from '../lib/logger.js';
import { notifyUser } from '../lib/sse.js';
import metricsService from './metricsService.js';
import {
  evaluateFraudRules,
  computeRuleRiskScore,
  getFraudFlagLabel,
  getHighestSeverity,
  summarizeFlags,
} from '../lib/fraudEngine.js';
import { generateGeminiText, parseGeminiResponse } from '../lib/vertexContext.js';

const FRAUD_DETECTION_ENABLED = process.env.FRAUD_DETECTION_ENABLED !== 'false';
const FRAUD_AI_SCORING_ENABLED = process.env.FRAUD_AI_SCORING_ENABLED === 'true';
const AGGREGATE_LIMIT = 2000;

export function isFraudDetectionEnabled() {
  return FRAUD_DETECTION_ENABLED;
}

/** Query count (helper) — error dianggap 0 (jangan pernah menjatuhkan alur). */
async function countRows(turso, sql, args) {
  try {
    const { rows } = await turso.execute({ sql, args });
    return Number(rows[0]?.c ?? 0);
  } catch {
    return 0;
  }
}

/**
 * Agregat per-user untuk L1. Semua query di-bounded (LIMIT 2000) & ber-index.
 * Query hanya dijalankan bila sinyal-nya mungkin relevan (hemat: merchant kosong
 * → skip velocity/new-merchant; type bukan expense/income → skip amount rules).
 */
async function loadAggregates(turso, userId, tx) {
  const aggregates = {};
  const merchant = typeof tx.merchant === 'string' ? tx.merchant.trim() : '';
  const amountNum = Number(tx.amount) || 0;

  // Duplikat via gmail_message_id (hanya bila tx membawa id).
  if (tx.gmailMessageId) {
    aggregates.gmailMessageIdExists = (await countRows(
      turso,
      `SELECT COUNT(*) AS c FROM transactions WHERE user_id = ? AND gmail_message_id = ? AND id != ?`,
      [userId, tx.gmailMessageId, tx.id],
    )) > 0;
  } else {
    aggregates.gmailMessageIdExists = false;
  }

  if (merchant) {
    // Duplikat: nominal + merchant + jendela 7 hari (komparasi numerik dibulatkan).
    aggregates.recentDuplicateCount = await countRows(
      turso,
      `SELECT COUNT(*) AS c FROM transactions
       WHERE user_id = ? AND merchant = ? AND amount = ? AND date >= date(?, ?) AND id != ?`,
      [userId, merchant, Math.round(amountNum * 100) / 100, tx.date || 'now', `-7 days`, tx.id],
    );
    // Velocity per merchant 24 jam.
    aggregates.merchantCount24h = await countRows(
      turso,
      `SELECT COUNT(*) AS c FROM transactions
       WHERE user_id = ? AND merchant = ? AND created_at >= datetime('now', '-24 hours') AND id != ?`,
      [userId, merchant, tx.id],
    );
    // Merchant pernah muncul sebelumnya?
    aggregates.merchantSeen = (await countRows(
      turso,
      `SELECT COUNT(*) AS c FROM transactions WHERE user_id = ? AND merchant = ? AND id != ?`,
      [userId, merchant, tx.id],
    )) > 0;
  } else {
    aggregates.recentDuplicateCount = 0;
    aggregates.merchantCount24h = 0;
    aggregates.merchantSeen = false;
  }

  // Baseline nominal per tipe (p99 + median dari riwayat tipe yang sama).
  if (tx.type === 'expense' || tx.type === 'income') {
    try {
      const { rows } = await turso.execute({
        sql: `SELECT amount FROM transactions WHERE user_id = ? AND type = ? ORDER BY amount DESC LIMIT ?`,
        args: [userId, tx.type, AGGREGATE_LIMIT],
      });
      const amounts = rows.map((r) => Number(r.amount) || 0).sort((a, b) => a - b);
      if (amounts.length > 0) {
        const idx99 = Math.min(amounts.length - 1, Math.floor(amounts.length * 0.99));
        aggregates.p99Amount = amounts[idx99];
        const mid = Math.floor(amounts.length / 2);
        aggregates.medianAmount = amounts.length % 2 === 0
          ? (amounts[mid - 1] + amounts[mid]) / 2
          : amounts[mid];
      } else {
        aggregates.p99Amount = 0;
        aggregates.medianAmount = 0;
      }
    } catch {
      aggregates.p99Amount = 0;
      aggregates.medianAmount = 0;
    }
  } else {
    aggregates.p99Amount = 0;
    aggregates.medianAmount = 0;
  }

  // Tipe kategori (untuk rule category_anomaly pada expense).
  if (tx.type === 'expense' && tx.categoryId) {
    try {
      const { rows } = await turso.execute({
        sql: `SELECT type FROM categories WHERE user_id = ? AND id = ? LIMIT 1`,
        args: [userId, tx.categoryId],
      });
      aggregates.categoryType = rows[0]?.type || null;
    } catch {
      aggregates.categoryType = null;
    }
  }

  return aggregates;
}

/**
 * Jalankan deteksi fraud untuk satu transaksi yang BARU dibuat.
 * Fire-and-forget dari route (bukan await di critical path). Tidak pernah throw.
 * @returns {{ flags: Array }}
 */
export async function runFraudDetection({ userId, transaction }) {
  if (!FRAUD_DETECTION_ENABLED) return { flags: [] };
  const turso = getTurso();
  if (!turso || !userId || !transaction?.id) return { flags: [] };

  try {
    const aggregates = await loadAggregates(turso, userId, transaction);
    const flags = evaluateFraudRules({ transaction, aggregates });
    if (flags.length === 0) return { flags: [] };

    const riskScore = computeRuleRiskScore(flags);
    const label = getFraudFlagLabel(flags);

    await persistFlags(turso, userId, transaction, flags, riskScore, null);
    await turso.execute({
      sql: `UPDATE transactions SET fraud_flag = ?, fraud_score = ? WHERE id = ? AND user_id = ?`,
      args: [label, riskScore, transaction.id, userId],
    });
    await notifyFraudFlag(userId, transaction, flags, riskScore);

    // Observability: counter flag per rule (admin dashboard + alert rule fraud_flag_count).
    metricsService.recordSystemMetric({
      metricName: 'fraud_flag_count',
      metricValue: flags.length,
      feature: 'fraud_detection',
      userId,
      metadata: { rules: flags.map((f) => f.rule), severity: getHighestSeverity(flags) },
    }).catch(() => {});

    // L2 AI scoring — opsional & async, di luar critical path.
    if (FRAUD_AI_SCORING_ENABLED) {
      runAiScoring({ userId, transaction, flags, aggregates }).catch(() => {});
    }

    return { flags };
  } catch (err) {
    logger.warn({ userId, txId: transaction.id, err: err.message }, 'Fraud detection gagal — non-blocking');
    return { flags: [] };
  }
}

/** Persist satu baris fraud_flags per flag (error per baris di-swallow). */
async function persistFlags(turso, userId, transaction, flags, riskScore, aiResult) {
  for (const flag of flags) {
    try {
      await turso.execute({
        sql: `INSERT INTO fraud_flags
              (id, user_id, transaction_id, flag_type, severity, description, rule_data, risk_score, decision, status, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', datetime('now'))`,
        args: [
          crypto.randomUUID(),
          userId,
          transaction.id,
          flag.rule,
          flag.severity,
          flag.description,
          JSON.stringify(flag.ruleData || {}),
          aiResult?.fraud_score ?? riskScore,
          aiResult?.decision ?? null,
        ],
      });
    } catch {
      // non-blocking — baris flag gagal tidak boleh menjatuhkan alur
    }
  }
}

function formatAmount(value) {
  const num = Number(value) || 0;
  return `Rp ${num.toLocaleString('id-ID')}`;
}

/** Notifikasi in-app (bell + SSE) — type 'warning' (whitelist client), dedupe per transaksi. */
async function notifyFraudFlag(userId, transaction, flags, riskScore) {
  const turso = getTurso();
  if (!turso) return;
  const merchant = transaction.merchant || transaction.categoryName || 'Transaksi';
  const severity = getHighestSeverity(flags);
  const priority = severity === 'high' || severity === 'critical' ? 'high' : 'normal';
  const title = severity === 'high' || severity === 'critical'
    ? 'Transaksi mencurigakan — perlu dicek'
    : 'Transaksi mencurigakan terdeteksi';
  const message = `${merchant} ${formatAmount(transaction.amount)} · ${summarizeFlags(flags)}. Transaksi tetap dicatat, tetapi sebaiknya diverifikasi.`;
  const id = crypto.randomUUID();
  try {
    await turso.execute({
      sql: `INSERT INTO notifications (id, user_id, type, priority, title, message, read, action_label, action_href, dedupe_key, metadata, created_at)
            VALUES (?, ?, 'warning', ?, ?, ?, 0, 'Lihat Transaksi', '/transactions', ?, ?, ?)
            ON CONFLICT(user_id, dedupe_key) DO UPDATE SET
              title = excluded.title, message = excluded.message, priority = excluded.priority,
              read = 0, created_at = excluded.created_at`,
      args: [
        id,
        userId,
        priority,
        title,
        message,
        `fraud:${transaction.id}`,
        JSON.stringify({
          transactionId: transaction.id,
          flags: flags.map((f) => f.rule),
          riskScore,
          fraudFlag: getFraudFlagLabel(flags),
        }),
        new Date().toISOString(),
      ],
    });
    notifyUser(userId, 'notification:new', { id, title });
  } catch (err) {
    logger.warn({ userId, txId: transaction.id, err: err.message }, 'Notifikasi fraud gagal — non-blocking');
  }
}

/** Prompt-bounded untuk L2 (hanya kandidat ter-flag; data di-ringkas). */
export function buildFraudScoringPrompt({ transaction, flags, aggregates }) {
  const summary = {
    transaction: {
      type: transaction.type,
      amount: Number(transaction.amount) || 0,
      merchant: transaction.merchant || null,
      category: transaction.categoryName || null,
      date: transaction.date || null,
      source: transaction.source || null,
    },
    ruleFlags: (flags || []).map((f) => ({ rule: f.rule, severity: f.severity })),
    context: {
      userP99Amount: Math.round(Number(aggregates?.p99Amount) || 0),
      userMedianAmount: Math.round(Number(aggregates?.medianAmount) || 0),
      merchantTransactions24h: Number(aggregates?.merchantCount24h) || 0,
      merchantFirstSeen: aggregates?.merchantSeen ? false : true,
      gmailDuplicate: Boolean(aggregates?.gmailMessageIdExists),
    },
  };

  return `Kamu adalah AI risk analyst untuk aplikasi CashFlow Indonesia.
Tugas: nilai risiko satu transaksi yang DIFLAG oleh rule engine deterministik aplikasi.
Keluarkan SATU JSON OBJECT VALID SAJA. Tidak ada markdown, tidak ada teks lain.

OUTPUT SCHEMA:
{
  "fraud_score": 0.0,
  "decision": "allow | review | block",
  "reasons": ["...", "..."],
  "confidence": 0.0
}

ATURAN:
1. fraud_score: number 0.0 (normal) sampai 1.0 (sangat mencurigakan).
2. decision "block" HANYA bila indikasi kuat penipuan/duplikat nyata (mis. gmail duplicate, velocity ekstrem dengan nominal besar). Jangan blokir hanya karena nominal besar.
3. reasons: maksimal 4 alasan singkat dalam Bahasa Indonesia.
4. confidence: seberapa yakin kamu terhadap skor.
5. Ingat: transaksi ini sudah tercatat; tugasmu menilai, bukan menolak.

Data transaksi (JSON):
${JSON.stringify(summary).substring(0, 6000)}`;
}

/** Clamp score 0..1 (nilai korup dari AI → null = pakai verdict L1). */
function clampScore(value) {
  const num = Number(value);
  return Number.isFinite(num) ? Math.max(0, Math.min(1, num)) : null;
}

/** L2 AI scoring — async, non-blocking; failure degrade ke verdict rule engine. */
async function runAiScoring({ userId, transaction, flags, aggregates }) {
  const turso = getTurso();
  if (!turso) return;
  try {
    const prompt = buildFraudScoringPrompt({ transaction, flags, aggregates });
    const result = await generateGeminiText(prompt, {
      feature: 'fraud_detection',
      userId,
      cacheTtlMs: 0,
    });
    const parsed = parseGeminiResponse(result.text);
    if (!parsed.success) {
      logger.warn({ txId: transaction.id }, 'Fraud AI scoring: JSON tidak valid — pakai verdict rule engine');
      return;
    }
    const score = clampScore(parsed.data.fraud_score);
    const decision = ['allow', 'review', 'block'].includes(parsed.data.decision)
      ? parsed.data.decision
      : null;
    if (score === null) return;
    const reasons = Array.isArray(parsed.data.reasons)
      ? parsed.data.reasons.slice(0, 4).map(String)
      : [];
    const confidence = clampScore(parsed.data.confidence); // Sprint P1.2: persist keyakinan AI

    // Persist skor + keputusan + alasan AI (alasan disimpan di rule_data agar
    // UI halaman review bisa menampilkan "Alasan AI" — lihat FraudPage.tsx).
    // rule_data di-merge dengan data rule L1 yang sudah ada (bukan overwrite).
    let mergedRuleData = {};
    try {
      const { rows } = await turso.execute({
        sql: `SELECT rule_data FROM fraud_flags WHERE user_id = ? AND transaction_id = ? LIMIT 1`,
        args: [userId, transaction.id],
      });
      const existing = rows[0]?.rule_data;
      if (typeof existing === 'string' && existing) {
        const parsedExisting = JSON.parse(existing);
        if (parsedExisting && typeof parsedExisting === 'object') mergedRuleData = parsedExisting;
      }
    } catch {
      /* non-blocking — merge gagal tidak menjatuhkan scoring */
    }
    if (reasons.length > 0) mergedRuleData.aiReasons = reasons;
    if (confidence !== null) mergedRuleData.aiConfidence = confidence;

    await turso.execute({
      sql: `UPDATE fraud_flags SET risk_score = ?, decision = ?, rule_data = ? WHERE user_id = ? AND transaction_id = ?`,
      args: [score, decision, JSON.stringify(mergedRuleData), userId, transaction.id],
    });
    await turso.execute({
      sql: `UPDATE transactions SET fraud_score = ? WHERE id = ? AND user_id = ?`,
      args: [score, transaction.id, userId],
    });

    // Eskalasi notifikasi bila AI menyimpulkan block — TETAP ADVISORY:
    // transaksi tidak dihapus/diblokir; hanya peringatan lebih kuat + skor AI.
    // (notifyFraudEscalation menangani reasons kosong — template conditional.)
    if (decision === 'block') {
      await notifyFraudEscalation(userId, transaction, score, reasons.slice(0, 3).join(' '));
    }
  } catch (err) {
    logger.warn({ txId: transaction.id, err: err.message }, 'Fraud AI scoring gagal — degrade ke verdict rule engine');
  }
}

/** Eskalasi L2: upsert notifikasi dedupe sama dengan pesan + skor AI. */
async function notifyFraudEscalation(userId, transaction, score, reasons) {
  const turso = getTurso();
  if (!turso) return;
  const merchant = transaction.merchant || transaction.categoryName || 'Transaksi';
  const id = crypto.randomUUID();
  try {
    await turso.execute({
      sql: `INSERT INTO notifications (id, user_id, type, priority, title, message, read, action_label, action_href, dedupe_key, metadata, created_at)
            VALUES (?, ?, 'warning', 'high', ?, ?, 0, 'Lihat Transaksi', '/transactions', ?, ?, ?)
            ON CONFLICT(user_id, dedupe_key) DO UPDATE SET
              title = excluded.title, message = excluded.message, priority = excluded.priority,
              read = 0, created_at = excluded.created_at`,
      args: [
        id,
        userId,
        `Aktivitas berisiko tinggi — segera verifikasi`,
        `${merchant} ${formatAmount(transaction.amount)} — skor risiko ${Math.round(score * 100)}%${reasons ? ` (${reasons})` : ''}. Transaksi tetap tercatat, tetapi perlu dicek manual.`,
        `fraud:${transaction.id}`,
        JSON.stringify({ transactionId: transaction.id, riskScore: score, decision: 'block', aiScored: true }),
        new Date().toISOString(),
      ],
    });
    notifyUser(userId, 'notification:new', { id, title: 'Aktivitas berisiko tinggi — segera verifikasi' });
  } catch (err) {
    logger.warn({ userId, txId: transaction.id, err: err.message }, 'Eskalasi fraud AI gagal — non-blocking');
  }
}

export default { runFraudDetection, isFraudDetectionEnabled, buildFraudScoringPrompt };
