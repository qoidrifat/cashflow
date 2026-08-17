/**
 * E2E: Rate limiting guard — jalur AI (aiLimiter) + jalur umum (generalLimiter)
 * + jalur receipt (receiptLimiter).
 *
 * Audit P1-2 lanjutan: e2e/rate-limit.spec.ts hanya meng-guard authLimiter.
 * Spec ini menutup celah untuk SEMUA limiter lain di server/index.js yang
 * berbagi format 429 yang sama:
 *   - aiLimiter       (index.js:222)  → POST /api/gemini/* + /api/agent-search,
 *                                       message 'Terlalu banyak panggilan AI.'
 *   - generalLimiter  (index.js:198)  → SEMUA route API setelah auth,
 *                                       message 'Terlalu banyak request.'
 *   - receiptLimiter  (index.js:231)  → POST /api/ai/extract-receipt-image,
 *                                       message 'Terlalu banyak scan struk.'
 *
 * KETIGANYA dipasang SETELAH authMiddleware (index.js:303) → key per-USER
 * (rateKeyGen index.js:194: `u:<userId>`), beda dari authLimiter yang per-IP.
 *
 * PENTING (urutan middleware): request /api/gemini/* melewati generalLimiter
 * (index.js:310) DULU, baru aiLimiter (index.js:311); request
 * /api/ai/extract-receipt-image melewati generalLimiter DULU, baru
 * receiptLimiter (index.js:313). Agar asersi bisa MEMBEDAKAN limiter mana yang
 * 429 (format body keduanya sama), spec ini:
 *   1. RATE_LIMIT_AI_MAX (8) & RATE_LIMIT_RECEIPT_MAX (8) DI BAWAH
 *      RATE_LIMIT_GENERAL_MAX (20) di webServer 5182 → request ke-9 melewati
 *      general (budget 20 utuh) lalu 429 dari limiter spesifik. Asersi message
 *      ('panggilan AI' / 'scan struk') membuktikan limiter yang benar.
 *   2. User FRESH per attempt (email unik + mint di dalam test, bukan
 *      beforeAll): retries:1 me-re-run body test tapi BUKAN beforeAll — bila
 *      user di-mint sekali per run, attempt retry memakai user yang sama dengan
 *      budget general terpakai → 429 bisa datang dari generalLimiter dulu
 *      (message salah → flaky). Per-attempt = budget bersih setiap attempt,
 *      sekaligus menghapus varians "429 muncul lebih awal dari LIMIT+1".
 *
 * STALE SERVER 5182 (dialami 2026-08-09): run playwright yang terputus
 * (Ctrl+C/crash) meninggalkan `node server/index.js` di port 5182 dengan ENV
 * LAMA (RATE_LIMIT_AI_MAX belum di-set → default 120). reuseExistingServer:true
 * memakai server stale itu → test gagal first429At=-1. Fix lokal: kill proses
 * node di port 5182 lalu jalankan ulang spec. CI aman (VM fresh tiap run).
 * Catatan receipt: stale server TANPA RATE_LIMIT_RECEIPT_MAX (default 30 >
 * GENERAL_MAX 20) gagal dengan tanda BERBEDA — 429 datang dari generalLimiter
 * di request ~21 (message 'Terlalu banyak request', bukan 'scan struk').
 *
 * Body request AI sengaja TIDAK VALID ({} tanpa month/year) → 400
 * MISSING_REPORT_DATA via validasi — request tetap dihitung limiter (middleware
 * berjalan sebelum route) TANPA memanggil Gemini (murah & deterministik).
 * Body receipt juga TIDAK VALID ({} tanpa image) → 400 MISSING_IMAGE via
 * validasi route — tetap dihitung limiter tanpa multipart upload / Gemini
 * (menutup gap terbuka RATE_LIMITING.md §7: receiptLimiter belum punya guard).
 * Catatan coupling: body {} mengandalkan month/year TETAP wajib di
 * geminiRoutes (di-lock geminiRoutesValidationG3.test.ts) & image wajib di
 * extract-receipt-image (di-lock unit validation). Bila validasi dilonggarkan,
 * request akan memanggil Gemini sungguhan (lambat/berbiaya).
 *
 * Menjalankan:
 *   npx playwright test e2e/rate-limit-ai-general.spec.ts
 *   npm run test:e2e:ratelimit   (keluarga limiter: auth + AI + general + receipt)
 */
