/**
 * E2E: Gmail Sync — kasus DUPLIKAT di tab Perlu Review (regression guard).
 *
 * Pola identik dengan e2e/gmail-review-approve.spec.ts dan
 * e2e/gmail-review-reject.spec.ts (login via cookie, seed via API, klik aksi di
 * UI, assert server + notifikasi, cleanup).
 *
 * Kasus: user menyetujui email yang transaksinya SUDAH pernah dibuat (duplikat
 * gmail_message_id). `addTransaction` → `findDuplicateTransaction` (GET
 * /api/transactions, cek `gmailMessageId` sama) → throw
 * `DuplicateTransactionError` → `handleApproveEmail` menangkap:
 *   - Status log di server = `duplicate` (di-persist, tidak muncul lagi di
 *     "Perlu Review" setelah refresh).
 *   - Toast warning "Transaksi duplikat".
 *   - Notifikasi warning (dedupeKey gmail-review-<messageId>, type 'warning',
 *     title 'Transaksi Gmail duplikat').
 *   - Transaksi dengan gmail_message_id = testMessageId TETAP 1 (tidak dobel).
 *
 * Alur test:
 *   1. Seed email test (needs_review + candidate) via POST /api/gmail/logs.
 *   2. Seed transaksi dengan gmail_message_id = testMessageId via
 *      POST /api/transactions (menyimulasikan transaksi yang sudah ada).
 *   3. Buka /gmail-sync, klik filter "Perlu Review", klik Setujui.
 *   4. Assert toast, notifikasi, status log = duplicate, jumlah transaksi = 1.
 *   5. Cleanup data test (transaksi + log + notifikasi) di afterAll.
 *
 * Menjalankan:
 *   npx playwright test e2e/gmail-review-duplicate.spec.ts
 */
import { test, expect } from 'playwright/test';
import { mintSessionCookie, cleanupTestSessions, cleanupGmailReviewTestData } from './helpers/mintSession';
import { setupAuthContext } from './helpers/authContext';
import { collectPageErrors } from './helpers/errors';
import { seedGmailReviewEmail, openReviewFilter } from './helpers/gmailReview';

test.describe('Gmail Sync Perlu Review — duplicate flow (e2e)', () => {
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

  test('approve email duplikat: status duplicate di server + notifikasi warning + transaksi tidak dobel', async ({ page, request }) => {
    const pageErrors = collectPageErrors(page);

    // ===== 1. Seed email test =====
    const amount = 90000;
    const merchant = 'E2E Duplicate Merchant';
    testMessageId = await seedGmailReviewEmail(request, session, {
      prefix: 'e2e-dup-',
      subject: `E2E Duplicate Test ${Date.now()}`,
      sender: 'e2e-dup@example.com',
      confidenceScore: 0.71,
      candidate: {
        amount,
        merchant,
        category: 'Belanja',
        paymentMethod: 'transfer-bank',
        transactionType: 'expense',
        date: '2026-08-01',
        confidence: 0.71,
      },
    });

    // ===== 2. Seed transaksi duplikat (gmail_message_id SAMA dengan email) =====
    // Menyimulasikan bahwa transaksi email ini SUDAH pernah disimpan sebelumnya
    // (mis. dari approve sebelumnya atau auto-accept). addTransaction akan
    // mendeteksinya via findDuplicateTransaction (cocokkan gmailMessageId).
    const txResp = await request.post('/api/transactions', {
      headers: { Cookie: `better-auth.session_token=${session.cookie}` },
      data: {
        type: 'expense',
        amount,
        categoryId: 'belanja',
        categoryName: 'Belanja',
        merchant,
        paymentMethod: 'transfer-bank',
        note: 'Seed transaksi duplikat E2E',
        date: '2026-08-01',
        source: 'gmail',
        gmailMessageId: testMessageId,
        confidenceScore: 0.71,
      },
    });
    expect(txResp.ok(), 'seed transaksi duplikat via API').toBeTruthy();

    // ===== 3. Buka halaman & filter Perlu Review → email test tampil =====
    const card = await openReviewFilter(page, testMessageId);
    await expect(card.getByText(/Rp/).first()).toBeVisible();

    // ===== 4. Klik Setujui → addTransaction mendeteksi duplikat =====
    await card.getByTitle('Setujui').click();

    // ===== 5. Toast warning duplikat =====
    await expect(page.getByText('Transaksi duplikat').first()).toBeVisible({ timeout: 20_000 });

    // ===== 6. Notifikasi warning dibuat (type warning, title 'Transaksi Gmail duplikat') =====
    await expect.poll(async () => {
      const resp = await request.get('/api/notifications?limit=100', {
        headers: { Cookie: `better-auth.session_token=${session.cookie}` },
      });
      if (!resp.ok()) return false;
      const notifications = (await resp.json()) as Array<{ dedupe_key?: string; type?: string; title?: string }>;
      return notifications.some(
        (n) =>
          n.dedupe_key === `gmail-review-${testMessageId}` &&
          n.type === 'warning' &&
          (n.title || '').includes('duplikat'),
      );
    }, { timeout: 15_000 }).toBe(true);

    // ===== 7. Status log di server berubah menjadi duplicate =====
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
    }, { timeout: 15_000 }).toBe('duplicate');

    // ===== 8. Transaksi dengan gmail_message_id ini TETAP 1 (tidak dobel) =====
    await expect.poll(async () => {
      const resp = await request.get('/api/transactions?limit=5000', {
        headers: { Cookie: `better-auth.session_token=${session.cookie}` },
      });
      if (!resp.ok()) return -1;
      const txs = (await resp.json()) as Array<{ gmail_message_id?: string }>;
      return txs.filter((t) => t.gmail_message_id === testMessageId).length;
    }, { timeout: 15_000 }).toBe(1);

    pageErrors.expectClean();
  });
});
