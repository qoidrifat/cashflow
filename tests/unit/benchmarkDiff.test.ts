/**
 * Unit test: scripts/benchmarkDiff.mjs — alur evaluasi before/after benchmark.
 *
 * Menguji diff murni tanpa menjalankan benchmark/vitest:
 *   - laporan identik → 'unchanged', delta 0
 *   - metrik naik (good) → 'improved'; turun → 'regressed'
 *   - cost turun (bad) → dianggap MEMBAIK
 *   - avgLatencyMs TIDAK ikut verdict secara default (noise 18-71% antar-run,
 *     bukti runtime); strict mode via includeLatencyInVerdict=true
 *   - kategori hilang/baru → 'removed' / 'new'
 *   - numericMetrics mengabaikan field non-numerik (objek confidenceDistribution)
 *   - renderDiffTable & verdictLine siap pakai
 */
import { describe, expect, it } from 'vitest';
import {
  diffBenchmarkReports,
  renderDiffTable,
  verdictLine,
  numericMetrics,
  metricDirection,
} from '../../scripts/benchmarkDiff.mjs';

/** Helper kategori benchmark: metrik default + override. */
function cat(name: string, overrides: Record<string, unknown> = {}) {
  return {
    category: name,
    cases: 100,
    precision: 1,
    recall: 1,
    f1: 1,
    accuracy: 1,
    avgLatencyMs: 0.5,
    confidenceDistribution: { '0.85-1.0': 100 }, // non-numerik → harus diabaikan
    ...overrides,
  };
}

describe('numericMetrics & metricDirection', () => {
  it('hanya field numerik; objek/string/array diabaikan', () => {
    const m = numericMetrics(cat('x', { rankingOrder: 'a,b', note: 'hai' }));
    expect(m.precision).toBe(1);
    expect(m.avgLatencyMs).toBe(0.5);
    expect(m.confidenceDistribution).toBeUndefined();
    expect(m.rankingOrder).toBeUndefined();
    expect(m.note).toBeUndefined();
    expect(m.cases).toBeUndefined(); // cases = non-metrik
  });

  it('direction: latency & cost = bad (lebih kecil lebih baik), lainnya good', () => {
    expect(metricDirection('avgLatencyMs')).toBe('bad');
    expect(metricDirection('estCostUsdPerCase')).toBe('bad');
    expect(metricDirection('precision')).toBe('good');
    expect(metricDirection('f1')).toBe('good');
  });
});

