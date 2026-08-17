/**
 * Benchmark Diff (Sprint 1.5 — alur evaluasi before/after perbaikan prompt).
 *
 * MURNI & deterministik: membandingkan dua laporan benchmark
 * (docs/ai/benchmark-results.json sebelum & sesudah perubahan prompt/rule)
 * per kategori, menghitung delta metrik numerik, dan menyimpulkan verdict.
 *
 * Direction metrik:
 *   - 'good' : nilai LEBIH BESAR lebih baik (precision, recall, f1, accuracy,
 *              top1HitRate, explanationRate, *Accuracy, *ValidRate, dst).
 *   - 'bad'  : nilai LEBIH KECIL lebih baik (avgLatencyMs, estCostUsdPerCase).
 *
 * Verdict per kategori: 'regressed' (ada metrik memburuk) · 'improved'
 * (semua >= before & minimal satu membaik) · 'unchanged' (semua |delta| <= eps).
 * Overall: 'regressed' bila ada kategori regressed, 'improved' bila tak ada
 * regress & ada improvement, selain itu 'unchanged'.
 *
 * NOISE LATENSI (bukti runtime): avgLatencyMs pure-JS di vitest berjitter
 * 18-71% antar-run pada kode yang SAMA (diukur 2026-08-07, 11 kategori).
 * Karena itu avgLatencyMs TIDAK ikut verdict secara default (informational,
 * tetap ditampilkan di delta). Gunakan opsi includeLatencyInVerdict=true
 * bila ingin strict. estCostUsdPerCase deterministik (turunan token) → tetap
 * ikut verdict.
 */
export const DEFAULT_EPSILON = 1e-9;

/** Metrik yang lebih kecil justru lebih baik (latency & biaya). */
const SMALLER_IS_BETTER = new Set(['avgLatencyMs', 'estCostUsdPerCase']);

/** Metrik berisik yang TIDAK ikut verdict kecuali diminta (see header). */
export const NOISY_METRICS = new Set(['avgLatencyMs']);

/** Bidang non-metrik yang tidak ikut dibandingkan. */
const NON_METRIC_FIELDS = new Set(['category', 'cases']);

export function metricDirection(field) {
  return SMALLER_IS_BETTER.has(field) ? 'bad' : 'good';
}

/** Ekstrak metrik numerik dari satu kategori (abaikan objek/string/array). */
export function numericMetrics(category) {
  const out = {};
  for (const [key, value] of Object.entries(category || {})) {
    if (NON_METRIC_FIELDS.has(key)) continue;
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
  }
  return out;
}

/**
 * Diff dua laporan. before/after: { categories: Array<{ category, ... }> }.
 * Opsi: epsilon (toleransi absolut), includeLatencyInVerdict (strict mode).
 * Mengembalikan { categories, overallVerdict, improvedCategories,
 * regressedCategories, newCategories, removedCategories }.
 */
