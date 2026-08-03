# Performance Test Plan — CashFlow E2E

> Phase 5 · Performance budget, pengukuran, dan tooling
> Date: 2026-08-01

## 1. Tujuan

Mengukur & menjaga performa halaman kritis (Dashboard, Transaksi, Gmail Sync) dengan budget
eksplisit, memakai **CDP (Chrome DevTools Protocol)** melalui Playwright — tanpa dependensi eksternal.

## 2. Metrik & Budget

| Metrik | Budget (dev, 1x) | Cara ukur |
|---|---|---|
| **Page load (LCP / render pertama konten)** | `< 3s` (dev) · `< 2s` (prod build) | `performance.getEntriesByType('navigation')` via `page.evaluate` |
| **API latency (endpoint inti)** | P50 `< 300ms` · P95 `< 800ms` | CDP `Network.responseReceived` timestamps |
| **Render stability** | `0` layout shift besar setelah data | `PerformanceObserver` (CLS) di inject script |
| **Network waterfall (jumlah request)** | `< 60 request per page load` | CDP `Network.requestWillBeSent` |
| **Large dataset pagination** | Halaman 1000+ item `< 2s` | Ukur waktu dari klik page → counter update |
| **Memory leak indicator** | Heap growth `< 5%` setelah 5× navigasi | CDP `HeapProfiler` sampling |

## 3. Tooling (CDP via Playwright)

Playwright mendukung sesi CDP langsung:

```ts
import { chromium } from 'playwright/test';

test('performance: dashboard load budget', async () => {
  test.setTimeout(120_000);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const client = await page.context().newCDPSession(page);

  const metrics: Record<string, number> = {};
  client.on('Network.responseReceived', (e) => {
    metrics[e.response.url] = e.response.responseTime ?? 0;
  });

  await page.goto('/dashboard');
  const nav = await page.evaluate(() => {
    const n = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    return {
      lcp: n.loadEventEnd - n.startTime,
      domContentLoaded: n.domContentLoadedEventEnd - n.startTime,
    };
  });
  expect(nav.lcp).toBeLessThan(3000);
  await browser.close();
});
```

> Catatan: sesi cookie-login tetap dipakai (mintSession + setupAuthContext) — gabungkan pola
> performance ke spec terpisah `e2e/performance.spec.ts` yang di-skip di default (tag `@perf`).

## 4. Kategori Pengukuran

### a. Page Load
- Navigasi dingin (cache kosong) untuk `/dashboard`, `/transactions`, `/gmail-sync`.
- Ukur `domContentLoaded`, `loadEventEnd`, `LCP` (jika tersedia), jumlah request.

### b. API Latency
- Endpoint inti: `/api/transactions/paginated`, `/api/gmail/logs`, `/api/budgets`, `/api/categories`.
- Hitung P50/P95 dari CDP `responseTime`; flag `>800ms` sebagai warning.

### c. Render Stability
- Inject `PerformanceObserver` untuk CLS; toleransi `< 0.1` setelah skeleton hilang.

### d. Network Waterfall
- Daftar URL + ukuran payload; deteksi: payload > 1MB, request berulang, waterfall seri panjang.

### e. Large Dataset Pagination
- Seed dataset 10k baris (script `scripts/seedPerfDataset.mjs`, cleanup setelahnya) →
  ukur waktu navigasi page 1→2→3 pada Transaksi (pageSize 100) & Gmail.

### f. Memory Leak Indicator
- 5× navigasi bolak-balik antar 3 halaman; `HeapProfiler.takeHeapSnapshot` → bandingkan
  total heap; growth `< 5%` = pass; pantau juga detached nodes via `queryObjects`.

## 5. Performance Budget Enforcement (terimplementasi 2026-08-03)

- Budget didefinisikan dalam satu file `e2e/performance/performance.config.ts` (angka terpusat + override env `PERF_BUDGET_*`).
- **Pagination memakai dua level**: `paginationSoftMs` (default 2000ms — melebihi = **warning** di log + report, BUKAN fail; dev build + React dev mode wajar 2–5s, noise mesin tidak boleh membatalkan CI) vs `paginationHardMs` (default 8000ms — melebihi = **fail**, menangkap regresi orde-magnitudo: N+1, index hilang).
- Page load & API latency: fail di atas budget (dev build longgar: dom 4s / load 6s / API p95 1.2s).
- Report dikeluarkan sebagai **JSON** (`test-results/perf/perf-*.json`) untuk dipakai CI trend & kalibrasi budget.

## 6. Integrasi CI (terimplementasi 2026-08-03)

- ✅ Job `performance` terpisah di `.github/workflows/e2e.yml` (`needs: [quality, e2e, visual-regression]` — serial, DB Turso bersama), menjalankan `npm run test:e2e:perf`.
- Budget CI di-override longgar via env job (`PERF_BUDGET_PAGE_LOAD_MS=8000`, `LOAD_MS=12000`, `API_P95_MS=2500`, `PAGINATION_SOFT_MS=4000`, `PAGINATION_HARD_MS=15000`) — runner shared ubuntu; angka awal, di-tighten bertahap dari trend `perf-reports` artifact (retensi 30 hari).
- Artifact: `perf-reports` (JSON, always) + `playwright-report-perf` (always).

## 7. Risiko & Catatan

- **Dev vs prod build** beda performa — budget dev longgar sengaja; angka produksi: jalankan `npm run build` + `vite preview` dengan `PERF_BUDGET_*` lebih ketat.
- **Machine noise** — API latency dihitung dari 3 sample (p50/p95, bukan single run); pagination diukur sampai counter update (bukan render penuh).
- Dataset perf memakai dataset seed/dev yang ada (541+ transaksi sudah >100 untuk pagination) — tanpa seed 10k terpisah (tidak merusak dataset migrasi).
