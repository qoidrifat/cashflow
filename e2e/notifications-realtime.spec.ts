/**
 * E2E: Notifikasi hasil review Gmail tampil REAL-TIME di bell icon (SSE).
 *
 * Alur (login via cookie, tanpa Google OAuth — pola sama dengan spec review):
 *   1. Seed email test (needs_review + candidate) via POST /api/gmail/logs.
 *   2. Buka /gmail-sync, filter "Perlu Review", klik Setujui / Tolak.
 *   3. TANPA reload halaman: buka dropdown bell → notifikasi hasil review
 *      muncul di daftar (title "Transaksi Gmail diterima" / "Transaksi ditolak").
 *      Ini membuktikan jalur REALTIME: POST /api/notifications → notifyUser
 *      (SSE event `notification:new`) → prependNotification → store → dropdown.
 *   4. Badge unread count di bell bertambah setelah aksi.
 *   5. Cleanup data test di afterAll.
 *
 * Perbedaan dengan spec review (approve/reject/duplicate/amount-missing):
 *   Spec itu memverifikasi SERVER (API /api/notifications + status log);
 *   spec ini memverifikasi UI BELL secara realtime tanpa memanggil API
 *   langsung — hanya mengklik bell & menunggu item tampil.
 *
 * Menjalankan:
 *   npx playwright test e2e/notifications-realtime.spec.ts
 */
import { test, expect } from 'playwright/test';
import { mintSessionCookie, cleanupTestSessions, cleanupGmailReviewTestData } from './helpers/mintSession';
import { setupAuthContext } from './helpers/authContext';
import { collectPageErrors } from './helpers/errors';

const TEST_MESSAGE_PREFIX = 'e2e-bell-';

/** Parse jumlah unread dari aria-label bell: "Buka notifikasi, X belum dibaca". */
function unreadCountFromLabel(label: string | null): number {
  if (!label) return 0;
  const m = label.match(/(\d+)\s+belum dibaca/);
  return m ? Number(m[1]) : 0;
}

