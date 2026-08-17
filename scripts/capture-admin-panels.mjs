/**
 * capture-admin-panels.mjs — regenerasi screenshot panel admin monitoring
 * (dokumentasi audit P10.1 / P10.2) dalam SATU perintah.
 *
 * Memakai engine bersama scripts/captureEngine.mjs — script ini hanya
 * MENDEFINISIKAN konfigurasi:
 *   · PANELS (heading h3 → file light/dark) — selector panel
 *   · beforeAll: seed fixture DETERMINISTIK (id prefiks e2e-*): ai_usage_metrics
 *     trend, rekomendasi (shown/opened), feedback-rate, retention cohort —
 *     REUSE fungsi yang sudah diuji e2e (tidak duplikasi SQL).
 *   · onTheme: klik toggle "90 Hari" setelah tiap reload tema (window 90 hari
 *     agar cohort retention 40 hari lalu tampil — pola spec retention).
 *   · afterAll: cleanup fixture.
 *
 * Menjalankan:
 *   npm run capture:admin
 *   node scripts/capture-admin-panels.mjs --theme light          # hanya light
 *   node scripts/capture-admin-panels.mjs --email admin@x.test   # user tertentu
 *   node scripts/capture-admin-panels.mjs --out /tmp/shots        # folder lain
 *   node scripts/capture-admin-panels.mjs --no-seed --keep-data   # data sudah ada
 *   node scripts/capture-admin-panels.mjs --ci                    # CI: output ke folder
 *     temporer + summary.json + exit 0/1 (job GH Actions; --out eksplisit tetap
 *     dihormati, tanpa --out memakai folder temp baru)
 *
 * Prasyarat: server dev berjalan (Vite 5180 + API 5181, `npm run dev:all`) +
 * browser Playwright terpasang (`npx playwright install chromium`).
 * Output default: docs/assets/screenshots/admin-monitoring-*.png (nama sama
 * dengan INDEX.md — regenerasi in-place, tidak perlu update INDEX).
 */
import { loadEnv, parseArgs, THEMES, runCapture, exitForCapture } from './captureEngine.mjs';
import {
  seedAICostTrendFixtures,
  cleanupAICostTrendFixtures,
  seedRecommendationFixtures,
  cleanupRecommendationFixtures,
  seedFeedbackRateFixtures,
  cleanupFeedbackRateFixtures,
  seedRetentionFixtures,
  cleanupRetentionFixtures,
} from '../e2e/helpers/mintSession.ts';

/** Panel yang dicapture: heading h3 → file output (light/dark). */
const PANELS = [
  {
    heading: 'Rekomendasi AI',
    light: 'admin-monitoring-recommendation.png',
    dark: 'admin-monitoring-recommendation-dark.png',
  },
  {
    heading: 'Feedback Rate',
    light: 'admin-monitoring-feedback-rate.png',
    dark: 'admin-monitoring-feedback-rate-dark.png',
  },
  {
    heading: 'Retensi Pengguna',
    light: 'admin-monitoring-retention.png',
    dark: 'admin-monitoring-retention-dark.png',
  },
];

async function main() {
  loadEnv();
  const args = parseArgs(process.argv.slice(2), {
    defaults: { width: 1440, height: 900, noSeed: false },
    booleans: ['--no-seed'],
  });
  const themes = THEMES(args.theme);

  // Resolusi email admin: flag > ADMIN_EMAILS[0] > fallback demo.
  const adminEmail =
    args.email ||
    (process.env.ADMIN_EMAILS || '').split(',')[0]?.trim() ||
    'demo@cashflow.test';
  console.log(`[capture] Admin: ${adminEmail} · theme: ${themes.join('+')} · out: ${args.out}`);

  const result = await runCapture({
    email: adminEmail,
    width: args.width,
    height: args.height,
    themes,
    out: args.out,
    keepData: args.keepData,
    ci: args.ci,
    pages: [
      {
        id: 'monitoring',
        path: '/admin/monitoring',
        waitText: 'AI Cost & Health',
        onTheme: async (page) => {
          // PENTING: klik toggle periode "90 Hari" SETELAH tiap reload tema —
          // reload me-reset periodDays ke default 7 hari, sedangkan cohort
          // retention fixture 40 hari lalu (di luar window 7 hari) sehingga
          // panel Retensi hanya menampilkan data setelah toggle ini
          // (pola e2e/admin-monitoring-retention.spec.ts:189). Fixture panel
          // lain (recommendation/feedback-rate) berada dalam 7 hari — window
          // 90 hari mencakup semuanya (deterministik).
          await page.getByRole('button', { name: '90 Hari' }).click().catch(() => {});
          await page.waitForTimeout(2500); // fetch ulang dengan window 90 hari
          // Tunggu ketiga panel render (data fixtures).
          for (const panel of PANELS) {
            await page
              .locator(`h3:has-text("${panel.heading}")`)
              .first()
              .waitFor({ state: 'visible', timeout: 20000 })
              .catch(() => {});
          }
          await page.waitForTimeout(1800); // chart recharts settle
        },
        shots: PANELS.map((panel) => ({
          // Element capture: heading → ancestor Card (.rounded-2xl) — engine.
          element: { heading: panel.heading },
          light: panel.light,
          dark: panel.dark,
        })),
      },
    ],
    beforeAll: async (session) => {
      // Seed fixture deterministik (id prefiks e2e-* → aman di-cleanup).
      if (args.noSeed) return;
      // DELETE-first (self-healing): bila run sebelumnya terputus (SIGKILL/crash)
      // sebelum cleanup, sisa e2e-* tersangkut dan seed berikutnya gagal
      // (fixed id → PRIMARY KEY violation). Bersihkan dulu = idempoten.
      // (retention sudah delete-first internal; keempatnya dipanggil eksplisit.)
      await cleanupAICostTrendFixtures();
      await cleanupRecommendationFixtures();
      await cleanupFeedbackRateFixtures();
      await cleanupRetentionFixtures();
      await seedAICostTrendFixtures(session.userId);
      await seedRecommendationFixtures(session.userId);
      await seedFeedbackRateFixtures(session.userId);
      await seedRetentionFixtures();
      console.log('[capture] Fixture di-seed (ai-cost · recommendation · feedback-rate · retention)');
    },
    afterAll: async () => {
      // Cleanup fixture (selalu jalan — walau screenshot gagal; sesi ditangani engine).
      if (args.keepData) {
        console.log('[capture] --keep-data: fixture TIDAK dihapus');
        return;
      }
      await cleanupRetentionFixtures();
      await cleanupRecommendationFixtures();
      await cleanupFeedbackRateFixtures();
      await cleanupAICostTrendFixtures();
      console.log('[capture] Cleanup fixture selesai (e2e-* dihapus)');
    },
  });
  // CI: exit 1 bila ada kegagalan (shot/setup/waitText/cleanup) — job gagal.
  exitForCapture(result, args.ci);
}

main().catch((err) => {
  console.error('[capture] GAGAL:', err.message);
  process.exit(1);
});
