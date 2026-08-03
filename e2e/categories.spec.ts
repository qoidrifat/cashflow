/**
 * E2E: Halaman Kategori (/categories)
 *
 * Menutup gap P1 terbesar tersisa di E2E_COVERAGE_REPORT.md (Categories adalah
 * dependensi Transaksi & Budget). Login via cookie (pola sama dengan spec lain:
 * mintSessionCookie → setupAuthContext), lalu memverifikasi:
 *
 *   1. Render tanpa pageerror + elemen kunci (header, tombol "Kategori Baru").
 *   2. Default categories tampil setelah init-defaults (idempoten) — tab
 *      Pengeluaran → "Makanan & Minuman", tab Pemasukan → "Gaji" + ground
 *      truth API (id default is_default=1).
 *   3. CRUD penuh: buat kategori custom (toast "Kategori ditambahkan" + card
 *      + API), edit nama (toast "Kategori diperbarui" + API), hapus (toast
 *      "Kategori dihapus" + hilang dari UI & API).
 *   4. Guard isDefault: kategori default TIDAK bisa dihapus (toast warning,
 *      tidak ada perubahan di server).
 *
 * Catatan SSE (anti-flaky, hasil audit 2026-08-03): mutasi create/edit/delete
 * memperbarui UI via SSE PUSH `category:changed` (server → notifyUser →
 * listenToCategories refetch). Karena itu test CRUD memakai gate deterministik
 * `waitRealtimeConnected` (sama dengan notifications-realtime.spec.ts) SEBELUM
 * aksi mutasi pertama — SSE yang lambat connect tidak membuat push terlewat.
 * Test render & guard default TIDAK butuh gate (tidak ada mutasi → tidak ada
 * dependensi SSE).
 *
 * Data test ditandai prefiks `e2e-cat-` dan dibersihkan di afterAll
 * (cleanupTestCategories) — tidak mengganggu dataset asli user.
 *
 * Menjalankan:
 *   npx playwright test e2e/categories.spec.ts
 *   npm run test:e2e:categories
 */
import { test, expect, type APIRequestContext, type Page } from 'playwright/test';
import {
  mintSessionCookie,
  cleanupTestSessions,
  cleanupTestCategories,
} from './helpers/mintSession';
import { setupAuthContext } from './helpers/authContext';
import { collectPageErrors } from './helpers/errors';
import { bellButton, waitRealtimeConnected } from './helpers/realtime';

const CAT_PREFIX = 'e2e-cat';
const AUTH_HEADER = (session: { cookie: string }) => ({
  Cookie: `better-auth.session_token=${session.cookie}`,
});

/** Container flex "justify-between" dari kartu kategori yang memuat `name`
 *  (parent ke-3 dari teks nama: p → div.min-w-0 → div.flex.items-center → row).
 *  Di dalam row: button[0]=edit (Pencil), button[1]=hapus (Trash2). */
function categoryRow(page: Page, name: string) {
  return page
    .getByText(name, { exact: true })
    .first()
    .locator('..')
    .locator('..')
    .locator('..');
}

async function fetchCategories(
  request: APIRequestContext,
  session: { cookie: string },
): Promise<Array<{ id?: string; name?: string; type?: string; is_default?: number }>> {
  const resp = await request.get('/api/categories', { headers: AUTH_HEADER(session) });
  if (!resp.ok()) return [];
  return (await resp.json()) as Array<{ id?: string; name?: string; type?: string; is_default?: number }>;
}

