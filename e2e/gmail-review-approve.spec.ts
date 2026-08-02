/**
 * E2E: Gmail Sync — alur "Setujui" di tab Perlu Review (regression guard bug fix).
 *
 * BUG yang diperbaiki (2026-08-02):
 *   1. `handleApproveEmail` return diam-diam saat `email.amount` kosong — email
 *      yang dimuat dari server TIDAK membawa amount/merchant/category (tidak
 *      disimpan di metadata), jadi klik "Setujui" tidak melakukan apa-apa tanpa
 *      feedback. Kini: candidate disimpan di metadata, dimapping kembali saat
 *      render (mapLogToSyncEmail), validasi memberi feedback jelas.
 *   2. Status approve/reject TIDAK di-persist ke server — setelah refresh email
 *      muncul lagi di "Perlu Review". Kini status approved/rejected/duplicate
 *      disimpan via persistGmailSyncResults (+ extractedTransactionId).
 *   3. Tidak ada notifikasi saat approve sukses/gagal. Kini dibuat notifikasi
 *      in-app (triggerGmailReviewResultNotification, dedupe per email).
 *
 * Alur test (login via cookie, tanpa Google OAuth):
 *   1. Seed email test (status needs_review + metadata.candidate.amount) via
 *      POST /api/gmail/logs.
 *   2. Buka /gmail-sync, klik filter "Perlu Review".
 *   3. Klik tombol Setujui pada email test.
 *   4. Assert: toast sukses tampil, notifikasi dibuat (dedupeKey
 *      gmail-review-<messageId>), status log di server = approved, transaksi
 *      dengan gmail_message_id = testMessageId tersimpan.
 *   5. Cleanup data test (transaksi + log + notifikasi) di afterAll.
 *
 * Menjalankan:
 *   npx playwright test e2e/gmail-review-approve.spec.ts
 */
import { test, expect } from 'playwright/test';
import { mintSessionCookie, cleanupTestSessions, cleanupGmailReviewTestData } from './helpers/mintSession';
import { setupAuthContext } from './helpers/authContext';
import { collectPageErrors } from './helpers/errors';
import { seedGmailReviewEmail, openReviewFilter } from './helpers/gmailReview';

test.describe('Gmail Sync Perlu Review — approve flow (e2e)', () => {
  let session: { cookie: string; userId: string };
  let testMessageId: string;

  test.beforeAll(async () => {
    session = await mintSessionCookie();
  });

  test.afterAll(async () => {
    // Bersihkan data test dulu (jangan sampai mencemari dataset user dev),
    // lalu bersihkan sesi E2E.
    if (testMessageId) {
      await cleanupGmailReviewTestData(testMessageId);
    }
    await cleanupTestSessions();
  });

  test.beforeEach(async ({ context }) => {
    await setupAuthContext(context, session);
  });

  test('approve email Perlu Review: transaksi tersimpan + notifikasi + status approved', async ({ page, request }) => {
    const pageErrors = collectPageErrors(page);

    // ===== 1. Seed email test =====
    testMessageId = await seedGmailReviewEmail(request, session, {
      prefix: 'e2e-review-',
      subject: `E2E Review Test ${Date.now()}`,
      sender: 'e2e-test@example.com',
      confidenceScore: 0.72,
      candidate: {
        amount: 125000,
        merchant: 'E2E Test Merchant',
        category: 'Makanan',
        paymentMethod: 'qris',
        transactionType: 'expense',
        date: '2026-08-01',
        confidence: 0.72,
      },
    });

    // ===== 2. Buka halaman & filter Perlu Review → email test tampil =====
    const card = await openReviewFilter(page, testMessageId);
    // Amount harus tampil (candidate dari metadata server) — bukti bug fix #1
    await expect(card.getByText(/Rp/).first()).toBeVisible();

    // ===== 3. Klik Setujui =====
    await card.getByTitle('Setujui').click();

    // ===== 4. Toast sukses =====
    await expect(page.getByText('Transaksi Gmail berhasil disimpan')).toBeVisible({ timeout: 20_000 });

    // ===== 5. Notifikasi in-app dibuat (dedupe per email) =====
    await expect.poll(async () => {
      const resp = await request.get('/api/notifications?limit=100', {
        headers: { Cookie: `better-auth.session_token=${session.cookie}` },
      });
      if (!resp.ok()) return false;
      const notifications = (await resp.json()) as Array<{ dedupe_key?: string; type?: string }>;
      return notifications.some((n) => n.dedupe_key === `gmail-review-${testMessageId}`);
    }, { timeout: 15_000 }).toBe(true);

    // ===== 6. Status log di server berubah menjadi approved =====
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
    }, { timeout: 15_000 }).toBe('approved');

    // ===== 7. Transaksi tersimpan dengan gmail_message_id = testMessageId =====
    await expect.poll(async () => {
      const resp = await request.get('/api/transactions?limit=5000', {
        headers: { Cookie: `better-auth.session_token=${session.cookie}` },
      });
      if (!resp.ok()) return false;
      const txs = (await resp.json()) as Array<{ gmail_message_id?: string }>;
      return txs.some((t) => t.gmail_message_id === testMessageId);
    }, { timeout: 15_000 }).toBe(true);

    pageErrors.expectClean();
  });
});
