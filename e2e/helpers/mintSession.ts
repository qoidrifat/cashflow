/**
 * Helpers E2E untuk autentikasi via cookie.
 *
 * Better Auth menyimpan sesi di tabel `session` (Turso) dan cookie-nya berbentuk
 * `${token}.${base64(HMAC-SHA256(secret, token))}`. Helper ini menulis satu baris
 * sesi valid ke Turso (userAgent 'e2e-test') dan mengembalikan nilai cookie yang
 * bisa di-inject ke browser — sehingga test bisa login tanpa Google OAuth manual.
 *
 * Referensi skema signature: server/lib/auth.js (betterAuth secret fallback).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@libsql/client';

function loadEnv(): void {
  const envPath = path.resolve(process.cwd(), 'server', '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (t && !t.startsWith('#') && t.includes('=')) {
      const i = t.indexOf('=');
      const k = t.slice(0, i).trim();
      const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
      if (k && !process.env[k]) process.env[k] = v;
    }
  }
}

export interface MintedSession {
  cookie: string;
  userId: string;
}

/** Buat sesi Better Auth untuk userId tertentu (shared — dipakai admin & non-admin). */
async function insertSession(turso: ReturnType<typeof createClient>, userId: string): Promise<MintedSession> {
  const token = crypto.randomBytes(24).toString('base64url').slice(0, 32);
  const secret =
    process.env.BETTER_AUTH_SECRET ||
    process.env.AUTH_SECRET ||
    'cashflow-dev-secret-change-in-production';
  const sig = crypto.createHmac('sha256', secret).update(token).digest('base64');
  const now = new Date();

  await turso.execute({
    sql: `INSERT INTO session (id, expiresAt, token, createdAt, updatedAt, ipAddress, userAgent, userId)
          VALUES (?, ?, ?, ?, ?, '', 'e2e-test', ?)`,
    args: [
      token,
      new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      token,
      now.toISOString(),
      now.toISOString(),
      userId,
    ],
  });

  return { cookie: `${token}.${sig}`, userId };
}

/**
 * Mint sesi Better Auth yang valid dan kembalikan cookie + userId.
 * Sesi ditandai userAgent='e2e-test' agar mudah dibersihkan.
 * Memakai user pertama di tabel `user` (qoidrifat23@gmail.com = ADMIN_EMAILS).
 */
export async function mintSessionCookie(): Promise<MintedSession> {
  loadEnv();

  const turso = createClient({
    url: process.env.TURSO_DATABASE_URL as string,
    authToken: process.env.TURSO_AUTH_TOKEN as string,
  });

  try {
    const users = await turso.execute({
      sql: 'SELECT id FROM user LIMIT 1',
      args: [],
    });
    const userId = users.rows[0]?.id as string | undefined;
    if (!userId) {
      throw new Error('Tidak ada user di tabel `user` — jalankan migrasi/seed terlebih dahulu.');
    }

    return await insertSession(turso, userId);
  } finally {
    turso.close();
  }
}

/**
 * Mint sesi untuk user dengan email tertentu — membuat user sementara bila belum ada.
 * Dipakai untuk menguji gate admin 403 (email TIDAK di ADMIN_EMAILS).
 * User test ditandai email berawalan 'e2e-' agar aman dibersihkan di cleanup.
 */
export async function mintSessionCookieForEmail(email: string): Promise<MintedSession> {
  loadEnv();

  const turso = createClient({
    url: process.env.TURSO_DATABASE_URL as string,
    authToken: process.env.TURSO_AUTH_TOKEN as string,
  });

  try {
    const existing = await turso.execute({
      sql: 'SELECT id FROM user WHERE email = ?',
      args: [email],
    });
    let userId = existing.rows[0]?.id as string | undefined;
    if (!userId) {
      userId = crypto.randomBytes(16).toString('hex');
      await turso.execute({
        sql: `INSERT INTO user (id, name, email, emailVerified) VALUES (?, ?, ?, 1)`,
        args: [userId, 'E2E Non-Admin', email],
      });
    }

    return await insertSession(turso, userId);
  } finally {
    turso.close();
  }
}

/**
 * Hapus data test approve Gmail review (transaksi + log + notifikasi) dari Turso.
 * Dipakai spec e2e/gmail-review-approve.spec.ts — data test ditandai messageId
 * unik (prefiks 'e2e-review-') agar tidak mengganggu dataset asli user.
 */
export async function cleanupGmailReviewTestData(testMessageId: string): Promise<void> {
  if (!testMessageId) return;
  loadEnv();
  const turso = createClient({
    url: process.env.TURSO_DATABASE_URL as string,
    authToken: process.env.TURSO_AUTH_TOKEN as string,
  });
  try {
    // Transaksi yang dibuat oleh alur approve (gmail_message_id = testMessageId)
    await turso.execute({
      sql: `DELETE FROM transactions WHERE gmail_message_id = ?`,
      args: [testMessageId],
    });
    // Log Gmail Sync test
    await turso.execute({
      sql: `DELETE FROM gmail_sync_logs WHERE message_id = ?`,
      args: [testMessageId],
    });
    // Notifikasi hasil review (dedupeKey gmail-review-<messageId>)
    await turso.execute({
      sql: `DELETE FROM notifications WHERE dedupe_key = ?`,
      args: [`gmail-review-${testMessageId}`],
    });
  } finally {
    turso.close();
  }
}

/** Hapus sesi E2E (userAgent='e2e-test') + user test (email 'e2e-*') dari Turso. */
export async function cleanupTestSessions(): Promise<void> {
  loadEnv();
  const turso = createClient({
    url: process.env.TURSO_DATABASE_URL as string,
    authToken: process.env.TURSO_AUTH_TOKEN as string,
  });
  try {
    await turso.execute({
      sql: `DELETE FROM session WHERE userAgent = 'e2e-test'`,
      args: [],
    });
    // User test non-admin (dibuat mintSessionCookieForEmail) — email prefiks 'e2e-'.
    await turso.execute({
      sql: `DELETE FROM user WHERE email LIKE 'e2e-%'`,
      args: [],
    });
  } finally {
    turso.close();
  }
}