describe('diffBenchmarkReports', () => {
  const before = { categories: [cat('fraud_l1', { precision: 0.95, accuracy: 0.9 }), cat('insight_fallback', { accuracy: 0.95 })] };

  it('laporan identik → seluruh kategori unchanged, overall unchanged', () => {
    const after = { categories: [cat('fraud_l1', { precision: 0.95, accuracy: 0.9 }), cat('insight_fallback', { accuracy: 0.95 })] };
    const diff = diffBenchmarkReports(before, after);
    expect(diff.overallVerdict).toBe('unchanged');
    expect(diff.improvedCategories).toEqual([]);
    expect(diff.regressedCategories).toEqual([]);
    for (const c of diff.categories) {
      expect(c.verdict).toBe('unchanged');
      for (const m of c.metrics) {
        expect(m.delta).toBe(0);
        expect(m.unchanged).toBe(true);
      }
    }
  });

  it('metrik naik (good) → kategori improved + delta positif', () => {
    const after = { categories: [cat('fraud_l1', { precision: 0.98, accuracy: 0.9 }), cat('insight_fallback', { accuracy: 0.95 })] };
    const diff = diffBenchmarkReports(before, after);
    expect(diff.overallVerdict).toBe('improved');
    expect(diff.improvedCategories).toEqual(['fraud_l1']);
    const fraud = diff.categories.find((c) => c.category === 'fraud_l1');
    expect(fraud.verdict).toBe('improved');
    const precision = fraud.metrics.find((m) => m.field === 'precision');
    expect(precision.before).toBe(0.95);
    expect(precision.after).toBe(0.98);
    expect(precision.delta).toBeCloseTo(0.03, 9);
    expect(precision.better).toBe(true);
  });

  it('metrik turun (good) → kategori regressed + overall regressed', () => {
    const after = { categories: [cat('fraud_l1', { precision: 0.9, accuracy: 0.9 }), cat('insight_fallback', { accuracy: 0.95 })] };
    const diff = diffBenchmarkReports(before, after);
    expect(diff.overallVerdict).toBe('regressed');
    expect(diff.regressedCategories).toEqual(['fraud_l1']);
  });

  it('cost TURUN = membaik (direction bad, deterministik)', () => {
    const b = { categories: [cat('advisor_fallback', { estCostUsdPerCase: 0.0001 })] };
    const a = { categories: [cat('advisor_fallback', { estCostUsdPerCase: 0.00005 })] };
    const diff = diffBenchmarkReports(b, a);
    expect(diff.overallVerdict).toBe('improved');
    const cost = diff.categories[0].metrics.find((m) => m.field === 'estCostUsdPerCase');
    expect(cost.better).toBe(true);
    expect(cost.worse).toBe(false);
  });

  it('latency TIDAK ikut verdict secara default (noisy, informational)', () => {
    const b = { categories: [cat('advisor_fallback', { avgLatencyMs: 0.4 })] };
    const a = { categories: [cat('advisor_fallback', { avgLatencyMs: 1.2 })] };
    const diff = diffBenchmarkReports(b, a);
    expect(diff.overallVerdict).toBe('unchanged');
    const latency = diff.categories[0].metrics.find((m) => m.field === 'avgLatencyMs');
    expect(latency.worse).toBe(true); // tetap terhitung sebagai delta memburuk
    expect(latency.noisy).toBe(true); // tapi ditandai noisy → tidak memengaruhi verdict
  });

  it('latency ikut verdict bila includeLatencyInVerdict=true (strict mode)', () => {
    const b = { categories: [cat('advisor_fallback', { avgLatencyMs: 1.0 })] };
    const a = { categories: [cat('advisor_fallback', { avgLatencyMs: 0.4 })] };
    const diff = diffBenchmarkReports(b, a, { includeLatencyInVerdict: true });
    expect(diff.overallVerdict).toBe('improved');
    const latency = diff.categories[0].metrics.find((m) => m.field === 'avgLatencyMs');
    expect(latency.delta).toBeCloseTo(-0.6, 9);
    expect(latency.better).toBe(true);
    expect(latency.worse).toBe(false);
  });

  it('sinyal campur: kualitas naik + latency naik (strict) → overall regressed', () => {
    const b = { categories: [cat('advisor_fallback', { precision: 0.9, avgLatencyMs: 0.4 })] };
    const a = { categories: [cat('advisor_fallback', { precision: 0.98, avgLatencyMs: 1.2 })] };
    // Default: latency diabaikan → hanya precision naik → improved.
    expect(diffBenchmarkReports(b, a).overallVerdict).toBe('improved');
    // Strict: latency naik (bad) → regressedCount > 0 → overall regressed.
    expect(diffBenchmarkReports(b, a, { includeLatencyInVerdict: true }).overallVerdict).toBe('regressed');
  });

  it('kategori hilang → removed; kategori baru → new', () => {
    const b = { categories: [cat('fraud_l1')] };
    const a = { categories: [cat('search_rerank')] };
    const diff = diffBenchmarkReports(b, a);
    expect(diff.removedCategories).toEqual(['fraud_l1']);
    expect(diff.newCategories).toEqual(['search_rerank']);
    const removed = diff.categories.find((c) => c.category === 'fraud_l1');
    const added = diff.categories.find((c) => c.category === 'search_rerank');
    expect(removed.verdict).toBe('removed');
    expect(added.verdict).toBe('new');
    // kategori baru/removed TIDAK membuat overall regressed
    expect(diff.overallVerdict).toBe('unchanged');
  });

  it('tanpa categories → tidak crash', () => {
    const diff = diffBenchmarkReports({ categories: [] }, { categories: [] });
    expect(diff.categories).toEqual([]);
    expect(diff.overallVerdict).toBe('unchanged');
  });
});

describe('renderDiffTable & verdictLine', () => {
  it('menghasilkan baris tabel & verdict line', () => {
    const b = { categories: [cat('fraud_l1', { precision: 0.95 })] };
    const a = { categories: [cat('fraud_l1', { precision: 0.98 })] };
    const diff = diffBenchmarkReports(b, a);
    const rows = renderDiffTable(diff);
    expect(rows).toHaveLength(1);
    expect(rows[0].category).toBe('fraud_l1');
    expect(rows[0].verdict).toBe('improved');
    expect(rows[0].delta).toContain('precision +0.03');
    const line = verdictLine(diff, 'setelah perbaikan');
    expect(line).toContain('MEMBAIK');
    expect(line).toContain('setelah perbaikan');
  });
});
