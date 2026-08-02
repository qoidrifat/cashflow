/**
 * Helpers E2E: tema (light/dark) — untuk visual regression (P3.11).
 *
 * Aplikasi membaca STORAGE_KEYS.THEME dari localStorage ('cashflow-theme').
 * Set via addInitScript SEBELUM navigasi agar class `dark` diterapkan saat
 * render (bukan toggle runtime yang bisa missed animation frame).
 */
import type { BrowserContext } from 'playwright/test';

export const THEME_KEY = 'cashflow-theme';

export type VisualTheme = 'light' | 'dark';

/** Set tema via localStorage addInitScript (sebelum navigasi). */
export async function setTheme(context: BrowserContext, mode: VisualTheme): Promise<void> {
  await context.addInitScript(([key, value]) => {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* noop */
    }
  }, [THEME_KEY, mode] as const);
}

/** Tunggu hingga tema benar-benar ter-apply (html.dark ada/tidak). */
export async function waitForTheme(page: import('playwright/test').Page, mode: VisualTheme): Promise<void> {
  await page.waitForFunction(
    (m) => document.documentElement.classList.contains('dark') === (m === 'dark'),
    mode,
  );
  // Font siap sebelum screenshot (anti-flaky glyph).
  await page.evaluate(() => document.fonts.ready);
}
