/**
 * Sprint 2 — unit test ranking fitur (murni, tanpa React/DB): tile ringkasan
 * per fitur memakai urutan biaya/token teratas dari summary.features.
 */
import { describe, it, expect } from 'vitest';
import { topFeatureEntries } from '../../src/utils/featureRanking';
import type { FeatureUsage } from '../../src/types/metrics';

function usage(partial: Partial<FeatureUsage>): FeatureUsage {
  return { costIdr: 0, costUsd: 0, tokens: 0, calls: 0, avgTimeMs: 0, successRate: 1, ...partial };
}

const features: Record<string, FeatureUsage> = {
  gmail_sync: usage({ costIdr: 300, tokens: 30000, calls: 100 }),
  agent_search: usage({ costIdr: 0, tokens: 0, calls: 1020 }),
  ocr_receipt: usage({ costIdr: 150, tokens: 8000, calls: 40 }),
  insight_generator: usage({ costIdr: 500, tokens: 5000, calls: 5 }),
};

describe('topFeatureEntries', () => {
  it('Top Biaya: urut costIdr menurun', () => {
    const rows = topFeatureEntries(features, 'costIdr');
    expect(rows.map((r) => r.feature)).toEqual(['insight_generator', 'gmail_sync', 'ocr_receipt', 'agent_search']);
    expect(rows[0].costIdr).toBe(500);
  });

  it('Top Token: urut tokens menurun (berbeda dari biaya)', () => {
    const rows = topFeatureEntries(features, 'tokens');
    expect(rows.map((r) => r.feature)).toEqual(['gmail_sync', 'ocr_receipt', 'insight_generator', 'agent_search']);
    expect(rows[0].tokens).toBe(30000);
  });

  it('limit membatasi jumlah hasil', () => {
    expect(topFeatureEntries(features, 'costIdr', 2)).toHaveLength(2);
    expect(topFeatureEntries(features, 'tokens', 3).map((r) => r.feature)).toEqual([
      'gmail_sync', 'ocr_receipt', 'insight_generator',
    ]);
  });

  it('fitur 0 (agent_search) tetap muncul sebagai kandidat (data asli, bukan bug)', () => {
    const rows = topFeatureEntries(features, 'costIdr');
    expect(rows.find((r) => r.feature === 'agent_search')?.costIdr).toBe(0);
  });

  it('input kosong → array kosong', () => {
    expect(topFeatureEntries({}, 'costIdr')).toEqual([]);
    expect(topFeatureEntries(undefined as unknown as Record<string, FeatureUsage>, 'tokens')).toEqual([]);
  });

  it('nilai tak terdefinisi di-coerce jadi 0 (tidak NaN)', () => {
    const rows = topFeatureEntries(
      { a: usage({ costIdr: Number.NaN, tokens: Number.NaN }), b: usage({ costIdr: 10, tokens: 20 }) },
      'costIdr',
    );
    expect(rows.find((r) => r.feature === 'a')?.costIdr).toBe(0);
    expect(rows[0].feature).toBe('b');
  });
});
