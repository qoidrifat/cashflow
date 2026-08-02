/**
 * Unit test: server/lib/aiCache.js — LRU response cache untuk AI (Sprint 3).
 *
 * Menguji perilaku murni cache: determinisme key, hit/miss, TTL expiry,
 * eviction LRU, dan statistik — tanpa dependensi jaringan/Vertex.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildAICacheKey,
  getCachedAICache,
  setCachedAICache,
  clearAICache,
  getAICacheStats,
} from '../../server/lib/aiCache.js';

const CONTENT_A = { text: 'hasil A' };
const CONTENT_B = { text: 'hasil B' };

describe('buildAICacheKey', () => {
  it('deterministik: input sama → key sama', () => {
    const input = {
      feature: 'gmail_sync',
      models: ['gemini-2.5-flash', 'gemini-2.5-flash-lite'],
      contents: [{ role: 'user', parts: [{ text: 'email sama' }] }],
      config: { temperature: 0.1, responseMimeType: 'application/json' },
    };
    expect(buildAICacheKey(input)).toBe(buildAICacheKey(input));
  });

  it('konten berbeda → key berbeda', () => {
    const base = { feature: 'gmail_sync', models: ['m1'], contents: [], config: {} };
    const a = buildAICacheKey({ ...base, contents: [{ role: 'user', parts: [{ text: 'satu' }] }] });
    const b = buildAICacheKey({ ...base, contents: [{ role: 'user', parts: [{ text: 'dua' }] }] });
    expect(a).not.toBe(b);
  });

  it('model-set berbeda → key berbeda (fallback model memengaruhi hasil)', () => {
    const base = { feature: 'ocr_receipt', contents: [{ role: 'user', parts: [{ text: 'x' }] }], config: {} };
    expect(buildAICacheKey({ ...base, models: ['m1'] })).not.toBe(
      buildAICacheKey({ ...base, models: ['m1', 'm2'] }),
    );
  });
});

describe('LRU cache', () => {
  beforeEach(() => {
    clearAICache();
  });

  it('miss lalu set lalu hit', () => {
    const key = buildAICacheKey({ feature: 'f', models: ['m'], contents: [], config: {} });
    expect(getCachedAICache(key)).toBeUndefined();
    setCachedAICache(key, CONTENT_A, 60_000);
    expect(getCachedAICache(key)).toEqual(CONTENT_A);
  });

  it('TTL kedaluwarsa → miss + entri dibuang', async () => {
    const key = buildAICacheKey({ feature: 'f', models: ['m'], contents: [], config: {} });
    setCachedAICache(key, CONTENT_A, 20); // 20ms
    expect(getCachedAICache(key)).toEqual(CONTENT_A);
    await new Promise((r) => setTimeout(r, 60));
    expect(getCachedAICache(key)).toBeUndefined();
    const stats = getAICacheStats();
    expect(stats.size).toBe(0); // expired entry dibuang dari store
  });

  it('eviction LRU: item tertua dibuang saat melebihi maxEntries', () => {
    const max = getAICacheStats().maxEntries; // default 100 (env overridable)
    for (let i = 0; i < max + 10; i++) {
      setCachedAICache(`key-${i}`, { text: `v${i}` }, 60_000);
    }
    const stats = getAICacheStats();
    expect(stats.size).toBe(max);
    expect(stats.evictions).toBe(10);
    // Item paling awal (key-0) harus ter-evict; yang terakhir masih ada.
    expect(getCachedAICache('key-0')).toBeUndefined();
    expect(getCachedAICache(`key-${max + 9}`)).toEqual({ text: `v${max + 9}` });
  });

  it('get memperbarui recency (item yang di-get tidak ter-evict duluan)', () => {
    const max = getAICacheStats().maxEntries;
    for (let i = 0; i < max; i++) setCachedAICache(`k${i}`, { v: i }, 60_000);
    // refresh k0 jadi paling baru
    expect(getCachedAICache('k0')).toEqual({ v: 0 });
    // tambah 1 item → evict k1 (yang kini tertua), bukan k0
    setCachedAICache('k-new', { v: 'new' }, 60_000);
    expect(getCachedAICache('k0')).toEqual({ v: 0 });
    expect(getCachedAICache('k1')).toBeUndefined();
  });

  it('stats hit/miss bertambah', () => {
    const key = buildAICacheKey({ feature: 'f', models: ['m'], contents: [], config: {} });
    setCachedAICache(key, CONTENT_A, 60_000);
    getCachedAICache(key); // hit
    getCachedAICache('tidak-ada'); // miss
    const stats = getAICacheStats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
    expect(stats.sets).toBe(1);
  });

  it('set dengan ttl <= 0 tidak menyimpan apa pun', () => {
    setCachedAICache('x', CONTENT_A, 0);
    expect(getCachedAICache('x')).toBeUndefined();
    setCachedAICache('y', CONTENT_A, -1);
    expect(getCachedAICache('y')).toBeUndefined();
  });
});
