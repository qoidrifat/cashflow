# Visual Regression Plan — CashFlow

> Phase 6 · Playwright Snapshot Testing: theming, responsive, baseline & CI workflow
> Date: 2026-08-01

## 1. Strategi

Gunakan **Playwright `toHaveScreenshot`** (snapshot image) dengan:
- **Theme**: light + dark (key `localStorage['cashflow-theme']` — lihat `STORAGE_KEYS.THEME`).
- **Viewport**: desktop 1440×900, tablet 768×1024, mobile 390×844.
- **Baseline** di-commit ke repo (`e2e/visual/__screenshots__/*`), diff otomatis di CI.

## 2. Setup

### a. Config (playwright.config.ts — tambah project visual)
```ts
projects: [
  { name: 'visual-light-desktop', use: { viewport: { width: 1440, height: 900 } }, grep: /@visual/ },
  { name: 'visual-dark-mobile', use: { viewport: { width: 390, height: 844 } }, grep: /@visual/ },
],
```
> Alternatif lebih sederhana: satu project + loop tema/viewport di dalam test (dianjurkan untuk
> tahap awal — minim config, maksimal kontrol).

### b. Helper tema (e2e/helpers/theme.ts)
```ts
export async function setTheme(context: BrowserContext, mode: 'light' | 'dark'): Promise<void> {
  await context.addInitScript((m) => {
    try { localStorage.setItem('cashflow-theme', m); } catch { /* noop */ }
  }, mode);
}
```
> Set `localStorage` via `addInitScript` **sebelum** navigasi → class `dark` diterapkan saat render
> (aplikasi membaca `STORAGE_KEYS.THEME`).

### c. Snapshot test template
```ts
test('@visual dashboard light desktop', async ({ page }) => {
  await page.goto('/dashboard');
  await page.waitForLoadState('domcontentloaded');
  await expect(page.getByText('Total Saldo', { exact: true }).first()).toBeVisible();
  await expect(page).toHaveScreenshot('dashboard-light-desktop.png', {
    maxDiffPixelRatio: 0.01,      // toleransi anti-flaky (font/AA)
    animations: 'disabled',        // matikan animasi framer-motion
    caret: 'hide',
    fullPage: false,               // above-the-fold dulu
  });
});
```

## 3. Anti-Flaky untuk Snapshot

| Risiko | Mitigasi |
|---|---|
| Font loading berubah | `await page.evaluate(() => document.fonts.ready)` sebelum screenshot |
| Animasi/transition | `animations: 'disabled'` di opsi screenshot |
| Time-dependent (tanggal "hari ini") | Mask area tanggal (`mask` option) atau seed tanggal tetap |
| Data berubah (284/519) | Visual hanya untuk halaman statis/skeleton-stabil; data-driven halaman di-mask pada region angka |
| Dark mode class timing | Set tema via addInitScript (bukan toggle runtime) + tunggu `html.dark` |
| Theme preference OS | App `getSystemTheme()` fallback — pastikan `cashflow-theme` selalu di-set |

## 4. Baseline Management

- `npx playwright test --update-snapshots` untuk regenerate baseline (dev, bukan CI).
- Baseline di-commit; di CI `--update-snapshots` TIDAK dijalankan (diff = failure).
- Folder: `e2e/visual/__screenshots__/` + `.gitignore` jangan meng-exclude.

## 5. Matrix Snapshot Awal (prioritas)

| Halaman | Light | Dark | Desktop | Tablet | Mobile |
|---|---|---|---|---|---|
| Dashboard (above-fold) | ✅ | ✅ | ✅ | — | ✅ |
| Transactions (list + pagination) | ✅ | ✅ | ✅ | — | ✅ |
| Gmail Sync (summary + list) | ✅ | ✅ | ✅ | — | ✅ |
| Login/Landing | ✅ | ✅ | ✅ | — | ✅ |

> Mulai dengan 3 halaman inti × light/dark × desktop/mobile = 12 snapshot awal; tablet ditambahkan
> setelah stabil.

## 6. CI

- Job `visual` di workflow (lihat CI_PIPELINE.md) — jalankan hanya pada PR yang menyentuh
  `src/**` (path filter) untuk hemat biaya.
- Artifact: `test-results/**/*-diff.png` + HTML report → lampirkan di PR comment (optional).

## 7. Risiko

- Snapshot rapuh terhadap perubahan font/icons library — toleransi `maxDiffPixelRatio` 0.01–0.02.
- Dataset berubah → angka di snapshot berubah → update baseline + re-commit.
- **Rekomendasi**: jalankan visual regression terpisah dari functional suite (job berbeda)
  agar kegagalan diff tidak memblokir smoke/functional.
