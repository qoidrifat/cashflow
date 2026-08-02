/**
 * Helpers E2E: kolektor page errors — satu sumber kebenaran untuk memastikan
 * tidak ada JavaScript error di halaman selama test.
 *
 * Dipakai di semua spec (dashboard, gmail-sync, transactions) agar boilerplate
 * `page.on('pageerror')` tidak diduplikasi.
 */
import { expect, type Page } from 'playwright/test';

export interface PageErrorCollector {
  /** Daftar message error yang tertangkap (copy agar aman). */
  all(): string[];
  /** Assert tidak ada error sama sekali — panggil di akhir test. */
  expectClean(): void;
}

/**
 * Daftarkan listener pageerror SEBELUM navigasi, lalu kembalikan collector.
 * Contoh:
 *   const pageErrors = collectPageErrors(page);
 *   await page.goto('/dashboard');
 *   ...
 *   pageErrors.expectClean();
 */
export function collectPageErrors(page: Page): PageErrorCollector {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  return {
    all: () => [...errors],
    expectClean: () => expect(errors).toEqual([]),
  };
}
