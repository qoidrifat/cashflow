/**
 * Unit tests — sanitizeCategoryInput (src/lib/categoryFilter.ts).
 * Mirip aturan sanitasi server agentSearchRoutes.validateSearchFilters:
 * trim + buang `"` `\` + cap 80.
 */
import { describe, expect, it } from 'vitest';
import { CATEGORY_FILTER_MAX_LENGTH, sanitizeCategoryInput } from '../../src/lib/categoryFilter';

describe('sanitizeCategoryInput', () => {
  it('trim spasi tepi', () => {
    expect(sanitizeCategoryInput('  Makanan  ')).toBe('Makanan');
  });

  it('buang karakter quote (berbahaya untuk filter string Discovery)', () => {
    expect(sanitizeCategoryInput('Makanan "Kantor"')).toBe('Makanan Kantor');
  });

  it('buang backslash', () => {
    expect(sanitizeCategoryInput('Tagihan\\Listrik')).toBe('TagihanListrik');
  });

  it('buang kombinasi quote dan backslash', () => {
    expect(sanitizeCategoryInput('"A\\B"')).toBe('AB');
  });

  it('potong ke batas 80 karakter (aturan server)', () => {
    const long = 'k'.repeat(200);
    const result = sanitizeCategoryInput(long);
    expect(result.length).toBe(CATEGORY_FILTER_MAX_LENGTH);
    expect(result.length).toBe(80);
  });

  it('string kosong setelah sanitasi tetap kosong (server tolak < 1 karakter)', () => {
    expect(sanitizeCategoryInput('   ')).toBe('');
    expect(sanitizeCategoryInput('"\\"')).toBe('');
  });

  it('nilai valid tidak berubah', () => {
    expect(sanitizeCategoryInput('Transportasi')).toBe('Transportasi');
  });
});
