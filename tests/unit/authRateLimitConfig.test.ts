/**
 * Unit test: server/lib/auth.js — rateLimit better-auth DI-DISABLE eksplisit.
 *
 * Audit P1-2: better-auth 1.6.25 punya rate limiter BAWAAN dengan default
 * `enabled: isProduction` (create-context.mjs:171 — 100 req / 10s / IP,
 * memory storage). Di produksi limiter ini AKTIF dan menumpuk DI ATAS
 * express-rate-limit (authLimiter di server/index.js) → dua lapis limiter
 * dengan format body 429 berbeda:
 *   - express-rate-limit : { ok:false, code:'RATE_LIMITED', ... } (draft-7 headers)
 *   - better-auth default : format handler bawaan berbeda
 * Frontend & e2e/rate-limit.spec.ts mengandalkan format express-rate-limit.
 *
 * Test ini meng-lock config: `rateLimit: { enabled: false }` WAJIB ada di
 * options yang dikirim ke betterAuth() — di SEMUA env (tidak boleh muncul
 * kembali via default isProduction). express-rate-limit = single source of
 * truth rate limiting.
 *
 * CATATAN: authConfig.test.ts memuat describe rateLimit DUPLEIKAT (3 test
 * identik) atas permintaan eksplisit user ("assertion di authConfig.test.ts").
 * Keduanya sengaja dipertahankan — jangan hapus salah satu tanpa persetujuan.
 *
 * Tanpa DB nyata: TURSO_DATABASE_URL=libsql:// (createClient lazy). betterAuth
 * di-mock untuk menangkap options (authInstance di-cache → resetModules +
 * dynamic import per test, pola sama dengan authConfig.test.ts).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../server/lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

/**
 * vi.hoisted: mock factory di-hoist ke atas import, jadi variabel yang dipakai
 * factory harus dibuat via hoisted (bukan const di module scope — TDZ error /
 * silent fallback ke module asli).
 */
const { capturedOptions, betterAuthMock } = vi.hoisted(() => {
  const capturedOptions: Array<Record<string, unknown>> = [];
  const betterAuthMock = vi.fn((options: Record<string, unknown>) => {
    capturedOptions.push(options);
    return { mockAuth: true };
  });
  return { capturedOptions, betterAuthMock };
});

// PENTING: better-auth ada DUA salinan (server/node_modules dipakai
// server/lib/auth.js, node_modules root diresolusi tests/unit) — mock harus
// menunjuk salinan yang SAMA dengan auth.js (pola tursoBootRetry.test.ts).
// P2.3 — mock factory SINKRON (tanpa importOriginal): auth.js hanya mengimpor
// named export `betterAuth` — mock minimal cukup. importOriginal memuat
// better-auth asli ~3MB di tiap worker → timeout flaky saat full suite
// paralel (terbukti: gagal di run penuh, lulus isolasi). Deterministik.
vi.mock('../../server/node_modules/better-auth', () => ({ betterAuth: betterAuthMock }));

async function loadAuthModule() {
  vi.resetModules(); // authInstance di-cache di module — reset antar test
  return await import('../../server/lib/auth.js');
}

function optionsFor(): Record<string, unknown> {
  return capturedOptions[capturedOptions.length - 1] ?? {};
}

describe('auth.js — rateLimit better-auth disabled (express-rate-limit = source of truth)', () => {
  beforeEach(() => {
    capturedOptions.length = 0;
    betterAuthMock.mockClear();
  });

  afterEach(() => {
    delete process.env.BETTER_AUTH_SECRET;
    delete process.env.AUTH_SECRET;
    delete process.env.BETTER_AUTH_URL;
    delete process.env.NODE_ENV;
    delete process.env.TURSO_DATABASE_URL;
    delete process.env.TURSO_AUTH_TOKEN;
  });

  it('produksi + secret kuat → options berisi rateLimit: { enabled: false }', async () => {
    process.env.NODE_ENV = 'production';
    process.env.BETTER_AUTH_SECRET = 'x'.repeat(64);
    process.env.TURSO_DATABASE_URL = 'libsql://test.example.com';
    process.env.TURSO_AUTH_TOKEN = 'test-token';
    const { getAuth } = await loadAuthModule();
    getAuth();

    expect(betterAuthMock).toHaveBeenCalledTimes(1);
    expect(optionsFor().rateLimit).toEqual({ enabled: false });
  });

  it('development → rateLimit: { enabled: false } tetap eksplisit (bukan via default)', async () => {
    process.env.NODE_ENV = 'development';
    process.env.TURSO_DATABASE_URL = 'libsql://test.example.com';
    process.env.TURSO_AUTH_TOKEN = 'test-token';
    const { getAuth } = await loadAuthModule();
    getAuth();

    expect(optionsFor().rateLimit).toEqual({ enabled: false });
  });

  it('tanpa NODE_ENV (default dev) → rateLimit disable eksplisit, tidak muncul kembali', async () => {
    process.env.TURSO_DATABASE_URL = 'libsql://test.example.com';
    process.env.TURSO_AUTH_TOKEN = 'test-token';
    const { getAuth } = await loadAuthModule();
    getAuth();

    expect(optionsFor().rateLimit).toEqual({ enabled: false });
  });
});
