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
 * Mint sesi Better Auth yang valid dan kembalikan cookie + userId.
 * Sesi ditandai userAgent='e2e-test' agar mudah dibersihkan.
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
  } finally {
    turso.close();
  }
}

/** Hapus semua sesi E2E (userAgent='e2e-test') dari Turso. */
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
  } finally {
    turso.close();
  }
}
