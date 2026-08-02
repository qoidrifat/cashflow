/**
 * E2E: Rate limiting guard — POST /api/auth/* → 429 setelah limit.
 *
 * Regression guard untuk Sprint 1.1 (express-rate-limit di server/index.js):
 *   - authLimiter: HANYA POST yang dihitung. GET session-check (dipanggil SPA
 *     setiap page-load) di-skip — fix yang mencegah 25 test E2E membunuh IP
 *     sendiri via session-read (akar flaky Sprint 1, lihat STABILITY_REPORT).
 *   - Body 429: { ok: false, code: 'RATE_LIMITED', ... } (JSON, bukan HTML).
 *   - Header Retry-After + `ratelimit` (format gabungan draft-7).
 *
 * SERVER UJI KHUSUS di port 5182 (webServer ketiga di playwright.config.ts):
 *   - RATE_LIMIT_AUTH_MAX=25 → test cepat & deterministik (≤26 request, bukan
 *     121 default) dan RATE_LIMIT_ENABLED=true dipaksa (anti CI mis-set false).
 *   - ISOLASI: auth limiter di-key per-IP (req.user belum ada di route auth) —
 *     semua test E2E datang dari 127.0.0.1, jadi tanpa server terpisah spec ini
 *     akan menguras budget IP bersama yang dipakai spec lain.
 *
 * Assertion BEHAVIORAL (bukan posisi persis) — window 15 menit bersifat rolling
 * dan tidak bisa di-reset dari luar: run berurutan bisa memulai dengan budget
 * sudah terpakai (429 muncul lebih awal). Yang di-guard:
 *   1. 429 TERCAPAI dalam ≤ LIMIT+1 request → limiter aktif & membatasi
 *      (kalau limiter dimatikan/di-hapus, 429 tidak pernah muncul → gagal).
 *   2. Body 429 = RATE_LIMITED JSON (format yang diandalkan frontend).
 *   3. Header Retry-After + `ratelimit` (draft-7 gabungan) ada.
 *   4. GET /api/auth/get-session TETAP 200 walau POST sudah 429 → membuktikan
 *      skip-GET (regresi paling kritis yang guard ini jaga).
 *
 * Menjalankan:
 *   npx playwright test e2e/rate-limit.spec.ts
 *   npm run test:e2e:ratelimit
 */
import { test, expect } from 'playwright/test';

/** Server uji rate-limit terpisah (lihat playwright.config.ts webServer ketiga). */
const RL_API_BASE = 'http://localhost:5182';

/**
 * Harus SINKRON dengan RATE_LIMIT_AUTH_MAX di playwright.config.ts webServer
 * ke-3. Bila limit diubah di config, ubah konstanta ini juga (coupling sengaja,
 * supaya regresi "limit terangkat diam-diam" ikut terdeteksi).
 */
const AUTH_LIMIT = 25;
const MAX_ATTEMPTS = AUTH_LIMIT + 5; // 429 pasti muncul ≤ LIMIT+1 dari state budget mana pun

test.describe('Rate limiting POST /api/auth/* (e2e)', () => {
  test('429 setelah limit: body RATE_LIMITED + Retry-After, dan GET session tetap 200', async ({ playwright }) => {
    // Context API terpisah dengan baseURL 5182 — fixture `request` sudah terikat
    // ke baseURL 5180 (vite proxy → 5181) dan TIDAK boleh dipakai di sini
    // (akan menguras budget IP bersama & tidak mengenai server uji).
    const ctx = await playwright.request.newContext({ baseURL: RL_API_BASE });

    try {
      let first429At = -1;
      let gotRateLimitedBody = false;
      let hasRetryAfter = false;
      let hasRateLimitHeader = false;

      for (let i = 1; i <= MAX_ATTEMPTS; i++) {
        // Di bawah limit → 302/404 (route OAuth); setelah limit → 429. Limiter
        // menghitung sebelum routing. Catatan: Playwright mengikuti redirect
        // (302 → Google) — respons akhir tidak lagi membawa header limiter,
        // jadi verifikasi draft-7 header dilakukan pada respons 429 (tanpa
        // redirect) yang PASTI membawa ratelimit-* + retry-after.
        const resp = await ctx.post('/api/auth/sign-in/google');
        if (resp.status() === 429) {
          first429At = i;
          hasRetryAfter = resp.headers()['retry-after'] !== undefined;
          // Draft-7 express-rate-limit 7.5.1 memakai format GABUNGAN:
          // header `ratelimit` ("limit=25, remaining=0, reset=...") +
          // `ratelimit-policy` — BUKAN ratelimit-limit (itu format draft-6).
          hasRateLimitHeader = !!Object.keys(resp.headers()).find(
            (h) => h.toLowerCase() === 'ratelimit',
          );
          try {
            const body = (await resp.json()) as { ok?: boolean; code?: string };
            gotRateLimitedBody = body?.ok === false && body?.code === 'RATE_LIMITED';
          } catch {
            gotRateLimitedBody = false; // non-JSON (HTML) → guard gagal
          }
          break;
        }
      }

      expect(
        first429At,
        `429 harus tercapai dalam ≤ ${AUTH_LIMIT + 1} POST (limit auth ${AUTH_LIMIT}/15m). ` +
          'Bila -1, limiter mati/di-hapus (cek RATE_LIMIT_ENABLED & RATE_LIMIT_AUTH_MAX di server/index.js + webServer 5182).',
      ).toBeGreaterThan(0);
      expect(
        first429At,
        `429 muncul di request ke-${first429At} — melebihi limit ${AUTH_LIMIT}+1. ` +
          'Limit naik diam-diam? Sinkronkan AUTH_LIMIT di spec ini dengan RATE_LIMIT_AUTH_MAX di playwright.config.ts.',
      ).toBeLessThanOrEqual(AUTH_LIMIT + 1);
      expect(
        gotRateLimitedBody,
        'body 429 harus JSON { ok: false, code: "RATE_LIMITED" } — bukan HTML/plain text',
      ).toBe(true);
      expect(hasRetryAfter, 'header Retry-After harus ada pada respons 429 (draft-7)').toBe(true);
      expect(
        hasRateLimitHeader,
        'header `ratelimit` (draft-7 gabungan) harus ada pada respons 429 — standardHeaders draft-7 aktif',
      ).toBe(true);

      // Regresi paling kritis: GET session-check TIDAK boleh kena limiter (skip
      // GET). /api/auth/get-session adalah endpoint yang dipanggil SPA via
      // authClient.getSession() tiap page-load/poll — inilah motif fix POST-only
      // di Sprint 1 (25 test E2E menguras budget via session-read).
      const getResp = await ctx.get('/api/auth/get-session');
      expect(
        getResp.status(),
        'GET /api/auth/get-session harus tetap 200 walau budget POST sudah habis (skip GET di authLimiter)',
      ).toBe(200);
    } finally {
      await ctx.dispose();
    }
  });
});