export function diffBenchmarkReports(
  before,
  after,
  { epsilon = DEFAULT_EPSILON, includeLatencyInVerdict = false } = {},
) {
  const beforeList = (before?.categories || []).map((c) => ({ ...c }));
  const afterList = (after?.categories || []).map((c) => ({ ...c }));
  const beforeMap = new Map(beforeList.map((c) => [c.category, c]));
  const afterMap = new Map(afterList.map((c) => [c.category, c]));

  const categories = [];
  const improvedCategories = [];
  const regressedCategories = [];
  const newCategories = [];
  const removedCategories = [];

  for (const [name, beforeCat] of beforeMap) {
    const afterCat = afterMap.get(name);
    if (!afterCat) {
      removedCategories.push(name);
      categories.push({ category: name, verdict: 'removed', metrics: [], beforeCases: beforeCat.cases, afterCases: null });
      continue;
    }
    const bm = numericMetrics(beforeCat);
    const am = numericMetrics(afterCat);
    const metrics = [];
    let improvedCount = 0;
    let regressedCount = 0;
    let unchangedCount = 0;

    // Metrik yang ada di before (bandingkan semua; field baru di after dicatat).
    const fields = new Set([...Object.keys(bm), ...Object.keys(am)]);
    for (const field of fields) {
      const b = bm[field];
      const a = am[field];
      if (b === undefined || a === undefined) continue; // field hilang/baru → diabaikan (jarang)
      const delta = a - b;
      const direction = metricDirection(field);
      const better = direction === 'good' ? delta > epsilon : delta < -epsilon;
      const worse = direction === 'good' ? delta < -epsilon : delta > epsilon;
      // Metrik berisik tidak memengaruhi verdict (informational) kecuali strict mode.
      const noisy = NOISY_METRICS.has(field);
      const verdictAffecting = !noisy || includeLatencyInVerdict;
      if (verdictAffecting) {
        if (worse) regressedCount += 1;
        else if (better) improvedCount += 1;
        else unchangedCount += 1;
      }
      metrics.push({
        field,
        before: b,
        after: a,
        delta,
        direction,
        better,
        worse,
        unchanged: !better && !worse,
        noisy,
      });
    }

    const verdict = regressedCount > 0 ? 'regressed' : improvedCount > 0 ? 'improved' : 'unchanged';
    if (verdict === 'improved') improvedCategories.push(name);
    if (verdict === 'regressed') regressedCategories.push(name);
    categories.push({
      category: name,
      verdict,
      beforeCases: beforeCat.cases,
      afterCases: afterCat.cases,
      improvedCount,
      regressedCount,
      unchangedCount,
      metrics,
    });
  }

  // Kategori baru yang hanya ada di after.
  for (const [name] of afterMap) {
    if (!beforeMap.has(name)) {
      newCategories.push(name);
      categories.push({ category: name, verdict: 'new', metrics: [], beforeCases: null, afterCases: afterMap.get(name).cases });
    }
  }

  const overallVerdict = regressedCategories.length > 0
    ? 'regressed'
    : improvedCategories.length > 0
      ? 'improved'
      : 'unchanged';

  return {
    categories,
    overallVerdict,
    improvedCategories,
    regressedCategories,
    newCategories,
    removedCategories,
  };
}

/** Ringkas delta per kategori untuk console.table (teks pendek). */
export function summarizeCategory(cat) {
  if (cat.verdict === 'new' || cat.verdict === 'removed') return { category: cat.category, verdict: cat.verdict, delta: cat.verdict };
  const changed = cat.metrics.filter((m) => !m.unchanged);
  if (changed.length === 0) return { category: cat.category, verdict: cat.verdict, delta: '—' };
  const deltaText = changed
    .map((m) => `${m.field} ${m.delta >= 0 ? '+' : ''}${round6(m.delta)}${m.noisy ? ' (info)' : ''}`)
    .join(', ');
  return { category: cat.category, verdict: cat.verdict, delta: deltaText };
}

function round6(v) {
  return Math.abs(v) < 1e-9 ? 0 : Number(v.toFixed(6));
}

/** Baris tabel ringkas untuk console.table. */
export function renderDiffTable(diff) {
  return diff.categories.map(summarizeCategory);
}

/** Pesan verdict ramah terminal. */
export function verdictLine(diff, labelAfter) {
  const head = `Perbandingan benchmark (${labelAfter}):`;
  const improved = diff.improvedCategories.length > 0 ? `\n  ✅ membaik: ${diff.improvedCategories.join(', ')}` : '';
  const regressed = diff.regressedCategories.length > 0 ? `\n  ❌ memburuk: ${diff.regressedCategories.join(', ')}` : '';
  const added = diff.newCategories.length > 0 ? `\n  ➕ baru: ${diff.newCategories.join(', ')}` : '';
  const removed = diff.removedCategories.length > 0 ? `\n  ➖ hilang: ${diff.removedCategories.join(', ')}` : '';
  const verdict = diff.overallVerdict === 'improved' ? 'MEMBAIK (aman untuk dilanjutkan)' : diff.overallVerdict === 'regressed' ? 'MENGALAMI REGRESI — tinjau perubahan' : 'TIDAK BERUBAH (deterministik)';
  return `${head}${improved}${regressed}${added}${removed}\n  Verdict: ${verdict}`;
}
