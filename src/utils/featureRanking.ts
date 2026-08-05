/**
 * Sprint 2 — ranking fitur untuk tile ringkasan per fitur (biaya & token teratas).
 *
 * MURNI (tanpa React/DB) agar bisa di-unit-test. Memetakan Record<feature,
 * FeatureUsage> (dari summary.features / ai-usage) menjadi daftar ber-urut
 * berdasarkan metrik terpilih, dibatasi `limit` teratas.
 */
import type { FeatureUsage } from '../types/metrics';

export interface FeatureRankRow {
  feature: string;
  costIdr: number;
  tokens: number;
  calls: number;
}

export type FeatureRankMetric = 'costIdr' | 'tokens';

/**
 * Fitur teratas menurut metrik (`costIdr` atau `tokens`), urut menurun,
 * maksimal `limit` item. Fitur dengan nilai 0 tetap bisa masuk bila tidak ada
 * kandidat lain (mis. satu-satunya fitur) — pemanggil menangani daftar kosong.
 */
export function topFeatureEntries(
  features: Record<string, FeatureUsage>,
  metric: FeatureRankMetric,
  limit = 5,
): FeatureRankRow[] {
  return Object.entries(features || {})
    .map(([feature, u]) => ({
      feature,
      costIdr: Number(u?.costIdr) || 0,
      tokens: Number(u?.tokens) || 0,
      calls: Number(u?.calls) || 0,
    }))
    .sort((a, b) => b[metric] - a[metric])
    .slice(0, Math.max(0, Math.min(limit, 50)));
}
