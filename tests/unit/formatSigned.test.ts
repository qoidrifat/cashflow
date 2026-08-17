/**
 * Unit test: formatSigned (src/lib/utils.ts) — dedup helper untuk pola
 * `${v < 0 ? '-' : ''}${formatCurrency(v)}` yang dipakai AiHubPage,
 * ReportsPage, dan BudgetsPage (audit 2026-08-09).
 *
 * Kontrak:
 *  - formatCurrency global memakai Math.abs → tanda adalah tanggung jawab helper.
 *  - negatif → "-RpX" (selalu, apa pun showPlus).
 *  - positif tanpa showPlus → "RpX" (tanpa tanda — pola Saldo/Balance).
 *  - positif + showPlus → "+RpX" (pola Δ Saldo / net cashflow).
 *  - nol → "Rp0" TANPA tanda (hindari "+Rp0" — pola StatCard positive).
 */
import { describe, expect, it } from 'vitest';
import { formatSigned } from '../../src/lib/utils';

describe('formatSigned', () => {
  it('negatif selalu ber-prefix minus', () => {
    expect(formatSigned(-5_000)).toBe('-Rp5.000');
    expect(formatSigned(-1_250_000)).toBe('-Rp1.250.000');
  });

  it('positif tanpa showPlus TIDAK diberi tanda', () => {
    expect(formatSigned(5_000)).toBe('Rp5.000');
    expect(formatSigned(10_000_000)).toBe('Rp10.000.000');
  });

  it('positif dengan showPlus diberi prefix plus', () => {
    expect(formatSigned(5_000, { showPlus: true })).toBe('+Rp5.000');
    expect(formatSigned(987_000, { showPlus: true })).toBe('+Rp987.000');
  });

  it('showPlus tidak menimpa minus pada nilai negatif', () => {
    expect(formatSigned(-987_000, { showPlus: true })).toBe('-Rp987.000');
  });

  it('nol TANPA tanda (hindari +Rp0)', () => {
    expect(formatSigned(0)).toBe('Rp0');
    expect(formatSigned(0, { showPlus: true })).toBe('Rp0');
  });

  it('format angka mengikuti id-ID (grouping ribuan)', () => {
    expect(formatSigned(1_234_567)).toBe('Rp1.234.567');
    expect(formatSigned(-1_234_567)).toBe('-Rp1.234.567');
  });
});
