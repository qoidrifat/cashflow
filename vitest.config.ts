import { defineConfig } from 'vitest/config';

/**
 * Vitest config — dua PROJECT terpisah (vitest 3 `projects`):
 *
 * 1. `unit-node`   — pure logic (environment: node): tests/unit/*.test.ts +
 *                    semua spec di tests/benchmark (glob "** /*.spec.ts"
 *                    juga menjaring aiLiveBenchmark — self-skip tanpa
 *                    BENCH_LIVE=1). TANPA overhead DOM boot — suite cepat.
 * 2. `unit-dom`    — komponen React (environment: happy-dom): tests/unit/*.test.tsx
 *                    (statCard, aiShownTelemetryDedup, aiFeedbackButtons).
 *                    happy-dom boot jauh lebih cepat daripada jsdom → tidak ada
 *                    lagi docblock `@vitest-environment jsdom` per file.
 *                    (jsdom tetap di devDependencies sebagai fallback env DOM;
 *                    cukup ganti environment di project ini bila dibutuhkan.)
 *                    setupFiles tests/unit/setup.ts = jest-dom matchers +
 *                    afterEach(cleanup) SEKALI untuk semua file komponen
 *                    (file test tidak perlu import keduanya lagi).
 *
 * Sebelumnya: semua file memakai `environment: 'node'` global + docblock
 * `// @vitest-environment jsdom` per file .tsx (boot jsdom TIDAK bisa di-share
 * antar file → overhead per file). Dengan project terpisah, environment ditetapkan
 * sekali di level project; docblock dihapus dari file komponen.
 *
 * Menjalankan:
 *   npm run test:unit          # kedua project (pola lama tetap sama)
 *   npx vitest run --project unit-node   # hanya pure logic
 *   npx vitest run --project unit-dom    # hanya komponen
 */
export default defineConfig({
  test: {
    globals: false,
    pool: 'forks',
    projects: [
      {
        test: {
          name: 'unit-node',
          environment: 'node',
          // Benchmark offline (Sprint 1 P1.6): deterministik, 5 kategori,
          // regression floors — dipanggil via `npm run benchmark:ai` DAN ikut
          // `npm run test:unit` (CI) sebagai guard. Glob juga menjaring
          // aiLiveBenchmark.spec.ts — ia self-skip tanpa BENCH_LIVE=1.
          include: ['tests/unit/**/*.test.ts', 'tests/benchmark/**/*.spec.ts'],
        },
      },
      {
        test: {
          name: 'unit-dom',
          environment: 'happy-dom',
          // Komponen React + RTL + jest-dom. happy-dom = environment DOM ringan
          // (lebih cepat dari jsdom). Jest-dom matcher & RTL kompatibel.
          include: ['tests/unit/**/*.test.tsx'],
          // Setup otomatis per project: jest-dom matchers + afterEach(cleanup)
          // (globals: false → RTL tidak auto-register; registrasi di sini sekali).
          // Render helper bersama: tests/unit/helpers/render.tsx.
          setupFiles: ['tests/unit/setup.ts'],
        },
      },
    ],
  },
});
