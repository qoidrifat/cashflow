# Bundle Analysis

> Sprint 0.6 · Output `npm run build` (vite build, production). Ukuran raw + gzip.

## 1. Chunk Inventory (sorted by raw size)

| Chunk | Raw | Gzip | Kategori |
|---|---|---|---|
| vendor-react | 334.15 kB | 102.13 kB | React + router + zustand (entry) |
| CartesianChart | 330.36 kB | 99.27 kB | **lazy** (recharts — hanya halaman chart) |
| GmailSyncPage | 151.19 kB | 42.10 kB | **lazy** halaman |
| vendor-motion | 128.78 kB | 42.32 kB | framer-motion (entry — dipakai komponen UI) |
| index (entry) | 102.65 kB | 31.72 kB | app shell |
| ProfessionalSuitePage | 81.92 kB | 22.44 kB | **lazy** |
| ReportsPage | 46.49 kB | 13.63 kB | **lazy** |
| TransactionsPage | 46.91 kB | 12.59 kB | **lazy** |
| AiSearchPage | 23.57 kB | 7.06 kB | **lazy** |
| MonitoringPage | 21.01 kB | 5.73 kB | **lazy** |
| LoginPage | 17.82 kB | 4.87 kB | **lazy** |
| AdvisorPage | 16.52 kB | 5.71 kB | **lazy** |
| RecurringPage | 16.75 kB | 4.23 kB | **lazy** |
| LineChart | 15.02 kB | 4.94 kB | lazy |
| DashboardPage | 14.29 kB | 5.17 kB | **lazy** |
| + 20+ chunk kecil (2–10 kB) | — | — | per-page lazy |

CSS: `index-*.css` 88.62 kB (Tailwind, satu file entry).

## 2. Analisis

### Sudah optimal
- **Semua halaman lazy-loaded** — tidak ada page-level code di entry.
- **recharts terisolasi** di `CartesianChart` chunk (330 kB) — dimuat hanya saat
  dashboard/reports/monitoring render chart. Entry tidak menyentuh recharts.
- Tiap halaman menghasilkan chunk terpisah (code splitting manual via
  `React.lazy` di `src/app/router.tsx`).

### Berat yang tersisa (documented, bukan blocker)
1. **vendor-react 334 kB (gzip 102 kB)** — React 18 + react-dom + router +
   zustand: inti SPA, tidak bisa dikurangi tanpa framework swap (dilarang).
2. **vendor-motion 128 kB (gzip 42 kB)** — framer-motion di-import komponen
   entry (AppLayout, Sidebar, Button, Modal, ToastContainer, StatCard,
   TransactionItem, PageTransition, dsb). Memindahkannya = refactor entry
   besar tanpa jaminan manfaat — **ditolak** (over-engineering, aturan sprint).
3. **GmailSyncPage 151 kB** — halaman terbesar (UI kompleks + chart internal);
   sudah lazy, jadi tidak membebani halaman lain.

## 3. Duplicate Dependency Check

Tidak ada dependency duplikat di bundle (grep bundle markers konsisten; build
tanpa warning duplicate). Tidak ada lib yang di-bundle 2×.

## 4. Rekomendasi (future, bukan baseline)

| Item | ROI | Catatan |
|---|---|---|
| gzip/brotli di hosting (CDN) | Tinggi | Mengurangi transfer ~70% — gratis di GitHub Pages/Render |
| Migrasi framer-motion → CSS animation pada komponen entry | Sedang | Hemat 42 kB gzip entry — butuh QA visual menyeluruh |
| Preload kritis (hanya font yang dipakai login) | Rendah | Manfaat marginal |
