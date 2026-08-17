/**
 * E2E: Halaman Dashboard (/dashboard)
 *
 * Login via cookie (pola sama dengan gmail-sync.spec.ts), lalu memverifikasi:
 *   1. Stat cards (Arus Kas Bersih — P2.5 rename dari "Total Saldo", Pemasukan
 *      Bulan Ini, Pengeluaran Bulan Ini,
 *      Sisa Budget) tampil dan nilainya cocok dengan API ground truth
 *      /api/transactions/summary (ringkasan WINDOWLESS server-side — sumber
 *      kebenaran tunggal. Root cause insiden 2026-08-08: sebelumnya dashboard
 *      menghitung saldo dari 50 transaksi terbaru sehingga saldo melompat
 *      saat window bergeser).
 *   2. Reload konsisten: nilai setelah reload = nilai API (tidak ada
 *      optimistic-state/cache yang menyimpang dari database).
 *   3. Quick actions & seksi "Transaksi Terbaru" tampil (min 1 item dirender).
 *
 * Menjalankan:
 *   npx playwright test e2e/dashboard.spec.ts
 */
import { test, expect, type Page } from 'playwright/test';
import { mintSessionCookie, cleanupTestSessions } from './helpers/mintSession';
import { setupAuthContext } from './helpers/authContext';
import { collectPageErrors } from './helpers/errors';

interface SummaryTotals {
  totalIncome: number;
  totalExpense: number;
  balance: number;
}

interface SummaryResp {
  month: number;
  year: number;
  lifetime: SummaryTotals;
  monthly: SummaryTotals;
}

/**
 * StatCard: <p>{title}</p> lalu <p>{formatCurrency(value)}</p>.
 * formatCurrency = `Rp${Math.abs(value).toLocaleString('id-ID')}` — bandingkan
 * dengan membuang semua non-digit (Rp, titik ribuan) agar anti-flaky terhadap
 * format locale.
 */
async function getStatCardValue(page: Page, title: string): Promise<string> {
  const titleEl = page.getByText(title, { exact: true }).first();
  await expect(titleEl).toBeVisible();
  const valueText = await titleEl.locator('xpath=following-sibling::*[1]').textContent();
  return (valueText ?? '').replace(/[^\d]/g, '');
}

/** Format angka ke bentuk yang sama dengan formatCurrency (id-ID). */
function formatCurrencyId(value: number): string {
  const abs = Math.abs(Math.round(value * 100) / 100);
  const [intPart, decPart] = abs.toString().split('.');
  const grouped = Number(intPart).toLocaleString('id-ID');
  return decPart ? `${grouped},${decPart}` : grouped;
}

test.describe('Dashboard page (e2e)', () => {
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

  test('stat cards cocok dengan API summary (windowless) & konsisten setelah reload', async ({ page, request }) => {
    const pageErrors = collectPageErrors(page);

    // Ground truth: ringkasan windowless server-side (bulan berjalan).
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();
    const apiResp = await request.get(`/api/transactions/summary?month=${month}&year=${year}`, {
      headers: { Cookie: `better-auth.session_token=${session.cookie}` },
    });
    expect(apiResp.ok()).toBeTruthy();
    const summary = (await apiResp.json()) as SummaryResp;

    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');

    // Tunggu data dirender (skeleton → stat cards)    await expect(page.getByText('Arus Kas Bersih', { exact: true }).first()).toBeVisible();
    // Arus Kas Bersih = LIFETIME net cash flow (windowless) — abs karena formatCurrency
    // memakai Math.abs.
    const balanceDigits = await getStatCardValue(page, 'Arus Kas Bersih');
    expect(balanceDigits).toBe(formatCurrencyId(summary.lifetime.balance).replace(/[^\d]/g, ''));

    // Pemasukan / Pengeluaran Bulan Ini = summary.monthly.
    const incomeDigits = await getStatCardValue(page, 'Pemasukan Bulan Ini');
    expect(incomeDigits).toBe(formatCurrencyId(summary.monthly.totalIncome).replace(/[^\d]/g, ''));
    const expenseDigits = await getStatCardValue(page, 'Pengeluaran Bulan Ini');
    expect(expenseDigits).toBe(formatCurrencyId(summary.monthly.totalExpense).replace(/[^\d]/g, ''));

    // Sisa Budget minimal tampil (tidak error/skeleton)
    const budgetDigits = await getStatCardValue(page, 'Sisa Budget');
    expect(budgetDigits.length).toBeGreaterThan(0);

    // RELOAD CONSISTENCY (T23): nilai sebelum & sesudah reload harus identik
    // dan sama dengan API — frontend state tidak boleh menyimpang dari DB.
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByText('Arus Kas Bersih', { exact: true }).first()).toBeVisible();
    expect(await getStatCardValue(page, 'Arus Kas Bersih')).toBe(balanceDigits);
    expect(await getStatCardValue(page, 'Pemasukan Bulan Ini')).toBe(incomeDigits);
    expect(await getStatCardValue(page, 'Pengeluaran Bulan Ini')).toBe(expenseDigits);

    pageErrors.expectClean();
  });

  test('quick actions & Transaksi Terbaru tampil', async ({ page }) => {
    const pageErrors = collectPageErrors(page);

    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByText('Arus Kas Bersih', { exact: true }).first()).toBeVisible();

    // Quick actions (aria-label = label)
    for (const label of ['Pemasukan', 'Pengeluaran', 'Scan Gmail', 'Laporan']) {
      await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible();
    }

    // Seksi Transaksi Terbaru + link Lihat Semua
    await expect(page.getByText('Transaksi Terbaru', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Lihat Semua', exact: true })).toBeVisible();

    // Minimal 1 transaksi dirender (dataset punya 284 transaksi)
    const items = page.locator('div.divide-y > div');
    const count = await items.count();
    expect(count).toBeGreaterThan(0);

    pageErrors.expectClean();
  });
});
