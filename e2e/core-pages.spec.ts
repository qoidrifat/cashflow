/**
 * E2E: Smoke test halaman inti yang sebelumnya tidak tercakup — Budgets,
 * Reports, Notifications (gap 9b).
 *
 * Login via cookie (pola sama dengan spec lain: mintSessionCookie →
 * setupAuthContext), lalu untuk tiap halaman:
 *   1. Halaman render tanpa JavaScript error (collectPageErrors → expectClean).
 *   2. Elemen kunci tampil (header/title, tombol aksi utama, atau filter).
 *
 * Bonus: memvalidasi RUNTIME halaman Budgets & Reports yang ikut diedit saat
 * cleanup frontend (sebelumnya hanya diverifikasi via tsc/build — ada blind
 * spot runtime). Halaman Notifications juga mencakup fetch API
 * (/api/notifications) + SSE subscribe.
 *
 * Menjalankan:
 *   npx playwright test e2e/core-pages.spec.ts
 *   npm run test:e2e:core-pages
 */
import { test, expect } from 'playwright/test';
import { mintSessionCookie, cleanupTestSessions } from './helpers/mintSession';
import { setupAuthContext } from './helpers/authContext';
import { collectPageErrors } from './helpers/errors';

test.describe('Core pages smoke (budgets, reports, notifications)', () => {
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

  test('halaman Budgets render tanpa error & elemen kunci tampil', async ({ page }) => {
    const pageErrors = collectPageErrors(page);

    await page.goto('/budgets');
    await page.waitForLoadState('domcontentloaded');

    // Header halaman (title dinamis: "Budget <Bulan> <Tahun>")
    await expect(page.getByRole('heading', { name: /^Budget / })).toBeVisible();

    // Summary cards
    await expect(page.getByText('Total Budget', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Terpakai', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Sisa', { exact: true }).first()).toBeVisible();

    // Tombol aksi utama
    await expect(page.getByRole('button', { name: 'Tambah Budget', exact: true })).toBeVisible();

    // Seksi Smart Budget Recommendation selalu dirender (dengan rekomendasi
    // ATAU hint "Belum cukup histori") — kunci bahwa page logic berjalan.
    await expect(page.getByText('Smart Budget Recommendation', { exact: true })).toBeVisible();

    pageErrors.expectClean();
  });

  test('halaman Reports render tanpa error & elemen kunci tampil', async ({ page }) => {
    const pageErrors = collectPageErrors(page);

    await page.goto('/reports');
    await page.waitForLoadState('domcontentloaded');

    // Header halaman ("Laporan Bulanan" default period)
    await expect(page.getByRole('heading', { name: /^Laporan / })).toBeVisible();

    // Period selector: 4 tombol
    for (const label of ['Harian', 'Mingguan', 'Bulanan', 'Tahunan']) {
      await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible();
    }

    // Tombol export PDF
    await expect(page.getByRole('button', { name: 'PDF', exact: true })).toBeVisible();

    // State: summary cards ATAU empty state — keduanya valid (dataset bisa
    // kosong untuk bulan berjalan). `.or()` = pass bila salah satu tampil.
    await expect(
      page
        .getByText('Belum ada data laporan', { exact: true })
        .or(page.getByText('Pemasukan', { exact: true }).first()),
    ).toBeVisible();

    pageErrors.expectClean();
  });

  test('halaman Notifications render tanpa error & elemen kunci tampil', async ({ page }) => {
    const pageErrors = collectPageErrors(page);

    await page.goto('/notifications');
    await page.waitForLoadState('domcontentloaded');

    // Header halaman + title
    await expect(page.getByRole('heading', { name: 'Semua Notifikasi', exact: true })).toBeVisible();

    // Filter tabs (nav aria-label)
    await expect(page.getByRole('navigation', { name: 'Filter notifikasi' })).toBeVisible();

    // Tombol refresh
    await expect(page.getByRole('button', { name: /Refresh/ })).toBeVisible();

    // Daftar notifikasi (section aria-label) selalu dirender — berisi list ATAU
    // empty state.
    await expect(page.getByRole('region', { name: 'Daftar notifikasi' })).toBeVisible();

    pageErrors.expectClean();
  });
});
