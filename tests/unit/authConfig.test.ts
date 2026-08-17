/**
 * Unit test: server/lib/auth.js — validasi kekuatan BETTER_AUTH_SECRET +
 * kontrak sesi eksplisit.
 *
 * Pola hardening existing (fail-fast produksi + warning dev) diperluas:
 *   - produksi + fallback development            → getAuth() THROW (existing)
 *   - produksi + secret < 32 char                → getAuth() THROW (baru — better
 *     auth sendiri hanya logger.warn di create-context.mjs:43)
 *   - produksi + secret kuat (≥ 32)              → boot jalan (info log)
 *   - dev + secret pendek                        → logger.warn (tidak throw)
 *   - dev + tanpa secret                         → logger.warn fallback (existing)
 *
 * Kontrak sesi (session contract) DI-PIN eksplisit — nilai = default better-auth
 * 1.6.25 (create-context.mjs:146-151) agar upgrade paket tidak menggeser
 * perilaku diam-diam:
 *   - expiresIn 604800s (7 hari)
 *   - updateAge 86400s (1 hari — rotasi token)
 *   - cookieCache { enabled: true, maxAge: 300 } (5 mnt — revokasi ≤ 5 mnt)
 *
 * Kontrak rateLimit (P1-2) DI-PIN: `rateLimit: { enabled: false }` di SEMUA env
 * — better-auth 1.6.25 default `enabled: isProduction` (create-context.mjs:171,
 * 100 req/10s/IP memory) yang di produksi menumpuk DI ATAS express-rate-limit
 * (authLimiter di server/index.js) dengan format body 429 berbeda.
 * express-rate-limit = single source of truth rate limiting.
 *
 * Tanpa DB nyata: TURSO_DATABASE_URL di-set ke libsql:// (createClient lazy —
 * tidak ada koneksi saat konstruksi; jangan pakai file: — libsql membuat file
 * DB di cwd saat createClient). getAuth() meng-cache authInstance →
 * vi.resetModules() + dynamic import per test agar env antar-test tidak bocor.
 *
 * PENTING: better-auth ada DUA salinan (server/node_modules dipakai auth.js,
 * node_modules root diresolusi tests/unit) — mock harus menunjuk salinan server
 * (pola tursoBootRetry.test.ts). Mock hanya untuk MENANGKAP options yang dikirim
 * ke betterAuth() (assertion kontrak sesi); test validasi secret tetap valid
 * karena throw terjadi SEBELUM betterAuth() dipanggil.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../server/lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { capturedOptions, betterAuthMock } = vi.hoisted(() => {
  const capturedOptions: Array<Record<string, unknown>> = [];
  const betterAuthMock = vi.fn((options: Record<string, unknown>) => {
    capturedOptions.push(options);
    return { mockAuth: true };
  });
  return { capturedOptions, betterAuthMock };
});

// P2.3 — mock factory SINKRON (tanpa importOriginal): auth.js hanya mengimpor
// named export `betterAuth` (server/lib/auth.js:5), jadi mock minimal cukup.
// importOriginal sebelumnya memuat better-auth ASLI ~3MB (server/node_modules)
// di tiap worker fork → contention saat full suite (97 file paralel) →
// import > 5s → timeout flaky (terbukti: 2 test gagal hanya di run penuh,
// lulus isolasi). Mock minimal = deterministik, tidak bergantung pada beban
// memuat library besar.
vi.mock('../../server/node_modules/better-auth', () => ({ betterAuth: betterAuthMock }));

import { logger } from '../../server/lib/logger.js';

const DEV_FALLBACK = 'cashflow-dev-secret-change-in-production'; // 40 char (≥ 32)

async function loadAuthModule() {
  vi.resetModules(); // authInstance di-cache di module — reset antar test
  return await import('../../server/lib/auth.js');
}

function optionsFor(): Record<string, unknown> {
  return capturedOptions[capturedOptions.length - 1] ?? {};
}

describe('auth.js — validasi kekuatan BETTER_AUTH_SECRET', () => {
  beforeEach(() => {
    vi.mocked(logger.warn).mockClear();
    vi.mocked(logger.info).mockClear();
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

  it('produksi + fallback development → fail-fast (getAuth throws)', async () => {
    process.env.NODE_ENV = 'production';
    const { getAuth } = await loadAuthModule();
    expect(() => getAuth()).toThrow(/BETTER_AUTH_SECRET/);
  });

  it('produksi + secret pendek (< 32 char) → fail-fast, bukan warning diam', async () => {
    process.env.NODE_ENV = 'production';
    process.env.BETTER_AUTH_SECRET = 'short-secret'; // 12 char
    const { getAuth } = await loadAuthModule();
    expect(() => getAuth()).toThrow(/min 32 char/);
    expect(logger.warn).not.toHaveBeenCalled(); // hard error, bukan warning
  });

  it('produksi + secret kuat (≥ 32 char) → boot jalan (tidak throw + info log)', async () => {
    process.env.NODE_ENV = 'production';
    process.env.BETTER_AUTH_SECRET = 'x'.repeat(64);
    process.env.TURSO_DATABASE_URL = 'libsql://test.example.com';
    process.env.TURSO_AUTH_TOKEN = 'test-token';
    const { getAuth } = await loadAuthModule();
    expect(() => getAuth()).not.toThrow();
    expect(logger.info).toHaveBeenCalledWith(
      expect.anything(),
      'Better Auth siap dengan Google OAuth',
    );
  });

  it('dev + secret pendek → logger.warn eksplisit (bukan throw), boot tetap jalan', async () => {
    process.env.NODE_ENV = 'development';
    process.env.BETTER_AUTH_SECRET = 'short-secret'; // 12 char
    process.env.TURSO_DATABASE_URL = 'libsql://test.example.com';
    process.env.TURSO_AUTH_TOKEN = 'test-token';
    const { getAuth } = await loadAuthModule();
    expect(() => getAuth()).not.toThrow();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ isProduction: false, secretLength: 12 }),
      expect.stringContaining('terlalu pendek (min 32 char)'),
    );
  });

  it('dev + tanpa secret → warning fallback development (perilaku existing)', async () => {
    process.env.NODE_ENV = 'development';
    process.env.TURSO_DATABASE_URL = 'libsql://test.example.com';
    process.env.TURSO_AUTH_TOKEN = 'test-token';
    const { getAuth } = await loadAuthModule();
    expect(() => getAuth()).not.toThrow();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ isProduction: false }),
      expect.stringContaining('fallback secret development'),
    );
  });

  it('batas eksak: secret 32 char diterima (bukan weak)', async () => {
    process.env.NODE_ENV = 'production';
    process.env.BETTER_AUTH_SECRET = 'a'.repeat(32);
    process.env.TURSO_DATABASE_URL = 'libsql://test.example.com';
    process.env.TURSO_AUTH_TOKEN = 'test-token';
    const { getAuth } = await loadAuthModule();
    expect(() => getAuth()).not.toThrow();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('DEV_FALLBACK_SECRET sendiri panjangnya ≥ 32 (konstanta aman)', () => {
    expect(DEV_FALLBACK.length).toBeGreaterThanOrEqual(32);
  });
});

describe('auth.js — kontrak sesi eksplisit (session contract di-pin)', () => {
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

  it('session.expiresIn = 604800 (7 hari) — di-pin eksplisit, bukan default implisit', async () => {
    process.env.NODE_ENV = 'production';
    process.env.BETTER_AUTH_SECRET = 'x'.repeat(64);
    process.env.TURSO_DATABASE_URL = 'libsql://test.example.com';
    process.env.TURSO_AUTH_TOKEN = 'test-token';
    const { getAuth } = await loadAuthModule();
    getAuth();

    const session = optionsFor().session as Record<string, unknown>;
    expect(session.expiresIn).toBe(604800);
  });

  it('session.updateAge = 86400 (1 hari — rotasi token)', async () => {
    process.env.NODE_ENV = 'production';
    process.env.BETTER_AUTH_SECRET = 'x'.repeat(64);
    process.env.TURSO_DATABASE_URL = 'libsql://test.example.com';
    process.env.TURSO_AUTH_TOKEN = 'test-token';
    const { getAuth } = await loadAuthModule();
    getAuth();

    const session = optionsFor().session as Record<string, unknown>;
    expect(session.updateAge).toBe(86400);
  });

  it('session.cookieCache = { enabled: true, maxAge: 300 } (revokasi ≤ 5 mnt)', async () => {
    process.env.NODE_ENV = 'production';
    process.env.BETTER_AUTH_SECRET = 'x'.repeat(64);
    process.env.TURSO_DATABASE_URL = 'libsql://test.example.com';
    process.env.TURSO_AUTH_TOKEN = 'test-token';
    const { getAuth } = await loadAuthModule();
    getAuth();

    const session = optionsFor().session as Record<string, unknown>;
    expect(session.cookieCache).toEqual({ enabled: true, maxAge: 300 });
  });

  it('session.freshAge = 86400 (24 jam — semantik isFresh di-pin)', async () => {
    process.env.NODE_ENV = 'production';
    process.env.BETTER_AUTH_SECRET = 'x'.repeat(64);
    process.env.TURSO_DATABASE_URL = 'libsql://test.example.com';
    process.env.TURSO_AUTH_TOKEN = 'test-token';
    const { getAuth } = await loadAuthModule();
    getAuth();

    const session = optionsFor().session as Record<string, unknown>;
    expect(session.freshAge).toBe(86400);
  });

  it('kontrak lengkap: expiresIn + updateAge + freshAge + cookieCache eksis bersama (tanpa field lain yang menimpa)', async () => {
    process.env.NODE_ENV = 'development';
    process.env.TURSO_DATABASE_URL = 'libsql://test.example.com';
    process.env.TURSO_AUTH_TOKEN = 'test-token';
    const { getAuth } = await loadAuthModule();
    getAuth();

    const session = optionsFor().session as Record<string, unknown>;
    expect(session).toEqual({
      expiresIn: 604800,
      updateAge: 86400,
      freshAge: 86400,
      cookieCache: { enabled: true, maxAge: 300 },
    });
  });
});

describe('auth.js — basePath & cookiePrefix di-pin (kontrak mount/cookie)', () => {
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

  it('basePath = /api/auth — mount handler DI-PIN (index.js memount di path yang sama)', async () => {
    process.env.NODE_ENV = 'production';
    process.env.BETTER_AUTH_SECRET = 'x'.repeat(64);
    process.env.TURSO_DATABASE_URL = 'libsql://test.example.com';
    process.env.TURSO_AUTH_TOKEN = 'test-token';
    const { getAuth } = await loadAuthModule();
    getAuth();

    expect(optionsFor().basePath).toBe('/api/auth');
  });

  it('cookiePrefix = better-auth DI-PIN di advanced (bukan top-level) — nama cookie session_token (kontrak E2E/scripts)', async () => {
    process.env.NODE_ENV = 'production';
    process.env.BETTER_AUTH_SECRET = 'x'.repeat(64);
    process.env.TURSO_DATABASE_URL = 'libsql://test.example.com';
    process.env.TURSO_AUTH_TOKEN = 'test-token';
    const { getAuth } = await loadAuthModule();
    getAuth();

    // better-auth 1.6.25 membaca HANYA `options.advanced?.cookiePrefix`
    // (cookies/index.mjs:26) — opsi top-level TIDAK dikonsumsi runtime. Pin di
    // advanced agar benar-benar berfungsi. e2e/helpers/authContext.ts,
    // mintSession.ts dan 6+ script hard-code `better-auth.session_token`.
    const advanced = optionsFor().advanced as Record<string, unknown>;
    expect(advanced.cookiePrefix).toBe('better-auth');
    expect(optionsFor().cookiePrefix).toBeUndefined(); // top-level no-op — jangan dikembalikan
  });

  it('dev: basePath & cookiePrefix tetap eksplisit (bukan via default)', async () => {
    process.env.NODE_ENV = 'development';
    process.env.TURSO_DATABASE_URL = 'libsql://test.example.com';
    process.env.TURSO_AUTH_TOKEN = 'test-token';
    const { getAuth } = await loadAuthModule();
    getAuth();

    expect(optionsFor().basePath).toBe('/api/auth');
    const advanced = optionsFor().advanced as Record<string, unknown>;
    expect(advanced.cookiePrefix).toBe('better-auth');
  });
});

describe('auth.js — advanced options di-pin (origin/CSRF/subdomain cookies)', () => {
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

  it('disableOriginCheck = false — origin check AKTIF di semua env (termasuk prod)', async () => {
    process.env.NODE_ENV = 'production';
    process.env.BETTER_AUTH_SECRET = 'x'.repeat(64);
    process.env.TURSO_DATABASE_URL = 'libsql://test.example.com';
    process.env.TURSO_AUTH_TOKEN = 'test-token';
    const { getAuth } = await loadAuthModule();
    getAuth();

    // create-context.mjs:210 default skipOriginCheck = isTest() ? true : false
    // — eksplisit false menjaga proteksi tetap ON di produksi.
    expect(optionsFor().advanced).toMatchObject({ disableOriginCheck: false });
  });

  it('disableCSRFCheck = false — CSRF check AKTIF (lapisan kedua di atas Origin 403 middleware)', async () => {
    process.env.NODE_ENV = 'production';
    process.env.BETTER_AUTH_SECRET = 'x'.repeat(64);
    process.env.TURSO_DATABASE_URL = 'libsql://test.example.com';
    process.env.TURSO_AUTH_TOKEN = 'test-token';
    const { getAuth } = await loadAuthModule();
    getAuth();

    expect(optionsFor().advanced).toMatchObject({ disableCSRFCheck: false });
  });

  it('crossSubDomainCookies = { enabled: false } — cookie tidak dibagikan ke parent domain', async () => {
    process.env.NODE_ENV = 'production';
    process.env.BETTER_AUTH_SECRET = 'x'.repeat(64);
    process.env.TURSO_DATABASE_URL = 'libsql://test.example.com';
    process.env.TURSO_AUTH_TOKEN = 'test-token';
    const { getAuth } = await loadAuthModule();
    getAuth();

    expect(optionsFor().advanced).toMatchObject({
      crossSubDomainCookies: { enabled: false },
    });
  });

  it('kontrak advanced lengkap: secure cookies + cookiePrefix + httpOnly + sameSite lax + pin protection', async () => {
    process.env.NODE_ENV = 'development';
    process.env.TURSO_DATABASE_URL = 'libsql://test.example.com';
    process.env.TURSO_AUTH_TOKEN = 'test-token';
    const { getAuth } = await loadAuthModule();
    getAuth();

    // P3 (2026-08-11): state OAuth di-DATABASE (account.storeStateStrategy) —
    // root cause state_mismatch Freebuff Preview. State cookie terikat jar
    // browser yang menginisiasi; alur Freebuff (webview preview → redirect
    // Google di tab Chrome eksternal) memakai DUA jar terpisah → cookie state
    // tidak pernah sampai callback. State di DB (tabel verification, migration
    // 0001) tahan handoff browser; validasi tetap eksak (tampered/missing/
    // expired/replay → rejected). `advanced.storeStateStrategy` BUKAN dibaca
    // runtime (create-context.mjs:136 membaca options.account.storeStateStrategy)
    // — ditaruh di `account` tempat runtime benar-benar membacanya.
    expect(optionsFor().advanced).toEqual({
      useSecureCookies: false,
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', secure: false },
      cookiePrefix: 'better-auth',
      disableOriginCheck: false,
      disableCSRFCheck: false,
      crossSubDomainCookies: { enabled: false },
    });
  });

  it('account.storeStateStrategy = database + skipStateCookieCheck = true — state bertahan lintas cookie jar (Freebuff preview → Chrome eksternal)', async () => {
    process.env.NODE_ENV = 'development';
    process.env.TURSO_DATABASE_URL = 'libsql://test.example.com';
    process.env.TURSO_AUTH_TOKEN = 'test-token';
    const { getAuth } = await loadAuthModule();
    getAuth();

    const account = optionsFor().account as Record<string, unknown>;
    expect(account.storeStateStrategy).toBe('database');
    expect(account.skipStateCookieCheck).toBe(true);
    // Pengunci: `advanced.storeStateStrategy` TIDAK boleh muncul (no-op yang
    // menyesatkan — runtime membaca options.account.*) — regresi ke bentuk itu
    // menghidupkan kembali state_mismatch lintas-jar.
    expect(optionsFor().advanced).not.toHaveProperty('storeStateStrategy');
  });
});

describe('auth.js — rateLimit better-auth disabled (P1-2, express-rate-limit = source of truth)', () => {
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

  it('produksi + secret kuat → options berisi rateLimit: { enabled: false } (disable eksplisit)', async () => {
    process.env.NODE_ENV = 'production';
    process.env.BETTER_AUTH_SECRET = 'x'.repeat(64);
    process.env.TURSO_DATABASE_URL = 'libsql://test.example.com';
    process.env.TURSO_AUTH_TOKEN = 'test-token';
    const { getAuth } = await loadAuthModule();
    getAuth();

    // Di produksi better-auth 1.6.25 default rateLimit enabled (create-context
    // .mjs:171 `enabled: isProduction`) — menumpuk DI ATAS express-rate-limit
    // dengan format 429 berbeda. Eksplisit false = single source of truth.
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