test.describe('Kategori page (e2e)', () => {
  let session: { cookie: string; userId: string };

  test.beforeAll(async () => {
    session = await mintSessionCookie();
  });

  test.afterAll(async () => {
    // Robust: hapus sisa kategori test walaupun test gagal di tengah jalan.
    await cleanupTestCategories();
    await cleanupTestSessions();
  });

  test.beforeEach(async ({ context }) => {
    await setupAuthContext(context, session);
  });

  test('render tanpa error, default categories tampil, tab Pengeluaran/Pemasukan berfungsi', async ({ page, request }) => {
    const pageErrors = collectPageErrors(page);

    await page.goto('/categories');
    await page.waitForLoadState('domcontentloaded');

    // Header halaman + tombol aksi utama
    await expect(page.getByRole('heading', { name: 'Kategori', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Kategori Baru', exact: true })).toBeVisible();

    // Default expense category tampil di tab Pengeluaran (default aktif).
    // Init-defaults idempoten dijalankan di mount — kartu muncul setelah fetch.
    await expect(page.getByText('Makanan & Minuman', { exact: true }).first()).toBeVisible({ timeout: 20_000 });

    // Tab Pemasukan → default income category tampil
    await page.getByRole('button', { name: 'Pemasukan', exact: true }).click();
    await expect(page.getByText('Gaji', { exact: true }).first()).toBeVisible({ timeout: 20_000 });

    // Ground truth API: init-defaults idempoten — id default kunci ada (is_default=1)
    await expect.poll(async () => {
      const rows = await fetchCategories(request, session);
      return (
        rows.some((r) => r.id === 'makanan-minuman' && r.is_default === 1) &&
        rows.some((r) => r.id === 'gaji' && r.is_default === 1)
      );
    }, { timeout: 15_000 }).toBe(true);

    pageErrors.expectClean();
  });

  test('CRUD: buat kategori custom, edit nama, lalu hapus — sinkron UI + API', async ({ page, request }) => {
    const pageErrors = collectPageErrors(page);

    const createdName = `${CAT_PREFIX}-${Date.now()}`;
    const editedName = `${createdName}-edit`;

    await page.goto('/categories');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByText('Makanan & Minuman', { exact: true }).first()).toBeVisible({ timeout: 20_000 });

    // Gate SSE deterministik SEBELUM mutasi: UI create/edit/delete di-refresh
    // via push `category:changed` (bukan polling) — push terlewat = card tidak
    // pernah muncul walaupun API sukses.
    const bell = bellButton(page);
    await waitRealtimeConnected(bell);

    // ===== CREATE =====
    await page.getByRole('button', { name: 'Kategori Baru', exact: true }).click();
    // .last() — aman dari transisi AnimatePresence (modal create sedang exit saat
    // modal edit terbuka; dua root bisa hadir sesaat → strict mode ambiguity).
    const modal = page.locator('.fixed.inset-0.z-50').last();
    await expect(modal.getByRole('heading', { name: 'Kategori Baru' })).toBeVisible();
    await modal.getByPlaceholder('Contoh: Kopi Produktif').fill(createdName);
    // Type default = expense (tab aktif) — tidak perlu mengubah toggle.
    await modal.getByRole('button', { name: 'Simpan', exact: true }).click();

    await expect(page.getByText('Kategori ditambahkan', { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(createdName, { exact: true }).first()).toBeVisible({ timeout: 20_000 });

    // Ground truth: kategori ada di API (type expense, is_default=0)
    await expect.poll(async () => {
      const rows = await fetchCategories(request, session);
      return rows.some((r) => r.name === createdName && r.type === 'expense' && r.is_default === 0);
    }, { timeout: 15_000 }).toBe(true);

    // ===== EDIT =====
    await categoryRow(page, createdName).locator('button').nth(0).click(); // Pencil
    await expect(modal.getByRole('heading', { name: 'Edit Kategori' })).toBeVisible();
    await modal.getByPlaceholder('Contoh: Kopi Produktif').fill(editedName);
    await modal.getByRole('button', { name: 'Simpan', exact: true }).click();

    await expect(page.getByText('Kategori diperbarui', { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(editedName, { exact: true }).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(createdName, { exact: true })).toHaveCount(0);

    // Ground truth: nama baru di API, nama lama hilang
    await expect.poll(async () => {
      const rows = await fetchCategories(request, session);
      return rows.some((r) => r.name === editedName) && !rows.some((r) => r.name === createdName);
    }, { timeout: 15_000 }).toBe(true);

    // ===== DELETE =====
    await categoryRow(page, editedName).locator('button').nth(1).click(); // Trash2
    await expect(page.getByText('Kategori dihapus', { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(editedName, { exact: true })).toHaveCount(0, { timeout: 20_000 });

    // Ground truth: hilang dari API
    await expect.poll(async () => {
      const rows = await fetchCategories(request, session);
      return !rows.some((r) => r.name === editedName);
    }, { timeout: 15_000 }).toBe(true);

    pageErrors.expectClean();
  });

  test('kategori default tidak bisa dihapus (guard isDefault)', async ({ page, request }) => {
    const pageErrors = collectPageErrors(page);

    await page.goto('/categories');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByText('Makanan & Minuman', { exact: true }).first()).toBeVisible({ timeout: 20_000 });

    // Guard isDefault di handleDelete — tanpa mutasi API, tanpa dependensi SSE.
    await categoryRow(page, 'Makanan & Minuman').locator('button').nth(1).click(); // Trash2

    await expect(page.getByText('Kategori default tidak bisa dihapus', { exact: true })).toBeVisible({ timeout: 10_000 });

    // Kartu tetap tampil + masih ada di API (tidak terhapus)
    await expect(page.getByText('Makanan & Minuman', { exact: true }).first()).toBeVisible();
    const rows = await fetchCategories(request, session);
    expect(rows.some((r) => r.name === 'Makanan & Minuman' && r.is_default === 1)).toBe(true);

    pageErrors.expectClean();
  });
});
