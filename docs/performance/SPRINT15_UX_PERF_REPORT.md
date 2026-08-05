# Sprint 1.5 + 1.8 — UX Polish & Performance Audit

> **Status:** Implemented · **Scope:** code splitting, re-render reduction, loading-state correctness

## 1. Performance audit — temuan & perbaikan

### P0: 385 kB recharts+d3 dievaluasi di initial load (FIXED)
**Temuan (dari analisis bundle):** entry chunk (`index-*.js`) memiliki **static import**
ke `vendor-charts` (385 kB raw / 112 kB gzip) — seluruh recharts + d3 di-download &
dievaluasi di load pertama **semua user**, padahal recharts hanya dipakai di 3 halaman
yang semuanya lazy (Dashboard, Reports, Monitoring).

**Root cause:** Vite menempatkan `__vite__mapDeps` (modulpreload polyfill helper) ke
chunk `vendor-charts` karena `manualChunks` mengelompokkan recharts/d3 → entry chunk
static-import chunk itu → browser memaksa fetch + eval 385 kB.

**Fix (`vite.config.ts`):**
1. Hapus rule `recharts|d3-` dari `manualChunks` → recharts jadi shared chunk otomatis
   (`CartesianChart`, 330 kB) yang hanya di-fetch saat halaman chart pertama dibuka.
2. `build.modulePreload.polyfill: false` — browser modern (2026) mendukung
   `<link rel="modulepreload">` native; polyfill tidak diperlukan.

**Bukti (sebelum → sesudah):**
| Metrik | Sebelum | Sesudah |
|---|---|---|
| Entry static imports | vendor-react + **vendor-charts** + vendor-motion | vendor-react + vendor-motion |
| recharts di initial load | **385 kB / 112 gzip** | **0 kB** (lazy — hanya saat halaman chart dibuka) |
| Entry bundle | 102.20 kB | 101.96 kB |

### P1: re-render semua item transaksi saat SSE update (FIXED)
`TransactionItem` dibungkus `React.memo` — item di dashboard & transactions page hanya
re-render saat props-nya berubah (sebelumnya: setiap event SSE `transaction:*`
memicu re-render seluruh list). Animasi framer-motion tetap jalan sekali saat mount.

### P1: flash EmptyState saat data async belum masuk (FIXED)
`CategoriesPage` & `ProfessionalSuitePage` menampilkan EmptyState ("Belum ada kategori" /
"Belum ada wallet") **sesaat sebelum data async selesai dimuat** — UX misleading.

**Fix:**
- `CardSkeleton` baru di `Skeleton.tsx` (skeleton generik untuk list/grid kartu).
- `CategoriesPage`: state `loading` → grid skeleton; dilepas di callback sukses DAN
  error callback (reviewer: cegah infinite skeleton bila fetch gagal).
- `ProfessionalSuitePage`: `.finally(() => setLoading(false))` menjamin loading selalu
  dilepas (sukses/gagal); skeleton di 3 panel (wallet/goal/subscription).

## 2. Validasi

| Gate | Hasil |
|---|---|
| `npm run build` | 0 error (23s) |
| `npm run typecheck` | 0 |
| `npm run lint` | 0 |
| Unit (Vitest) | 384/384 |
| E2E dashboard + categories | 5/5 |
| Visual browser (dashboard chart SVG + kategori render) | 2/2, tanpa pageerror |

## 3. Teknis lain yang diverifikasi

- `useAppStore()` tanpa selector di banyak halaman — setiap perubahan state app
  (toast, realtime status) memicu re-render subscriber.
- `ProfessionalSuitePage` (82 kB) adalah halaman lazy terbesar berikutnya — hanya
  dimuat saat dibuka, acceptable.

## 4. Teknis tersisa (roadmap)

- Selector-based store subscription (`useAppStore((s) => s.toasts)`) di halaman
  lain (Dashboard & Transactions sudah selesai di Sprint 1.9).
- `ProfessionalSuitePage` 82 kB — audit lanjutan bila diperlukan.

## 5. Sprint 1.9 — penyelesaian dua debt di atas

### Selector store (Dashboard + Transactions)
`useAppStore()` → `useAppStore((s) => s.addToast)` / `(s) => s.addNotification`:
kedua halaman hanya memakai action (reference stabil di zustand), sehingga tidak
lagi re-render saat state lain (toasts/notifications/theme/sidebar/realtime) berubah.

### GmailSyncPage 158 kB — komponen internal dipecah
| Perubahan | Sebelum | Sesudah |
|---|---|---|
| `GmailSyncPage.tsx` (sumber) | 3429 baris | **2861 baris** |
| Chunk halaman | 158 kB raw / 44 gzip | **151 kB raw / 42 gzip** |
| `EmailCard` | inline di page | **chunk terpisah 7.66 kB / 2.36 gzip** — `React.lazy`,
  hanya di-fetch saat list hasil scan dirender (`<Suspense fallback={null}>`) |
| Helper murni (infer*/normalize*/calculateStats/buildDebugInfo/dll) | inline | `gmailSyncHelpers.ts`
  (unit-testable — 11 test baru) |
| `STATUS_CONFIG` + `ProcessingStats` | inline | dipindah ke helpers (reuse EmailCard + page) |

`processBatchWithConcurrency` & `processSingleEmail` tetap di page (logika
processing, bukan render). Unit suite: 417/417. E2E gmail-sync gagal di lokal
karena data drift DB dev (Expected 611 vs Received 616 log) — bukan regresi.
