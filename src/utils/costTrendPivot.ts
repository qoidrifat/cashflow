/**
 * Sprint 2 — pivot cost trend per fitur jadi baris multi-seri untuk Recharts.
 *
 * MURNI (tanpa React/DB) agar bisa di-unit-test: mengubah kumpulan baris
 * [{ date, feature, <metric> }] menjadi [{ date, [feature]: <metric> }] — satu
 * kolom per fitur (diisi 0 bila fitur tidak aktif di hari itu).
 *
 * `metric` menentukan kolom yang dipivot (Sprint 2 — toggle Biaya/Token/Calls):
 * 'costIdr' (default) | 'tokens' | 'calls'.
 */
import type { CostTrendByFeaturePoint } from '../types/metrics';

export type TrendMetric = 'costIdr' | 'tokens' | 'calls';

export interface TrendRow {
  date: string;
  [feature: string]: string | number;
}

/** Nama fitur yang aktif dalam data (kolom seri = semua key selain `date`). */
export function activeTrendFeatures(points: CostTrendByFeaturePoint[]): string[] {
  const seen = new Set<string>();
  for (const p of points) {
    if (p.feature) seen.add(p.feature);
  }
  return [...seen];
}

/**
 * Pivot baris per-(hari, fitur) menjadi satu baris per hari dengan satu kolom
 * per fitur untuk metrik terpilih. Nilai per fitur dalam sehari dijumlahkan
 * (bulat 2 desimal — integers tokens/calls tidak terpengaruh). Urut tanggal
 * naik; hari yang tidak punya data untuk fitur tertentu diisi 0 (recharts Line
 * membutuhkan dataKey hadir agar seri kontinu).
 */
export function pivotTrendByFeature(
  points: CostTrendByFeaturePoint[],
  metric: TrendMetric = 'costIdr',
): TrendRow[] {
  const byDate = new Map<string, TrendRow>();
  const allFeatures = new Set<string>();
  for (const p of points) {
    const row = byDate.get(p.date) || { date: p.date };
    const prev = Number(row[p.feature] ?? 0);
    row[p.feature] = Math.round((prev + (Number(p[metric]) || 0)) * 100) / 100;
    byDate.set(p.date, row);
    if (p.feature) allFeatures.add(p.feature);
  }
  const rows = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  // Zero-fill: hari tanpa data untuk sebuah fitur tetap punya kolom 0, sehingga
  // seri recharts kontinu (tanpa gap) dan Legend konsisten antar hari.
  for (const row of rows) {
    for (const feature of allFeatures) {
      if (!(feature in row)) row[feature] = 0;
    }
  }
  return rows;
}
