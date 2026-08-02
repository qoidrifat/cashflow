/**
 * E2E: Halaman Dashboard (/dashboard)
 *
 * Login via cookie (pola sama dengan gmail-sync.spec.ts), lalu memverifikasi:
 *   1. Stat cards (Total Saldo, Pemasukan Bulan Ini, Pengeluaran Bulan Ini,
 *      Sisa Budget) tampil dan nilai "Total Saldo" cocok dengan balance yang
 *      dihitung dari 50 transaksi terbaru (API /api/transactions?limit=50 —
 *      sumber yang sama dengan yang dipakai halaman via listenToTransactions).
 *   2. Quick actions & seksi "Transaksi Terbaru" tampil (min 1 item dirender).
 *
 * Menjalankan:
 *   npx playwright test e2e/dashboard.spec.ts
 */
import { test, expect, type Page } from 'playwright/test';
import { mintSessionCookie, cleanupTestSessions } from './helpers/mintSession';
import { setupAuthContext } from './helpers/authContext';
import { collectPageErrors } from './helpers/errors';

interface TxRow {
  type: string;
  amount: number;
}

/** Replikasi calculateBalance() di src/services/transactionService.ts. */
function calculateBalance(rows: TxRow[]): { totalIncome: number; totalExpense: number; balance: number } {
  const totalIncome = rows
    .filter((t) => t.type === 'income' || t.type === 'refund')
    .reduce((sum, t) => sum + Number(t.amount), 0);
  const totalExpense = rows
    .filter((t) => t.type === 'expense' || t.type === 'transfer')
    .reduce((sum, t) => sum + Number(t.amount), 0);
  return { totalIncome, totalExpense, balance: totalIncome - totalExpense };
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

  test('stat cards tampil & Total Saldo cocok dengan API ground truth', async ({ page, request }) => {
    const pageErrors = collectPageErrors(page);

    // Ground truth: 50 transaksi terbaru (sama dengan fetch halaman)
    const apiResp = await request.get('/api/transactions?limit=50', {
      headers: { Cookie: `better-auth.session_token=${session.cookie}` },
    });
    expect(apiResp.ok()).toBeTruthy();
    const rows = (await apiResp.json()) as TxRow[];
    expect(rows.length).toBe(50);
    const expected = calculateBalance(rows);

    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');

    // Tunggu data dirender (skeleton → stat cards)
    await expect(page.getByText('Total Saldo', { exact: true }).first()).toBeVisible();

    // Total Saldo (abs karena formatCurrency memakai Math.abs)
    const balanceDigits = await getStatCardValue(page, 'Total Saldo');
    expect(balanceDigits).toBe(formatCurrencyId(expected.balance).replace(/[^\d]/g, ''));

    // Cards lain minimal tampil dengan nilai non-negatif (tidak error/skeleton)
    for (const title of ['Pemasukan Bulan Ini', 'Pengeluaran Bulan Ini', 'Sisa Budget']) {
      const digits = await getStatCardValue(page, title);
      expect(digits.length).toBeGreaterThan(0);
    }

    pageErrors.expectClean();
  });

  test('quick actions & Transaksi Terbaru tampil', async ({ page }) => {
    const pageErrors = collectPageErrors(page);

    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByText('Total Saldo', { exact: true }).first()).toBeVisible();

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
