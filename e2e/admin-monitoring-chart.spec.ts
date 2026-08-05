/**
 * E2E: Chart multi-seri "Tren Biaya" di Admin Monitoring (Sprint 2).
 *
 * Regression guard untuk:
 *   1. Mode "Semua Fitur" = line chart MULTI-SERI — lebih dari satu garis
 *      recharts + Legend berisi label fitur (FEATURE_LABELS).
 *   2. Filter fitur tunggal (gmail_sync) = seri TUNGGAL — tepat 1 garis, tanpa
 *      Legend (mode single-series memang tanpa Legend).
 *   3. Kembali ke "Semua Fitur" → multi-seri lagi.
 *   4. Dark mode — chart multi-seri tetap render (html.dark) tanpa pageerror.
 *
 * Anti-flaky & determinisme data:
 *   - seedE2eDataset TIDAK mengisi ai_usage_metrics → sebelum test, spec
 *     men-seed 3 baris fixture (gmail_sync / ocr_receipt / insight_generator,
 *     id prefiks 'e2e-usage-') via Turso langsung sehingga chart PASTI punya
 *     >1 seri. Dihapus di afterAll.
 *   - Nilai numerik (biaya/token) tidak di-assert — hanya struktur DOM chart.
 *   - Retry navigasi maks 3× bila panel belum tampil (blip Turso transient —
 *     pola agent-search-engagement.spec.ts).
 *   - Theme via helper setTheme(context, 'dark') + reload (pola visual spec).
 *
 * Menjalankan:
 *   npx playwright test e2e/admin-monitoring-chart.spec.ts
 *   npm run test:e2e:monitoring-chart
 */
import { test, expect, type Page } from 'playwright/test';
import {
  mintSessionCookie,
  cleanupTestSessions,
  seedAICostTrendFixtures,
  cleanupAICostTrendFixtures,
  type MintedSession,
} from './helpers/mintSession';
import { setupAuthContext } from './helpers/authContext';
import { collectPageErrors } from './helpers/errors';
import { setTheme, waitForTheme } from './helpers/theme';

const FILTER_SELECT = 'select[aria-label="Filter fitur pada grafik tren biaya"]';

test.describe('Admin Monitoring — chart multi-seri Tren Biaya (e2e)', () => {
  let session: MintedSession;

  test.beforeAll(async () => {
    session = await mintSessionCookie();
    // Fixture deterministik: 3 fitur dengan usage hari ini → chart multi-seri
    // PASTI punya >1 garis (tanpa ini ai_usage_metrics bisa kosong di CI).
    await seedAICostTrendFixtures(session.userId);
  });

  test.afterAll(async () => {
    await cleanupAICostTrendFixtures();
    await cleanupTestSessions();
  });

  test.beforeEach(async ({ context }) => {
    await setupAuthContext(context, session);
    await setTheme(context, 'light'); // deterministik: mulai dari light
  });

  const lineCount = (page: Page) => page.locator('.recharts-line').count();

  test('multi-seri: >1 garis + Legend; filter fitur → 1 garis; light/dark tanpa pageerror', async ({ page }) => {
    const pageErrors = collectPageErrors(page);

    // ── LIGHT: mode multi-seri (default "Semua Fitur") ──
    const chartTitle = page.getByText('Tren Biaya (7 Hari)');
    for (let attempt = 0; attempt < 3; attempt++) {
      await page.goto('/admin/monitoring', { waitUntil: 'domcontentloaded' });
      await expect(chartTitle).toBeVisible({ timeout: 6000 }).catch(() => {});
      if (await chartTitle.isVisible()) break;
    }
    await expect(chartTitle).toBeVisible({ timeout: 20_000 });

    const select = page.locator(FILTER_SELECT);
    await expect(select).toHaveValue('all');
    // Multi-seri: >1 garis recharts + Legend dengan label fitur ter-seed
    await expect.poll(() => lineCount(page), { timeout: 20_000 }).toBeGreaterThan(1);
    await expect(page.locator('.recharts-legend-wrapper')).toBeVisible();
    await expect(page.locator('.recharts-legend-wrapper')).toContainText('Gmail Sync');

    // ── FILTER: fitur tunggal → tepat 1 garis, tanpa Legend ──
    await select.selectOption('gmail_sync');
    await expect(select).toBeEnabled({ timeout: 20_000 }); // refetch selesai
    await expect(chartTitle).toBeVisible();
    await expect.poll(() => lineCount(page), { timeout: 20_000 }).toBe(1);
    await expect(page.locator('.recharts-legend-wrapper')).toHaveCount(0);

    // ── KEMBALI ke "Semua Fitur" → multi-seri lagi ──
    await select.selectOption('all');
    await expect(select).toBeEnabled({ timeout: 20_000 });
    await expect.poll(() => lineCount(page), { timeout: 20_000 }).toBeGreaterThan(1);
    await expect(page.locator('.recharts-legend-wrapper')).toBeVisible();

    // ── DARK: set theme + reload → multi-seri tetap render ──
    await setTheme(page.context(), 'dark');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForTheme(page, 'dark');
    await expect(chartTitle).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => lineCount(page), { timeout: 20_000 }).toBeGreaterThan(1);
    await expect(page.locator('.recharts-legend-wrapper')).toBeVisible();

    pageErrors.expectClean();
  });
});
