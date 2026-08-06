import { defineConfig } from 'vitest/config';

/**
 * Vitest config — unit test untuk pure logic (tidak butuh browser/playwright).
 *
 * Cakupan: tests/unit (semua file .test.ts di direktori itu)
 *   - e2e/helpers/pagination.ts (fungsi murni: counterRegexFor, listTotalFrom, listRangeFrom)
 *   - src/lib/*  (aiDecisionValidator, confidenceScorer, tiketDedupe, promoCashbackClassifier, ...)
 *   - src/utils/aiTokenEstimator.ts
 *
 * Menjalankan:
 *   npm run test:unit
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/benchmark/**/*.spec.ts'],
    // tests/benchmark/aiQualityBenchmark.spec.ts — AI Quality Benchmark (Sprint 1
    // P1.6): deterministik, 5 kategori, regression floors. Dipanggil via
    // `npm run benchmark:ai` DAN ikut `npm run test:unit` (CI) sebagai guard.
    globals: false,
    // Unit test = fast; paralel default per file.
    pool: 'forks',
  },
});
