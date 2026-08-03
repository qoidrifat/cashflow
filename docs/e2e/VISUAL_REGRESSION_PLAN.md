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

- `npm run test:e2e:visual` = regenerate baseline (`--update-snapshots`); `npm run test:e2e:visual:check` = mode check (diff = failure).
- Baseline di-commit; di CI `--update-snapshots` TIDAK dijalankan (diff = failure).
- Folder aktual: `e2e/visual/visual-regression.spec.ts-snapshots/*.png` (bukan `__screenshots__`).
- **Portabel lintas OS**: `playwright.config.ts` memakai `snapshotPathTemplate` TANPA token `{-snapshotSuffix}` (suffix platform `-win32`/`-linux` dihapus) → baseline Windows & check Ubuntu memakai nama file sama.
- **Font self-hosted**: Manrope + Outfit di `public/fonts/` (variable TTF, OFL) menggantikan Google Fonts CDN — prasyarat determinisme visual lintas-OS (baseline digenerate di Windows, check di Ubuntu).

## 5. Matrix Snapshot Aktual (terimplementasi 2026-08-03 — 6 snapshot)

| Halaman | Light | Dark | Desktop | Tablet | Mobile |
|---|---|---|---|---|---|
| Landing (publik, tanpa auth) | ✅ | ✅ | ✅ | — | ✅ |
| Dashboard (auth via cookie, stat cards di-mask) | ✅ | ✅ | ✅ | — | — |
| Transactions / Gmail Sync / Login | — | — | — | — | — (menyusul) |

> Implementasi awal memakai **loop tema/viewport di dalam test** (1 project + `setTheme` helper) —
> sesuai opsi "lebih sederhana" di seksi 2a. Stat cards dashboard di-mask (angka berubah, layout tidak)
> → baseline stabil tanpa seed ulang. Tablet + halaman lain (Transactions/Gmail) menyusul di iterasi
> berikutnya; tambahkan ke `e2e/visual/visual-regression.spec.ts`.

## 6. CI

- ✅ **TERIMPLEMENTASI** (2026-08-03): job `visual-regression` di `.github/workflows/e2e.yml`
  (`needs: [quality, e2e]`, serial — DB Turso bersama), menjalankan `npm run test:e2e:visual:check`.
- Artifact: `visual-diffs` (screenshot actual vs baseline + snapshot dir, on failure) + `playwright-report-visual` (always).
- Kalibrasi pertama CI: bila diff antar-OS muncul (hinting/antialiasing), naikkan `maxDiffPixelRatio` bertahap atau mask region teks — bukan hapus matcher.

## 7. Risiko

- Snapshot rapuh terhadap perubahan font/icons library — toleransi `maxDiffPixelRatio` 0.02 (sudah dipakai).
- Dataset berubah → angka di snapshot berubah → update baseline + re-commit (dashboard sudah di-mask → minim).
- **SELESAI**: visual regression berjalan di job terpisah dari functional suite — kegagalan diff tidak memblokir smoke/functional (keduanya serial di CI, tapi state terpisah).
