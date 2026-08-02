/**
 * Helpers E2E BERSAMA untuk spec Gmail Sync "Perlu Review".
 *
 * Mengurangi duplikasi antar 5 spec:
 *   - e2e/gmail-review-approve.spec.ts
 *   - e2e/gmail-review-reject.spec.ts
 *   - e2e/gmail-review-duplicate.spec.ts
 *   - e2e/gmail-review-amount-missing.spec.ts
 *   - e2e/notifications-realtime.spec.ts (bell)
 *
 * Tiga helper inti (diminta refactor):
 *   1. seedGmailReviewEmail  — POST /api/gmail/logs (needs_review + candidate).
 *   2. openReviewFilter      — buka /gmail-sync + filter "Perlu Review" + tunggu
 *                              email test tampil (return locator kartu).
 *   3. assertBellNotification — buka dropdown bell TANPA reload + assert menuitem
 *                              realtime (SSE) + badge unread naik.
 * Plus pendukung bell: bellButton / unreadCountFromLabel / waitRealtimeConnected
 * (semuanya di-relokasi dari notifications-realtime.spec.ts agar satu sumber).
 */
import { expect, type APIRequestContext, type Locator, type Page } from 'playwright/test';

/** Bentuk minimal sesi hasil mintSessionCookie (cukup cookie untuk seed API). */
export interface MintedSessionLike {
  cookie: string;
}

export interface GmailReviewSeedOptions {
  /** Prefiks messageId unik per spec (mis. 'e2e-review-'). Helper menambahkan timestamp. */
  prefix: string;
  subject?: string;
  sender?: string;
  confidenceScore?: number;
  /**
   * Candidate yang disimpan di metadata. `amount` OPSIONAL — kasus
   * amount-missing TIDAK mengirim amount (menyimulasikan nominal tidak ditemukan).
   */
  candidate: {
    amount?: number;
    merchant?: string;
    category?: string;
    paymentMethod?: string;
    transactionType?: string;
    date?: string;
    confidence?: number;
  };
}

/**
 * Seed email test (status needs_review + metadata.candidate) via POST /api/gmail/logs.
 * Mengembalikan messageId yang dibuat (dipakai tracking & cleanup di spec).
 */
export async function seedGmailReviewEmail(
  request: APIRequestContext,
  session: MintedSessionLike,
  options: GmailReviewSeedOptions,
): Promise<string> {
  const messageId = `${options.prefix}${Date.now()}`;
  const confidence = options.confidenceScore ?? 0.7;

  const resp = await request.post('/api/gmail/logs', {
    headers: { Cookie: `better-auth.session_token=${session.cookie}` },
    data: {
      messageId,
      subject: options.subject ?? `E2E Gmail Review ${Date.now()}`,
      sender: options.sender ?? 'e2e-gmail@example.com',
      emailDate: '2026-08-01T00:00:00.000Z',
      status: 'needs_review',
      finalStatus: 'needs_review',
      confidenceScore: confidence,
      metadata: {
        candidate: {
          ...options.candidate,
          confidence: options.candidate.confidence ?? confidence,
        },
      },
    },
  });
  expect(resp.ok(), 'seed email test via API').toBeTruthy();
  return messageId;
}

/**
 * Buka /gmail-sync, klik filter "Perlu Review", tunggu email test tampil.
 * Return locator kartu email test (siap di-assert / diklik aksinya).
 */
export async function openReviewFilter(page: Page, testMessageId: string): Promise<Locator> {
  await page.goto('/gmail-sync');
  await page.waitForLoadState('domcontentloaded');

  // Tunggu list data tampil dulu (ground truth dari server)
  await page.getByRole('button', { name: 'Perlu Review', exact: true }).click();

  const card = page.getByTestId(`email-card-${testMessageId}`);
  await expect(card).toBeVisible({ timeout: 20_000 });
  return card;
}