import { test, expect, type APIRequestContext, type APIResponse } from 'playwright/test';
import { mintSessionCookieForEmail, cleanupRateLimitUsers } from './helpers/mintSession';

/** Server uji rate-limit terpisah (lihat playwright.config.ts webServer ketiga). */
const RL_API_BASE = 'http://localhost:5182';

/**
 * Harus SINKRON dengan env webServer 5182 di playwright.config.ts
 * (RATE_LIMIT_AI_MAX / RATE_LIMIT_GENERAL_MAX). Bila limit diubah di config,
 * ubah konstanta ini juga (coupling sengaja, pola e2e/rate-limit.spec.ts).
 */
const AI_LIMIT = 8;
const GENERAL_LIMIT = 20;
const RECEIPT_LIMIT = 8;
const AI_MAX_ATTEMPTS = AI_LIMIT + 5; // 429 pasti muncul ≤ LIMIT+1 dari state budget mana pun
const GENERAL_MAX_ATTEMPTS = GENERAL_LIMIT + 5;
const RECEIPT_MAX_ATTEMPTS = RECEIPT_LIMIT + 5;

/** Pesan 429 per limiter (server/index.js rlMessage) — pembeda limiter mana yang 429. */
const AI_429_MESSAGE_FRAGMENT = 'panggilan AI';
const GENERAL_429_MESSAGE_FRAGMENT = 'Terlalu banyak request';
const RECEIPT_429_MESSAGE_FRAGMENT = 'scan struk';

/**
 * Email user UNIK per panggilan (per-attempt) → budget per-user selalu bersih
 * walau run/attempt sebelumnya crash (rolling window 15 mnt tak bisa di-reset).
 * afterEach/cleanup menghapus user+sesi persis email ini.
 */
function rlUserEmail(role: 'ai' | 'gen' | 'receipt'): string {
  return `e2e-rl-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@cashflow.test`;
}

/** Body 429 draft-7 express-rate-limit: { ok:false, code:'RATE_LIMITED', message }. */
interface RateLimitedBody {
  ok?: boolean;
  code?: string;
  message?: string;
}

interface First429Capture {
  at: number; // request ke berapa 429 pertama muncul; -1 = tidak pernah
  gotRateLimitedBody: boolean;
  message: string;
  hasRetryAfter: boolean;
  hasRateLimitHeader: boolean;
}

/** Kirim request berulang sampai 429 atau maxAttempts; kumpulkan metadata 429. */
async function captureFirst429(
  ctx: APIRequestContext,
  send: () => Promise<APIResponse>,
  maxAttempts: number,
): Promise<First429Capture> {
  const out: First429Capture = {
    at: -1,
    gotRateLimitedBody: false,
    message: '',
    hasRetryAfter: false,
    hasRateLimitHeader: false,
  };
  for (let i = 1; i <= maxAttempts; i++) {
    const resp = await send();
    if (resp.status() === 429) {
      out.at = i;
      out.hasRetryAfter = resp.headers()['retry-after'] !== undefined;
      // Draft-7 express-rate-limit memakai header GABUNGAN `ratelimit`
      // ("limit=.., remaining=.., reset=..") — BUKAN ratelimit-limit (draft-6).
      out.hasRateLimitHeader = !!Object.keys(resp.headers()).find(
        (h) => h.toLowerCase() === 'ratelimit',
      );
      try {
        const body = (await resp.json()) as RateLimitedBody;
        out.gotRateLimitedBody = body?.ok === false && body?.code === 'RATE_LIMITED';
        out.message = body?.message || '';
      } catch {
        out.gotRateLimitedBody = false; // non-JSON (HTML) → guard gagal
      }
      break;
    }
  }
  return out;
}

