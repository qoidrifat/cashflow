# Design Tokens & Kebijakan Kontras (P2.1)

> Dibuat: 2026-08-09 (P2.1). Kebijakan kontras + token semantic CashFlow.

## 1. Kebijakan Kontras (WCAG 2.1 AA)

- Teks normal: **≥ 4.5:1** · teks besar (≥18px/14px-bold): **≥ 3:1** · komponen
  non-teks (ikon, border interaktif, focus ring): **≥ 3:1**.
- Berlaku untuk **light DAN dark mode** (keduanya di-scan axe di
  `e2e/accessibility.spec.ts` — **9 halaman × 2 tema** (dashboard,
  transactions, ai-hub, ai-timeline, admin-monitoring, ai-search, reports,
  gmail-sync, privacy) + 4 test targeted = 22 test, gate 0 serious/critical).
- Gate: `npm run test:a11y`. Jangan menurunkan ambang atau me-mask violation.

## 2. Token Semantic (tailwind.config.js + src/styles/globals.css)

Palet berbasis CSS variable (`app.*`) + skala Tailwind (`primary`, `mint`,
`navy`, `soft.*`). Aturan pemakaian:

| Role | Token | Aturan |
|------|-------|--------|
| Teks utama | `text-app-text` | kontras ≥ 7:1 di `bg-app-bg` |
| Teks sekunder | `text-app-muted` | ≥ 4.5:1 |
| Teks tersier (label/kecil) | `text-app-subtle` | **≥ 4.5:1** — jangan `text-*-400`/`slate-400` untuk teks 10–12px |
| Teks on-tint | `text-primary-600 dark:text-primary-300` (bukan 500 di atas bg 50) | ≥ 4.5:1 |
| Badge 10px | `text-primary-600 dark:text-primary-300` di `bg-primary-50 dark:bg-primary-500/12` | terukur 5.6:1 light |
| Disabled | `disabled:opacity-50` | dikecualikan axe (permanen, bukan teks informatif) |

## 3. Opacity Scale Tailwind (fix akar P2.1)

Tailwind JIT HANYA meng-generate opacity yang ada di skala default
(0,5,10,20,25,30,…). Nilai di luar skala — `/8 /12 /15 /24 /28` — **senyap
tidak di-generate**: `dark:bg-primary-500/12` tidak pernah muncul di CSS →
pill/badge dark memakai bg LIGHT (kontras 1.78:1). Fix: daftarkan di
`tailwind.config.js` `theme.extend.opacity` (satu tempat, ~120 pemakaian).

**Aturan: JANGAN pakai opacity di luar skala ini tanpa menambahkannya ke
config — test a11y akan menggagalkan dark mode.**

## 4. States yang Wajib Diperiksa

`default · hover · active · focus (ring ≥3:1) · disabled · selected ·
error/warning/success` — kombinasi teks-on-bg, teks-on-card, teks-on-tint,
badge, chart label/legend, placeholder input, link, focus ring.
Verifikasi: scan axe light+dark (`npm run test:a11y`).

## 5. Regresi

Perubahan warna → jalankan `npm run test:a11y` DAN `npm run test:e2e:visual:check`.
Bila baseline berubah: inspeksi diff (intended?), update snapshot, dokumentasikan
alasan (contoh P2.1: `transactions-dark-desktop.png` — tint dark kini render).

### 5.1 Kebijakan snapshot visual — sumber DB (P3.x, 2026-08-17)

**Baseline snapshot WAJIB di-generate dari isolated deterministic E2E DB, BUKAN
shared dev DB.** Root cause drift (6 snapshot dashboard/transactions gagal): dev
DB seed admin memperoleh 1 account + 1 anchor + 430 tx dari run E2E P3.x,
sedangkan baseline lama merepresentasikan 391 tx / 0 account → diff full-page
padahal bukan UI regression.

Aturan:

- Snapshot source = DB fresh per run dengan seed CI-equivalent deterministik
  (`scripts/seedE2eDataset.mjs`, mulberry32 — 284 tx / 519 gmail logs / 0
  accounts). Dev DB (data pribadi, data hasil E2E manual, anchor manual) TIDAK
  boleh menjadi snapshot source.
