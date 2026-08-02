/**
 * E2E: Panel "AI Response Cache" di halaman Admin Monitoring (Sprint 3 LRU cache).
 *
 * Regression guard untuk:
 *   1. Endpoint GET /api/admin/metrics/cache (getAICacheStats + hitRate) —
 *      auth gate (401 tanpa cookie, 200 + shape lengkap dengan cookie admin).
 *   2. UI panel di /admin/monitoring: judul, label "Hit Rate", progress bar,
 *      dan 4 stat (Hits/Misses/Tersimpan/Evictions) — tanpa pageerror.
 *   3. Nilai hit rate yang ditampilkan VALID: "—" (belum ada aktivitas cache,
 *      fresh server restart = stats in-process kosong) ATAU "NN%" — keduanya
 *      benar; yang di-assert adalah bentuknya, bukan angka spesifik (nilai
 *      aktual bergantung usage runtime, bukan deterministik).
 *
 * Catatan anti-flaky: loadAll halaman memakai Promise.all 5 fetch; blip Turso
 * transient (P0.1 authMiddleware) bisa membuat satu fetch gagal → error card →
 * panel tak muncul. Strategi: retry navigasi maks 3× bila panel belum tampil
 * (pola sama dengan expect.poll di spec lain — strict pada end-state, toleran
 * pada blip sesaat).
 *
 * Menjalankan:
 *   npx playwright test e2e/admin-cache.spec.ts
 *   npm run test:e2e:admin-cache
 */
import { test, expect, type APIRequestContext, type APIResponse } from 'playwright/test';
import { mintSessionCookie, cleanupTestSessions, type MintedSession } from './helpers/mintSession';
import { setupAuthContext } from './helpers/authContext';
import { collectPageErrors } from './helpers/errors';
import { adminCacheContract } from './contract/contracts';

const CACHE_ENDPOINT = '/api/admin/metrics/cache';

/** GET ke endpoint cache dengan atau tanpa cookie (relative → via baseURL/proxy). */
async function getCache(
  request: APIRequestContext,
  cookie?: string,
): Promise<APIResponse> {
  return request.get(CACHE_ENDPOINT, {
    headers: cookie ? { Cookie: `better-auth.session_token=${cookie}` } : {},
  });
}

/**
 * Validasi shape lengkap response cache — REUSE kontrak adminCacheContract
 * (satu sumber kebenaran shape) + cek rentang hitRate 0..1 yang tidak dicakup
 * kontrak.
 */
async function expectCacheShape(body: Record<string, unknown>): Promise<void> {
  expect(adminCacheContract.validate(body), adminCacheContract.describe()).toBe(true);
  const hitRate = body.hitRate as number;
  expect(hitRate, 'hitRate harus 0..1').toBeGreaterThanOrEqual(0);
  expect(hitRate, 'hitRate harus 0..1').toBeLessThanOrEqual(1);
}

test.describe('Admin AI Response Cache panel (e2e)', () => {
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

  test('tanpa cookie: /api/admin/metrics/cache → 401 (bukan 500) — auth gate bekerja', async ({ request }) => {
    const resp = await getCache(request);
    expect(resp.status(), 'tanpa cookie harus 401').toBe(401);
  });

  test('dengan cookie admin: /api/admin/metrics/cache → 200 + ok + shape lengkap (8 field numeric)', async ({ request }) => {
    await expect
      .poll(
        async () => {
          const resp = await getCache(request, session.cookie);
          if (resp.status() !== 200) return false;
          let body: Record<string, unknown> = {};
          try {
            body = (await resp.json()) as Record<string, unknown>;
          } catch {
            return false;
          }
          return body.ok === true && typeof body.hitRate === 'number';
        },
        { timeout: 10_000, intervals: [150, 300, 600, 1200], message: 'cache endpoint harus 200 + ok setelah blip transient' },
      )
      .toBe(true);

    const final = await getCache(request, session.cookie);
    expect(final.status()).toBe(200);
    await expectCacheShape((await final.json()) as Record<string, unknown>);
  });

  test('panel AI Response Cache render: judul, Hit Rate bar, 4 stat, nilai valid — tanpa pageerror', async ({ page }) => {
    const pageErrors = collectPageErrors(page);

    // Retry navigasi maks 3× — blip Turso transient bisa menjatuhkan satu fetch
    // di loadAll → error card (bukan bug UI). Strict pada end-state: panel tampil.
    // Tiap attempt MENUNGGU panel render (loadAll = 5 fetch paralel → tidak
    // instan setelah domcontentloaded), bukan cek isVisible seketika.
    const panelHeading = page.getByRole('heading', { name: 'AI Response Cache' });
    for (let attempt = 0; attempt < 3; attempt++) {
      await page.goto('/admin/monitoring', { waitUntil: 'domcontentloaded' });
      await expect(panelHeading).toBeVisible({ timeout: 6000 }).catch(() => {});
      if (await panelHeading.isVisible()) break;
    }
    await expect(panelHeading).toBeVisible({ timeout: 20_000 });

    // Tidak ada error card (401/403/500)
    await expect(
      page.getByText('Tidak dapat memuat data monitoring').or(page.getByText('Akses ditolak')),
    ).toHaveCount(0);

    // Label "Hit Rate" + progress bar (baris mint/amber — keduanya valid)
    await expect(page.getByText('Hit Rate', { exact: true })).toBeVisible();

    // Nilai hit rate: "—" (belum ada aktivitas) ATAU "NN%" — keduanya valid.
    // DI-SCOPE ke container panel (label "Hit Rate" + nilai ada di flex yang
    // sama) — bukan getByText global yang bisa match '%' lain di halaman.
    const hitValue = page.getByText('Hit Rate', { exact: true }).locator('..').getByText(/(\d+%|—)/);
    await expect(hitValue).toBeVisible();

    // 4 stat panel
    for (const stat of ['Hits', 'Misses', 'Tersimpan', 'Evictions']) {
      await expect(page.getByText(stat, { exact: true })).toBeVisible();
    }

    // Progress bar (mint ≥50% / amber <50% — keduanya valid). CATATAN: bar
    // ber-width 0% saat hitRate 0 (cache kosong fresh restart) → Playwright
    // menganggap elemen width-0 'hidden' → assert via toHaveCount (attached),
    // bukan toBeVisible (bar selalu ada di DOM, lebarnya bervariasi oleh data).
    await expect(page.locator('.bg-mint-500, .bg-amber-500').first()).toHaveCount(1);

    pageErrors.expectClean();
  });
});
