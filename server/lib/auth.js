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

// Panjang minimum secret yang diterima. Better Auth hanya logger.warn bila
// secret < 32 char (create-context.mjs); kita naikkan menjadi fail-fast di
// produksi — pola hardening existing (fallback secret juga fail-fast).
const MIN_SECRET_LENGTH = 32;

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
  const weakSecret = !usingFallbackSecret && configuredSecret.length < MIN_SECRET_LENGTH;

  // Hardening produksi (audit SECURITY_PERFORMANCE: skor 80/100 "with conditions").
  // - BETTER_AUTH_SECRET wajib di-set ke nilai kuat (min 32 char) yang unik di
  //   produksi — fail-fast saat boot bila masih memakai fallback dev ATAU secret
  //   terlalu pendek (bukan silent downgrade / warning diam).
  // - useSecureCookies = true di produksi (cookie hanya lewat HTTPS).
  // - trustedOrigins bisa diperluas via env BETTER_AUTH_TRUSTED_ORIGINS
  //   (comma-separated, e.g. domain frontend produksi).
  if (isProduction && (usingFallbackSecret || weakSecret)) {
    throw new Error(
      '[Auth] PRODUCTION: BETTER_AUTH_SECRET wajib di-set ke secret kuat ' +
        `(min ${MIN_SECRET_LENGTH} char) yang unik. ` +
        'Jangan pakai fallback development / secret pendek — set env BETTER_AUTH_SECRET lalu restart.',
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

  // Secret dikonfigurasi tapi terlalu pendek (dev): warning eksplisit — di
  // produksi baris di atas sudah fail-fast; di dev tetap lanjut (bukan block).
  if (weakSecret) {
    logger.warn(
      { isProduction, secretLength: configuredSecret.length },
      `Auth: BETTER_AUTH_SECRET terlalu pendek (min ${MIN_SECRET_LENGTH} char). Perkuat sebelum produksi.`,
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
    // Mount path DI-PIN eksplisit (default better-auth 1.6.25, create-context.mjs:86
    // `options.basePath || '/api/auth'`). server/index.js me-mount handler di
    // `/api/auth` (baris ~302) — pin agar perubahan mount tidak menggeser path
    // auth secara diam-diam (semua script verifikasi & E2E mengandalkannya).
    basePath: '/api/auth',
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
    // Kontrak sesi EKSPLISIT (nilai = default better-auth 1.6.25, di-pin agar
    // upgrade paket tidak menggeser perilaku diam-diam; create-context.mjs:146-151):
    //   - expiresIn 604800s (7 hari) — masa berlaku sesi maksimal.
    //   - updateAge 86400s (1 hari) — rotasi token: sesi yang aktif TETAP aktif
    //     diperbarui (rolling) setelah melewati usia ini; sesi tidak aktif >
    //     7 hari kedaluwarsa. Rotasi 1 hari memendekkan jendela token curian.
    //   - cookieCache.maxAge 300s (5 mnt) — cache validasi sesi sisi klien;
    //     trade-off disengaja: revokasi (logout/suspend) terlihat ≤ 5 mnt
    //     (kompromi kecepatan vs pembatalan cepat, dibuktikan E2E logout).
    session: {
      expiresIn: 604800, // 7 hari
      updateAge: 86400, // rotasi token 1 hari
      // freshAge 86400s (24 jam) — default better-auth 1.6.25 (create-context
      // .mjs:148 `freshAge === void 0 ? 3600*24 : ...`). DI-PIN: durasi setelah
      // login sesi dianggap "tidak fresh" (flag `session.isFresh` turun) —
      // dipakai klien untuk memutuskan kapan re-auth diperlukan. Pin mencegah
      // upgrade paket menggeser semantik isFresh diam-diam.
      freshAge: 86400,
      cookieCache: {
        enabled: true,
        maxAge: 300, // 5 mnt — revokasi terlihat ≤ 5 mnt
      },
    },
    // P1-2 audit: better-auth 1.6.25 punya rate limiter BAWAAN dengan default
    // `enabled: isProduction` (create-context.mjs:171 — 100 req / 10s / IP,
    // memory storage). Di produksi ini AKTIF dan menumpuk DI ATAS
    // express-rate-limit (authLimiter di server/index.js) → dua lapis limiter
    // dengan format body 429 berbeda (better-auth default handler vs
    // { ok:false, code:'RATE_LIMITED' } yang diandalkan frontend/E2E).
    // Disable eksplisit: express-rate-limit adalah SATU-SATUNYA source of
    // truth untuk rate limiting (server/index.js, draft-7 headers, per-user key).
    rateLimit: { enabled: false },
    user: {
      additionalFields: {
        displayName: { type: 'string', required: false },
        photoUrl: { type: 'string', required: false },
        avatarUrl: { type: 'string', required: false },
        googleId: { type: 'string', required: false },
      },
    },
    // P3 (2026-08-11) — OAuth state di-DATABASE + TANPA state-cookie binding
    // (ROOT CAUSE state_mismatch di Freebuff Preview).
    //
    // Bukti forensik (repro deterministik 2026-08-11, .test-data/oauth-repro2):
    //   [SAME jar]  callback + cookie state → PASS state → invalid_code (token
    //               exchange; kode palsu — expected)
    //   [OTHER jar] callback TANPA cookie  → state_mismatch (error persis yang
    //               dilaporkan user di Freebuff)
    //
    // Flow Freebuff: inisiasi login terjadi di webview preview
    // (http://127.0.0.1:5180) tetapi redirect Google + callback selesai di TAB
    // CHROME EKSTERNAL — dua cookie jar TERPISAH. Cookie `better-auth.state`
    // yang dibuat di jar inisiator TIDAK pernah sampai ke callback (jar lain)
    // → state_mismatch. Tidak ada atribut cookie yang bisa menembus jar berbeda.
    //
    // Solusi: state disimpan SERVER-SIDE di tabel `verification` (migration
    // 0001 — sudah ada, TANPA migration baru) dan callback divalidasi via
    // parameter `state` itu sendiri. `skipStateCookieCheck: true` menghapus
    // HANYA lapisan cookie yang mustahil lintas-jar — validasi state TETAP
    // eksak (pola sama dengan plugin resmi better-auth oauth-proxy
    // dist/plugins/oauth-proxy/index.mjs:19):
    //   - state tidak dikenal / tampered → state_mismatch (rejected)
    //   - state missing               → state_not_found (rejected)
    //   - state expired               → state_mismatch (rejected; baris
    //     expiresAt < now di-cleanup adapter)
    //   - state dikonsumsi            → sekali pakai (row dihapus saat
    //     callback sukses — replay ditolak)
    //   - state acak 32-char           → tidak bisa ditebak/brute-force
    // Origin check & CSRF check tetap AKTIF (disableOriginCheck/CSRFCheck
    // false di advanced). Catatan: `advanced.storeStateStrategy` BUKAN dibaca
    // runtime (create-context.mjs:136 membaca options.account.storeStateStrategy;
    // nilai lama di advanced = no-op yang menyesatkan) — konfigurasi jujur
    // ditaruh di `account` tempat runtime benar-benar membacanya.
    account: {
      storeStateStrategy: 'database',
      skipStateCookieCheck: true,
    },
    advanced: {
      useSecureCookies: isProduction,
      // httpOnly DI-PIN eksplisit (default true) — bagian dari kontrak cookie
      // HttpOnly+SameSite=Lax (SESSION_LIFECYCLE.md); pin mencegah flip default
      // upstream membuat cookie sesi terbaca JavaScript diam-diam.
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: 'lax',
        secure: isProduction,
      },
      // Prefix cookie DI-PIN eksplisit di sini (bukan top-level) — better-auth
      // 1.6.25 membaca HANYA `options.advanced?.cookiePrefix` (cookies/index.mjs:26
      // `options.advanced?.cookiePrefix || "better-auth"`); opsi top-level
      // `cookiePrefix` TIDAK dikonsumsi runtime (verifikasi dist 2026-08-09 →
      // pin top-level = no-op). Nama cookie yang dihasilkan =
      // `better-auth.session_token` — HARD-CODED oleh e2e/helpers/authContext.ts,
      // mintSession.ts, dan 6+ script verifikasi; di produksi (useSecureCookies)
      // menjadi `__Secure-better-auth.session_token`.
      cookiePrefix: 'better-auth',
      // P1-2 audit — pin eksplisit agar proteksi origin/CSRF better-auth TIDAK
      // pernah dinonaktifkan diam-diam (default create-context.mjs:209-210:
      //   skipCSRFCheck  = !!options.advanced?.disableCSRFCheck        (default false)
      //   skipOriginCheck = options.advanced?.disableOriginCheck ??    (default false;
      //     isTest() ? true : false — DI TEST ENV origin check auto-skip)
      // Eksplisit `false` = origin check & CSRF check AKTIF di semua env
      // (termasuk produksi). Lapisan kedua di atas CSRF Origin check 403
      // middleware (server/index.js, docs/security/SESSION_LIFECYCLE.md §5).
      disableOriginCheck: false,
      disableCSRFCheck: false,
      // crossSubDomainCookies { enabled: false } — DI-PIN (default nonaktif,
      // cookies/index.mjs:22 `!!options.advanced?.crossSubDomainCookies?.enabled`).
      // Menjaga cookie TIDAK dibagikan ke parent domain — penting karena
      // trustedOrigins memuat wildcard (ngrok/loca.lt): enable yang tidak sengaja
      // akan melemahkan scope cookie ke subdomain lain.
      crossSubDomainCookies: { enabled: false },
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
