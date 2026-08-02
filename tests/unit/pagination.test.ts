/**
 * Unit test: e2e/helpers/pagination.ts — fungsi MURNI (tanpa playwright).
 *
 * getListCountText / waitListTotal / waitListRange butuh Page & expect dari
 * playwright — diuji di E2E (transactions.spec / gmail-sync.spec). Di sini hanya
 * fungsi pure yang dipakai sebagai dasar regex parsing.
 */
import { describe, it, expect, vi } from 'vitest';

// pagination.ts meng-import { expect } dari 'playwright/test' di module top-level.
// Fungsi yang diuji (counterRegexFor, listTotalFrom, listRangeFrom) TIDAK memakai
// expect/Page — mock modul agar vitest tidak memuat test runner playwright.
vi.mock('playwright/test', () => ({ expect: {}, type: undefined }));

import { counterRegexFor, listTotalFrom, listRangeFrom } from '../../e2e/helpers/pagination';

describe('counterRegexFor', () => {
  it('membangun regex dari keyword (email)', () => {
    const re = counterRegexFor('email');
    expect(re).toBeInstanceOf(RegExp);
    expect(re.test('Menampilkan 1-100 dari 519 email')).toBe(true);
    expect(re.test('Menampilkan 1-50 dari 284 transaksi')).toBe(false);
  });

  it('membangun regex dari keyword (transaksi)', () => {
    const re = counterRegexFor('transaksi');
    expect(re.test('Menampilkan 1-50 dari 284 transaksi')).toBe(true);
    expect(re.test('Menampilkan 1-100 dari 519 email')).toBe(false);
  });
});

describe('listTotalFrom', () => {
  it('parse total dari teks counter', () => {
    expect(listTotalFrom('Menampilkan 1-100 dari 519 email', 'email')).toBe(519);
    expect(listTotalFrom('Menampilkan 1-50 dari 284 transaksi', 'transaksi')).toBe(284);
  });

  it('mengembalikan -1 bila format tidak cocok', () => {
    expect(listTotalFrom('Tidak ada data', 'email')).toBe(-1);
  });
});

describe('listRangeFrom', () => {
  it('parse start-end-total', () => {
    expect(listRangeFrom('Menampilkan 1-100 dari 519 email', 'email')).toEqual({
      start: 1,
      end: 100,
      total: 519,
    });
    expect(listRangeFrom('Menampilkan 101-200 dari 519 email', 'email')).toEqual({
      start: 101,
      end: 200,
      total: 519,
    });
    expect(listRangeFrom('Menampilkan 1-50 dari 284 transaksi', 'transaksi')).toEqual({
      start: 1,
      end: 50,
      total: 284,
    });
  });

  it('halaman terakhir: end = total', () => {
    expect(listRangeFrom('Menampilkan 501-519 dari 519 email', 'email')).toEqual({
      start: 501,
      end: 519,
      total: 519,
    });
  });

  it('mengembalikan -1/-1/-1 bila format tidak cocok', () => {
    expect(listRangeFrom('garbage', 'email')).toEqual({ start: -1, end: -1, total: -1 });
  });
});
