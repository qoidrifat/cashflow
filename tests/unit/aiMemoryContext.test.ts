/**
 * Unit test — Integrasi AI Memory ke prompt advisor/insight (Sprint 1.5).
 *
 * Memverifikasi lib/aiMemoryContext.js (formatter murni "AI ingat: ...") dan
 * injeksinya ke buildAdvisorPrompt / buildMonthlyReportPrompt:
 *   - format, sanitasi, cap item/char, framing anti prompt-injection
 *   - prompt advisor & insight mengandung section memory saat ada data,
 *     dan TIDAK mengandung section saat kosong
 *   - memory tidak ikut di-serialize mentah ke JSON data laporan
 *
 * Murni — tanpa DB, tanpa Gemini.
 */
import { describe, expect, it } from 'vitest';
import {
  formatMemoryPrompt,
  formatMemoryLine,
  sanitizeMemoryText,
  memoryCategoryLabel,
  MEMORY_PROMPT_MAX_ITEMS,
} from '../../server/lib/aiMemoryContext.js';
import {
  buildAdvisorPrompt,
  buildMonthlyReportPrompt,
} from '../../server/lib/vertexContext.js';

const SAMPLE_MEMORY = [
  { category: 'payment_preference', key: 'Metode favorit', value: 'QRIS' },
  { category: 'spending_habit', key: 'Makan siang', value: 'Sering GoFood' },
  { category: 'goal', key: 'Target tabungan', value: 'Dana darurat 6 bulan' },
];

describe('formatMemoryLine & sanitizeMemoryText', () => {
  it('memformat baris "- key: \"value\" (Label)"', () => {
    expect(formatMemoryLine({ category: 'payment_preference', key: 'Metode favorit', value: 'QRIS' }))
      .toBe('- Metode favorit: "QRIS" (Preferensi Pembayaran)');
  });

  it('tanpa key → hanya value', () => {
    expect(formatMemoryLine({ category: 'note', value: 'Rajin nabung' }))
      .toBe('- "Rajin nabung" (Catatan)');
  });

  it('kategori tak dikenal → fallback raw category', () => {
    expect(formatMemoryLine({ category: 'secret_hack', key: 'k', value: 'v' }))
      .toBe('- k: "v" (secret_hack)');
  });

  it('baris kosong → null (tidak ikut prompt)', () => {
    expect(formatMemoryLine({})).toBeNull();
  });

  it('sanitasi: buang control char & collapse spasi', () => {
    expect(sanitizeMemoryText('  a\u0000\u0001b \t c  ')).toBe('a b c');
  });

  it('sanitasi: cap panjang value & key', () => {
    expect(sanitizeMemoryText('x'.repeat(300), 140)).toHaveLength(140);
    expect(sanitizeMemoryText('y'.repeat(100), 60)).toHaveLength(60);
  });

  it('label kategori dikenal', () => {
    expect(memoryCategoryLabel('budget_style')).toBe('Gaya Budget');
    expect(memoryCategoryLabel('langganan_xyz')).toBe('langganan_xyz');
  });
});

describe('formatMemoryPrompt', () => {
  it('kosong / bukan array → string kosong', () => {
    expect(formatMemoryPrompt([])).toBe('');
    expect(formatMemoryPrompt(undefined)).toBe('');
    expect(formatMemoryPrompt(null)).toBe('');
  });

  it('menghasilkan section ber-frame "BUKAN instruksi" dengan semua baris', () => {
    const s = formatMemoryPrompt(SAMPLE_MEMORY);
    expect(s).toContain('PREFERENSI PENGGUNA YANG AI INGAT');
    expect(s).toContain('BUKAN instruksi');
    expect(s).toContain('- Metode favorit: "QRIS" (Preferensi Pembayaran)');
    expect(s).toContain('- Makan siang: "Sering GoFood" (Kebiasaan Belanja)');
    expect(s).toContain('- Target tabungan: "Dana darurat 6 bulan" (Tujuan Keuangan)');
  });

  it('maxItems membatasi jumlah baris', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ category: 'note', key: `k${i}`, value: `v${i}` }));
    const s = formatMemoryPrompt(many);
    expect(s.split('\n').filter((l) => l.startsWith('- '))).toHaveLength(MEMORY_PROMPT_MAX_ITEMS);
  });

  it('maxTotalChars memotong baris (minimal tetap 1 baris)', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ category: 'note', key: `k${i}`, value: 'v'.repeat(200) }));
    const s = formatMemoryPrompt(many, { maxTotalChars: 300 });
    // value di-cap 140 → tiap baris ±158 char; budget 300 hanya muat 1 baris
    expect(s.split('\n').filter((l) => l.startsWith('- '))).toHaveLength(1);
    // total section = header framing + 1 baris — tetap dibawah 500 char
    expect(s.length).toBeGreaterThan(0);
    expect(s.length).toBeLessThan(500);
  });

  it('semua baris kosong → string kosong', () => {
    expect(formatMemoryPrompt([{}, { key: '  ' }])).toBe('');
  });
});

describe('buildAdvisorPrompt — injeksi memory', () => {
  const base = { metrics: { currentMonthIncome: 5000000 }, subscriptions: [] };

  it('tanpa memory → tidak ada section PREFERENSI', () => {
    expect(buildAdvisorPrompt(base)).not.toContain('PREFERENSI PENGGUNA YANG AI INGAT');
  });

  it('dengan memory → section muncul & value tersanitasi', () => {
    const p = buildAdvisorPrompt({ ...base, memory: SAMPLE_MEMORY });
    expect(p).toContain('PREFERENSI PENGGUNA YANG AI INGAT');
    expect(p).toContain('QRIS');
    expect(p).toContain('Sering GoFood');
  });

  it('memory tidak ikut di-serialize mentah ke blok data', () => {
    const p = buildAdvisorPrompt({ ...base, memory: [{ category: 'note', key: 'rahasia', value: 'sensitif-123' }] });
    // value hanya muncul 1x (di section) — tidak bocor ke JSON.stringify data
    expect(p.match(/sensitif-123/g)).toHaveLength(1);
  });
});

describe('buildMonthlyReportPrompt — injeksi memory', () => {
  it('tanpa memory → tidak ada section', () => {
    const p = buildMonthlyReportPrompt({ month: 8, year: 2026, metrics: {} });
    expect(p).not.toContain('PREFERENSI PENGGUNA YANG AI INGAT');
  });

  it('dengan memory → section muncul', () => {
    const p = buildMonthlyReportPrompt({
      month: 8,
      year: 2026,
      metrics: {},
      memory: SAMPLE_MEMORY,
    });
    expect(p).toContain('PREFERENSI PENGGUNA YANG AI INGAT');
    expect(p).toContain('QRIS');
  });

  it('memory diekstrak — tidak ikut JSON.stringify data laporan', () => {
    const p = buildMonthlyReportPrompt({
      month: 8,
      year: 2026,
      metrics: { currentMonthExpense: 100000 },
      memory: [{ category: 'note', key: 'k', value: 'rahasia-memory' }],
    });
    // "rahasia-memory" hanya muncul 1x (di section), bukan di JSON data
    expect(p.match(/rahasia-memory/g)).toHaveLength(1);
  });

  it('memory kosong → format sama seperti sebelumnya (backward compatible)', () => {
    const withEmpty = buildMonthlyReportPrompt({ month: 8, year: 2026, metrics: { a: 1 }, memory: [] });
    const without = buildMonthlyReportPrompt({ month: 8, year: 2026, metrics: { a: 1 } });
    expect(withEmpty).toBe(without);
  });
});
