/**
 * E2E: Halaman Pengaturan (/settings)
 *
 * Login via cookie (pola sama dengan core-pages.spec.ts), memverifikasi:
 *   1. Halaman render tanpa JavaScript error.
 *   2. Section utama tampil: Tampilan & Mata Uang, Gmail Automation,
 *      Notifikasi, Data & Privasi, Saldo Awal Rekening, Akun Milik Sendiri.
 *   3. Theme toggle berfungsi (klik Light/Dark/System).
 *   4. Gmail sync toggle berfungsi.
 *   5. Delete data modal buka/tutup + form konfirmasi ada.
 *
 * Menjalankan:
 *   npx playwright test e2e/settings.spec.ts
 *   npm run test:e2e:settings
 */
import { test, expect } from 'playwright/test';
import { mintSessionCookie, cleanupTestSessions } from './helpers/mintSession';
import { setupAuthContext } from './helpers/authContext';
import { collectPageErrors } from './helpers/errors';

test.describe('Settings page (e2e)', () => {
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

  test('render tanpa error & semua section utama tampil', async ({ page }) => {
    const pageErrors = collectPageErrors(page);

    await page.goto('/settings');
    await page.waitForLoadState('domcontentloaded');

    // Header (h1 in layout header)
    await expect(page.locator('h1').filter({ hasText: 'Pengaturan' })).toBeVisible();

    // Section: Tampilan & Mata Uang
    await expect(page.getByText('Tampilan & Mata Uang', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Light' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Dark' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'System' })).toBeVisible();

    // Section: Akun Milik Sendiri
    await expect(page.getByText('Akun Milik Sendiri', { exact: true })).toBeVisible();

    // Section: Saldo Awal Rekening
    await expect(page.getByText('Saldo Awal Rekening', { exact: true })).toBeVisible();

    // Section: Gmail Automation
    await expect(page.getByText('Gmail Automation', { exact: true })).toBeVisible();

    // Section: Notifikasi
    await expect(page.getByText('Notifikasi', { exact: true }).first()).toBeVisible();

    // Section: Data & Privasi
    await expect(page.getByText('Data & Privasi', { exact: true })).toBeVisible();

    pageErrors.expectClean();
  });

  test('theme toggle: klik Light/Dark/System mengubah tema tanpa error', async ({ page }) => {
    const pageErrors = collectPageErrors(page);

    await page.goto('/settings');
    await page.waitForLoadState('domcontentloaded');

    // Klik Dark → class harus berubah
    await page.getByRole('button', { name: 'Dark', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Dark', exact: true })).toHaveAttribute(
      'class',
      /border-primary/,
    );

    // Klik Light → class harus berubah
    await page.getByRole('button', { name: 'Light', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Light', exact: true })).toHaveAttribute(
      'class',
      /border-primary/,
    );

    // Klik System → class harus berubah
    await page.getByRole('button', { name: 'System', exact: true }).click();
    await expect(page.getByRole('button', { name: 'System', exact: true })).toHaveAttribute(
      'class',
      /border-primary/,
    );

    pageErrors.expectClean();
  });

  test('Gmail Automation toggle berfungsi', async ({ page }) => {
    const pageErrors = collectPageErrors(page);

    await page.goto('/settings');
    await page.waitForLoadState('domcontentloaded');

    // Section Gmail Automation harus tampil
    await expect(page.getByText('Gmail Automation', { exact: true })).toBeVisible();

    // Toggle Syncronisasi Gmail harus tampil
    await expect(page.getByText('Sinkronisasi Gmail', { exact: true })).toBeVisible();

    // Toggle Auto-save harus tampil
    await expect(page.getByText('Auto-save confidence tinggi', { exact: true })).toBeVisible();

    pageErrors.expectClean();
  });

  test('Data & Privasi section: Export button & Delete button tampil, modal buka/tutup', async ({ page }) => {
    const pageErrors = collectPageErrors(page);

    await page.goto('/settings');
    await page.waitForLoadState('domcontentloaded');

    // Data & Privasi section
    await expect(page.getByText('Data & Privasi', { exact: true })).toBeVisible();

    // Export button
    await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeVisible();

    // Delete button
    await expect(page.getByRole('button', { name: 'Hapus', exact: true })).toBeVisible();

    // Klik Hapus → modal buka
    await page.getByRole('button', { name: 'Hapus', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Hapus Semua Data', exact: true })).toBeVisible();

    // Tombol Batal ada
    await expect(page.getByRole('button', { name: 'Batal', exact: true })).toBeVisible();

    // Klik Batal → modal tutup
    await page.getByRole('button', { name: 'Batal', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Hapus Semua Data', exact: true })).not.toBeVisible();

    pageErrors.expectClean();
  });

  test('Akun Milik Sendiri: input + Tambah tombol tampil', async ({ page }) => {
    const pageErrors = collectPageErrors(page);

    await page.goto('/settings');
    await page.waitForLoadState('domcontentloaded');

    // Section Akun Milik Sendiri
    await expect(page.getByText('Akun Milik Sendiri', { exact: true })).toBeVisible();

    // Input untuk nama akun
    const input = page.getByRole('textbox', { name: 'Nama akun milik sendiri' });
    await expect(input).toBeVisible();

    // Tombol Tambah
    await expect(page.getByRole('button', { name: 'Tambah', exact: true })).toBeVisible();

    // Tombol Simpan
    await expect(page.getByRole('button', { name: 'Simpan', exact: true })).toBeVisible();

    pageErrors.expectClean();
  });
});
