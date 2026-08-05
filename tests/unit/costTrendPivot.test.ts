/**
 * Sprint 2 — unit test pivot cost trend per fitur (murni, tanpa React/DB).
 * Memastikan multi-seri line chart menerima data yang benar: grouping per hari,
 * penjumlahan per fitur, zero-fill hari kosong, urutan tanggal naik.
 */
import { describe, it, expect } from 'vitest';
import { activeTrendFeatures, pivotTrendByFeature } from '../../src/utils/costTrendPivot';
import type { CostTrendByFeaturePoint } from '../../src/types/metrics';

const points: CostTrendByFeaturePoint[] = [
  { date: '2026-08-01', feature: 'gmail_sync', costIdr: 100, tokens: 10, calls: 1 },
  { date: '2026-08-01', feature: 'gmail_sync', costIdr: 50, tokens: 5, calls: 1 },
  { date: '2026-08-01', feature: 'ocr_receipt', costIdr: 25, tokens: 3, calls: 1 },
  { date: '2026-08-02', feature: 'gmail_sync', costIdr: 75, tokens: 7, calls: 1 },
];

describe('pivotTrendByFeature', () => {
  it('menjumlahkan biaya per fitur dalam satu hari', () => {
    const rows = pivotTrendByFeature(points);
    expect(rows).toHaveLength(2);
    expect(rows[0].date).toBe('2026-08-01');
    expect(rows[0].gmail_sync).toBe(150);
    expect(rows[0].ocr_receipt).toBe(25);
  });

  it('zero-fill: hari tanpa data fitur tertentu tetap punya kolom 0', () => {
    const rows = pivotTrendByFeature(points);
    expect(rows[1].date).toBe('2026-08-02');
    expect(rows[1].gmail_sync).toBe(75);
    expect(rows[1].ocr_receipt).toBe(0);
  });

  it('membulatkan biaya ke 2 desimal', () => {
    const rows = pivotTrendByFeature([
      { date: '2026-08-01', feature: 'a', costIdr: 0.12345, tokens: 1, calls: 1 },
      { date: '2026-08-01', feature: 'a', costIdr: 0.1, tokens: 1, calls: 1 },
    ]);
    expect(rows[0].a).toBe(0.22);
  });

  it('mengurutkan tanggal naik walau input terbalik', () => {
    const rows = pivotTrendByFeature([...points].reverse());
    expect(rows.map((r) => r.date)).toEqual(['2026-08-01', '2026-08-02']);
  });

  it('input kosong → array kosong', () => {
    expect(pivotTrendByFeature([])).toEqual([]);
    expect(activeTrendFeatures([])).toEqual([]);
  });

  it('fitur tanpa nilai cost (0) tetap muncul sebagai kolom', () => {
    const rows = pivotTrendByFeature([
      { date: '2026-08-01', feature: 'x', costIdr: 0, tokens: 0, calls: 0 },
    ]);
    expect(rows[0].x).toBe(0);
  });
});

describe('pivotTrendByFeature — metrik tokens & calls (toggle Biaya/Token/Calls)', () => {
  it('metric=tokens: menjumlahkan token per fitur per hari', () => {
    const rows = pivotTrendByFeature([
      { date: '2026-08-01', feature: 'a', costIdr: 1, tokens: 100, calls: 2 },
      { date: '2026-08-01', feature: 'a', costIdr: 2, tokens: 50, calls: 3 },
      { date: '2026-08-01', feature: 'b', costIdr: 5, tokens: 30, calls: 1 },
    ], 'tokens');
    expect(rows[0].a).toBe(150);
    expect(rows[0].b).toBe(30);
  });

  it('metric=calls: menjumlahkan calls per fitur per hari', () => {
    const rows = pivotTrendByFeature([
      { date: '2026-08-01', feature: 'a', costIdr: 1, tokens: 10, calls: 2 },
      { date: '2026-08-01', feature: 'a', costIdr: 2, tokens: 20, calls: 3 },
    ], 'calls');
    expect(rows[0].a).toBe(5);
  });

  it('zero-fill tetap berlaku untuk metrik non-cost', () => {
    const rows = pivotTrendByFeature([
      { date: '2026-08-01', feature: 'a', costIdr: 0, tokens: 100, calls: 2 },
      { date: '2026-08-02', feature: 'b', costIdr: 0, tokens: 40, calls: 1 },
    ], 'tokens');
    expect(rows[1].a).toBe(0);
    expect(rows[1].b).toBe(40);
  });

  it('default metric = costIdr (backward compatible)', () => {
    const rows = pivotTrendByFeature([
      { date: '2026-08-01', feature: 'a', costIdr: 7, tokens: 999, calls: 9 },
    ]);
    expect(rows[0].a).toBe(7);
  });
});

describe('activeTrendFeatures', () => {
  it('mengembalikan fitur unik sesuai urutan kemunculan', () => {
    expect(activeTrendFeatures(points)).toEqual(['gmail_sync', 'ocr_receipt']);
  });

  it('mengabaikan fitur kosong', () => {
    expect(activeTrendFeatures([
      { date: '2026-08-01', feature: '', costIdr: 1, tokens: 1, calls: 1 },
      { date: '2026-08-01', feature: 'b', costIdr: 2, tokens: 1, calls: 1 },
    ])).toEqual(['b']);
  });
});
