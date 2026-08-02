/**
 * Helpers E2E UNTUK REALTIME / SSE — bell notifikasi + gate koneksi SSE.
 *
 * Di-relokasi dari e2e/helpers/gmailReview.ts (commit d0d12aa) agar tidak
 * terikat ke domain "Gmail review" — konsep SSE/bell ini bersifat GENERIK dan
 * bisa dipakai ulang oleh spec lain (mis. spec dashboard yang menunggu push
 * realtime, spec notifikasi apa pun).
 *
 * Isi:
 *   1. bellButton            — locator tombol bell (selector anti-ambigu).
 *   2. unreadCountFromLabel  — parse jumlah unread dari aria-label bell.
 *   3. waitRealtimeConnected — gate deterministik: tunggu EventSource SSE
 *                              terhubung SEBELUM aksi (anti-flaky push terlewat).
 *   4. assertBellNotification — buka dropdown bell TANPA reload + assert
 *                              menuitem realtime (SSE push) + badge unread naik.
 *
 * Dipakai oleh: e2e/notifications-realtime.spec.ts (dan spec lain yang
 * meng-assert UI yang di-update oleh SSE push tanpa reload).
 */
import { expect, type Locator, type Page } from 'playwright/test';

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
 * Deterministik: tunggu koneksi SSE terbuka SEBELUM aksi yang memicu push.
 *
 * Indikator: ikon WifiOff (anak elemen bell, class `text-amber-500`) HILANG
 * saat `realtimeConnected === true` (App.tsx: `onStatus: setRealtimeConnected`
 * dipanggil saat EventSource onopen). Dengan menunggu ikon hilang, test tidak
 * pernah mengeksekusi aksi sebelum jalur push (mis. `notification:new`) siap —
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
 *   2. Menuitem notifikasi hasil aksi muncul (REALTIME via SSE push:
 *      POST /api/notifications → notifyUser('notification:new') →
 *      prependNotification → store → dropdown).
 *   3. Badge unread bertambah (jumlah belum dibaca > baseline).
 *
 * Generik: `itemName` menerima regex apa pun — title notifikasi yang
 * di-assert ditentukan pemanggil (mis. "Transaksi Gmail diterima").
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
