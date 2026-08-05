/**
 * Unit tests — aggregateCacheHitByFeature (server/services/metricsService.js).
 * Agregasi cache-hit per fitur dari baris system_metrics ai_cache_hit/_miss
 * yang SUDAH di-GROUP BY feature. Murni (tanpa DB) — pola sama dengan
 * computeHitRateFromCounts / aggregateAgentSearchEngagement.
 */
import { describe, expect, it } from 'vitest';
import { aggregateCacheHitByFeature } from '../../server/services/metricsService.js';

const hitRow = (feature: string, total: number) => ({ feature, total });
const missRow = (feature: string, total: number) => ({ feature, total });

describe('aggregateCacheHitByFeature', () => {
  it('kosong → array kosong', () => {
    expect(aggregateCacheHitByFeature()).toEqual([]);
    expect(aggregateCacheHitByFeature([], [])).toEqual([]);
  });

  it('hit + miss diagregasi per fitur + hitRate = hit/(hit+miss)', () => {
    const r = aggregateCacheHitByFeature([hitRow('gmail_sync', 75)], [missRow('gmail_sync', 25)]);
    expect(r).toEqual([{ feature: 'gmail_sync', hits: 75, misses: 25, hitRate: 0.75 }]);
  });

  it('tanpa aktivitas cache → hitRate 1.0 (default sehat — tidak ada degradasi terukur)', () => {
    const r = aggregateCacheHitByFeature([hitRow('ocr_receipt', 0)], [missRow('ocr_receipt', 0)]);
    expect(r[0].hitRate).toBe(1);
    expect(r[0].hits).toBe(0);
    expect(r[0].misses).toBe(0);
  });

  it('fitur dari kedua sisi (hit saja / miss saja) digabung', () => {
    const r = aggregateCacheHitByFeature(
      [hitRow('gmail_sync', 10), hitRow('ocr_receipt', 4)],
      [missRow('gmail_sync', 10)],
    );
    const gmail = r.find((x) => x.feature === 'gmail_sync');
    expect(gmail).toEqual({ feature: 'gmail_sync', hits: 10, misses: 10, hitRate: 0.5 });
    const ocr = r.find((x) => x.feature === 'ocr_receipt');
    expect(ocr).toEqual({ feature: 'ocr_receipt', hits: 4, misses: 0, hitRate: 1 });
  });

  it('urutan desc berdasarkan total aktivitas (hits + misses)', () => {
    // b: hits 4 + misses 2 = 6 aktivitas > a: hits 5 → b lebih dulu.
    const r = aggregateCacheHitByFeature([hitRow('a', 5)], [hitRow('b', 4), missRow('b', 2)]);
    expect(r.map((x) => x.feature)).toEqual(['b', 'a']);
  });

  it('feature null/absen → fallback unknown (defensive)', () => {
    const r = aggregateCacheHitByFeature([{ total: 3 }], [{ feature: null, total: 1 }]);
    expect(r).toEqual([{ feature: 'unknown', hits: 3, misses: 1, hitRate: 0.75 }]);
  });
});
