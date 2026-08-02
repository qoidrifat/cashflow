/**
 * E2E: Visual regression (P3.11 — dari VISUAL_REGRESSION_PLAN.md).
 *
 * Snapshot Playwright untuk deteksi regresi visual:
 *   - Theme: light + dark (localStorage 'cashflow-theme' via helper setTheme)
 *   - Viewport: desktop 1440×900 + mobile 390×844 (loop di dalam test)
 *   - Baseline di-commit ke e2e/visual/__screenshots__/
 *
 * Halaman yang di-snapshot (above-the-fold, fullPage:false):
 *   - Landing (publik, tanpa auth)   — statis, baseline paling stabil
 *   - Dashboard (auth via cookie)    — data-driven: angka di-mask biar stabil
 *
 * Anti-flaky:
 *   - fonts.ready + animasi disabled + caret hide
 *   - maxDiffPixelRatio 0.02 (font AA/antialiasing)
 *   - region angka dinamis di-mask (stat cards dashboard)
 *
 * Menjalankan (generate baseline):
 *   npx playwright test e2e/visual/visual-regression.spec.ts --update-snapshots
 * Menjalankan (verify diff):
 *   npm run test:e2e:visual
 */
import { test, expect } from 'playwright/test';
import { mintSessionCookie, cleanupTestSessions } from '../helpers/mintSession';
import { setupAuthContext } from '../helpers/authContext';
import { collectPageErrors } from '../helpers/errors';
import { setTheme, waitForTheme, type VisualTheme } from '../helpers/theme';

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };
const THEMES: VisualTheme[] = ['light', 'dark'];

/** Render + tunggu stabil, lalu screenshot (masked region angka). */
async function snapshotPage(
  page: import('playwright/test').Page,
  opts: {
    name: string;
    theme: VisualTheme;
    mask?: import('playwright/test').Locator[];
    mobile?: boolean;
  },
): Promise<void> {
  await waitForTheme(page, opts.theme);
  await page.waitForTimeout(400); // skeleton → konten stabil
  await expect(page).toHaveScreenshot(opts.name, {
    animations: 'disabled',
    caret: 'hide',
    fullPage: false,
    maxDiffPixelRatio: 0.02,
    ...(opts.mask ? { mask: opts.mask } : {}),
  });
}

test.describe('Visual regression @visual', () => {
  let session: { cookie: string; userId: string };

  test.beforeAll(async () => {
    session = await mintSessionCookie();
  });

  test.afterAll(async () => {
    await cleanupTestSessions();
  });

  for (const theme of THEMES) {
    test(`landing ${theme} desktop`, async ({ page }) => {
      await setTheme(page.context(), theme);
      const pageErrors = collectPageErrors(page);
      await page.setViewportSize(DESKTOP);
      await page.goto('/landing');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('body')).toBeVisible();
      await snapshotPage(page, { name: `landing-${theme}-desktop.png`, theme });
      pageErrors.expectClean();
    });

    test(`landing ${theme} mobile`, async ({ page }) => {
      await setTheme(page.context(), theme);
      const pageErrors = collectPageErrors(page);
      await page.setViewportSize(MOBILE);
      await page.goto('/landing');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('body')).toBeVisible();
      await snapshotPage(page, { name: `landing-${theme}-mobile.png`, theme, mobile: true });
      pageErrors.expectClean();
    });
  }

  test('dashboard light desktop — stat cards dimask (data-driven)', async ({ page, context }) => {
    await setTheme(context, 'light');
    await setupAuthContext(context, session);
    const pageErrors = collectPageErrors(page);
    await page.setViewportSize(DESKTOP);
    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByText('Total Saldo', { exact: true }).first()).toBeVisible();

    // Mask region angka dinamis (stat cards) — data berubah, layout tidak.
    const mask = [
      page.locator('text=Total Saldo').first().locator('xpath=following-sibling::*[1]'),
      page.locator('text=Pemasukan Bulan Ini').first().locator('xpath=following-sibling::*[1]'),
      page.locator('text=Pengeluaran Bulan Ini').first().locator('xpath=following-sibling::*[1]'),
      page.locator('text=Sisa Budget').first().locator('xpath=following-sibling::*[1]'),
    ];
    await snapshotPage(page, { name: 'dashboard-light-desktop.png', theme: 'light', mask });
    pageErrors.expectClean();
  });

  test('dashboard dark desktop — stat cards dimask (data-driven)', async ({ page, context }) => {
    await setTheme(context, 'dark');
    await setupAuthContext(context, session);
    const pageErrors = collectPageErrors(page);
    await page.setViewportSize(DESKTOP);
    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByText('Total Saldo', { exact: true }).first()).toBeVisible();

    const mask = [
      page.locator('text=Total Saldo').first().locator('xpath=following-sibling::*[1]'),
      page.locator('text=Pemasukan Bulan Ini').first().locator('xpath=following-sibling::*[1]'),
      page.locator('text=Pengeluaran Bulan Ini').first().locator('xpath=following-sibling::*[1]'),
      page.locator('text=Sisa Budget').first().locator('xpath=following-sibling::*[1]'),
    ];
    await snapshotPage(page, { name: 'dashboard-dark-desktop.png', theme: 'dark', mask });
    pageErrors.expectClean();
  });
});
