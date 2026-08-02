/**
 * Unit test: computeHitRateFromCounts — hit rate LRU cache untuk alert rule
 * `cache_hit_rate` (metricsService). Fungsi MURNI (tanpa DB) — menutup concern
 * code review: computeCacheHitRate yang berbasis DB tidak di-unit-test.
 */
import { describe, it, expect } from 'vitest';
import { computeHitRateFromCounts } from '../../server/services/metricsService.js';

describe('computeHitRateFromCounts', () => {
  it('hit rate normal: hits/(hits+misses) dibulatkan 3 desimal', () => {
    expect(computeHitRateFromCounts(75, 25)).toBe(0.75);
    expect(computeHitRateFromCounts(90, 10)).toBe(0.9);
    expect(computeHitRateFromCounts(1, 1)).toBe(0.5);
  });

  it('100% hit', () => {
    expect(computeHitRateFromCounts(10, 0)).toBe(1);
  });

  it('0% hit (semua miss)', () => {
    expect(computeHitRateFromCounts(0, 10)).toBe(0);
  });

  it('tanpa aktivitas (0/0) → 1.0 = sehat, tidak trigger alert lt', () => {
    expect(computeHitRateFromCounts(0, 0)).toBe(1);
  });

  it('toleran string numeric dari DB (SQLite SUM)', () => {
    expect(computeHitRateFromCounts('75', '25')).toBe(0.75);
    expect(computeHitRateFromCounts('0', '0')).toBe(1);
  });

  it('pembulatan 3 desimal (mis. 2/3)', () => {
    expect(computeHitRateFromCounts(2, 1)).toBe(0.667);
  });
});
