/**
 * Gmail Review Notifier — channel eksternal untuk hasil aksi review Gmail
 * (approve/reject/duplicate/failed) agar user tahu walau app tidak terbuka.
 *
 * Notifikasi in-app sudah dibuat oleh frontend (`triggerGmailReviewResultNotification`
 * → POST /api/notifications). Service ini MENAMBAH channel pengiriman eksternal
 * dari server (pola sama dengan `alertNotifier.js`):
 *
 *  1. WEBHOOK (env GMAIL_WEBHOOK_URL, fallback ALERT_WEBHOOK_URL, optional):
 *     POST JSON ke URL eksternal (Slack/Discord/generic webhook) saat ada hasil
 *     review Gmail (approved/rejected/duplicate/failed).
 *  2. EMAIL (env SMTP_HOST/PORT/USER/PASS/FROM, optional): kirim email ke email
 *     user yang melakukan aksi via nodemailer (bekerja dengan Gmail SMTP,
 *     Mailgun, SendGrid, Amazon SES, dll — vendor-agnostic).
 *
 * PRINSIP: non-blocking & tidak pernah melempar (semua error di-swallow) — sama
 * dengan alertNotifier; channel pengiriman tidak boleh memblokir/menjatuhkan
 * respons POST /api/notifications.
 */
import nodemailer from 'nodemailer';
import { logger } from '../lib/logger.js';

/** Webhook URL: GMAIL_WEBHOOK_URL → fallback ALERT_WEBHOOK_URL (bila hanya satu yang di-set). */
const WEBHOOK_URL = (process.env.GMAIL_WEBHOOK_URL || process.env.ALERT_WEBHOOK_URL || '').trim();
const WEBHOOK_TIMEOUT_MS = 10_000;

/** SMTP config (email channel). EMAIL_ENABLED hanya true bila SMTP_HOST di-set. */
const SMTP_HOST = (process.env.SMTP_HOST || '').trim();
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587', 10) || 587;
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER || 'CashFlow <no-reply@cashflow.local>';
const EMAIL_ENABLED = SMTP_HOST.length > 0;

/** In-flight guard (anti double-send): emailId yang sedang diproses notifikasinya. */
const inFlightEmailIds = new Set();

const STATUS_META = {
  approved: { title: 'Transaksi Gmail diterima', emoji: '✅' },
  rejected: { title: 'Transaksi ditolak', emoji: '🚫' },
  duplicate: { title: 'Transaksi Gmail duplikat', emoji: '⚠️' },
  failed: { title: 'Gagal menerima transaksi Gmail', emoji: '❌' },
};

/**
 * Pure helper (unit-testable): payload webhook dengan shape stabil agar konsumen
 * webhook bisa mem-parse tanpa perubahan. Tidak membawa field sensitif.
 */
export function buildReviewWebhookPayload({ userId, userEmail, result }) {
  return {
    event: 'gmail.review.result',
    app: 'cashflow',
    timestamp: new Date().toISOString(),
    user: {
      id: userId || null,
      email: userEmail || null,
    },
    result: {
      status: result.status,
      emailId: result.emailId,
      merchant: result.merchant || null,
      amount: typeof result.amount === 'number' ? result.amount : null,
      message: result.message || null,
    },
  };
}

/**
 * Pure helper (unit-testable): konten email (subject + text + html sederhana)
 * per status hasil review.
 */
export function buildReviewEmailContent(result) {
  const meta = STATUS_META[result.status] || STATUS_META.failed;
  const merchantLabel = result.merchant || 'Transaksi';
  const amountLabel = typeof result.amount === 'number'
    ? ` Rp ${result.amount.toLocaleString('id-ID')}`
    : '';

  let body;
  switch (result.status) {
    case 'approved':
      body = `${merchantLabel}${amountLabel} berhasil disimpan ke daftar transaksi CashFlow.`;
      break;
    case 'rejected':
      body = `${merchantLabel}${amountLabel} ditandai ditolak dan tidak disimpan.`;
      break;
    case 'duplicate':
      body = `${merchantLabel}${amountLabel} tidak disimpan karena transaksi serupa sudah ada.`;
      break;
    default:
      body = `${merchantLabel}${amountLabel} gagal disimpan. ${result.message || 'Terjadi kegagalan sistem.'}`;
  }

  const text = `${meta.emoji} ${meta.title}\n\n${body}\n\n— CashFlow`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 12px;">
      <h2 style="margin: 0 0 12px; color: #111827;">${meta.emoji} ${meta.title}</h2>
      <p style="margin: 0 0 16px; color: #374151; line-height: 1.6;">${body}</p>
      <p style="margin: 0; color: #9ca3af; font-size: 12px;">Dikirim otomatis oleh CashFlow.</p>
    </div>
  `;

  return { subject: `CashFlow: ${meta.title} — ${merchantLabel}`, text, html };
}

/** POST JSON ke webhook URL (bila di-set). Error → log warn, tidak throw. */
async function sendReviewWebhook(payload) {
  if (!WEBHOOK_URL) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
  try {
    const resp = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    logger.info({ status: resp.status, emailId: payload.result?.emailId }, 'Gmail review webhook terkirim');
  } catch (err) {
    logger.warn({ err: err.message }, 'Gmail review webhook gagal — non-blocking');
  } finally {
    clearTimeout(timer);
  }
}

let transporterCache = null;

/** Buat transporter SMTP lazily (sekali per proses). Null bila email nonaktif. */
function getTransporter() {
  if (!EMAIL_ENABLED) return null;
  if (!transporterCache) {
    transporterCache = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: SMTP_USER && SMTP_PASS ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
    });
  }
  return transporterCache;
}

/** Kirim email ke user (bila SMTP di-set). Error → log warn, tidak throw. */
async function sendReviewEmail(userEmail, content) {
  if (!EMAIL_ENABLED || !userEmail) return;
  const transporter = getTransporter();
  if (!transporter) return;
  try {
    await transporter.sendMail({
      from: SMTP_FROM,
      to: userEmail,
      subject: content.subject,
      text: content.text,
      html: content.html,
    });
    logger.info({ to: userEmail, emailId: content.emailId }, 'Gmail review email terkirim');
  } catch (err) {
    logger.warn({ to: userEmail, err: err.message }, 'Gmail review email gagal — non-blocking');
  }
}

/**
 * Orchestrator: kirim webhook + email untuk satu hasil review Gmail.
 * Non-blocking — error di-swallow. Dipanggil fire-and-forget dari
 * POST /api/notifications (dedupeKey `gmail-review-*` / metadata.source gmail_review).
 */
export async function notifyGmailReviewResult({ userId, userEmail, result }) {
  if (!result?.emailId) return;
  if (inFlightEmailIds.has(result.emailId)) return; // sudah diproses
  inFlightEmailIds.add(result.emailId);
  try {
    const payload = buildReviewWebhookPayload({ userId, userEmail, result });
    const content = buildReviewEmailContent(result);
    await Promise.all([sendReviewWebhook(payload), sendReviewEmail(userEmail, content)]);
  } catch (err) {
    logger.warn({ err: err.message }, 'Gmail review notifier error — non-blocking');
  } finally {
    inFlightEmailIds.delete(result.emailId);
  }
}
