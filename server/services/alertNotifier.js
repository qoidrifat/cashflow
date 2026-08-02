/**
 * Alert Notifier — channel pengiriman notifikasi alert (MONITORING_AUDIT gap #1).
 *
 * Sebelumnya `checkAlerts()` hanya mengevaluasi rule dan menampilkan hasil di
 * dashboard admin; tidak ada channel pengiriman. Service ini menutup gap:
 *
 *  1. WEBHOOK (env ALERT_WEBHOOK_URL, optional): POST JSON ke URL eksternal
 *     (Slack/Discord/opsgenie/generic webhook) saat rule TRIGGERED.
 *  2. IN-APP (selalu): buat notifikasi untuk semua user admin (ADMIN_EMAILS)
 *     via tabel `notifications` + SSE `notifyUser` (bell icon realtime).
 *  3. COOLDOWN: hanya kirim bila belum pernah dinotifikasi ATAU sudah lewat
 *     `ALERT_COOLDOWN_MINUTES` sejak `last_notified_at` — mencegah spam alert.
 *
 * PRINSIP: non-blocking & tidak pernah melempar (semua error di-swallow) —
 * sama dengan metricsService; alert channel tidak boleh memblokir/menjatuhkan
 * evaluasi alert yang sudah berjalan.
 */
import crypto from 'node:crypto';
import { getTurso } from '../lib/turso.js';
import { logger } from '../lib/logger.js';
import { getAdminEmails } from '../config/metricsConfig.js';
import { notifyUser } from '../lib/sse.js';

/** Cooldown antar notifikasi per rule (menit → ms). Env: ALERT_COOLDOWN_MINUTES (default 60). */
function envMinutes(key, fallback) {
  const v = parseInt(process.env[key], 10);
  return Number.isFinite(v) && v >= 0 ? v * 60_000 : fallback * 60_000;
}
export const NOTIFY_COOLDOWN_MS = envMinutes('ALERT_COOLDOWN_MINUTES', 60);

// Cooldown sangat rendah = potensi spam webhook (tiap scheduler tick 60s kirim
// ulang untuk rule yang persist triggered). Log warning sebagai guard misconfig.
if (NOTIFY_COOLDOWN_MS < 5 * 60_000) {
  logger.warn({ cooldownMs: NOTIFY_COOLDOWN_MS }, 'ALERT_COOLDOWN_MINUTES < 5 — risiko spam webhook; gunakan nilai > 5 untuk produksi');
}

const WEBHOOK_URL = (process.env.ALERT_WEBHOOK_URL || '').trim();
const WEBHOOK_TIMEOUT_MS = 10_000;

/**
 * In-flight guard (anti double-notify race): set nama rule yang sedang diproses
 * notifyAlert. Scheduler (runAlertEvaluation, bypass cache) DAN request path
 * admin (checkAlerts, cache expired) bisa menjalankan computeAlerts dalam window
 * yang sama; tanpa guard, dua notifyAlert bisa sama-sama lolos SELECT
 * last_notified_at sebelum UPDATE mendarat (webhook fetch s/d 10s) → webhook
 * ganda. Set ini memastikan satu rule hanya diproses satu kali bersamaan.
 */
const inFlightRules = new Set();

/**
 * Pure helper (unit-testable tanpa DB): bolehkah mengirim notifikasi untuk rule?
 * true bila belum pernah dinotifikasi atau cooldown sudah lewat.
 */
export function shouldNotify(lastNotifiedAt, cooldownMs = NOTIFY_COOLDOWN_MS) {
  if (!lastNotifiedAt) return true;
  const t = new Date(lastNotifiedAt).getTime();
  if (Number.isNaN(t)) return true; // value korup → anggap belum notified
  return Date.now() - t >= cooldownMs;
}

/**
 * Build payload webhook (pure — dipakai unit test). Shape stabil agar konsumen
 * webhook (Slack/Discord/dll) bisa mem-parse tanpa perubahan.
 */
export function buildWebhookPayload(rule) {
  return {
    event: 'alert.triggered',
    app: 'cashflow',
    timestamp: new Date().toISOString(),
    rule: {
      name: rule.name,
      metricName: rule.metricName,
      status: rule.status,
      currentValue: rule.currentValue,
      threshold: rule.threshold,
      condition: rule.condition,
      windowMinutes: rule.windowMinutes,
    },
  };
}

