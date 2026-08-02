/**
 * E2E: Gmail Sync — alur "Tolak" di tab Perlu Review (regression guard bug fix).
 *
 * Pola identik dengan e2e/gmail-review-approve.spec.ts (login via cookie,
 * seed data via API, klik aksi di UI, assert server + notifikasi, cleanup).
 *
 * BUG yang diperbaiki (2026-08-02, sama dengan approve):
 *   - Status reject TIDAK di-persist ke server — setelah refresh email muncul
 *     lagi di "Perlu Review". Kini status rejected disimpan via
 *     persistGmailSyncResults.
 *   - Tidak ada notifikasi saat reject. Kini dibuat notifikasi in-app
 *     (triggerGmailReviewResultNotification, dedupe per email).
 *
 * Alur test:
 *   1. Seed email test (status needs_review + metadata.candidate.amount) via
 *      POST /api/gmail/logs.
 *   2. Buka /gmail-sync, klik filter "Perlu Review".
 *   3. Klik tombol Tolak pada email test.
 *   4. Assert:
 *      - Toast "Transaksi ditolak" tampil.
 *      - Notifikasi dibuat (dedupeKey gmail-review-<messageId>).
 *      - Status log di server = rejected.
 *      - TIDAK ada transaksi dibuat (gmail_message_id = testMessageId tidak ada).
 *   5. Cleanup data test (log + notifikasi) di afterAll.
 *
 * Menjalankan:
 *   npx playwright test e2e/gmail-review-reject.spec.ts
 */
import { test, expect } from 'playwright/test';
import { mintSessionCookie, cleanupTestSessions, cleanupGmailReviewTestData } from './helpers/mintSession';
import { setupAuthContext } from './helpers/authContext';
import { collectPageErrors } from './helpers/errors';

const TEST_MESSAGE_PREFIX = 'e2e-reject-';

test.describe('Gmail Sync Perlu Review — reject flow (e2e)', () => {
  let session: { cookie: string; userId: string };
  let testMessageId: string;

  test.beforeAll(async () => {
    session = await mintSessionCookie();
  });

  test.afterAll(async () => {
    if (testMessageId) {
      await cleanupGmailReviewTestData(testMessageId);
    }
    await cleanupTestSessions();
  });

  test.beforeEach(async ({ context }) => {
    await setupAuthContext(context, session);
  });

  test('reject email Perlu Review: status rejected di server + notifikasi + TIDAK ada transaksi', async ({ page, request }) => {
    const pageErrors = collectPageErrors(page);

    // ===== 1. Seed email test =====
    testMessageId = `${TEST_MESSAGE_PREFIX}${Date.now()}`;
    const subject = `E2E Reject Test ${Date.now()}`;
    const amount = 150000;
    const merchant = 'E2E Reject Merchant';

    const seedResp = await request.post('/api/gmail/logs', {
      headers: { Cookie: `better-auth.session_token=${session.cookie}` },
      data: {
        messageId: testMessageId,
        subject,
        sender: 'e2e-reject@example.com',
        emailDate: '2026-08-01T00:00:00.000Z',
        status: 'needs_review',
        finalStatus: 'needs_review',
        confidenceScore: 0.68,
        metadata: {
          candidate: {
            amount,
            merchant,
            category: 'Transportasi',
            paymentMethod: 'e-wallet',
            transactionType: 'expense',
            date: '2026-08-01',
            confidence: 0.68,
          },
        },
      },
    });
    expect(seedResp.ok(), 'seed email test via API').toBeTruthy();

    // ===== 2. Buka halaman & filter Perlu Review =====
    await page.goto('/gmail-sync');
    await page.waitForLoadState('domcontentloaded');

    await page.getByRole('button', { name: 'Perlu Review', exact: true }).click();

    // ===== 3. Email test tampil dengan amount & tombol Tolak =====
    const card = page.getByTestId(`email-card-${testMessageId}`);
    await expect(card).toBeVisible({ timeout: 20_000 });
    // Amount harus tampil (candidate dari metadata server) — bukti bug fix #1
    await expect(card.getByText(/Rp/).first()).toBeVisible();

    // ===== 4. Klik Tolak =====
    await card.getByTitle('Tolak').click();

    // ===== 5. Toast info =====
    await expect(page.getByText('Transaksi ditolak').first()).toBeVisible({ timeout: 20_000 });

    // ===== 6. Notifikasi in-app dibuat (dedupe per email) =====
    await expect.poll(async () => {
      const resp = await request.get('/api/notifications?limit=100', {
        headers: { Cookie: `better-auth.session_token=${session.cookie}` },
      });
      if (!resp.ok()) return false;
      const notifications = (await resp.json()) as Array<{ dedupe_key?: string; type?: string; message?: string }>;
      return notifications.some(
        (n) => n.dedupe_key === `gmail-review-${testMessageId}` && n.type === 'info',
      );
    }, { timeout: 15_000 }).toBe(true);

    // ===== 7. Status log di server berubah menjadi rejected =====
    await expect.poll(async () => {
      const resp = await request.get(`/api/gmail/logs?limit=5000&includeSummary=1`, {
        headers: { Cookie: `better-auth.session_token=${session.cookie}` },
      });
      if (!resp.ok()) return null;
      const json = (await resp.json()) as { data?: Array<{ message_id?: string; messageId?: string; status?: string; final_status?: string }> };
      const rows = Array.isArray(json) ? json : json.data || [];
      const found = rows.find(
        (r) => (r.message_id || r.messageId) === testMessageId,
      );
      return found ? (found.status || found.final_status) : null;
    }, { timeout: 15_000 }).toBe('rejected');

    // ===== 8. TIDAK ada transaksi dibuat (kontras dengan approve) =====
    // API !ok → false (poll retry → timeout = test gagal) — pola sama dengan
    // spec approve; jangan masking kegagalan API dengan menganggap "tidak ada".
    await expect.poll(async () => {
      const resp = await request.get('/api/transactions?limit=5000', {
        headers: { Cookie: `better-auth.session_token=${session.cookie}` },
      });
      if (!resp.ok()) return false;
      const txs = (await resp.json()) as Array<{ gmail_message_id?: string }>;
      return !txs.some((t) => t.gmail_message_id === testMessageId);
    }, { timeout: 15_000 }).toBe(true);

    pageErrors.expectClean();
  });
});
