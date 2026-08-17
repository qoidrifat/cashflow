/**
 * P0.8 — OAuth Session Host-Consistency regression.
 *
 * ROOT CAUSE (P0.8, dibuktikan forensik): origin frontend `http://127.0.0.1:5180`
 * dianggap browser sebagai CROSS-SITE terhadap backend `http://localhost:5181`.
 * Cookie session Better Auth (`SameSite=Lax`, host-only `localhost`) DITAHAN browser
 * saat fetch subrequest lintas-site → `get-session` kembali `null` → user dilempar
 * balik `/login`.
 *
 * Dua control (negatif + positif) membuktikan mekanisme (bukan asumsi):
 *   [127.0.0.1 origin] fetch → localhost:5181 ⇒ Cookie TIDAK dikirim (cross-site)
 *   [localhost  origin] fetch → localhost:5181 ⇒ Cookie DIKIRIM       (same-site)
 *
 * Test ini mereplikasi control tersebut secara deterministik — tanpa sekret, tanpa
 * Google nyata. Ia meng-*lock* INVARIANT transport yang jadi akar kegagalan user:
 * hanya flow same-site `localhost` yang mengizinkan session cookie mengalir.
 *
 * Menjalankan (membutuhkan backend turun dengan secure-cookie dev di localhost):
 *   npx playwright test -c playwright.e2e-local.config.mjs -g "host consistency" e2e/oauth-session-host-consistency.spec.ts
 */
import { test, expect } from 'playwright/test';

const API_CANONICAL = 'http://localhost:5181';
const FRONT_CANONICAL = 'http://localhost:5180';
const FRONT_NONCANONICAL = 'http://127.0.0.1:5180';

test.describe('P0.8 host consistency — SameSite cookie transport (deterministic, no secret)', () => {
  test('positive control: origin localhost → API localhost ⇒ cookie dikirim (same-site)', async ({ context }) => {
    const page = await context.newPage();
    // peroleh cookie real host-only `localhost` dari initiation OAuth (non-secret: better-auth.state)
    await context.request.post(`${API_CANONICAL}/api/auth/sign-in/social`, {
      headers: { 'Content-Type': 'application/json', 'Origin': FRONT_CANONICAL },
      data: { provider: 'google', callbackURL: `${FRONT_CANONICAL}/auth/callback` },
    });
    const cks = await context.cookies(API_CANONICAL);
    expect(cks.some((c) => c.sameSite === 'Lax')).toBeTruthy();
    expect(cks.some((c) => c.name === 'better-auth.state')).toBeTruthy();

    // halaman di localhost (same-site), fetch ke API localhost
    await page.goto(`${FRONT_CANONICAL}/login`, { waitUntil: 'load' });
    let sent = '';
    await context.route('**/get-session', (route) => {
      sent = route.request().headers()['cookie'] || '';
      route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    await page.evaluate((u) => fetch(`${u}/api/auth/get-session`, { credentials: 'include' }), API_CANONICAL);
    expect(sent.toLowerCase()).toContain('better-auth');
  });

  test('negative control: origin 127.0.0.1 → API localhost ⇒ cookie TIDAK dikirim (cross-site)', async ({ context }) => {
    const page = await context.newPage();
    await context.request.post(`${API_CANONICAL}/api/auth/sign-in/social`, {
      headers: { 'Content-Type': 'application/json', 'Origin': FRONT_CANONICAL },
      data: { provider: 'google', callbackURL: `${FRONT_CANONICAL}/auth/callback` },
    });

    // halaman di 127.0.0.1 (cross-site), fetch ke API localhost — cookie Lax ditarik brotowser
    await page.goto(`${FRONT_NONCANONICAL}/login`, { waitUntil: 'load' });
    let sent = '';
    await context.route('**/get-session', (route) => {
      sent = route.request().headers()['cookie'] || '';
      route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    await page.evaluate((u) => fetch(`${u}/api/auth/get-session`, { credentials: 'include' }), API_CANONICAL);
    expect(sent.toLowerCase()).not.toContain('better-auth');
  });
});
