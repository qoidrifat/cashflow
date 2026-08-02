/**
 * E2E: Notifikasi hasil review Gmail tampil REAL-TIME di bell icon (SSE).
 *
 * Alur (login via cookie, tanpa Google OAuth — pola sama dengan spec review):
 *   1. Seed email test (needs_review + candidate) via POST /api/gmail/logs.
 *   2. Buka /gmail-sync, filter "Perlu Review", klik Setujui / Tolak.
 *   3. TANPA reload halaman: buka dropdown bell → notifikasi hasil review
 *      muncul di daftar — SEMUA 4 hasil aksi review:
 *        - approve  → title "Transaksi Gmail diterima"
 *        - reject   → title "Transaksi ditolak"
 *        - duplikat → title "Transaksi Gmail duplikat" (warning)
 *        - amount kosong → title "Gagal menerima transaksi Gmail" (error)
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
import { seedGmailReviewEmail, openReviewFilter } from './helpers/gmailReview';
import {
  bellButton,
  unreadCountFromLabel,
  waitRealtimeConnected,
  assertBellNotification,
} from './helpers/realtime';

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
    // Catat messageId SEBELUM seed — bila seed gagal, id tetap ter-cleanup
    // di afterAll (bukan meninggalkan data orfanas).
    testMessageId = `${'e2e-bell-'}${Date.now()}`;
    testMessageIds.push(testMessageId);
    await seedGmailReviewEmail(request, session, {
      prefix: 'e2e-bell-',
      subject: `E2E Bell Test ${Date.now()}`,
      sender: 'e2e-bell@example.com',
      confidenceScore: 0.7,
      candidate: {
        amount: 75000,
        merchant: 'E2E Bell Merchant',
        category: 'Transportasi',
        paymentMethod: 'e-wallet',
        transactionType: 'expense',
        date: '2026-08-01',
        confidence: 0.7,
      },
    });

    // ===== 2. Buka halaman & filter Perlu Review → email test tampil =====
    const card = await openReviewFilter(page, testMessageId);

    // ===== 3. Baseline unread count dari bell =====
    // Selector spesifik: hanya bell yang punya "belum dibaca" di aria-label
    // (nama /notifikasi/i ambigu — ada tombol "Tutup notifikasi" lain di halaman).
    const bell = bellButton(page);
    await expect(bell).toBeVisible();
    const baseline = unreadCountFromLabel(await bell.getAttribute('aria-label'));

    // ===== 4. Deterministik: SSE harus terhubung sebelum aksi =====
    // WifiOff hilang = realtimeConnected true → push `notification:new`
    // dijamin sampai (SSE lambat connect tidak bikin flaky).
    await waitRealtimeConnected(bell);

    // ===== 5. Klik Setujui =====
    await card.getByTitle('Setujui').click();
    await expect(page.getByText('Transaksi Gmail berhasil disimpan')).toBeVisible({ timeout: 20_000 });

    // ===== 6. Buka dropdown bell TANPA reload → notifikasi realtime + badge naik =====
    await assertBellNotification(page, bell, {
      itemName: /Transaksi Gmail diterima/,
      baselineUnread: baseline,
    });

    pageErrors.expectClean();
  });

  test('reject: notifikasi "Transaksi ditolak" muncul di bell TANPA reload', async ({ page, request }) => {
    const pageErrors = collectPageErrors(page);

    // ===== 1. Seed email test (unik per test) =====
    // Catat messageId SEBELUM seed — bila seed gagal, id tetap ter-cleanup
    // di afterAll (bukan meninggalkan data orfanas).
    testMessageId = `${'e2e-bell-'}${Date.now()}`;
    testMessageIds.push(testMessageId);
    await seedGmailReviewEmail(request, session, {
      prefix: 'e2e-bell-',
      subject: `E2E Bell Reject ${Date.now()}`,
      sender: 'e2e-bell@example.com',
      confidenceScore: 0.66,
      candidate: {
        amount: 65000,
        merchant: 'E2E Bell Reject Merchant',
        category: 'Belanja',
        paymentMethod: 'qris',
        transactionType: 'expense',
        date: '2026-08-01',
        confidence: 0.66,
      },
    });

    // ===== 2. Buka halaman & filter → email test tampil =====
    const card = await openReviewFilter(page, testMessageId);

    // ===== 3. Baseline unread =====
    // Selector spesifik: hanya bell yang punya "belum dibaca" di aria-label.
    const bell = bellButton(page);
    const baseline = unreadCountFromLabel(await bell.getAttribute('aria-label'));

    // ===== 4. Deterministik: SSE harus terhubung sebelum aksi =====
    await waitRealtimeConnected(bell);

    // ===== 5. Klik Tolak =====
    await card.getByTitle('Tolak').click();
    await expect(page.getByText('Transaksi ditolak').first()).toBeVisible({ timeout: 20_000 });

    // ===== 6. Buka dropdown bell TANPA reload → notifikasi realtime + badge naik =====
    await assertBellNotification(page, bell, {
      itemName: /Transaksi ditolak/,
      baselineUnread: baseline,
    });

    pageErrors.expectClean();
  });

  test('duplicate: notifikasi warning "Transaksi Gmail duplikat" muncul di bell TANPA reload', async ({ page, request }) => {
    const pageErrors = collectPageErrors(page);

    // ===== 1. Seed email test =====
    // Catat messageId SEBELUM seed — bila seed gagal, id tetap ter-cleanup.
    testMessageId = `${'e2e-bell-'}${Date.now()}`;
    testMessageIds.push(testMessageId);
    const amount = 88000;
    const merchant = 'E2E Bell Duplicate Merchant';
    await seedGmailReviewEmail(request, session, {
      prefix: 'e2e-bell-',
      subject: `E2E Bell Duplicate ${Date.now()}`,
      sender: 'e2e-bell@example.com',
      confidenceScore: 0.7,
      candidate: {
        amount,
        merchant,
        category: 'Belanja',
        paymentMethod: 'qris',
        transactionType: 'expense',
        date: '2026-08-01',
        confidence: 0.7,
      },
    });

    // ===== 2. Seed transaksi duplikat (gmail_message_id SAMA dengan email) =====
    // Menyimulasikan bahwa transaksi email ini SUDAH pernah disimpan —
    // klik Setujui akan memicu addTransaction → findDuplicateTransaction →
    // DuplicateTransactionError → status duplicate + notifikasi warning.
    const txResp = await request.post('/api/transactions', {
      headers: { Cookie: `better-auth.session_token=${session.cookie}` },
      data: {
        type: 'expense',
        amount,
        categoryId: 'belanja',
        categoryName: 'Belanja',
        merchant,
        paymentMethod: 'qris',
        note: 'Seed transaksi duplikat E2E bell',
        date: '2026-08-01',
        source: 'gmail',
        gmailMessageId: testMessageId,
        confidenceScore: 0.7,
      },
    });
    expect(txResp.ok(), 'seed transaksi duplikat via API').toBeTruthy();

    // ===== 3. Buka halaman & filter → email test tampil =====
    const card = await openReviewFilter(page, testMessageId);

    // ===== 4. Baseline unread + gate SSE deterministik =====
    const bell = bellButton(page);
    await expect(bell).toBeVisible();
    const baseline = unreadCountFromLabel(await bell.getAttribute('aria-label'));
    await waitRealtimeConnected(bell);

    // ===== 5. Klik Setujui → deteksi duplikat =====
    await card.getByTitle('Setujui').click();
    await expect(page.getByText('Transaksi duplikat').first()).toBeVisible({ timeout: 20_000 });

    // ===== 6. Notifikasi warning tampil realtime di bell TANPA reload =====
    await assertBellNotification(page, bell, {
      itemName: /Transaksi Gmail duplikat/,
      baselineUnread: baseline,
    });

    pageErrors.expectClean();
  });

  test('amount-missing: notifikasi error "Gagal menerima transaksi Gmail" muncul di bell TANPA reload', async ({ page, request }) => {
    const pageErrors = collectPageErrors(page);

    // ===== 1. Seed email test — candidate TANPA amount (nominal tidak ditemukan) =====
    testMessageId = `${'e2e-bell-'}${Date.now()}`;
    testMessageIds.push(testMessageId);
    await seedGmailReviewEmail(request, session, {
      prefix: 'e2e-bell-',
      subject: `E2E Bell No Amount ${Date.now()}`,
      sender: 'e2e-bell@example.com',
      confidenceScore: 0.6,
      candidate: {
        // amount TIDAK di-set — menyimulasikan nominal tidak ditemukan
        merchant: 'E2E Bell No Amount Merchant',
        category: 'Lainnya',
        date: '2026-08-01',
        confidence: 0.6,
      },
    });

    // ===== 2. Buka halaman & filter → email test tampil (tanpa nominal) =====
    const card = await openReviewFilter(page, testMessageId);
    await expect(card.getByText(/Rp/)).toHaveCount(0);

    // ===== 3. Baseline unread + gate SSE deterministik =====
    const bell = bellButton(page);
    await expect(bell).toBeVisible();
    const baseline = unreadCountFromLabel(await bell.getAttribute('aria-label'));
    await waitRealtimeConnected(bell);

    // ===== 4. Klik Setujui → feedback error (bukan silent return) =====
    await card.getByTitle('Setujui').click();
    await expect(page.getByText('Nominal transaksi tidak ditemukan').first()).toBeVisible({ timeout: 20_000 });

    // ===== 5. Notifikasi error tampil realtime di bell TANPA reload =====
    await assertBellNotification(page, bell, {
      itemName: /Gagal menerima transaksi Gmail/,
      baselineUnread: baseline,
    });

    pageErrors.expectClean();
  });
});
