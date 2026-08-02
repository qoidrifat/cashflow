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
    include: ['tests/unit/**/*.test.ts'],
    globals: false,
    // Unit test = fast; paralel default per file.
    pool: 'forks',
  },
});
