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

## 5. Performance Budget Enforcement

- Budget didefinisikan dalam satu file `e2e/performance.config.ts` (angka terpusat).
- Gagal = warning di default, hard-fail di CI `@perf` project (bukan blocker push, tapi report).
- Report dikeluarkan sebagai **JSON** (`test-results/perf/*.json`) untuk dipakai CI trend.

## 6. Integrasi CI

- Job `performance` terpisah di workflow (lihat CI_PIPELINE.md), dijalankan **setelah** smoke,
  atau terjadwal nightly (cron) untuk menghindari flaky di push.
- Artifact: perf JSON + HTML report.

## 7. Risiko & Catatan

- **Dev vs prod build** beda performa — jalankan perf terhadap `npm run build` + `vite preview`
  untuk angka produksi; dev hanya untuk smoke.
- **Machine noise** — gunakan `expect.poll` + median dari 3 runs, bukan single run.
- Dataset perf dibersihkan setelah run (jangan merusak dataset migrasi 284/519).
