/**
 * E2E: Gmail Sync — alur "Setujui" klik ganda / fast-click (regression guard).
 *
 * BUG yang ditutup (2026-08-09): tombol Setujui TIDAK di-disable saat request
 * approve in-flight → klik ganda memicu eksekusi handler 2× (toast/persist/
 * notifikasi dobel). Data integrity sudah dijamin lapisan bawah (in-flight map
 * addTransaction + Idempotency-Key server), guard UI ini menutup sisi UX:
 * konfirmasi TUNGGAL — tombol disabled + spinner ("Menyetujui...") selama
 * request berjalan, klik kedua diabaikan.
 *
 * Alur test (pola identik gmail-review-approve.spec.ts + route-delay):
 *   1. Seed email test (status needs_review + metadata.candidate.amount).
 *   2. Route-delay POST /api/transactions (1200ms) agar window in-flight terlihat.
 *   3. Klik Setujui SATU kali → tombol langsung disabled ("Menyetujui...").
 *   4. Klik paksa kedua saat disabled → no-op (guard + disabled attribute).
 *   5. Assert hasil FINAL = tepat SATU transaksi (gmail_message_id), status log
 *      approved, dan TEPAT SATU notifikasi (dedupeKey gmail-review-<id>).
 *   6. Cleanup data test di afterAll.
 *
 * Menjalankan:
 *   npx playwright test e2e/gmail-review-approve-doubleclick.spec.ts
 */
import { test, expect } from 'playwright/test';
import { mintSessionCookie, cleanupTestSessions, cleanupGmailReviewTestData } from './helpers/mintSession';
import { setupAuthContext } from './helpers/authContext';
import { collectPageErrors } from './helpers/errors';
import { seedGmailReviewEmail, openReviewFilter } from './helpers/gmailReview';

/** Tahan POST /api/transactions agar state in-flight bisa diverifikasi. */
const APPROVE_HOLD_MS = 1200;

test.describe('Gmail Sync Perlu Review — approve double-click guard (e2e)', () => {
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

  test('klik ganda Setujui → SATU transaksi, SATU notifikasi, tombol disabled saat in-flight', async ({ page, request }) => {
    const pageErrors = collectPageErrors(page);

    // ===== 0. Route-delay: tahan POST transaksi agar window in-flight terlihat =====
    await page.route('**/api/transactions', async (route) => {
      const req = route.request();
      if (req.method() === 'POST') {
        await new Promise((r) => setTimeout(r, APPROVE_HOLD_MS));
      }
      await route.continue();
    });

    // ===== 1. Seed email test =====
    testMessageId = await seedGmailReviewEmail(request, session, {
      prefix: 'e2e-dbl-',
      subject: `E2E DoubleClick Test ${Date.now()}`,
      sender: 'e2e-dbl@example.com',
      confidenceScore: 0.72,
      candidate: {
        amount: 135000,
        merchant: 'E2E DoubleClick Merchant',
        category: 'Makanan',
        paymentMethod: 'qris',
        transactionType: 'expense',
        date: '2026-08-01',
        confidence: 0.72,
      },
    });

    // ===== 2. Buka halaman & filter Perlu Review → email test tampil =====
    const card = await openReviewFilter(page, testMessageId);
    await expect(card.getByText(/Rp/).first()).toBeVisible();

    // ===== 3. Klik Setujui sekali — tombol berubah disabled + spinner =====
    const approveBtn = card.getByTitle('Setujui');
    await expect(approveBtn).toBeEnabled();
    await approveBtn.click();

    // In-flight lock: tombol ganti title jadi "Menyetujui..." dan disabled
    // (spinner Lucide render sebagai svg tanpa role — cukup kontrak title+
    // disabled, icon spinner tidak di-assert).
    const pendingBtn = card.getByTitle('Menyetujui...');
    await expect(pendingBtn).toBeDisabled({ timeout: 5_000 });

    // ===== 4. Klik paksa KEDUA saat disabled — harus no-op =====
    // force bypass actionability; disabled button tidak mem-firing click event
    // (dan ref guard di handler mengabaikan bila sempat lewat).
    await pendingBtn.click({ force: true, timeout: 2_000 });

    // ===== 5. Hasil final: request pertama selesai (route delay berlalu) =====
    await expect(page.getByText('Transaksi Gmail berhasil disimpan')).toBeVisible({ timeout: 20_000 });

    // 5a. TEPAT SATU transaksi dengan gmail_message_id ini (create-once).
    await expect.poll(async () => {
      const resp = await request.get('/api/transactions?limit=5000', {
        headers: { Cookie: `better-auth.session_token=${session.cookie}` },
      });
      if (!resp.ok()) return -1;
      const txs = (await resp.json()) as Array<{ gmail_message_id?: string }>;
      return txs.filter((t) => t.gmail_message_id === testMessageId).length;
    }, { timeout: 15_000 }).toBe(1);

    // 5b. Status log di server = approved (persist sekali).
    await expect.poll(async () => {
      const resp = await request.get('/api/gmail/logs?limit=5000&includeSummary=1', {
        headers: { Cookie: `better-auth.session_token=${session.cookie}` },
      });
      if (!resp.ok()) return null;
      const json = (await resp.json()) as { data?: Array<{ message_id?: string; messageId?: string; status?: string; final_status?: string }> };
      const rows = Array.isArray(json) ? json : json.data || [];
      const found = rows.find((r) => (r.message_id || r.messageId) === testMessageId);
      return found ? (found.status || found.final_status) : null;
    }, { timeout: 15_000 }).toBe('approved');

    // 5c. TEPAT SATU notifikasi (dedupe per email) — bukan dua.
    await expect.poll(async () => {
      const resp = await request.get('/api/notifications?limit=100', {
        headers: { Cookie: `better-auth.session_token=${session.cookie}` },
      });
      if (!resp.ok()) return -1;
      const notifications = (await resp.json()) as Array<{ dedupe_key?: string }>;
      return notifications.filter((n) => n.dedupe_key === `gmail-review-${testMessageId}`).length;
    }, { timeout: 15_000 }).toBe(1);

    pageErrors.expectClean();
  });
});
