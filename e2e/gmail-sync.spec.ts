/**
 * E2E: Gmail Sync page
 *
 * Login via cookie Better Auth yang di-mint langsung ke Turso (tanpa Google OAuth),
 * lalu memverifikasi:
 *   1. Summary cards & total email sesuai dengan ground-truth dari API
 *      (/api/gmail/logs?includeSummary=1) — bukan hardcode.
 *   2. Klik filter status (Perlu Review, Diterima Otomatis, Semua) → list count
 *      selalu cocok dengan summary cards.
 *   3. Pagination: klik tombol "Berikutnya" sampai halaman terakhir (total 519,
 *      pageSize 100 → 6 halaman) → counter "Menampilkan X-Y dari N email" selalu
 *      benar dan indikator "Halaman X dari Y" ikut berubah.
 *
 * Menjalankan:
 *   npx playwright test e2e/gmail-sync.spec.ts
 * (webServer di playwright.config.ts otomatis memakai server yang sudah berjalan,
 *  atau me-start ulang bila belum jalan.)
 */
import { test, expect, type Page } from 'playwright/test';
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

const KEYWORD = 'email';

/**
 * Klik chip filter lalu TUNGGU response API /api/gmail/logs yang cocok dengan
 * status tersebut selesai — jauh lebih deterministik daripada hanya poll counter
 * (anti-flaky saat sistem terbebani). Mengembalikan total dari response tersebut.
 *
 * Matching memakai URL parsing (searchParams) — presisi: untuk 'all' hanya
 * request TANPA param status (dan includeSummary=1) yang cocok, jadi tidak akan
 * salah menangkap request mount/pagination lain.
 */
async function clickFilterAndWaitResponse(
  page: Page,
  buttonName: string,
  statusQuery: string | null,
): Promise<number> {
  const responsePromise = page.waitForResponse((resp) => {
    if (!resp.url().includes('/api/gmail/logs') || resp.status() !== 200) return false;
    const params = new URL(resp.url()).searchParams;
    if (params.get('includeSummary') !== '1') return false;
    const actualStatus = params.get('status');
    return statusQuery === null ? actualStatus === null : actualStatus === statusQuery;
  });
  await page.getByRole('button', { name: buttonName, exact: true }).click();
  const response = await responsePromise;
  const json = (await response.json()) as { total?: number };
  return json.total ?? -1;
}

async function getSummaryCards(page: Page): Promise<{ [label: string]: number }> {
  // StatCard: <Card><p>label</p><p>value</p></Card>
  const labels = ['Diterima', 'Perlu Review', 'Dilewati/Ditolak', 'Error'];
  const cards: { [label: string]: number } = {};
  for (const label of labels) {
    const labelEl = page.getByText(label, { exact: true }).first();
    await expect(labelEl).toBeVisible();
    const valueText = await labelEl.locator('xpath=following-sibling::*[1]').textContent();
    cards[label] = Number((valueText ?? '').trim());
  }
  return cards;
}