- Menjalankan secara lokal: `playwright.visual-local.config.mjs` (Vite 5192 /
  API 5193, DB `.test-data/e2e-visual.db` delete-first per run):
  `npx playwright test -c playwright.visual-local.config.mjs` (check) /
  `--update-snapshots` (regenerate baseline).
- Sebelum regenerate: jalankan check terhadap DB bersih, inspeksi SETIAP diff
  (band histogram / render), klasifikasi (expected dataset change vs UI
  regression vs env failure). Hanya baseline yang terbukti data-driven yang
  boleh diperbarui.
- CI visual job sudah isolated-deterministik (Turso seed per run, serial setelah
  e2e); pastikan tetap demikian pada setiap perubahan workflow.

### 5.2 Audit kecil-teks sisa (P3.x)

Badge/status kecil (10–14px, non-large-text) WAJIB memakai -700 pada -50/-hover
bg light (4.5:1) + `dark:-300`; -500 GAGAL (mint 2.37 / amber 2.00 / red 3.51 /
blue 3.43 / violet 3.95 di light). Ter-fix: `gmailSyncHelpers.ts` STATUS_CONFIG,
`EmailCard.tsx` confidence + fallback badge, `GmailSyncEtaCard.tsx` breakdown
counts (text-sm semibold). Sisa `text-soft-*` hanya untuk icon non-text (3:1,
PASS).

## 6. P2.2 — Accessibility & UI Hardening (2026-08-09)

### 6.1 Focus-visible convention

- **Kontainer input**: `focus-within:ring-2 focus-within:ring-primary-500/40` pada
  wrapper `<label>`/div (contoh `AiSearchBox`). Jangan `outline-none` tanpa
  replacement; border-only (1px) TIDAK cukup — tambah `focus:ring-2
  focus:ring-primary-500/30` (contoh `AiConversationPage` textarea, `AiSearchPage`
  inputs, `AiFeedbackButtons` reason input).
- Tombol/elemen lain: `focus-visible:ring-2 focus-visible:ring-primary-400`
  (light) / `dark:focus-visible:ring-primary-400` — token ring = primary, bukan
  warna arbitrary.

### 6.2 Reduced motion

- Root app dibungkus `<MotionConfig reducedMotion="user">` (src/main.tsx): user
  dengan `prefers-reduced-motion: reduce` mendapat transform/layout animation
  dinonaktifkan (framer-motion built-in). Opacity fade tetap berjalan (ringan).
- Blok `@media (prefers-reduced-motion: reduce)` di globals.css menangani CSS
  transitions/animations. **Keduanya wajib ada** — blok CSS saja tidak meng-gate
  animasi framer (rAF).
- Default framer tanpa prop = `"never"` (tidak menghormati OS pref) — inilah celah
  yang ditutup P2.2.

### 6.3 Typography floor

| Konteks | Minimum | Catatan |
|---|---|---|
| Interactive / navigation | 11px (prefer 12px) | BottomNav, chips, filter, tabs |
| Table header | 11px | thead AiHubPage, FeatureDetailPage |
| Section label (uppercase) | 11px | timeline/hub/admin metric labels |
| Financial/important metadata | 11px | Calls/Gagal/Avg, Hit Rate, trust meta |
| Non-essential micro | 10px | meta operasional, timestamp |
| 9px | **Dilarang** | 3 pemakaian dinaikkan ke 10px (P2.2) |
| 10px | Hanya meta non-interaktif | 9 pemakaian interaktif dinaikkan ke 11px (guard) |

**Lint guard (otomatis):** `scripts/typography-lint.mjs`, ter-wire ke `npm run
lint` — menolak `text-[9px]` di mana pun dan `text-[10px]` pada elemen
interaktif (tag JSX button/a/Link/summary/select/th/thead/nav/input/textarea,
termasuk `motion.*`, atau className dengan affordance `hover:`/`cursor-pointer`).
Heuristik tag terdekat (bukan parser penuh); self-test: fixture injeksi 4
pelanggaran + 2 kontrol non-false-positive. Jangan turunkan floor ini tanpa
mengubah kebijakan §6.3.

