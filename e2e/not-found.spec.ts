/**
 * E2E: Halaman 404 / Not Found
 *
 * Login via cookie, lalu navigasi ke path yang tidak valid.
 * Memverifikasi NotFoundPage tampil tanpa error.
 *
 * Menjalankan:
 *   npx playwright test e2e/not-found.spec.ts
 *   npm run test:e2e:not-found
 */
import { test, expect } from 'playwright/test';
import { mintSessionCookie, cleanupTestSessions } from './helpers/mintSession';
import { setupAuthContext } from './helpers/authContext';
import { collectPageErrors } from './helpers/errors';

test.describe('Not Found page (e2e)', () => {
  let session: { cookie: string; userId: string };

  test.beforeAll(async () => {
    session = await mintSessionCookie();
  });

  test.afterAll(async () => {
    await cleanupTestSessions();
  });

  test.beforeEach(async ({ context }) => {
    await setupAuthContext(context, session);
  });

  test('path tidak valid → 404 tampil tanpa error', async ({ page }) => {
    const pageErrors = collectPageErrors(page);

    await page.goto('/path-yang-tidak-ada');
    await page.waitForLoadState('domcontentloaded');

    // NotFoundPage menampilkan "404" atau "tidak ditemukan"
    await expect(
      page.getByText('404').or(page.getByText('tidak ditemukan')).or(page.getByText('Not Found')).first(),
    ).toBeVisible();

    pageErrors.expectClean();
  });

  test('path admin tidak valid → 404 tampil tanpa error', async ({ page }) => {
    const pageErrors = collectPageErrors(page);

    await page.goto('/admin/nonexistent');
    await page.waitForLoadState('domcontentloaded');

    // NotFoundPage harus tampil (bukan error 500 atau crash)
    await expect(
      page.getByText('404').or(page.getByText('tidak ditemukan')).or(page.getByText('Not Found')).first(),
    ).toBeVisible();

    pageErrors.expectClean();
  });
});