test.describe('Gmail Sync page (e2e)', () => {
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

  test('summary cards & total email cocok dengan API ground truth', async ({ page, request }) => {
    // Kumpulkan page errors sejak awal navigasi (bukan setelah goto)
    const pageErrors = collectPageErrors(page);

    // Ground truth dari API (server menghitung summary dari SEMUA email).
    // Fixture `request` adalah context terpisah — cookie sesi harus dikirim eksplisit.
    const apiResp = await request.get('/api/gmail/logs?includeSummary=1&page=1&pageSize=5', {
      headers: { Cookie: `better-auth.session_token=${session.cookie}` },
    });
    expect(apiResp.ok()).toBeTruthy();
    const api = await apiResp.json();
    // Pinned: dataset migrasi saat ini = 519 email (regression guard — update bila
    // data bertambah secara intentional via scan baru).
    expect(api.total).toBe(519);
    expect(api.summary).toBeDefined();

    await page.goto('/gmail-sync');
    await page.waitForLoadState('domcontentloaded');

    // Tunggu data benar-benar dirender (bukan networkidle — bisa hang karena HMR WebSocket)
    await expect(page.getByText(counterRegexFor(KEYWORD)).first()).toBeVisible();

    // Summary cards
    const cards = await getSummaryCards(page);
    expect(cards['Diterima']).toBe(api.summary.autoAccepted);
    expect(cards['Perlu Review']).toBe(api.summary.needsReview);
    expect(cards['Dilewati/Ditolak']).toBe(api.summary.skippedRejected);
    expect(cards['Error']).toBe(api.summary.error);

    // List count selalu = total
    expect(listTotalFrom(await getListCountText(page, KEYWORD), KEYWORD)).toBe(api.summary.total);

    // Console bersih
    pageErrors.expectClean();
  });

  test('filter status: list count selalu cocok dengan summary cards', async ({ page, request }) => {
    const pageErrors = collectPageErrors(page);

    const apiResp = await request.get('/api/gmail/logs?includeSummary=1&page=1&pageSize=5', {
      headers: { Cookie: `better-auth.session_token=${session.cookie}` },
    });
    expect(apiResp.ok()).toBeTruthy();
    const api = await apiResp.json();
    expect(api.total).toBe(519);

    await page.goto('/gmail-sync');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByText(counterRegexFor(KEYWORD)).first()).toBeVisible();

    const cards0 = await getSummaryCards(page);
    expect(cards0['Diterima']).toBe(api.summary.autoAccepted);
    expect(cards0['Perlu Review']).toBe(api.summary.needsReview);

    // Filter: Perlu Review → list total = card Perlu Review (tunggu response API)
    const needsReviewTotal = await clickFilterAndWaitResponse(page, 'Perlu Review', 'needs_review');
    expect(needsReviewTotal).toBe(cards0['Perlu Review']);
    await waitListTotal(page, KEYWORD, needsReviewTotal);

    // Filter: Diterima Otomatis → list total = card Diterima
    const autoAcceptedTotal = await clickFilterAndWaitResponse(page, 'Diterima Otomatis', 'auto_accepted');
    expect(autoAcceptedTotal).toBe(cards0['Diterima']);
    await waitListTotal(page, KEYWORD, autoAcceptedTotal);

    // Kembali ke Semua → list total = total API
    const allTotal = await clickFilterAndWaitResponse(page, 'Semua', null);
    expect(allTotal).toBe(api.summary.total);
    await waitListTotal(page, KEYWORD, allTotal);

    pageErrors.expectClean();
  });

  test('pagination: klik Berikutnya sampai halaman terakhir, counter email selalu benar', async ({ page, request }) => {
    const pageErrors = collectPageErrors(page);

    // Ground truth: total & struktur pagination (LOGS_PAGE_SIZE = 100 di GmailSyncPage)
    const apiResp = await request.get('/api/gmail/logs?includeSummary=1&page=1&pageSize=5', {
      headers: { Cookie: `better-auth.session_token=${session.cookie}` },
    });
    expect(apiResp.ok()).toBeTruthy();
    const api = await apiResp.json();
    expect(api.total).toBe(519);

    const total = api.total;
    const pageSize = 100;
    const totalPages = Math.ceil(total / pageSize); // 519/100 → 6
    expect(totalPages).toBe(6);

    await page.goto('/gmail-sync');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByText(counterRegexFor(KEYWORD)).first()).toBeVisible();

    // Halaman 1 (default): Menampilkan 1-100 dari 519
    await waitListRange(page, KEYWORD, 1, Math.min(pageSize, total), total);

    // Halaman 2..6: klik tombol "Berikutnya", pastikan counter X-Y sesuai
    for (let p = 2; p <= totalPages; p++) {
      const expectedStart = (p - 1) * pageSize + 1;
      const expectedEnd = Math.min(p * pageSize, total);

      // Ground truth: jumlah item di halaman ini dari API = panjang range
      const pageResp = await request.get(`/api/gmail/logs?includeSummary=1&page=${p}&pageSize=${pageSize}`, {
        headers: { Cookie: `better-auth.session_token=${session.cookie}` },
      });
      expect(pageResp.ok()).toBeTruthy();
      const pageApi = await pageResp.json();
      expect(pageApi.data.length).toBe(expectedEnd - expectedStart + 1);

      await page.getByRole('button', { name: /Berikutnya/ }).click();
      await waitListRange(page, KEYWORD, expectedStart, expectedEnd, total);

      // Indikator halaman aktif juga benar
      await expect(page.getByText(`Halaman ${p} dari ${totalPages}`, { exact: true })).toBeVisible();
    }

    // Di halaman terakhir, tombol Berikutnya harus disabled (batas akhir pagination)
    await expect(page.getByRole('button', { name: /Berikutnya/ })).toBeDisabled();

    pageErrors.expectClean();
  });
});