/**
 * Locator tombol bell notifikasi. Selector spesifik: hanya bell yang punya
 * "belum dibaca" di aria-label (nama /notifikasi/i ambigu — ada tombol
 * "Tutup notifikasi" lain di halaman).
 */
export function bellButton(page: Page): Locator {
  return page.getByRole('button', { name: /belum dibaca/ });
}

/** Parse jumlah unread dari aria-label bell: "Buka notifikasi, X belum dibaca". */
export function unreadCountFromLabel(label: string | null): number {
  if (!label) return 0;
  const m = label.match(/(\d+)\s+belum dibaca/);
  return m ? Number(m[1]) : 0;
}

/**
 * Deterministik: tunggu koneksi SSE terbuka SEBELUM aksi approve/reject.
 *
 * Indikator: ikon WifiOff (anak elemen bell, class `text-amber-500`) HILANG
 * saat `realtimeConnected === true` (App.tsx: `onStatus: setRealtimeConnected`
 * dipanggil saat EventSource onopen). Dengan menunggu ikon hilang, test tidak
 * pernah mengeksekusi aksi sebelum jalur push `notification:new` siap —
 * SSE yang lambat connect tidak lagi membuat test flaky (item tidak muncul
 * karena push terlewat, bukan karena logika salah).
 *
 * Fallback aman: bila SSE tidak pernah connect dalam timeout, test gagal
 * di sini dengan pesan jelas (bukan timeout 20s misterius di menuitem).
 *
 * KAPAN GATE INI DIPERLUKAN (hasil audit 2026-08-03):
 *   HANYA spec yang meng-assert UI yang di-update oleh SSE PUSH tanpa reload
 *   (contoh: notifications-realtime.spec.ts — menuitem bell muncul dari event
 *   `notification:new`). Gate memastikan EventSource sudah connect SEBELUM
 *   aksi, jadi push tidak terlewat saat SSE lambat connect.
 *
 * KAPAN TIDAK PERLU (spec gmail-review-approve/reject/duplicate/amount-missing):
 *   Spec itu meng-assert state SERVER via `expect.poll` pada `request.get(...)`
 *   (API /api/notifications, /api/gmail/logs, /api/transactions). Poll ke server
 *   TIDAK bergantung pada SSE — ia retry sampai end-state tercapai, jadi sudah
 *   deterministik tanpa gate ini. Memakai gate di sana hanya menambah 1 dep
 *   SSE ekstra yang tidak relevan dengan yang di-assert.
 */
export async function waitRealtimeConnected(bell: Locator, timeout = 20_000): Promise<void> {
  await expect(bell.locator('.text-amber-500')).toHaveCount(0, { timeout });
}

export interface AssertBellNotificationOptions {
  /** Regex nama menuitem yang diharapkan, mis. /Transaksi Gmail diterima/. */
  itemName: RegExp;
  /** Baseline unread SEBELUM aksi (dari unreadCountFromLabel) — badge harus naik. */
  baselineUnread: number;
}

/**
 * Buka dropdown bell TANPA reload halaman lalu assert:
 *   1. Menu dropdown terbuka.
 *   2. Menuitem notifikasi hasil review muncul (REALTIME via SSE push:
 *      POST /api/notifications → notifyUser('notification:new') →
 *      prependNotification → store → dropdown).
 *   3. Badge unread bertambah (jumlah belum dibaca > baseline).
 */
export async function assertBellNotification(
  page: Page,
  bell: Locator,
  options: AssertBellNotificationOptions,
): Promise<void> {
  await bell.click();
  await expect(page.getByRole('menu')).toBeVisible({ timeout: 10_000 });

  // Notifikasi hasil review muncul realtime (SSE push)
  const item = page.getByRole('menuitem', { name: options.itemName }).first();
  await expect(item).toBeVisible({ timeout: 20_000 });

  // Badge unread bertambah (jumlah belum dibaca naik)
  await expect.poll(async () => {
    const current = unreadCountFromLabel(await bell.getAttribute('aria-label'));
    return current > options.baselineUnread;
  }, { timeout: 15_000 }).toBe(true);
}
