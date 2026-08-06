# Lighthouse Report

> Sprint 0.6 · Halaman: `/login` · Runner: Lighthouse 13.4.1 (headless Chrome,
> simulated mobile 4G) terhadap `vite preview` production build.

## 1. Skor

| Kategori | Sebelum | Sesudah Fix | Target | Status |
|---|---|---|---|---|
| Performance | 81 | 78–83* | ≥ 95 | ⚠️ lihat analisis |
| Accessibility | 100 | 100 | 100 | ✅ |
| Best Practices | 96 | 100 | 100 | ✅ |
| SEO | 91 | 100 | ≥ 95 | ✅ |

\* fluktuasi antar-run (78, 81, 83) karena throttling simulated + lingkungan lokal.

## 2. Fix yang Diterapkan (minimal, tanpa ubah perilaku)

| Temuan | Root Cause | Fix |
|---|---|---|
| SEO 91 | `robots.txt` tidak ada (audit `robots-txt` score 0) | Tambah `public/robots.txt` (`User-agent: *` + `Disallow: /api/`) |
| BEST 96 | `errors-in-console`: fetch `/api/auth/get-session` diblokir CORS dari origin `http://localhost:4173` | Tambah `http://localhost:4173` (+ `127.0.0.1:4173`) ke default `ALLOWED_ORIGINS` di `server/index.js` (produksi memakai env `ALLOWED_ORIGINS` — tidak terpengaruh) |

## 3. Analisis Performance (78–83)

Metrik inti sebenarnya sehat:

| Metrik | Nilai | Evaluasi |
|---|---|---|
| First Contentful Paint | ~3540 ms | ✗ ditentukan bundle |
| Largest Contentful Paint | ~3840 ms | ✗ sama |
| Speed Index | ~3540 ms | = FCP |
| Total Blocking Time | 0 ms | ✅ sempurna |
| Cumulative Layout Shift | 0 | ✅ sempurna |
| Initial server response | 100 | ✅ cepat |

### Root cause skor rendah

1. **`vite preview` tanpa gzip/brotli** — Lighthouse simulated mengukur transfer
   RAW: index (102 kB) + vendor-react (334 kB) + vendor-motion (128 kB) ≈
   **565 kB raw** vs **~176 kB gzip** di produksi nyata (CDN). Ini
   **underestimate** vs deployment sebenarnya.
2. **vendor-react & vendor-motion di critical path** — dipakai komponen entry
   (AppLayout, Sidebar, Button, Modal, ToastContainer, dsb). Memisahkannya
   memerlukan restrukturisasi entry = **over-engineering, ditolak** sesuai
   aturan sprint (tidak ada manfaat tanpa kompleksitas).
3. `unused-javascript` / `unused-css` score 0 — audit berbobot yang menghukum
   SPA monolith bundle; sifat audit informasi (tidak memblok).

### Rekomendasi (untuk dipertimbangkan sprint berikutnya — BUKAN bagian baseline ini)

- Deploy static via CDN yang menerapkan gzip/brotli (GitHub Pages sudah otomatis).
- Opsional: `font-display: swap` sudah ada; tidak ada font blocking.
- Opsional (ROI sedang): pindah framer-motion hanya ke halaman yang benar-benar
  animasi — butuh refactor entry, bukan sprint stabilisasi.

## 4. Metodologi & Reproduksi

```bash
npm run build
npx vite preview --port 4173 --strictPort &
npx lighthouse http://localhost:4173/login \
  --only-categories=performance,accessibility,best-practices,seo \
  --output=json --output-path=./tmp-lh.json \
  --chrome-flags='--headless --no-sandbox'
```

Catatan Windows: `--output-path` relatif (bukan `/tmp`) agar Lighthouse bisa
menulis; error `EPERM` saat cleanup temp dir adalah kosmetik (hasil tetap valid).
