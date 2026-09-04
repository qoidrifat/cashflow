/**
 * Alert Notifier — channel pengiriman notifikasi alert (MONITORING_AUDIT gap #1).
 *
 * Sebelumnya `checkAlerts()` hanya mengevaluasi rule dan menampilkan hasil di
 * dashboard admin; tidak ada channel pengiriman. Service ini menutup gap:
 *
 *  1. WEBHOOK (env ALERT_WEBHOOK_URL, optional): POST JSON ke URL eksternal
 *     (Slack/Discord/opsgenie/generic webhook) saat rule TRIGGERED.
 *  2. EMAIL/SMTP (env SMTP_HOST/SMTP_USER/SMTP_PASS, optional): kirim email ke
 *     semua admin (ADMIN_EMAILS) via nodemailer — pola sama dengan gmailNotifier.
 *     Aktif hanya bila SEMUA var wajib di-set; ADMIN_EMAILS kosong → skip.
 *  3. IN-APP (selalu): buat notifikasi untuk semua user admin (ADMIN_EMAILS)
 *     via tabel `notifications` + SSE `notifyUser` (bell icon realtime).
 *  4. COOLDOWN: hanya kirim bila belum pernah dinotifikasi ATAU sudah lewat
 *     `ALERT_COOLDOWN_MINUTES` sejak `last_notified_at` — mencegah spam alert.
 *
 * PRINSIP: non-blocking & tidak pernah melempar (semua error di-swallow) —
 * sama dengan metricsService; alert channel tidak boleh memblokir/menjatuhkan
 * evaluasi alert yang sudah berjalan.
 */
import crypto from 'node:crypto';
import nodemailer from 'nodemailer';
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

/**
 * Pure helper (unit-testable): bolehkah mengirim email alert? true hanya bila
 * SEMUA var SMTP wajib di-set (HOST/USER/PASS) DAN ada penerima (admin emails).
 * PORT default 587; FROM fallback ke SMTP_USER — keduanya tidak wajib.
 */
export function shouldSendAlertEmail(env, adminEmails) {
  const required = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'];
  const smtpOk = required.every((k) => String(env[k] || '').trim().length > 0);
  return smtpOk && Array.isArray(adminEmails) && adminEmails.length > 0;
}

/**
 * Pure helper (unit-testable): payload email alert (subject + plain text).
 * Membawa rule, metric, threshold, nilai saat ini, dan timestamp.
 */
export function buildAlertEmailPayload(rule) {
  const timestamp = new Date().toISOString();
  const summary = `${rule.metricName} ${rule.condition} ${rule.threshold}`;
  const subject = `[CashFlow Alert] ${rule.name} — ${summary}`;
  const text = [
    `Alert CashFlow TRIGGERED: ${rule.name}`,
    '',
    `Rule      : ${rule.name}`,
    `Metric    : ${rule.metricName}`,
    `Kondisi   : ${rule.condition} ${rule.threshold} (window ${rule.windowMinutes}m)`,
    `Nilai saat ini : ${rule.currentValue}`,
    `Waktu     : ${timestamp}`,
    '',
    '— CashFlow Monitoring',
  ].join('\n');
  return { subject, text, timestamp };
}

let smtpTransporterCache = null;

/** Buat transporter SMTP lazily (sekali per proses). Pola sama dengan gmailNotifier. */
function getAlertTransporter(env) {
  if (!smtpTransporterCache) {
    const port = parseInt(env.SMTP_PORT || '587', 10) || 587;
    smtpTransporterCache = nodemailer.createTransport({
      host: String(env.SMTP_HOST).trim(),
      port,
      secure: port === 465,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
    });
  }
  return smtpTransporterCache;
}

/**
 * Kirim email alert ke semua admin (bila SMTP lengkap di-set). Error → log
 * warn, tidak pernah throw — SMTP tidak boleh menjatuhkan alur alert.
 */
async function sendAlertEmail(rule) {
  const admins = getAdminEmails();
  if (!shouldSendAlertEmail(process.env, admins)) return;
  const { subject, text } = buildAlertEmailPayload(rule);
  const from = process.env.SMTP_FROM || process.env.SMTP_USER || 'CashFlow <no-reply@cashflow.local>';
  try {
    const transporter = getAlertTransporter(process.env);
    await transporter.sendMail({ from, to: admins.join(', '), subject, text });
    logger.info({ rule: rule.name, to: admins.length }, 'Alert email SMTP terkirim');
  } catch (err) {
    logger.warn({ rule: rule.name, err: err.message }, 'Alert email SMTP gagal — non-blocking');
  }
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
  // L1 (audit 2026-09-04): batch 1 round-trip; SSE notify tetap per-user.
  // ON CONFLICT dedupe per (user_id, dedupe_key) dipertahankan. Error batch
  // di-swallow (non-blocking) — sama dengan perilaku loop lama.
  try {
    await turso.batch(
      userIds.map((userId) => {
        const id = crypto.randomUUID();
        const dedupeKey = `alert:${rule.name}`;
        return {
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
        };
      }),
    );
    for (const userId of userIds) {
      notifyUser(userId, 'notification:new', { id: null, title: `Alert: ${rule.name}` });
    }
  } catch (err) {
    logger.warn({ rule: rule.name, err: err.message }, 'In-app alert batch gagal — non-blocking');
  }
}

/**
 * Kirim notifikasi untuk satu rule triggered (webhook + email + in-app) bila
 * cooldown sudah lewat, lalu update `last_notified_at`. Non-blocking — error
 * di-swallow.
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
    await sendAlertEmail(rule);
    await notifyAdminsInApp(rule);

    await turso.execute({
      sql: `UPDATE alert_rules SET last_notified_at = ? WHERE name = ?`,
      args: [new Date().toISOString(), rule.name],
    });
    logger.info({ rule: rule.name }, 'Alert notifikasi terkirim (webhook + email + in-app) + last_notified_at di-update');
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
