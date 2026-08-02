/**
 * E2E: Gmail Sync — kasus AMOUNT KOSONG di tab Perlu Review (regression guard).
 *
 * Pola identik dengan e2e/gmail-review-approve.spec.ts,
 * e2e/gmail-review-reject.spec.ts, dan e2e/gmail-review-duplicate.spec.ts
 * (login via cookie, seed via API, klik aksi di UI, assert server + notifikasi,
 * cleanup).
 *
 * BUG yang diperbaiki (2026-08-02): `handleApproveEmail` DULU punya
 * `if (!email.amount) return;` — return DIAM-DIAM tanpa feedback apa pun saat
 * nominal tidak ditemukan. Kini:
 *   - Toast error jelas: "Tidak dapat menyetujui" / "Nominal transaksi tidak
 *     ditemukan pada email ini..." (bukan silent return).
 *   - Notifikasi failed dibuat (dedupeKey gmail-review-<messageId>, type
 *     'error', title 'Gagal menerima transaksi Gmail').
 *   - Status log TETAP `needs_review` (tidak dipersist sebagai approved).
 *   - TIDAK ada transaksi dibuat.
 *
 * Alur test:
 *   1. Seed email test (status needs_review, metadata.candidate TANPA amount)
 *      via POST /api/gmail/logs.
 *   2. Buka /gmail-sync, klik filter "Perlu Review".
 *   3. Klik tombol Setujui pada email test.
 *   4. Assert: toast error "Nominal transaksi tidak ditemukan", notifikasi
 *      failed, status log tetap needs_review, TIDAK ada transaksi.
 *   5. Cleanup data test (log + notifikasi) di afterAll.
 *
 * Menjalankan:
 *   npx playwright test e2e/gmail-review-amount-missing.spec.ts
 */
import { test, expect } from 'playwright/test';
import { mintSessionCookie, cleanupTestSessions, cleanupGmailReviewTestData } from './helpers/mintSession';
import { setupAuthContext } from './helpers/authContext';
import { collectPageErrors } from './helpers/errors';

const TEST_MESSAGE_PREFIX = 'e2e-amount-';

test.describe('Gmail Sync Perlu Review — amount missing flow (e2e)', () => {
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

  test('approve email tanpa amount: toast error + notifikasi failed + status tetap needs_review + TIDAK ada transaksi', async ({ page, request }) => {
    const pageErrors = collectPageErrors(page);

    // ===== 1. Seed email test — candidate TANPA amount (nilai yang tersimpan
    //      dari email yang gagal diekstrak / tidak ditemukan nominal) =====
    testMessageId = `${TEST_MESSAGE_PREFIX}${Date.now()}`;
    const subject = `E2E Amount Missing Test ${Date.now()}`;
    const merchant = 'E2E No Amount Merchant';

    const seedResp = await request.post('/api/gmail/logs', {
      headers: { Cookie: `better-auth.session_token=${session.cookie}` },
      data: {
        messageId: testMessageId,
        subject,
        sender: 'e2e-amount@example.com',
        emailDate: '2026-08-01T00:00:00.000Z',
        status: 'needs_review',
        finalStatus: 'needs_review',
        confidenceScore: 0.6,
        metadata: {
          candidate: {
            // amount TIDAK di-set — menyimulasikan nominal tidak ditemukan
            merchant,
            category: 'Lainnya',
            date: '2026-08-01',
            confidence: 0.6,
          },
        },
      },
    });
    expect(seedResp.ok(), 'seed email test via API').toBeTruthy();

    // ===== 2. Buka halaman & filter Perlu Review =====
    await page.goto('/gmail-sync');
    await page.waitForLoadState('domcontentloaded');

    await page.getByRole('button', { name: 'Perlu Review', exact: true }).click();

    // ===== 3. Email test tampil (tanpa amount — tidak ada teks Rp) =====
    const card = page.getByTestId(`email-card-${testMessageId}`);
    await expect(card).toBeVisible({ timeout: 20_000 });
    // Bukti amount memang tidak ada: kartu TIDAK menampilkan nominal
    await expect(card.getByText(/Rp/)).toHaveCount(0);

    // ===== 4. Klik Setujui → harusnya feedback error, bukan silent return =====
    await card.getByTitle('Setujui').click();

    // ===== 5. Toast error (bukan silent return) =====
    await expect(page.getByText('Nominal transaksi tidak ditemukan').first()).toBeVisible({ timeout: 20_000 });

    // ===== 6. Notifikasi failed dibuat (type error, title 'Gagal menerima transaksi Gmail') =====
    await expect.poll(async () => {
      const resp = await request.get('/api/notifications?limit=100', {
        headers: { Cookie: `better-auth.session_token=${session.cookie}` },
      });
      if (!resp.ok()) return false;
      const notifications = (await resp.json()) as Array<{ dedupe_key?: string; type?: string; title?: string; message?: string }>;
      return notifications.some(
        (n) =>
          n.dedupe_key === `gmail-review-${testMessageId}` &&
          n.type === 'error' &&
          (n.title || '').includes('Gagal menerima transaksi Gmail') &&
          (n.message || '').includes('Nominal transaksi tidak ditemukan'),
      );
    }, { timeout: 15_000 }).toBe(true);

    // ===== 7. Status log TETAP needs_review (tidak diubah ke approved) =====
    // Settle delay: beri jendela waktu bagi perubahan hipotetis (bug yang
    // keliru mempersist status) untuk mendarat, agar assert "tetap" ini tidak
    // lolos vakum (poll resolusi seketika sebelum perubahan async muncul).
    await page.waitForTimeout(1000);
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
    }, { timeout: 15_000 }).toBe('needs_review');

    // ===== 8. TIDAK ada transaksi dibuat =====
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
