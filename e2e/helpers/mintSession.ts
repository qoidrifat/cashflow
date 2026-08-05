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

/**
 * Email user seed E2E — resolusi HARUS identik dengan scripts/seedE2eDataset.mjs
 * (ADMIN_EMAILS[0] atau default 'e2e-seed-admin@cashflow.test'). Mint sesi &
 * cleanup memakai email yang sama persis dengan seed agar target user
 * deterministik di lingkungan mana pun (CI: e2e-seed-admin@…; lokal: admin dev).
 *
 * ⚠️ DIVERGENSI TAHU-BETUL (reviewer): seed script menghitung ADMIN_EMAIL saat
 * module-load — SEBELUM loadEnv() — sehingga ia TIDAK pernah membaca server/.env
 * (hanya env var proses nyata). Helper ini dipanggil SETELAH loadEnv() → di
 * skenario lokal tanpa env ter-export, seed menarget e2e-seed-admin@… sedangkan
 * mintSession menarget ADMIN_EMAILS dari server/.env. CI TIDAK terpengaruh
 * (workflow selalu men-set ADMIN_EMAILS sebagai env var nyata). Untuk konsistensi
 * penuh saat run lokal: export ADMIN_EMAILS secara eksplisit (pola verifikasi
 * temp-DB: seed & spec memakai env yang sama).
 */
function resolveSeedAdminEmail(): string {
  return (
    (process.env.ADMIN_EMAILS || '').split(',')[0]?.trim().toLowerCase() ||
    'e2e-seed-admin@cashflow.test'
  );
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
 *
 * Target user = USER SEED (email ADMIN_EMAILS[0] atau default
 * e2e-seed-admin@cashflow.test) — SAMA dengan scripts/seedE2eDataset.mjs.
 * Resolusi by email (BUKAN `LIMIT 1`) agar deterministik walau tabel `user`
 * berisi banyak user (mis. leftover dari spec non-admin) atau urutan row
 * berubah — penyebab kegagalan CI #4 (mint sesi untuk user yang salah).
 */
export async function mintSessionCookie(): Promise<MintedSession> {
  loadEnv();

  const turso = createClient({
    url: process.env.TURSO_DATABASE_URL as string,
    authToken: process.env.TURSO_AUTH_TOKEN as string,
  });

  try {
    const email = resolveSeedAdminEmail();
    const users = await turso.execute({
      sql: 'SELECT id FROM user WHERE email = ?',
      args: [email],
    });
    let userId = users.rows[0]?.id as string | undefined;
    if (!userId) {
      // User seed belum ada (DB fresh tanpa seed) — buat seperti seed, termasuk
      // sinkronisasi ke `users` (plural) yang dipakai FK tabel bisnis.
      userId = crypto.randomBytes(16).toString('hex');
      await turso.execute({
        sql: `INSERT INTO user (id, name, email, emailVerified) VALUES (?, ?, ?, 1)`,
        args: [userId, 'E2E Seed Admin', email],
      });
      await turso.execute({
        sql: `INSERT INTO users (id, email, name, display_name) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
        args: [userId, email, 'E2E Seed Admin', 'E2E Seed Admin'],
      });
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

/**
 * Hapus data test kategori (nama prefiks 'e2e-cat-') dari Turso.
 * Dipakai spec e2e/categories.spec.ts — data test ditandai prefiks unik agar
 * tidak mengganggu dataset asli user (kategori default is_default=1 tidak
 * mungkin memiliki nama prefiks 'e2e-cat-', jadi aman).
 */
export async function cleanupTestCategories(): Promise<void> {
  loadEnv();
  const turso = createClient({
    url: process.env.TURSO_DATABASE_URL as string,
    authToken: process.env.TURSO_AUTH_TOKEN as string,
  });
  try {
    await turso.execute({
      sql: `DELETE FROM categories WHERE name LIKE 'e2e-cat-%'`,
      args: [],
    });
  } finally {
    turso.close();
  }
}

/**
 * Seed fixture DETERMINISTIK ai_usage_metrics (hari ini, 3 fitur) agar chart
 * multi-seri Tren Biaya di /admin/monitoring PASTI punya >1 garis di CI.
 * Tanpa ini ai_usage_metrics bisa kosong (seedE2eDataset tidak mengisinya) →
 * chart menampilkan EmptyMini dan asersi line-count tidak bermakna.
 * Baris ditandai id prefiks 'e2e-usage-' agar aman dibersihkan.
 */
export async function seedAICostTrendFixtures(userId: string): Promise<void> {
  loadEnv();
  const turso = createClient({
    url: process.env.TURSO_DATABASE_URL as string,
    authToken: process.env.TURSO_AUTH_TOKEN as string,
  });
  try {
    // Satu INSERT multi-VALUES → ATOMIK (reviewer): kegagalan tidak bisa
    // menyisakan baris parsial yang membuat chart tidak konsisten.
    await turso.execute({
      sql: `INSERT INTO ai_usage_metrics
            (id, user_id, feature, provider, model, prompt_tokens, completion_tokens,
             estimated_cost_usd, estimated_cost_idr, execution_time_ms, status, error_message, metadata)
            VALUES
              ('e2e-usage-gmail', ?, 'gmail_sync', 'gemini_flash', 'e2e-fixture', 2000, 0, 0, 150, 120, 'success', NULL, '{}'),
              ('e2e-usage-ocr', ?, 'ocr_receipt', 'gemini_flash', 'e2e-fixture', 800, 0, 0, 50, 120, 'success', NULL, '{}'),
              ('e2e-usage-insight', ?, 'insight_generator', 'gemini_flash', 'e2e-fixture', 1200, 0, 0, 100, 120, 'success', NULL, '{}')`,
      args: [userId, userId, userId],
    });
  } finally {
    turso.close();
  }
}

/** Hapus fixture ai_usage_metrics (id prefiks 'e2e-usage-') dari Turso. */
export async function cleanupAICostTrendFixtures(): Promise<void> {
  loadEnv();
  const turso = createClient({
    url: process.env.TURSO_DATABASE_URL as string,
    authToken: process.env.TURSO_AUTH_TOKEN as string,
  });
  try {
    await turso.execute({
      sql: `DELETE FROM ai_usage_metrics WHERE id LIKE 'e2e-usage-%'`,
      args: [],
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
    // ⚠️ JANGAN hapus USER SEED: di CI user seed = e2e-seed-admin@cashflow.test
    // yang juga cocok `LIKE 'e2e-%'` — menghapusnya memutus sesi & data bisnis
    // untuk spec berikutnya (akar kegagalan CI #4: 3× E2E gagal beruntun palsu).
    const seedEmail = resolveSeedAdminEmail();
    await turso.execute({
      sql: `DELETE FROM user WHERE email LIKE 'e2e-%' AND email != ?`,
      args: [seedEmail],
    });
  } finally {
    turso.close();
  }
}