test.describe('Notification bell — review result realtime (e2e)', () => {
  let session: { cookie: string; userId: string };
  // BUG FIX: DUA test dalam satu describe — pakai ARRAY messageId agar data tiap
  // test (termasuk transaksi dari approve) semuanya ter-cleanup di afterAll.
  // Sebelumnya satu variabel `testMessageId` ditimpa test 2 → data test 1 bocor
  // ke dataset dev dan merusak fixture count spec lain (transactions).
  const testMessageIds: string[] = [];
  let testMessageId: string;

  test.beforeAll(async () => {
    session = await mintSessionCookie();
  });

  test.afterAll(async () => {
    for (const id of testMessageIds) {
      await cleanupGmailReviewTestData(id);
    }
    await cleanupTestSessions();
  });

  test.beforeEach(async ({ context }) => {
    await setupAuthContext(context, session);
  });

  test('approve: notifikasi "Transaksi Gmail diterima" muncul di bell TANPA reload + badge bertambah', async ({ page, request }) => {
    const pageErrors = collectPageErrors(page);

    // ===== 1. Seed email test =====
    testMessageId = `${TEST_MESSAGE_PREFIX}${Date.now()}`;
    testMessageIds.push(testMessageId);
    const amount = 75000;
    const merchant = 'E2E Bell Merchant';

    const seedResp = await request.post('/api/gmail/logs', {
      headers: { Cookie: `better-auth.session_token=${session.cookie}` },
      data: {
        messageId: testMessageId,
        subject: `E2E Bell Test ${Date.now()}`,
        sender: 'e2e-bell@example.com',
        emailDate: '2026-08-01T00:00:00.000Z',
        status: 'needs_review',
        finalStatus: 'needs_review',
        confidenceScore: 0.7,
        metadata: {
          candidate: {
            amount,
            merchant,
            category: 'Transportasi',
            paymentMethod: 'e-wallet',
            transactionType: 'expense',
            date: '2026-08-01',
            confidence: 0.7,
          },
        },
      },
    });
    expect(seedResp.ok(), 'seed email test via API').toBeTruthy();

    // ===== 2. Buka halaman & filter Perlu Review =====
    await page.goto('/gmail-sync');
    await page.waitForLoadState('domcontentloaded');

    await page.getByRole('button', { name: 'Perlu Review', exact: true }).click();

    // ===== 3. Email test tampil =====
    const card = page.getByTestId(`email-card-${testMessageId}`);
    await expect(card).toBeVisible({ timeout: 20_000 });

    // ===== 4. Baseline unread count dari bell =====
    // Selector spesifik: hanya bell yang punya "belum dibaca" di aria-label
    // (nama /notifikasi/i ambigu — ada tombol "Tutup notifikasi" lain di halaman).
    const bell = page.getByRole('button', { name: /belum dibaca/ });
    await expect(bell).toBeVisible();
    const baseline = unreadCountFromLabel(await bell.getAttribute('aria-label'));

    // ===== 5. Klik Setujui =====
    await card.getByTitle('Setujui').click();
    await expect(page.getByText('Transaksi Gmail berhasil disimpan')).toBeVisible({ timeout: 20_000 });

    // ===== 6. Buka dropdown bell — TANPA reload halaman =====
    await bell.click();
    await expect(page.getByRole('menu')).toBeVisible({ timeout: 10_000 });

    // Notifikasi hasil review muncul realtime (SSE push)
    const reviewItem = page.getByRole('menuitem', { name: /Transaksi Gmail diterima/ }).first();
    await expect(reviewItem).toBeVisible({ timeout: 20_000 });

    // ===== 7. Badge unread bertambah (jumlah belum dibaca naik) =====
    await expect.poll(async () => {
      const current = unreadCountFromLabel(await bell.getAttribute('aria-label'));
      return current > baseline;
    }, { timeout: 15_000 }).toBe(true);

    pageErrors.expectClean();
  });

  test('reject: notifikasi "Transaksi ditolak" muncul di bell TANPA reload', async ({ page, request }) => {
    const pageErrors = collectPageErrors(page);

    // ===== 1. Seed email test (unik per test) =====
    testMessageId = `${TEST_MESSAGE_PREFIX}${Date.now()}`;
    testMessageIds.push(testMessageId);
    const amount = 65000;
    const merchant = 'E2E Bell Reject Merchant';

    const seedResp = await request.post('/api/gmail/logs', {
      headers: { Cookie: `better-auth.session_token=${session.cookie}` },
      data: {
        messageId: testMessageId,
        subject: `E2E Bell Reject ${Date.now()}`,
        sender: 'e2e-bell@example.com',
        emailDate: '2026-08-01T00:00:00.000Z',
        status: 'needs_review',
        finalStatus: 'needs_review',
        confidenceScore: 0.66,
        metadata: {
          candidate: {
            amount,
            merchant,
            category: 'Belanja',
            paymentMethod: 'qris',
            transactionType: 'expense',
            date: '2026-08-01',
            confidence: 0.66,
          },
        },
      },
    });
    expect(seedResp.ok(), 'seed email test via API').toBeTruthy();

    // ===== 2. Buka halaman & filter =====
    await page.goto('/gmail-sync');
    await page.waitForLoadState('domcontentloaded');

    await page.getByRole('button', { name: 'Perlu Review', exact: true }).click();

    const card = page.getByTestId(`email-card-${testMessageId}`);
    await expect(card).toBeVisible({ timeout: 20_000 });

    // ===== 3. Baseline unread =====
    // Selector spesifik: hanya bell yang punya "belum dibaca" di aria-label.
    const bell = page.getByRole('button', { name: /belum dibaca/ });
    const baseline = unreadCountFromLabel(await bell.getAttribute('aria-label'));

    // ===== 4. Klik Tolak =====
    await card.getByTitle('Tolak').click();
    await expect(page.getByText('Transaksi ditolak').first()).toBeVisible({ timeout: 20_000 });

    // ===== 5. Buka dropdown bell — TANPA reload =====
    await bell.click();
    await expect(page.getByRole('menu')).toBeVisible({ timeout: 10_000 });

    // Notifikasi hasil reject muncul realtime (SSE push)
    const rejectItem = page.getByRole('menuitem', { name: /Transaksi ditolak/ }).first();
    await expect(rejectItem).toBeVisible({ timeout: 20_000 });

    // ===== 6. Badge unread bertambah =====
    await expect.poll(async () => {
      const current = unreadCountFromLabel(await bell.getAttribute('aria-label'));
      return current > baseline;
    }, { timeout: 15_000 }).toBe(true);

    pageErrors.expectClean();
  });
});
