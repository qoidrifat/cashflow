/**
 * Better Auth Configuration
 * Setup authentication with Google OAuth and Turso/libSQL database.
 */
import { betterAuth } from 'better-auth';
import { createClient } from '@libsql/client';
import { LibsqlDialect } from '@libsql/kysely-libsql';
import { dash } from '@better-auth/infra';
import { logger } from './logger.js';

const DEV_FALLBACK_SECRET = 'cashflow-dev-secret-change-in-production';

let authInstance = null;

export function getAuth() {
  if (authInstance) return authInstance;

  // PENTING: baca env DI SINI (saat getAuth dipanggil), BUKAN di module top-level.
  // server/index.js memanggil dotenv.config() di module body; semua import dievaluasi
  // SEBELUM body jalan. Bila env dibaca di top-level module, BETTER_AUTH_SECRET dari
  // server/.env belum ter-load → server diam-diam memakai fallback dev (degradasi
  // keamanan). Membaca di sini = nilai env final sudah tersedia.
  const NODE_ENV = process.env.NODE_ENV || 'development';
  const isProduction = NODE_ENV === 'production';
  const configuredSecret = process.env.BETTER_AUTH_SECRET || process.env.AUTH_SECRET;
  const usingFallbackSecret = !configuredSecret || configuredSecret === DEV_FALLBACK_SECRET;

  // Hardening produksi (audit SECURITY_PERFORMANCE: skor 80/100 "with conditions").
  // - BETTER_AUTH_SECRET wajib di-set ke nilai kuat yang unik di produksi —
  //   fail-fast saat boot bila masih memakai fallback dev (bukan silent downgrade).
  // - useSecureCookies = true di produksi (cookie hanya lewat HTTPS).
  // - trustedOrigins bisa diperluas via env BETTER_AUTH_TRUSTED_ORIGINS
  //   (comma-separated, e.g. domain frontend produksi).
  if (isProduction && usingFallbackSecret) {
    throw new Error(
      '[Auth] PRODUCTION: BETTER_AUTH_SECRET wajib di-set ke secret kuat yang unik. ' +
        'Jangan pakai fallback development — set env BETTER_AUTH_SECRET lalu restart.',
    );
  }

  // Defense-in-depth: warning kapan pun fallback dipakai (termasuk bila NODE_ENV
  // lupa di-set di deployment) — hard throw hanya di produksi.
  if (usingFallbackSecret) {
    logger.warn(
      { isProduction },
      'Auth: memakai fallback secret development. Set BETTER_AUTH_SECRET sebelum produksi.',
    );
  }

  const extraOrigins = (process.env.BETTER_AUTH_TRUSTED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  const tursoClient = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN || undefined,
  });

  authInstance = betterAuth({
    database: {
      dialect: new LibsqlDialect({ client: tursoClient }),
      type: 'sqlite',
    },
    plugins: [dash()],
    baseURL: process.env.BETTER_AUTH_URL || 'http://localhost:5181',
    secret: configuredSecret || DEV_FALLBACK_SECRET,
    socialProviders: {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID || '',
        clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
        scope: [
          'openid',
          'email',
          'profile',
          'https://www.googleapis.com/auth/gmail.readonly',
        ],
        accessType: 'offline',
        prompt: 'consent',
      },
    },
    session: {
      cookieCache: {
        enabled: true,
        maxAge: 60 * 5, // 5 menit cache
      },
    },
    user: {
      additionalFields: {
        displayName: { type: 'string', required: false },
        photoUrl: { type: 'string', required: false },
        avatarUrl: { type: 'string', required: false },
        googleId: { type: 'string', required: false },
      },
    },
    advanced: {
      useSecureCookies: isProduction,
      storeStateStrategy: 'cookie',
      defaultCookieAttributes: {
        sameSite: 'lax',
        secure: isProduction,
      },
    },
    trustedOrigins: [
      'http://localhost:5180',
      'http://127.0.0.1:5180',
      'http://localhost:5181',
      'http://127.0.0.1:5181',
      'https://better-auth.com',
      'https://dash.better-auth.com',
      'https://*.loca.lt',
      'https://*.ngrok-free.app',
      ...extraOrigins,
    ],
  });

  logger.info({ baseURL: process.env.BETTER_AUTH_URL || 'http://localhost:5181' }, 'Better Auth siap dengan Google OAuth');
  return authInstance;
}
