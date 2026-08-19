/**
 * E2E: Halaman Privasi & Izin (/privacy)
 *
 * Login via cookie (pola sama dengan core-pages.spec.ts), memverifikasi:
 *   1. Halaman render tanpa JavaScript error.
 *   2. Permission brief header tampil.
 *   3. Semua 5 privacy section tampil.
 *   4. Export Data Saya button tampil.
 *   5. Delete Account button buka modal, ada konfirmasi DELETE.
 *   6. Modal buka/tutup tanpa error.
 *
 * Menjalankan:
 *   npx playwright test e2e/privacy.spec.ts
 *   npm run test:e2e:privacy
 */
import { test, expect } from 'playwright/test';
import { mintSessionCookie, cleanupTestSessions } from './helpers/mintSession';
import { setupAuthContext } from './helpers/authContext';
import { collectPageErrors } from './helpers/errors';

test.describe('Privacy page (e2e)', () => {
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

  test('render tanpa error & permission brief tampil', async ({ page }) => {
    const pageErrors = collectPageErrors(page);

    await page.goto('/privacy');
    await page.waitForLoadState('domcontentloaded');

    // Header
    await expect(page.getByRole('heading', { name: 'Privasi & Izin', exact: true })).toBeVisible();

    // Permission brief
    await expect(page.getByText('Permission brief', { exact: true })).toBeVisible();
    await expect(
      page.getByText('Gmail dibaca seperlunya, transaksi disimpan secukupnya.', { exact: true }),
    ).toBeVisible();

    pageErrors.expectClean();
  });

  test('semua 5 privacy sections tampil', async ({ page }) => {
    const pageErrors = collectPageErrors(page);

    await page.goto('/privacy');
    await page.waitForLoadState('domcontentloaded');

    // 5 sections berdasarkan PrivacyPage
    const sections = [
      'Data Gmail yang Dibaca',
      'Data yang Disimpan',
      'API Key & Token',
      'Scope Minimum',
      'Kontrol User',
    ];

    for (const section of sections) {
      await expect(page.getByText(section, { exact: true })).toBeVisible();
    }

    pageErrors.expectClean();
  });

  test('Export Data Saya & Delete Account buttons tampil', async ({ page }) => {
    const pageErrors = collectPageErrors(page);

    await page.goto('/privacy');
    await page.waitForLoadState('domcontentloaded');

    // Export button
    await expect(page.getByRole('button', { name: 'Export My Data' })).toBeVisible();

    // Delete button
    await expect(page.getByRole('button', { name: 'Delete Account' })).toBeVisible();

    pageErrors.expectClean();
  });

  test('Delete Account modal buka & tutup tanpa error', async ({ page }) => {
    const pageErrors = collectPageErrors(page);

    await page.goto('/privacy');
    await page.waitForLoadState('domcontentloaded');

    // Klik Delete Account → modal buka
    await page.getByRole('button', { name: 'Delete Account' }).click();
    // Modal heading is the 2nd 'Hapus Akun CashFlow' (1st = card h3, 2nd = modal h2)
    await expect(page.getByRole('heading', { name: 'Hapus Akun CashFlow' }).nth(1)).toBeVisible();

    // Confirmation input ada (id="delete-confirm-input" on the input element)
    await expect(page.locator('#delete-confirm-input')).toBeVisible();

    // Tombol Batal ada & berfungsi
    await expect(page.getByRole('button', { name: 'Batal', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Batal', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Hapus Akun CashFlow' }).nth(1)).not.toBeVisible();

    pageErrors.expectClean();
  });
});
