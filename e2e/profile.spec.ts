/**
 * E2E: Halaman Profil (/profile)
 *
 * Login via cookie (pola sama dengan core-pages.spec.ts), memverifikasi:
 *   1. Halaman render tanpa JavaScript error.
 *   2. Profile header tampil (nama, email, foto).
 *   3. Financial summary section tampil (loading → data/empty).
 *   4. Quick actions tampil (Pengaturan, Gmail Sync, Scan Bukti, Bantuan).
 *   5. Tombol Keluar tampil & modal buka/tutup.
 *
 * Menjalankan:
 *   npx playwright test e2e/profile.spec.ts
 *   npm run test:e2e:profile
 */
import { test, expect } from 'playwright/test';
import { mintSessionCookie, cleanupTestSessions } from './helpers/mintSession';
import { setupAuthContext } from './helpers/authContext';
import { collectPageErrors } from './helpers/errors';

test.describe('Profile page (e2e)', () => {
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

  test('render tanpa error & profile header tampil', async ({ page }) => {
    const pageErrors = collectPageErrors(page);

    await page.goto('/profile');
    await page.waitForLoadState('domcontentloaded');

    // Header
    await expect(page.getByRole('heading', { name: 'Profil', exact: true })).toBeVisible();

    // User display name (dari session seed: "E2E Seed Admin" - appears in h2 + img alt)
    await expect(page.getByText('E2E Seed Admin').first()).toBeVisible();

    // Email tampil (may appear in profile header + elsewhere)
    await expect(page.getByText('e2e-seed-admin@cashflow.test').first()).toBeVisible();

    pageErrors.expectClean();
  });

  test('Ringkasan keuangan section tampil (loading → data/empty)', async ({ page }) => {
    const pageErrors = collectPageErrors(page);

    await page.goto('/profile');
    await page.waitForLoadState('domcontentloaded');

    // Section "Ringkasan" harus tampil
    const monthLabel = new Date().toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
    await expect(page.getByText(`Ringkasan ${monthLabel}`)).toBeVisible();

    // Bisa berupa stat cards (ada data) atau empty state — keduanya valid.
    // Tunggu sampai loading selesai (skeleton hilang)
    await expect(
      page.getByText('Pemasukan').or(page.getByText('Belum ada transaksi bulan ini')),
    ).toBeVisible();

    pageErrors.expectClean();
  });

  test('Quick actions tampil: Pengaturan, Gmail Sync, Scan Bukti, Bantuan', async ({ page }) => {
    const pageErrors = collectPageErrors(page);

    await page.goto('/profile');
    await page.waitForLoadState('domcontentloaded');

    // Quick actions section
    await expect(page.getByText('Akses Cepat', { exact: true })).toBeVisible();

    // 4 quick action cards (some labels also in sidebar → use .first())
    await expect(page.getByText('Pengaturan', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Gmail Sync', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Scan Bukti', { exact: true })).toBeVisible();
    await expect(page.getByText('Bantuan', { exact: true })).toBeVisible();

    pageErrors.expectClean();
  });

  test('Tombol Keluar tampil & modal buka/tutup', async ({ page }) => {
    const pageErrors = collectPageErrors(page);

    await page.goto('/profile');
    await page.waitForLoadState('domcontentloaded');

    // Tombol Keluar harus tampil
    await expect(page.getByRole('button', { name: 'Keluar' })).toBeVisible();

    // Klik → modal konfirmasi buka
    await page.getByRole('button', { name: 'Keluar' }).click();
    await expect(page.getByText('Apakah kamu yakin ingin keluar?')).toBeVisible();

    // Tombol Batal → modal tutup
    await page.getByRole('button', { name: 'Batal', exact: true }).click();
    await expect(page.getByText('Apakah kamu yakin ingin keluar?')).not.toBeVisible();

    pageErrors.expectClean();
  });

  test('CashFlow versi tampil di bagian bawah', async ({ page }) => {
    const pageErrors = collectPageErrors(page);

    await page.goto('/profile');
    await page.waitForLoadState('domcontentloaded');

    // Footer version text
    await expect(page.getByText('CashFlow v1.0.0')).toBeVisible();

    pageErrors.expectClean();
  });
});
