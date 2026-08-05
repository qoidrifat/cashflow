/**
 * Unit tests — Sprint 1.4 AI Search enhancements.
 * Backend: rankAndExplainResults + buildSuggestedQueries (server/services/agentSearchService.js).
 * Frontend: searchHistory (src/lib/searchHistory.ts) — murni, tanpa DOM.
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  rankAndExplainResults,
  buildSuggestedQueries,
} from '../../server/services/agentSearchService.js';
import {
  addRecentSearch,
  clearRecentSearches,
  readRecentSearches,
  MAX_RECENT_SEARCHES,
} from '../../src/lib/searchHistory';

const sampleResults = [
  { id: 'r1', title: 'Pengeluaran Tiket Bali Rp1.500.000', merchant: 'Tiket.com', type: 'expense', transaction_date: '2026-06-15', user_id_hash: 'hash_x' },
  { id: 'r2', title: 'Pengeluaran Gojek Rp25.000', merchant: 'Gojek', type: 'expense', transaction_date: '2026-08-02', user_id_hash: 'hash_x' },
  { id: 'r3', title: 'Pemasukan Gaji Rp10.000.000', merchant: 'PT Maju', type: 'income', transaction_date: '2026-07-25', user_id_hash: 'hash_x' },
  { id: 'r1', title: 'Pengeluaran Tiket Bali Rp1.500.000', merchant: 'Tiket.com', type: 'expense', transaction_date: '2026-06-15', user_id_hash: 'hash_x' }, // duplikat r1 (id sama)
];

describe('rankAndExplainResults (Sprint 1.4)', () => {
  it('menghapus duplikat (by id) dan menambah explanation + relevance', () => {
    const ranked = rankAndExplainResults(sampleResults, 'tiket bali', 'transactions');
    expect(ranked.length).toBe(3); // r4 duplikat r1 (id sama) dibuang
    expect(ranked.every((r) => Array.isArray(r.explanation))).toBe(true);
    expect(ranked.every((r) => typeof r.relevance === 'number')).toBe(true);
  });

  it('menaikkan hasil yang match token query (stabil, urutan Discovery dipertahankan untuk skor sama)', () => {
    const ranked = rankAndExplainResults(sampleResults, 'tiket', 'transactions');
    expect(ranked[0].id).toBe('r1'); // tiket di title/merchant → relevance 2 (tiket + tiket.com? token 'tiket')
    // r1 & r4 sama; r2/r3 relevance 0 → tetap urut asli setelahnya
    expect(ranked[0].explanation.join(' ')).toContain('tiket');
  });

  it('explanation menyertakan tipe/rentang tanggal/kepemilikan bila filter aktif', () => {
    const ranked = rankAndExplainResults(
      sampleResults,
      'tiket',
      'transactions',
      { type: 'expense', dateFrom: '2026-06-01', dateTo: '2026-06-30' },
    );
    const first = ranked.find((r) => r.id === 'r1');
    expect(first?.explanation.join(' ')).toContain('tipe expense');
    expect(first?.explanation.join(' ')).toContain('dalam rentang tanggal');
    expect(first?.explanation.join(' ')).toContain('data milik kamu');
  });

  it('filter tipe memotong hasil tipe lain (penjelasan hanya untuk yang cocok)', () => {
    const ranked = rankAndExplainResults(sampleResults, '', 'transactions', { type: 'income' });
    const income = ranked.find((r) => r.id === 'r3');
    expect(income?.explanation.join(' ')).toContain('tipe income');
  });
});

describe('buildSuggestedQueries (Sprint 1.4)', () => {
  it('memakai relatedQuestions engine bila tersedia (≥2)', () => {
    const suggestions = buildSuggestedQueries('tiket bali', 'transactions', ['Berapa total tiket bulan ini?', 'Tiket bali kapan terakhir?'], 5);
    expect(suggestions).toHaveLength(2);
    expect(suggestions[0]).toBe('Berapa total tiket bulan ini?');
  });

  it('fallback template per tab bila engine kosong — maksimal 4, tanpa duplikat query', () => {
    const suggestions = buildSuggestedQueries('tiket bali', 'transactions', [], 0);
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.length).toBeLessThanOrEqual(4);
    expect(suggestions.some((s) => s.toLowerCase() === 'tiket bali'.toLowerCase())).toBe(false);
    expect(suggestions[0]).toContain('tiket bali');
  });

  it('query kosong / tab tidak dikenal → tidak melempar', () => {
    expect(() => buildSuggestedQueries('', 'bogus-tab', [], 0)).not.toThrow();
    expect(() => buildSuggestedQueries('x', 'help', 'not-array', 0)).not.toThrow();
  });
});

// ===== searchHistory (frontend pure helpers) =====
function mockStorage() {
  const store = new Map<string, string>();
  const storage = {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { store.set(key, value); }),
    removeItem: vi.fn((key: string) => { store.delete(key); }),
  };
  vi.stubGlobal('window', { localStorage: storage } as unknown as Window);
  return storage;
}

describe('searchHistory (Sprint 1.4)', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('addRecentSearch: dedupe case-insensitive, query terbaru di atas, cap MAX', () => {
    mockStorage();
    const fixed = new Date('2026-08-05T00:00:00Z');
    addRecentSearch('u-1', 'tiket  bali', 'transactions', fixed); // whitespace collapse
    addRecentSearch('u-1', 'TIKET BALI', 'transactions', new Date('2026-08-06T00:00:00Z')); // dedupe
    const recent = readRecentSearches('u-1');
    expect(recent).toHaveLength(1);
    // dedupe case-insensitive; versi terbaru yang menang (case baru dipertahankan)
    expect(recent[0].query).toBe('TIKET BALI');
    expect(recent[0].at).toBe('2026-08-06T00:00:00.000Z');
  });

  it('addRecentSearch: cap MAX_RECENT_SEARCHES dan urut terbaru dulu', () => {
    mockStorage();
    for (let i = 1; i <= MAX_RECENT_SEARCHES + 3; i++) {
      addRecentSearch('u-1', `query-${i}`, 'help', new Date(`2026-08-${String(i).padStart(2, '0')}T00:00:00Z`));
    }
    const recent = readRecentSearches('u-1');
    expect(recent).toHaveLength(MAX_RECENT_SEARCHES);
    expect(recent[0].query).toBe(`query-${MAX_RECENT_SEARCHES + 3}`); // terbaru dulu
  });

  it('per-user isolation: riwayat user A tidak terlihat user B', () => {
    mockStorage();
    addRecentSearch('u-1', 'gaji', 'insight');
    addRecentSearch('u-2', 'gojek', 'transactions');
    expect(readRecentSearches('u-1').map((e) => e.query)).toEqual(['gaji']);
    expect(readRecentSearches('u-2').map((e) => e.query)).toEqual(['gojek']);
  });

  it('clearRecentSearches menghapus hanya untuk user terkait', () => {
    mockStorage();
    addRecentSearch('u-1', 'gaji', 'insight');
    addRecentSearch('u-2', 'gojek', 'transactions');
    clearRecentSearches('u-1');
    expect(readRecentSearches('u-1')).toHaveLength(0);
    expect(readRecentSearches('u-2')).toHaveLength(1);
  });

  it('data korup / tanpa storage → [] tanpa throw', () => {
    mockStorage();
    const storage = window.localStorage as unknown as { setItem: (k: string, v: string) => void };
    storage.setItem('cashflow:ai-search:recent:u-1', '{not-json');
    expect(readRecentSearches('u-1')).toEqual([]);
    vi.unstubAllGlobals();
    // tanpa window (SSR / test-node) → safe
    expect(readRecentSearches('u-1')).toEqual([]);
  });
});
