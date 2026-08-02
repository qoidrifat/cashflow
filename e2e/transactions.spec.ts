/**
 * E2E: Halaman Transaksi (/transactions)
 *
 * Login via cookie (pola sama dengan gmail-sync.spec.ts), lalu memverifikasi:
 *   1. List count "Menampilkan X-Y dari N transaksi" cocok dengan ground-truth API
 *      (/api/transactions/paginated) — bukan hardcode.
 *   2. Klik filter tipe (Pemasukan / Pengeluaran / Semua) → list count berubah
 *      sesuai total API untuk tipe tersebut.
 *   3. Pagination: klik halaman 2-6 (filter Semua) → counter
 *      "Menampilkan X-Y dari N transaksi" selalu benar (X-Y sesuai halaman aktif).
 *
 * Menjalankan:
 *   npx playwright test e2e/transactions.spec.ts
 */
import { test, expect } from 'playwright/test';
import { mintSessionCookie, cleanupTestSessions } from './helpers/mintSession';
import { setupAuthContext } from './helpers/authContext';
import {
  counterRegexFor,
  getListCountText,
  listTotalFrom,
  waitListTotal,
  waitListRange,
} from './helpers/pagination';
import { collectPageErrors } from './helpers/errors';
import { PINNED, PINNED_DESCRIPTION } from './helpers/fixtures';

const KEYWORD = 'transaksi';

test.describe('Transaksi page (e2e)', () => {
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

  test('list count & total cocok dengan API ground truth', async ({ page, request }) => {
    const pageErrors = collectPageErrors(page);

    // Ground truth dari API (fixture `request` = context terpisah → cookie eksplisit)
    const apiResp = await request.get('/api/transactions/paginated?page=1&pageSize=5', {
      headers: { Cookie: `better-auth.session_token=${session.cookie}` },
    });
    expect(apiResp.ok()).toBeTruthy();
    const api = await apiResp.json();
    // Regression guard: dataset migrasi = 284 transaksi (definisi di fixtures.ts)
    expect(api.total, PINNED_DESCRIPTION.transactionsTotal).toBe(PINNED.transactionsTotal);

    await page.goto('/transactions');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByText(counterRegexFor(KEYWORD)).first()).toBeVisible();

    expect(listTotalFrom(await getListCountText(page, KEYWORD), KEYWORD)).toBe(api.total);

    // Console bersih
    pageErrors.expectClean();
  });

  test('filter tipe: list count selalu cocok dengan total API per tipe', async ({ page, request }) => {
    const pageErrors = collectPageErrors(page);

    // Ground truth: total per tipe
    const totals: Record<string, number> = {};
    for (const type of ['all', 'income', 'expense']) {
      const resp = await request.get(
        `/api/transactions/paginated?page=1&pageSize=5&type=${type}`,
        { headers: { Cookie: `better-auth.session_token=${session.cookie}` } },
      );
      expect(resp.ok()).toBeTruthy();
      const j = await resp.json();
      totals[type] = j.total;
    }
    expect(totals.income, PINNED_DESCRIPTION.transactionsIncome).toBe(PINNED.transactionsIncome);
    expect(totals.expense, PINNED_DESCRIPTION.transactionsExpense).toBe(PINNED.transactionsExpense);

    await page.goto('/transactions');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByText(counterRegexFor(KEYWORD)).first()).toBeVisible();
    expect(listTotalFrom(await getListCountText(page, KEYWORD), KEYWORD)).toBe(totals.all);

    // Filter: Pemasukan → list total = total income API
    await page.getByRole('button', { name: 'Pemasukan', exact: true }).click();
    await waitListTotal(page, KEYWORD, totals.income);

    // Filter: Pengeluaran → list total = total expense API
    await page.getByRole('button', { name: 'Pengeluaran', exact: true }).click();
    await waitListTotal(page, KEYWORD, totals.expense);

    // Kembali ke Semua → list total = total API
    await page.getByRole('button', { name: 'Semua', exact: true }).click();
    await waitListTotal(page, KEYWORD, totals.all);

    pageErrors.expectClean();
  });

  test('pagination: klik halaman 2-6, counter Menampilkan X-Y dari N selalu benar', async ({ page, request }) => {
    const pageErrors = collectPageErrors(page);

    // Ground truth: total & struktur pagination (pageSize default = 50)
    const apiResp = await request.get('/api/transactions/paginated?page=1&pageSize=5', {
      headers: { Cookie: `better-auth.session_token=${session.cookie}` },
    });
    expect(apiResp.ok()).toBeTruthy();
    const api = await apiResp.json();
    expect(api.total, PINNED_DESCRIPTION.transactionsTotal).toBe(PINNED.transactionsTotal);

    const total = api.total;
    const pageSize = 50;
    const totalPages = Math.ceil(total / pageSize); // dari PINNED.transactionsTotal
    expect(totalPages, `totalPages dari ${PINNED_DESCRIPTION.transactionsTotal}`).toBe(
      Math.ceil(PINNED.transactionsTotal / pageSize),
    );

    await page.goto('/transactions');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByText(counterRegexFor(KEYWORD)).first()).toBeVisible();

    // Halaman 1 (default): Menampilkan 1-50 dari 284
    await waitListRange(page, KEYWORD, 1, Math.min(pageSize, total), total);

    // Halaman 2..6: klik tombol nomor halaman, pastikan counter X-Y sesuai
    for (let p = 2; p <= totalPages; p++) {
      const expectedStart = (p - 1) * pageSize + 1;
      const expectedEnd = Math.min(p * pageSize, total);

      // Ground truth: jumlah item di halaman ini dari API = panjang range
      const pageResp = await request.get(`/api/transactions/paginated?page=${p}&pageSize=${pageSize}`, {
        headers: { Cookie: `better-auth.session_token=${session.cookie}` },
      });
      expect(pageResp.ok()).toBeTruthy();
      const pageApi = await pageResp.json();
      expect(pageApi.data.length).toBe(expectedEnd - expectedStart + 1);

      await page.getByRole('button', { name: String(p), exact: true }).click();
      await waitListRange(page, KEYWORD, expectedStart, expectedEnd, total);

      // Indikator halaman aktif juga benar
      await expect(page.getByText(`Halaman ${p} dari ${totalPages}`, { exact: true })).toBeVisible();
    }

    pageErrors.expectClean();
  });
});
