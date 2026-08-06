# Performance Baseline

> Baseline terukur untuk perbandingan sprint berikutnya. Tanggal: 2026-08-06.
> Semua angka diukur pada commit sebelum tag `react-performance-stable`.

## 1. Build

| Metrik | Nilai |
|---|---|
| Waktu build | 12.7–26.3 s (inkonsistensi disk; rata-rata ~15 s) |
| Exit code | 0 |
| Chunk entry (index) | 102.65 kB raw · 31.72 kB gzip |
| vendor-react | 334.15 kB raw · 102.13 kB gzip |
| vendor-motion | 128.78 kB raw · 42.32 kB gzip |
| CSS total | 88.62 kB |
| Charts (lazy, recharts) | 330.36 kB raw · 99.27 kB gzip |
| GmailSyncPage (lazy) | 151.19 kB raw · 42.10 kB gzip |

Semua halaman **lazy-loaded** (React.lazy) — tidak ada halaman di entry selain
app shell.

## 2. Render (Runtime Capture, 35s /admin/monitoring)

| Komponen | Sebelum | Sesudah | Delta |
|---|---|---|---|
| App | 15 | 5 | −67% |
| MonitoringPage | 17 | 9 | −47% |
| Sidebar | 19 | 9 | −53% |
| Header/Bell | 15 | 11 | −27% |

Toggle theme (mutasi legitimate): 20 render terbuang → **0 render terbuang**.

## 3. Memory (Probe 7 menit, 19 siklus navigasi antar halaman)

| Metrik | Nilai |
|---|---|
| Heap awal (avg kuartil-1) | 22.3 MB |
| Heap akhir (avg kuartil-3) | 22.6 MB |
| Growth | **+0.2 MB** → tidak ada leak |
| Console error / pageerror | 0 selama probe |

## 4. Lighthouse (halaman /login, preview lokal tanpa gzip)

| Kategori | Skor | Target |
|---|---|---|
| Performance | 78–83* | ≥ 95 |
| Accessibility | 100 | 100 ✓ |
| Best Practices | 100 | 100 ✓ |
| SEO | 100 | ≥ 95 ✓ |

\* PERF rendah karena `vite preview` TIDAK menerapkan gzip/brotli → Lighthouse
simulated menghitung transfer RAW (~565 kB JS) bukan gzip (~176 kB). Di
deployment produksi (CDN + gzip) skor akan jauh lebih tinggi. Faktor lain:
vendor-react + vendor-motion ada di critical path karena dipakai komponen
layout/UI (tidak bisa di-lazy tanpa merombak entry — ditolak, over-engineering).
CLS 0, TBT 0, server response 100 → inti runtime baik.

## 5. Test Gates

| Gate | Hasil |
|---|---|
| Typecheck | ✓ |
| Lint | ✓ |
| Unit (vitest) | 471/471 ✓ |
| Store subscription guard | ✓ |
| E2E dashboard / core-pages / notifications | ✓ (subset lokal) |
| E2E transactions (dataset lokal) | ⚠️ gagal karena dataset tidak sinkron (774 vs 541) — bukan regresi kode |

## 6. Cara Reproduksi

```bash
npm run build                     # ukur waktu build & chunk
npx vite preview --port 4173      # lalu Lighthouse ke :4173/login
node scripts/tmp-memory-probe.mjs # probe memori (hapus setelah dipakai)
npx vitest run                    # unit + guard
npx playwright test e2e/dashboard.spec.ts
```