/** POST JSON ke ALERT_WEBHOOK_URL (bila di-set). Error → log warn, tidak throw. */
async function sendWebhook(rule) {
  if (!WEBHOOK_URL) return;
  const payload = buildWebhookPayload(rule);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
  try {
    const resp = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    logger.info({ rule: rule.name, status: resp.status }, 'Alert webhook terkirim');
  } catch (err) {
    logger.warn({ rule: rule.name, err: err.message }, 'Alert webhook gagal — non-blocking');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Buat notifikasi in-app untuk semua admin (ADMIN_EMAILS → user ids).
 * Reuse tabel `notifications` + SSE. Error per user di-swallow.
 */
async function notifyAdminsInApp(rule) {
  const turso = getTurso();
  if (!turso) return;
  const admins = getAdminEmails();
  if (admins.length === 0) return;

  let userIds = [];
  try {
    const placeholders = admins.map(() => '?').join(', ');
    const { rows } = await turso.execute({
      sql: `SELECT id FROM user WHERE lower(email) IN (${placeholders})`,
      args: admins.map((e) => e.toLowerCase()),
    });
    userIds = rows.map((r) => r.id);
  } catch (err) {
    logger.warn({ err: err.message }, 'Cari admin user gagal — in-app alert di-skip');
    return;
  }
  if (userIds.length === 0) return;

  const now = new Date().toISOString();
  for (const userId of userIds) {
    try {
      const id = crypto.randomUUID();
      const dedupeKey = `alert:${rule.name}`;
      await turso.execute({
        sql: `INSERT INTO notifications (id, user_id, type, priority, title, message, read, action_label, action_href, dedupe_key, metadata, created_at)
              VALUES (?, ?, 'alert', 'high', ?, ?, 0, 'Buka Monitoring', '/admin/monitoring', ?, ?, ?)
              ON CONFLICT(user_id, dedupe_key) DO UPDATE SET
                title = excluded.title, message = excluded.message, priority = excluded.priority,
                read = 0, created_at = excluded.created_at`,
        args: [
          id,
          userId,
          `Alert: ${rule.name}`,
          `${rule.metricName} ${rule.condition} ${rule.threshold} — nilai saat ini ${rule.currentValue} (window ${rule.windowMinutes}m)`,
          dedupeKey,
          JSON.stringify({ alertRule: rule.name }),
          now,
        ],
      });
      notifyUser(userId, 'notification:new', { id, title: `Alert: ${rule.name}` });
    } catch (err) {
      logger.warn({ userId, rule: rule.name, err: err.message }, 'In-app alert gagal — non-blocking');
    }
  }
}

/**
 * Kirim notifikasi untuk satu rule triggered (webhook + in-app) bila cooldown
 * sudah lewat, lalu update `last_notified_at`. Non-blocking — error di-swallow.
 */
export async function notifyAlert(rule) {
  const turso = getTurso();
  if (!turso) return;

  try {
    const { rows } = await turso.execute({
      sql: `SELECT last_notified_at FROM alert_rules WHERE name = ?`,
      args: [rule.name],
    });
    const lastNotifiedAt = rows[0]?.last_notified_at;
    if (!shouldNotify(lastNotifiedAt)) {
      logger.debug({ rule: rule.name }, 'Alert cooldown aktif — notifikasi di-skip');
      return;
    }

    await sendWebhook(rule);
    await notifyAdminsInApp(rule);

    await turso.execute({
      sql: `UPDATE alert_rules SET last_notified_at = ? WHERE name = ?`,
      args: [new Date().toISOString(), rule.name],
    });
    logger.info({ rule: rule.name }, 'Alert notifikasi terkirim (webhook + in-app) + last_notified_at di-update');
  } catch (err) {
    logger.warn({ rule: rule.name, err: err.message }, 'Alert notify gagal — non-blocking');
  }
}

/**
 * Kirim notifikasi untuk semua rule yang baru triggered. Dipanggil dari
 * computeAlerts (fire-and-forget) dan scheduler. Tidak pernah melempar.
 */
export async function notifyTriggeredAlerts(triggeredRules) {
  for (const rule of triggeredRules) {
    if (inFlightRules.has(rule.name)) continue; // sudah diproses evaluasi lain
    inFlightRules.add(rule.name);
    try {
      await notifyAlert(rule);
    } catch {
      // never throw — channel alert tidak boleh mengganggu evaluasi
    } finally {
      inFlightRules.delete(rule.name);
    }
  }
}
