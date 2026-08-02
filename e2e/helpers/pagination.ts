/**
 * Helpers E2E: pagination / list counter — dipakai bersama oleh spec Transaksi
 * dan Gmail Sync (satu sumber kebenaran, cukup beda keyword counter).
 *
 * Contoh counter:
 *   - Transaksi:  "Menampilkan 1-50 dari 284 transaksi"   → keyword 'transaksi'
 *   - Gmail Sync: "Menampilkan 1-100 dari 519 email"      → keyword 'email'
 *
 * Regex counter diturunkan dari keyword, sehingga spec tidak perlu
 * mendefinisikan regex duplikat.
 */
import { expect, type Page } from 'playwright/test';

/** Bangun regex counter "Menampilkan a-b dari c <keyword>" dari keyword. */
export function counterRegexFor(keyword: string): RegExp {
  return new RegExp(`Menampilkan \\d+-\\d+ dari \\d+ ${keyword}`);
}

/** Ambil teks counter "Menampilkan a-b dari c <keyword>" yang terlihat di halaman. */
export async function getListCountText(page: Page, keyword: string): Promise<string> {
  const el = page.getByText(counterRegexFor(keyword)).first();
  await expect(el).toBeVisible();
  return (await el.textContent()) ?? '';
}

/** Parse total (c) dari teks counter. */
export function listTotalFrom(text: string, keyword: string): number {
  const m = text.match(new RegExp(`dari (\\d+) ${keyword}`));
  return m ? Number(m[1]) : -1;
}

/** Parse {start, end, total} dari teks counter. */
export function listRangeFrom(text: string, keyword: string): { start: number; end: number; total: number } {
  const m = text.match(new RegExp(`Menampilkan (\\d+)-(\\d+) dari (\\d+) ${keyword}`));
  return m ? { start: Number(m[1]), end: Number(m[2]), total: Number(m[3]) } : { start: -1, end: -1, total: -1 };
}

/** Tunggu hingga list count berubah (menampilkan total tertentu). */
export async function waitListTotal(page: Page, keyword: string, expected: number): Promise<void> {
  await expect
    .poll(async () => {
      const text = await getListCountText(page, keyword).catch(() => '');
      return listTotalFrom(text, keyword);
    })
    .toBe(expected);
}

/** Tunggu hingga counter "Menampilkan start-end dari total <keyword>" tepat seperti expected. */
export async function waitListRange(
  page: Page,
  keyword: string,
  start: number,
  end: number,
  total: number,
): Promise<void> {
  await expect
    .poll(async () => {
      const text = await getListCountText(page, keyword).catch(() => '');
      const r = listRangeFrom(text, keyword);
      return `${r.start}-${r.end}-${r.total}`;
    })
    .toBe(`${start}-${end}-${total}`);
}
