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
 *   - Transactions (auth)            — data-driven: nominal & counter di-mask
 *   - Gmail Sync (auth)              — data-driven: summary counts + email list di-mask
 *
 * Anti-flaky:
 *   - fonts.ready + animasi disabled + caret hide
 *   - maxDiffPixelRatio 0.02 (font AA/antialiasing)
 *   - region angka dinamis di-mask (stat cards dashboard, nominal/counter transactions,
 *     summary counts + email cards gmail sync)
 *   - Banner "Gemini AI siap digunakan" bergantung pada API key server (env lokal vs CI
 *     bisa beda) → di-deterministikan via route interception /api/gemini/health (mock ok)
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
import { bellButton, waitRealtimeConnected } from '../helpers/realtime';

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
  // Tunggu font self-hosted selesai dimuat (bukan timer tetap) — font swap
  // tengah-screenshot = flaky. Font lokal (public/fonts) cepat, tapi robustness
  // lebih baik daripada waitForTimeout: replace font → render stabil.
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300); // skeleton → konten stabil
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

  // ── Transactions (auth, data-driven — nominal & counter pagination di-mask) ──
  // Dataset e2e user deterministik (seed 284 tx + cleanup approve/reject tests),
  // tapi nominal & counter tetap di-mask: nomor adalah data, layout adalah desain.
  for (const theme of THEMES) {
    test(`transactions ${theme} desktop — nominal & counter dimask (data-driven)`, async ({ page, context }) => {
      await setTheme(context, theme);
      await setupAuthContext(context, session);
      const pageErrors = collectPageErrors(page);
      await page.setViewportSize(DESKTOP);
      await page.goto('/transactions');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.getByText(/Menampilkan \d+-\d+ dari \d+ transaksi/).first()).toBeVisible();

      // Mask: nominal per baris (p.tabular-nums) + counter pagination (angka dinamis).
      const mask = [
        page.locator('p.tabular-nums'),
        page.getByText(/Menampilkan \d+-\d+ dari \d+ transaksi/),
        page.getByText(/Halaman \d+ dari \d+/).first(),
      ];
      await snapshotPage(page, { name: `transactions-${theme}-desktop.png`, theme, mask });
      pageErrors.expectClean();
    });
  }

  // ── Gmail Sync (auth, data-driven — summary counts & email list di-mask) ──
  // Banner Gemini health env-dependent (API key server lokal vs CI) → route
  // interception mock ok:true agar baseline lokal == CI (banner + layout di bawahnya
  // identik). Summary counts + email cards (data-testid^=email-card-) + counter
  // "Menampilkan X-Y dari N email" di-mask (data, bukan desain).
  for (const theme of THEMES) {
    test(`gmail-sync ${theme} desktop — summary counts & email list dimask (data-driven)`, async ({ page, context }) => {
      await setTheme(context, theme);
      await setupAuthContext(context, session);
      // Deterministikkan banner Gemini health (env-dependent) — mock ok:true.
      await page.route('**/api/gemini/health**', (route) =>
        route.fulfill({ json: { ok: true, status: 'ok', message: 'E2E mock health' } }),
      );
      const pageErrors = collectPageErrors(page);
      await page.setViewportSize(DESKTOP);
      await page.goto('/gmail-sync');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.getByText('Diterima', { exact: true }).first()).toBeVisible();
      // Deterministikkan state SSE sebelum snapshot: WifiOff (belum connect) vs
      // terhubung mengubah header. Gate yang sama dipakai spec review realtime.
      await waitRealtimeConnected(bellButton(page));

      // ── Region DATA-DRIVEN disembunyikan (display:none) — terbukti CI #4-#6 ──
      // 1. AutoSync card (data-testid=autosync-status): settings + riwayat sync
      //    (toggle ON/OFF mengubah STRUKTUR card, tanggal, count dinamis). Tinggi
      //    card env-dependent (dev DB riil vs CI DB seed) → meski di-mask, konten
      //    di bawahnya bergeser (mask tidak menahan layout shift) → diff massif.
      // 2. Email cards ([data-testid^=email-card-]): TINGGI per-card tergantung
      //    konten (subjek email dev 2 baris vs seed 1 baris) → blok mask tidak
      //    sejajar antar-env (analisis diff PNG CI #6: gap y=680 di baseline).
      // Keduanya PURE data-driven → display:none DI TEST berlaku identik saat
      // generate baseline maupun check CI → layout di sekitarnya selalu sejajar.
      // Coverage list/card dipertahankan via spec fungsional (gmail-sync.spec.ts).
      await expect(page.locator('[data-testid="autosync-status"]')).toBeVisible();
      await page.addStyleTag({
        content:
          '[data-testid="autosync-status"]{display:none !important} ' +
          '[data-testid^="email-card-"]{display:none !important}',
      });

      // Mask: nilai summary (label → following-sibling value) + counter pagination.
      // Label pakai anchored regex (bukan substring) agar tidak salah tangkap badge
      // 'Diterima Otomatis' / tombol filter 'Config Error' / riwayat 'Diterima:'.
      // notification-badge = jumlah unread (dinamis per env).
      const mask = [
        page.locator('text=/^Diterima$/').first().locator('xpath=following-sibling::*[1]'),
        page.locator('text=/^Perlu Review$/').first().locator('xpath=following-sibling::*[1]'),
        page.locator('text=/^Dilewati\\/Ditolak$/').first().locator('xpath=following-sibling::*[1]'),
        page.locator('text=/^Error$/').first().locator('xpath=following-sibling::*[1]'),
        page.getByText(/Menampilkan \d+-\d+ dari \d+ email/),
        page.locator('[data-testid="notification-badge"]'),
      ];
      await snapshotPage(page, { name: `gmail-sync-${theme}-desktop.png`, theme, mask });
      pageErrors.expectClean();
    });
  }
});
