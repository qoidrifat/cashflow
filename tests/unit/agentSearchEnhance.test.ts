/**
 * Unit tests — Sprint 1.4 AI Search enhancements.
 * Backend: rankAndExplainResults + buildSuggestedQueries (server/services/agentSearchService.js).
 * Frontend: searchHistory (src/lib/searchHistory.ts) — murni, tanpa DOM.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  rankAndExplainResults,
  buildSuggestedQueries,
} from '../../server/services/agentSearchService.js';
import {
  addRecentSearch,
  clearRecentSearches,
  createSearchHistory,
  readRecentSearches,
  removeRecentSearch,
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

// ===== searchHistory (Sprint 1.9 — factory injectable storage, tanpa stub window) =====
function mockStorage() {
  const store = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { store.set(key, value); }),
    removeItem: vi.fn((key: string) => { store.delete(key); }),
    /** spy akses internal untuk assert (mis. key per-user). */
    __dump: () => Object.fromEntries(store),
  };
}

type MockStorage = ReturnType<typeof mockStorage>;

function makeHistory(storage: MockStorage | null) {
  return createSearchHistory(storage as never);
}

describe('searchHistory (Sprint 1.9 — factory injectable)', () => {
  it('add: dedupe case-insensitive, query terbaru di atas, whitespace collapse', () => {
    const h = makeHistory(mockStorage());
    const fixed = new Date('2026-08-05T00:00:00Z');
    h.add('u-1', 'tiket  bali', 'transactions', fixed);
    h.add('u-1', 'TIKET BALI', 'transactions', new Date('2026-08-06T00:00:00Z'));
    const recent = h.read('u-1');
    expect(recent).toHaveLength(1);
    // dedupe case-insensitive; versi terbaru yang menang (case baru dipertahankan)
    expect(recent[0].query).toBe('TIKET BALI');
    expect(recent[0].at).toBe('2026-08-06T00:00:00.000Z');
  });

  it('add: cap MAX_RECENT_SEARCHES dan urut terbaru dulu', () => {
    const h = makeHistory(mockStorage());
    for (let i = 1; i <= MAX_RECENT_SEARCHES + 3; i++) {
      h.add('u-1', `query-${i}`, 'help', new Date(`2026-08-${String(i).padStart(2, '0')}T00:00:00Z`));
    }
    const recent = h.read('u-1');
    expect(recent).toHaveLength(MAX_RECENT_SEARCHES);
    expect(recent[0].query).toBe(`query-${MAX_RECENT_SEARCHES + 3}`);
  });

  it('per-user isolation: key menyertakan userId, riwayat A tidak terlihat B', () => {
    const storage = mockStorage();
    const h = makeHistory(storage);
    h.add('u-1', 'gaji', 'insight');
    h.add('u-2', 'gojek', 'transactions');
    expect(h.read('u-1').map((e) => e.query)).toEqual(['gaji']);
    expect(h.read('u-2').map((e) => e.query)).toEqual(['gojek']);
    // dua key berbeda di storage (bukti no cross-account leak)
    expect(Object.keys(storage.__dump())).toHaveLength(2);
  });

  it('clear: menghapus hanya untuk user terkait', () => {
    const h = makeHistory(mockStorage());
    h.add('u-1', 'gaji', 'insight');
    h.add('u-2', 'gojek', 'transactions');
    h.clear('u-1');
    expect(h.read('u-1')).toHaveLength(0);
    expect(h.read('u-2')).toHaveLength(1);
  });

  it('remove: hapus satu entri per index (0 = paling baru), urutan sisanya dipertahankan', () => {
    const h = makeHistory(mockStorage());
    h.add('u-1', 'gaji', 'insight');
    h.add('u-1', 'gojek', 'transactions');
    h.add('u-1', 'tiket', 'receipts'); // paling baru → index 0
    const updated = h.remove('u-1', 0);
    expect(updated?.map((e) => e.query)).toEqual(['gojek', 'gaji']);
    expect(h.read('u-1').map((e) => e.query)).toEqual(['gojek', 'gaji']);
  });

  it('remove: hapus entri tengah (index 1)', () => {
    const h = makeHistory(mockStorage());
    h.add('u-1', 'gaji', 'insight');
    h.add('u-1', 'gojek', 'transactions');
    h.add('u-1', 'tiket', 'receipts');
    const updated = h.remove('u-1', 1);
    expect(updated?.map((e) => e.query)).toEqual(['tiket', 'gaji']);
  });

  it('remove: index di luar rentang (negatif / >= length) → array tidak berubah, tanpa throw', () => {
    const h = makeHistory(mockStorage());
    h.add('u-1', 'gaji', 'insight');
    expect(h.remove('u-1', -1)?.map((e) => e.query)).toEqual(['gaji']);
    expect(h.remove('u-1', 5)?.map((e) => e.query)).toEqual(['gaji']);
    expect(h.remove('u-1', 0)?.map((e) => e.query)).toEqual([]); // habis — masih valid
  });

  it('data korup / non-array / entri invalid → difilter tanpa throw', () => {
    const storage = mockStorage();
    const h = makeHistory(storage);
    storage.setItem('cashflow:ai-search:recent:u-1', '{not-json');
    expect(h.read('u-1')).toEqual([]);
    storage.setItem('cashflow:ai-search:recent:u-2', JSON.stringify([{ query: 42 }, { query: 'ok', tab: 'x', at: '2026-01-01T00:00:00.000Z' }]));
    const read = h.read('u-2');
    expect(read).toHaveLength(1); // entri invalid (query bukan string) dibuang
    expect(read[0].query).toBe('ok');
  });

  it('storage null (SSR / diblokir) → read [], add null, remove no-op aman, clear no-op — tanpa throw', () => {
    const h = makeHistory(null);
    expect(h.read('u-1')).toEqual([]);
    expect(h.add('u-1', 'gaji', 'insight')).toBeNull(); // gagal menulis → null
    // remove: list kosong → index out-of-range → no-op, return array tidak berubah (bukan error)
    expect(h.remove('u-1', 0)).toEqual([]);
    expect(() => h.clear('u-1')).not.toThrow();
  });

  it('storage.setItem melempar (quota exceeded) → add/remove return null, tidak propagate error', () => {
    // getItem mengembalikan data lama yang valid → remove index 0 VALID → setItem throw
    const throwing = {
      getItem: vi.fn(() => JSON.stringify([{ query: 'gaji', tab: 'insight', at: '2026-08-01T00:00:00.000Z' }])),
      setItem: vi.fn(() => { throw new Error('QuotaExceededError'); }),
      removeItem: vi.fn(),
    };
    const h = createSearchHistory(throwing);
    expect(h.add('u-1', 'gaji', 'insight')).toBeNull();
    expect(h.remove('u-1', 0)).toBeNull(); // valid index tapi write gagal → null
    expect(() => h.read('u-1')).not.toThrow(); // read tetap aman
    expect(throwing.setItem).toHaveBeenCalledTimes(2); // add + remove keduanya mencoba menulis
  });

  it('instance default (searchHistory) tetap aman tanpa window (SSR)', () => {
    // vitest berjalan di node → typeof window undefined → safeLocalStorage null
    expect(readRecentSearches('u-1')).toEqual([]);
    expect(addRecentSearch('u-1', 'gaji', 'insight')).toBeNull();
    expect(removeRecentSearch('u-1', 0)).toEqual([]); // list kosong → no-op aman
    expect(() => clearRecentSearches('u-1')).not.toThrow();
  });
});
