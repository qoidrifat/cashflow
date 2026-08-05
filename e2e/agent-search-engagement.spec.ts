/**
 * E2E: Panel "AI Search Engagement" di Admin Monitoring (Sprint 1.9).
 *
 * Regression guard untuk:
 *   1. Endpoint GET /api/admin/metrics/agent-search-engagement —
 *      auth gate (401 tanpa cookie, 200 + shape lengkap dengan cookie admin).
 *   2. UI panel di /admin/monitoring: heading, stat labels (Klik Hasil /
 *      Suggestion Dipakai / CTR) ATAU EmptyMini data kosong — tanpa pageerror.
 *
 * Catatan anti-flaky:
 *   - Nilai numerik (searches/clicks/ctr) bergantung usage runtime → hanya
 *     shape yang di-assert (angka, rentang ctr 0..1), bukan nilai spesifik.
 *   - loadAll memakai Promise.all 6 fetch; blip Turso transient bisa membuat
 *     satu fetch gagal → error card. Strategi: retry navigasi maks 3× bila
 *     panel belum tampil (pola admin-cache.spec.ts).
 *   - Panel data boleh kosong: bila belum ada agent_search_* di window, panel
 *     menampilkan EmptyMini — assertion menerima KEDUA bentuk.
 *
 * Menjalankan:
 *   npx playwright test e2e/agent-search-engagement.spec.ts
 *   npm run test:e2e:agent-search-engagement
 *
 * CATATAN: endpoint ini baru (Sprint 1.9) — dev server lokal yang dijalankan
 * dengan `node server/index.js` (TANPA --watch) perlu di-restart agar memuat
 * route baru; bila tidak, test 1 (401) & 2 (shape) melihat 404 dan gagal di
 * lokal. Full pass dijamin di CI (server fresh).
 */
import { test, expect, type APIRequestContext, type APIResponse } from 'playwright/test';
import { mintSessionCookie, cleanupTestSessions, type MintedSession } from './helpers/mintSession';
import { setupAuthContext } from './helpers/authContext';
import { collectPageErrors } from './helpers/errors';

const ENGAGEMENT_ENDPOINT = '/api/admin/metrics/agent-search-engagement';

/** GET ke endpoint engagement dengan atau tanpa cookie (relative → via baseURL/proxy). */
async function getEngagement(request: APIRequestContext, cookie?: string): Promise<APIResponse> {
  return request.get(ENGAGEMENT_ENDPOINT, {
    headers: cookie ? { Cookie: `better-auth.session_token=${cookie}` } : {},
  });
}

/** Validasi shape response engagement: field numerik + array + ctr 0..1. */
async function expectEngagementShape(body: Record<string, unknown>): Promise<void> {
  expect(body.ok, 'ok harus true').toBe(true);
  for (const key of ['searches', 'clicks', 'suggestionsUsed', 'ctr']) {
    expect(typeof body[key], `${key} harus number`).toBe('number');
  }
  expect(Array.isArray(body.topSuggestedQueries), 'topSuggestedQueries harus array').toBe(true);
  expect(Array.isArray(body.clicksByTab), 'clicksByTab harus array').toBe(true);
  expect(Array.isArray(body.suggestionsByTab), 'suggestionsByTab harus array').toBe(true);
  const ctr = body.ctr as number;
  expect(ctr, 'ctr harus 0..1').toBeGreaterThanOrEqual(0);
  expect(ctr, 'ctr harus 0..1').toBeLessThanOrEqual(1);
}

test.describe('Admin AI Search Engagement panel (e2e)', () => {
  let session: MintedSession;

  test.beforeAll(async () => {
    session = await mintSessionCookie();
  });

  test.afterAll(async () => {
    await cleanupTestSessions();
  });

  test.beforeEach(async ({ context }) => {
    await setupAuthContext(context, session);
  });

  test('tanpa cookie: /api/admin/metrics/agent-search-engagement → 401 (bukan 500) — auth gate bekerja', async ({ request }) => {
    const resp = await getEngagement(request);
    expect(resp.status(), 'tanpa cookie harus 401').toBe(401);
  });

  test('dengan cookie admin: endpoint → 200 + ok + shape lengkap (4 field numeric + 3 array, ctr 0..1)', async ({ request }) => {
    await expect
      .poll(
        async () => {
          const resp = await getEngagement(request, session.cookie);
          if (resp.status() !== 200) return false;
          let body: Record<string, unknown> = {};
          try {
            body = (await resp.json()) as Record<string, unknown>;
          } catch {
            return false;
          }
          return body.ok === true && typeof body.ctr === 'number';
        },
        { timeout: 10_000, intervals: [150, 300, 600, 1200], message: 'engagement endpoint harus 200 + ok setelah blip transient' },
      )
      .toBe(true);

    const final = await getEngagement(request, session.cookie);
    expect(final.status()).toBe(200);
    await expectEngagementShape((await final.json()) as Record<string, unknown>);
  });

  test('panel AI Search Engagement render: heading + (stat labels ATAU EmptyMini) — tanpa pageerror', async ({ page }) => {
    const pageErrors = collectPageErrors(page);

    const panelHeading = page.getByRole('heading', { name: 'AI Search Engagement' });
    for (let attempt = 0; attempt < 3; attempt++) {
      await page.goto('/admin/monitoring', { waitUntil: 'domcontentloaded' });
      await expect(panelHeading).toBeVisible({ timeout: 6000 }).catch(() => {});
      if (await panelHeading.isVisible()) break;
    }
    await expect(panelHeading).toBeVisible({ timeout: 20_000 });

    // Data boleh kosong — stat labels ATAU EmptyMini keduanya valid.
    const hasStats = await page.getByText('Klik Hasil').isVisible().catch(() => false);
    const hasEmpty = await page.getByText('Belum ada data engagement AI Search').isVisible().catch(() => false);
    expect(hasStats || hasEmpty, 'panel harus menampilkan stat ATAU EmptyMini data kosong').toBe(true);

    pageErrors.expectClean();
  });
});