Implementasi P2.2: 9px→10px ×3, nav/table/interactive/section-label 10px→11px
(~30 spot di 12 file). 10px tersisa = hanya kategori E (meta non-esensial).

**Klasifikasi kategori (P2.3):**

| Kategori | Konteks | Minimum |
|---|---|---|
| A | Primary UI (judul kartu, body teks) | 12px (`text-xs`/`text-sm` +) |
| B | Interactive / navigation / table header / section label | 11px (`text-label`) |
| C | Non-essential metadata (timestamp, meta operasional) | 10px (`text-meta`) |
| D | Decorative micro-label | 9px **hanya jika justified** — saat ini 0 pemakaian |

**Token semantic (P2.3):** `tailwind.config.js` `theme.extend.fontSize` —
`text-meta` (10px, kategori C) & `text-label` (11px, kategori B). Pemetaan
lain memakai default Tailwind: caption → `text-xs` (12px), body → `text-sm`
(14px). Aturan: **kode baru wajib memakai token ini**, bukan arbitrary
`text-[10px]`/`text-[11px]`. Pemakaian existing (168× `text-[11px]` +
92× `text-[10px]`) sengaja TIDAK dimigrasi massal — sudah ter-guard floor di
bawah, migrasi = risiko visual tanpa nilai fungsional. Guard lint diperluas:
`text-meta` pada elemen interaktif DITOLAK (analog `text-[10px]`), mencegah
token baru menjadi celah.

### 6.4 Chart accessibility (Recharts)

- Setiap chart: wrapper div `role="img"` + `aria-label` deskriptif Bahasa Indonesia
  (mis. "Grafik garis Pemasukan dan Pengeluaran, 7 hari terakhir"). 7 chart
  ditandai (dashboard, reports ×2, monitoring ×3, conversation).
- Multi-seri **wajib** punya `<Legend />` — dashboard line chart ditambahkan
  (P2.2); series name (`name=`) harus ada (dipakai legend + tooltip).
- Tooltip visual tetap ada; jangan menambah summary/network call baru.

### 6.5 Touch target

- Desktop minimum 32×32px untuk ikon-button; coarse pointer 44×44px otomatis via
  `.app-icon-button` (`@media (pointer: coarse)` di globals.css).
- AiFeedbackButtons 👍/👎: 24px → 32px (button `h-8 w-8`, icon `h-4 w-4`); submit
  & cancel ikut 32px. WCAG 2.5.8 (24px AA) tetap terpenuhi di semua pointer.

### 6.6 Heading hierarchy

- Panel sejajar di bawah h1 halaman = `h2` (bukan h3) — MonitoringPage 12 panel &
  ReportsPage 4 section diubah h3→h2. Metric label (Calls/Gagal/Avg) tetap
  `<p>` (bukan heading) — jangan buat heading artifisial hanya demi axe.
- Pola: h1 (halaman) → h2 (panel/section) → h3 (sub-section). Axe `heading-order`
  = 0 di semua halaman yang di-scan.

### 6.7 Responsive check (360/390/430/768)

- Verifikasi pasca-typography/touch-target: `node scripts/responsive-audit.mjs`
  (mint sesi otomatis; output 32 screenshot + `summary.json` di
  `docs/assets/screenshots/responsive-p22/`). Kriteria: overflow 0, chart tidak
  clipped, nav label tidak overflow, tombol 👍/👎 ≥32px dan fits.
- Bug nyata yang ditemukan & diperbaiki: ReportsPage & MonitoringPage filter row
  overflow di 360/390 (`flex-wrap` + `min-w-0`), skeleton `grid-cols-3` AI chat
  (bar 160px) overflow di ≤390 → `grid-cols-1 sm:grid-cols-3`, header
  TransactionsPage (Scan Bukti + Tambah, 217px) overflow di 360 → `flex-wrap`
  (ditemukan saat verifikasi guard typography; halaman ditambahkan ke audit).
- Hasil: 32/32 kombinasi hijau (8 halaman × 4 viewport; overflow 0 semua).