test.describe('Rate limiting jalur AI + umum (e2e)', () => {
  test('aiLimiter: POST /api/gemini/* → 429 RATE_LIMITED (message panggilan AI) + draft-7 headers', async ({ playwright }) => {
    const email = rlUserEmail('ai');
    const { cookie } = await mintSessionCookieForEmail(email);
    // Context API terpisah dengan baseURL 5182 (pola rate-limit.spec.ts):
    // fixture `request` terikat 5180 → tidak boleh dipakai di sini.
    const ctx = await playwright.request.newContext({
      baseURL: RL_API_BASE,
      extraHTTPHeaders: { cookie: `better-auth.session_token=${cookie}` },
    });
    try {
      // Body {} → 400 MISSING_REPORT_DATA (month/year wajib) — validasi murah
      // di dalam route; request dihitung oleh limiter middleware terlebih dulu.
      const got = await captureFirst429(
        ctx,
        () => ctx.post('/api/gemini/monthly-report', { data: {} }),
        AI_MAX_ATTEMPTS,
      );

      expect(
        got.at,
        `429 harus tercapai dalam ≤ ${AI_LIMIT + 1} POST /api/gemini/* (limit AI ${AI_LIMIT}/15m). ` +
          'Bila -1, aiLimiter mati/di-hapus ATAU server 5182 stale dengan env lama — ' +
          '(cek RATE_LIMIT_ENABLED & RATE_LIMIT_AI_MAX di server/index.js + webServer 5182; kill proses node di 5182 lalu re-run).',
      ).toBeGreaterThan(0);
      expect(
        got.at,
        `429 muncul di request ke-${got.at} — melebihi limit ${AI_LIMIT}+1. ` +
          'Limit naik diam-diam? Sinkronkan AI_LIMIT dengan RATE_LIMIT_AI_MAX di playwright.config.ts.',
      ).toBeLessThanOrEqual(AI_LIMIT + 1);
      expect(
        got.message,
        'message 429 harus dari aiLimiter ("panggilan AI") — membuktikan aiLimiter (bukan generalLimiter) yang memblokir. ' +
          'Bila message general "Terlalu banyak request", urutan/limit rusak: AI_LIMIT harus < RATE_LIMIT_GENERAL_MAX.',
      ).toContain(AI_429_MESSAGE_FRAGMENT);
      expect(
        got.gotRateLimitedBody,
        'body 429 harus JSON { ok: false, code: "RATE_LIMITED" } — bukan HTML/plain text',
      ).toBe(true);
      expect(got.hasRetryAfter, 'header Retry-After harus ada pada respons 429 (draft-7)').toBe(true);
      expect(
        got.hasRateLimitHeader,
        'header `ratelimit` (draft-7 gabungan) harus ada pada respons 429 — standardHeaders draft-7 aktif',
      ).toBe(true);
    } finally {
      await ctx.dispose();
      await cleanupRateLimitUsers([email]);
    }
  });

  test('generalLimiter: GET /api/transactions → 429 RATE_LIMITED (message umum) + /api/health tetap 200 (skip)', async ({ playwright }) => {
    const email = rlUserEmail('gen');
    const { cookie } = await mintSessionCookieForEmail(email);
    const ctx = await playwright.request.newContext({
      baseURL: RL_API_BASE,
      extraHTTPHeaders: { cookie: `better-auth.session_token=${cookie}` },
    });
    try {
      const got = await captureFirst429(
        ctx,
        () => ctx.get('/api/transactions?limit=5'),
        GENERAL_MAX_ATTEMPTS,
      );

      expect(
        got.at,
        `429 harus tercapai dalam ≤ ${GENERAL_LIMIT + 1} GET /api/transactions (limit general ${GENERAL_LIMIT}/15m). ` +
          'Bila -1, generalLimiter mati/di-hapus ATAU server 5182 stale dengan env lama — ' +
          '(cek RATE_LIMIT_ENABLED & RATE_LIMIT_GENERAL_MAX di server/index.js + webServer 5182; kill proses node di 5182 lalu re-run).',
      ).toBeGreaterThan(0);
      expect(
        got.at,
        `429 muncul di request ke-${got.at} — melebihi limit ${GENERAL_LIMIT}+1. ` +
          'Limit naik diam-diam? Sinkronkan GENERAL_LIMIT dengan RATE_LIMIT_GENERAL_MAX di playwright.config.ts.',
      ).toBeLessThanOrEqual(GENERAL_LIMIT + 1);
      expect(
        got.message,
        'message 429 harus dari generalLimiter ("Terlalu banyak request") — membuktikan generalLimiter yang memblokir. ' +
          'User general terpisah dari user AI → tidak boleh 429 dari aiLimiter.',
      ).toContain(GENERAL_429_MESSAGE_FRAGMENT);
      expect(
        got.gotRateLimitedBody,
        'body 429 harus JSON { ok: false, code: "RATE_LIMITED" } — bukan HTML/plain text',
      ).toBe(true);
      expect(got.hasRetryAfter, 'header Retry-After harus ada pada respons 429 (draft-7)').toBe(true);
      expect(
        got.hasRateLimitHeader,
        'header `ratelimit` (draft-7 gabungan) harus ada pada respons 429 — standardHeaders draft-7 aktif',
      ).toBe(true);

      // Skip generalLimiter: /api/health di-skip (index.js:205) — probe health
      // tidak boleh diblokir walau budget umum user habis.
      const healthResp = await ctx.get('/api/health');
      expect(
        healthResp.status(),
        'GET /api/health harus tetap 200 walau budget umum habis (skip di generalLimiter)',
      ).toBe(200);
    } finally {
      await ctx.dispose();
      await cleanupRateLimitUsers([email]);
    }
  });

  test('receiptLimiter: POST /api/ai/extract-receipt-image → 429 RATE_LIMITED (message scan struk) + draft-7 headers', async ({ playwright }) => {
    const email = rlUserEmail('receipt');
    const { cookie } = await mintSessionCookieForEmail(email);
    const ctx = await playwright.request.newContext({
      baseURL: RL_API_BASE,
      extraHTTPHeaders: { cookie: `better-auth.session_token=${cookie}` },
    });
    try {
      // Body {} (tanpa image) → 400 MISSING_IMAGE via validasi route — request
      // tetap dihitung oleh receiptLimiter (middleware berjalan sebelum route),
      // tanpa multipart upload & tanpa memanggil Gemini (murah & deterministik;
      // menutup gap terbuka RATE_LIMITING.md §7).
      const got = await captureFirst429(
        ctx,
        () => ctx.post('/api/ai/extract-receipt-image', { data: {} }),
        RECEIPT_MAX_ATTEMPTS,
      );

      expect(
        got.at,
        `429 harus tercapai dalam ≤ ${RECEIPT_LIMIT + 1} POST /api/ai/extract-receipt-image (limit receipt ${RECEIPT_LIMIT}/15m). ` +
          'Bila -1, receiptLimiter mati/di-hapus ATAU server 5182 stale dengan env lama — ' +
          '(cek RATE_LIMIT_ENABLED & RATE_LIMIT_RECEIPT_MAX di server/index.js + webServer 5182; kill proses node di 5182 lalu re-run).',
      ).toBeGreaterThan(0);
      expect(
        got.at,
        `429 muncul di request ke-${got.at} — melebihi limit ${RECEIPT_LIMIT}+1. ` +
          'Limit naik diam-diam? Sinkronkan RECEIPT_LIMIT dengan RATE_LIMIT_RECEIPT_MAX di playwright.config.ts.',
      ).toBeLessThanOrEqual(RECEIPT_LIMIT + 1);
      expect(
        got.message,
        'message 429 harus dari receiptLimiter ("scan struk") — membuktikan receiptLimiter (bukan generalLimiter) yang memblokir. ' +
          'Bila message general "Terlalu banyak request", urutan/limit rusak: RECEIPT_LIMIT harus < RATE_LIMIT_GENERAL_MAX.',
      ).toContain(RECEIPT_429_MESSAGE_FRAGMENT);
      expect(
        got.gotRateLimitedBody,
        'body 429 harus JSON { ok: false, code: "RATE_LIMITED" } — bukan HTML/plain text',
      ).toBe(true);
      expect(got.hasRetryAfter, 'header Retry-After harus ada pada respons 429 (draft-7)').toBe(true);
      expect(
        got.hasRateLimitHeader,
        'header `ratelimit` (draft-7 gabungan) harus ada pada respons 429 — standardHeaders draft-7 aktif',
      ).toBe(true);
    } finally {
      await ctx.dispose();
      await cleanupRateLimitUsers([email]);
    }
  });
});
