# ANALISIS FITUR CASHFLOW

**Versi:** 1.0.0  
**Tanggal:** Juni 2026  
**Tipe:** Analisis Produk & Rekomendasi Fitur  
**Audiens:** Product Manager, Developer, Stakeholder

---

## Executive Summary

CashFlow adalah aplikasi manajemen keuangan pribadi berbasis web dengan fokus pada pencatatan transaksi otomatis via Gmail Sync + AI (Gemini). Aplikasi ini sudah memiliki fondasi teknis yang solid: React + TypeScript + Vite + Zustand + Firebase/Firestore + Tailwind CSS + Framer Motion.

**Update implementasi Phase 2 (19 Juni 2026):** Quick Add Transaction, Recurring Transaction, Duplicate Detection, dan Smart Search & Filter sudah dijalankan. Catatan lama yang menyebut Quick Add/Recurring belum ada perlu dibaca sebagai kondisi sebelum Phase 2 dieksekusi.

**Kondisi saat ini:** MVP fungsional dengan 7 fitur utama berjalan. Area terkuat ada pada Gmail Sync pipeline (prefilter â†’ AI â†’ fallback â†’ review â†’ save). Area terlemah ada pada auth security (client-side JWT tanpa backend verification), recurring transaction (belum ada), dan smart financial features (belum ada).

**Rekomendasi utama:** Fokus pada 3 hal: (1) Perbaiki security auth dengan backend verification, (2) Tambahkan Quick Add + Recurring Transaction untuk daily use, (3) AI Monthly Report untuk memberikan value proposisi unik.

---

## 1. Kondisi Sistem Saat Ini

### 1.1 Arsitektur Teknis

| Layer | Stack | Status |
|-------|-------|--------|
| Frontend | React 18 + TypeScript + Vite | âœ… Stabil |
| State Management | Zustand 5 | âœ… Stabil |
| Routing | React Router 7 | âœ… Stabil |
| Styling | Tailwind CSS 3 + CSS Variables | âœ… Stabil |
| Animasi | Framer Motion 12 | âœ… Stabil |
| Chart | Recharts 3 | âœ… Stabil |
| Auth | Google Identity Services (client-side JWT) | âš ï¸ Perlu Perbaikan |
| Database | Firebase Firestore + LocalStorage fallback | âœ… Stabil |
| AI | Gemini via Server Proxy | âš ï¸ Parsial |
| Form | react-hook-form + zod (terinstall, belum dipakai) | ðŸ”´ Tidak Terpakai |

### 1.2 Struktur Folder

```
src/
â”œâ”€â”€ app/           # App.tsx + Router
â”œâ”€â”€ components/    # Layout (Header, Sidebar, BottomNav) + UI atoms + Notifications
â”œâ”€â”€ config/        # Firebase, env, constants
â”œâ”€â”€ features/      # Pages (auth, budgets, categories, dashboard, gmail, dll)
â”œâ”€â”€ lib/           # Utils, theme, gemini helpers, parsers
â”œâ”€â”€ pages/         # 404
â”œâ”€â”€ services/      # Firebase CRUD (transaction, budget, category, auth, reset)
â”œâ”€â”€ store/         # Zustand (useAppStore, useAuthStore)
â”œâ”€â”€ styles/        # globals.css
â””â”€â”€ types/         # TypeScript interfaces
```

**Kelebihan:** Struktur feature-based yang bersih, pemisahan service/store/components jelas, CSS variables untuk theming.

**Kekurangan:** Beberapa file lib (geminiErrors, geminiParser, gmailClassifier, dll) tidak ada di reading tree â€” mungkin hilang atau belum di-commit.

### 1.3 Fitur yang Sudah Berjalan

| Fitur | Maturity | Notes |
|-------|----------|-------|
| Dashboard | âœ… 8/10 | Stat cards, chart, recent tx, quick actions, skeletons, empty state |
| Transactions | âœ… 8/10 | CRUD, search, filter, sort, detail modal, Gmail source badge |
| Transaction Form | âœ… 7/10 | Category selector, payment method, notes, sticky submit mobile |
| Budget | âš ï¸ 6/10 | CRUD, progress bar, status color, notification trigger, tapi tidak ada smart suggestion |
| Reports | âš ï¸ 6/10 | Period filter, bar/pie chart, AI insight text, tapi tidak ada PDF/export |
| Gmail Sync | âœ… 8/10 | OAuth, prefilter, AI extraction, fallback, retry, debug panel, config error stop |
| Categories | âœ… 7/10 | Default + custom, color/icon selector, type toggle |
| Profile | âš ï¸ 5/10 | Theme, currency, Gmail toggle, export CSV, delete data, logout |
| Settings | âš ï¸ 5/10 | Theme, currency, Gmail automation, export, notifikasi browser |
| Notifications | âœ… 7/10 | Bell icon + badge, dropdown, mark read, dedup, triggers untuk Gmail/budget/transaction |
| Mobile Layout | âœ… 7/10 | Bottom nav, responsive padding/grid, tabular-nums, safe area |
| Auth | ðŸ”´ 4/10 | Google Identity Services OK, tapi tidak ada real backend verification |

---

## 2. Temuan Utama

### 2.1 Masalah Kritis (Harus Segera Diperbaiki)

#### ðŸ”´ Auth Security â€” Tidak Ada Backend Verification

**Masalah:** Login menggunakan Google Identity Services langsung dari client. ID Token JWT di-parse manual di frontend (`parseGoogleIdToken`), lalu disimpan di localStorage. Tidak ada verifikasi token di backend.

```ts
// src/services/authService.ts
function parseGoogleIdToken(idToken: string): GoogleJwtPayload {
  const [, payload] = idToken.split('.');
  // ... decode base64 + JSON.parse langsung
}
```

**Risiko:** 
- Siapa pun bisa membuat fake JWT dan mendapatkan akses ke Firestore
- Data user tidak benar-benar aman
- Firebase Security Rules memang membatasi akses berdasarkan `request.auth.uid`, tapi token Google tidak diverifikasi oleh Firebase Auth â€” jadi `request.auth` mungkin null

**Solusi:** 
- Gunakan Firebase Auth (`signInWithPopup` dengan Google provider) â€” ini memberikan token yang diverifikasi Firebase
- Atau deploy server proxy yang memverifikasi Google ID token sebelum memberi akses
- Setelah migrasi, hapus `parseGoogleIdToken` dan session localStorage custom

**Prioritas:** **P0 â€” Critical**

#### ðŸ”´ Server Proxy Belum Ada

**Masalah:** Gemini API dipanggil melalui server proxy (`/api/gemini/extract-transaction`), tapi file `server/index.js` tidak ada di repository. Vite proxy di `vite.config.ts` mengarah ke `http://127.0.0.1:5181` yang belum ada.

```ts
// geminiService.ts â€” endpoint yang dipanggil
const endpoint = `${baseUrl}/api/gemini/extract-transaction`;
// baseUrl = '' (empty string)
```

**Dampak:** Gmail Sync tidak bisa menggunakan AI extraction. Simulasi extraction (`simulateExtraction`) sangat sederhana dan tidak akurat.

**Solusi:** Buat Express server di `server/index.js` dengan:
- POST `/api/gemini/extract-transaction` â€” panggil Gemini API
- GET `/api/gemini/health` â€” health check
- Environment variable `GEMINI_API_KEY`

**Prioritas:** **P0 â€” Critical**

#### ðŸ”´ Tidak Ada Firestore Indexes

**Masalah:** Query seperti `orderBy('date', 'desc'), limit(50)` dan `where('month', '==', month), where('year', '==', year)` membutuhkan composite index di Firestore. Tanpa index, query akan gagal di production dengan data banyak.

**Dampak:** Aplikasi crash saat data mencapai ribuan transaksi.

**Solusi:** Export indexes dari Firebase Console atau buat `firestore.indexes.json`.

**Prioritas:** **P1 â€” High**

### 2.2 Masalah Signifikan

#### âš ï¸ Tidak Ada Recurring Transaction

Fitur paling dasar untuk aplikasi finance. User harus manual mencatat:
- Gaji bulanan (setiap bulan sama)
- Subscription (Netflix, Spotify, VPN)
- Kos/kontrakan
- Cicilan

**Dampak:** User cepat bosan karena harus input data berulang.

#### âš ï¸ Quick Add Transaction Belum Ada

Proses tambah transaksi saat ini: klik Tambah â†’ pilih tipe â†’ isi nominal â†’ pilih kategori â†’ isi merchant â†’ pilih payment â†’ isi note â†’ submit. Total 7 langkah, minimal 30 detik.

Idealnya: floating action button â†’ input nominal â†’ pilih income/expense â†’ pilih kategori recent â†’ submit. Total 3 langkah, 5-10 detik.

#### âš ï¸ react-hook-form + zod Tidak Terpakai

Kedua library ini ada di `package.json` tapi tidak digunakan di kode manapun. Form validation masih manual.

#### âš ï¸ Tidak Ada Unit Test

Zero test files. Tidak ada vitest, jest, atau testing library.

#### âš ï¸ Not Found Pages / lib Files

Beberapa file diimpor tapi tidak ditemukan di reading tree:
- `src/lib/geminiErrors.ts`
- `src/lib/geminiParser.ts`
- `src/lib/geminiFallbackParser.ts`
- `src/lib/gmailClassifier.ts`
- `src/lib/geminiPromptBuilder.ts` (referenced in constants)
- `src/services/gmailSyncLogService.ts`
- `src/config/categoryIcons.ts`

Kemungkinan file-file ini belum di-commit atau hilang.

#### âš ï¸ Error Boundary Belum Ada

Tidak ada React Error Boundary. Jika komponen crash, seluruh aplikasi akan blank.

### 2.3 Area yang Sudan Stabil

- âœ… Dashboard layout dan data fetching
- âœ… Transaction CRUD dengan Firestore + LocalStorage fallback
- âœ… Gmail Sync pipeline (classify â†’ prefilter â†’ AI extract â†’ fallback â†’ save)
- âœ… Batch processing dengan concurrency limit + exponential backoff
- âœ… Notification system dengan dedup
- âœ… Category management
- âœ… Theme system (light/dark/system)
- âœ… Toast notification system
- âœ… Responsive mobile layout (bottom nav, padding, grid)
- âœ… Skeleton loading untuk semua major views

---

## 3. Fitur yang Perlu Di-improve

### 3.1 Priority Matrix

| Fitur | User Impact | Tech Complexity | Business Value | Urgency | Risk | Priority |
|-------|:-----------:|:--------------:|:--------------:|:------:|:----:|:--------:|
| Auth Security (Backend Verification) | 5 | 3 | 5 | 5 | 5 | **P0** |
| Server AI Proxy | 5 | 2 | 5 | 5 | 4 | **P0** |
| Quick Add Transaction | 5 | 1 | 5 | 4 | 1 | **P1** |
| Recurring Transaction | 5 | 3 | 5 | 4 | 1 | **P1** |
| Firestore Indexes | 4 | 1 | 4 | 4 | 3 | **P1** |
| AI Monthly Report | 5 | 3 | 5 | 3 | 2 | **P1** |
| Export PDF | 4 | 2 | 4 | 3 | 1 | **P2** |
| Smart Budget Recommendation | 4 | 3 | 4 | 3 | 2 | **P2** |
| Error Boundary | 4 | 1 | 4 | 4 | 1 | **P1** |
| Duplicate Detection | 4 | 2 | 4 | 3 | 2 | **P2** |
| Multi-Wallet | 4 | 4 | 4 | 2 | 2 | **P3** |
| OCR Receipt | 3 | 5 | 3 | 1 | 3 | **P3** |
| AI Financial Assistant | 4 | 5 | 4 | 1 | 3 | **P3** |

### 3.2 Fitur Detail

#### P0: Auth Security Fix

**Deskripsi:** Migrasi dari Google Identity Services client-side JWT ke Firebase Auth resmi. Firebase Auth memberikan token yang diverifikasi, support refresh token, dan integrasi langsung dengan Firestore Security Rules.

**Langkah:**
1. Install `firebase/auth`
2. Implementasi `signInWithPopup` dengan Google Auth Provider
3. Dapatkan `User.getIdToken()` untuk backend verification
4. Hapus `parseGoogleIdToken` dan session localStorage custom
5. Update `useAuthStore` untuk menggunakan Firebase Auth state listener (`onAuthStateChanged`)
6. Update Firestore Security Rules untuk menggunakan `request.auth.uid`

**File yang diubah:** `src/services/authService.ts`, `src/store/useAuthStore.ts`, `src/features/auth/LoginPage.tsx`, `firestore.rules`

**Estimasi:** 2-3 hari

#### P1: Quick Add Transaction

**Deskripsi:** Floating action button yang memungkinkan user mencatat transaksi dalam 5-10 detik.

**Flow:**
1. FAB di pojok kanan bawah (mobile) atau di atas list (desktop)
2. Klik â†’ muncul bottom sheet minimalis
3. Input nominal (auto numeric keyboard)
4. Pilih income/expense (toggle)
5. Pilih kategori (recent categories muncul pertama)
6. Auto-fill tanggal hari ini
7. Submit

**Komponen baru:** `QuickAddSheet.tsx` di `src/features/transactions/`

**Estimasi:** 1-2 hari

#### P1: Recurring Transaction

**Deskripsi:** Transaksi otomatis yang dibuat berdasarkan jadwal (harian, mingguan, bulanan).

**Data Model Tambahan:**
```ts
interface RecurringTransaction {
  id: string;
  userId: string;
  type: TransactionType;
  amount: number;
  categoryId: string;
  categoryName: string;
  merchant: string;
  paymentMethod: PaymentMethod;
  note: string;
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval: number; // every N days/weeks/months
  nextDate: string;
  endDate?: string;
  isActive: boolean;
  createdAt: Date;
}
```

**Service baru:** `src/services/recurringService.ts`  
**Halaman baru:** Tab di `TransactionsPage` atau halaman terpisah

**Estimasi:** 3-4 hari

#### P1: AI Monthly Financial Report

**Deskripsi:** Laporan bulanan otomatis yang mudah dipahami, mirip laporan kartu kredit.

**Konten:**
- Ringkasan pemasukan vs pengeluaran
- Kategori paling boros
- Perubahan vs bulan lalu
- Insight pengeluaran (AI-generated)
- Rekomendasi budget bulan depan
- Download PDF

**Fitur:** Generate otomatis setiap tanggal 1, push notification.

**Estimasi:** 4-5 hari

---

## 4. Ranking Prioritas Fitur

### Top 10 Fitur Paling Direkomendasikan

| Rank | Fitur | Impact | Effort | Alasan |
|:----:|-------|:------:|:------:|--------|
| 1 | **Auth Security Fix** ðŸ”´ | Critical | 3 hari | Security risk, blocking production |
| 2 | **Server AI Proxy** ðŸ”´ | Critical | 2 hari | Gmail Sync tidak berfungsi tanpa ini |
| 3 | **Quick Add Transaction** | High | 1 hari | Meningkatkan frekuensi pencatatan 3x |
| 4 | **Error Boundary** | High | 0.5 hari | Mencegah blank screen crash |
| 5 | **Firestore Indexes** | High | 0.5 hari | Mencegah query error di production |
| 6 | **Recurring Transaction** | High | 3 hari | Fitur wajib untuk daily use |
| 7 | **AI Monthly Report** | High | 4 hari | Value prop utama CashFlow |
| 8 | **Duplicate Detection** | Medium | 2 hari | Mencegah transaksi ganda dari Gmail |
| 9 | **Smart Budget** | Medium | 3 hari | Membantu user mengelola budget |
| 10 | **Export PDF** | Medium | 2 hari | Fitur yang sering diminta user |

---

## 5. Roadmap Implementasi

### Phase 1 â€” Security & Stability (Minggu 1)

| Task | Owner | Duration | Priority |
|------|-------|:--------:|:--------:|
| âœ… Auth Security: Firebase Auth migration | Dev | 3 hari | P0 |
| âœ… Server AI Proxy: Express server dengan Gemini | Dev | 2 hari | P0 |
| âœ… Error Boundary component | Dev | 0.5 hari | P1 |
| âœ… Firestore Indexes | Dev | 0.5 hari | P1 |
| âœ… Fix missing lib files (geminiErrors, parsers, dll) | Dev | 1 hari | P1 |

**Acceptance Criteria:**
- Login menggunakan Firebase Auth, bukan client-side JWT
- Server proxy berjalan di port 5181
- Gemini API extraction berfungsi end-to-end
- Error Boundary menangkap error komponen tanpa blank screen
- Query Firestore berjalan tanpa error index

### Phase 2 â€” Daily Usefulness (Minggu 2)

| Task | Owner | Duration | Priority |
|------|-------|:--------:|:--------:|
| âœ… Quick Add Transaction | Dev | 1 hari | P1 |
| âœ… Recurring Transaction | Dev | 3 hari | P1 |
| âœ… Duplicate Detection (Gmail + manual) | Dev | 2 hari | P2 |
| âœ… Smart Search & Filter (advance) | Dev | 1 hari | P2 |

**Acceptance Criteria:**
- âœ… FAB untuk quick add bekerja di mobile dan desktop melalui `AppLayout`
- âœ… Recurring transaction otomatis diproses saat aplikasi dibuka dan bisa diproses manual
- âœ… Duplicate detection mencegah transaksi ganda dari Gmail, manual, Quick Add, dan recurring
- âœ… Search bisa filter by date range, category, payment method, source, amount range, dan sort merchant

**Status Implementasi 19 Juni 2026:**
- `QuickAddSheet` sudah aktif sebagai floating action button global.
- `RecurringPage` tersedia di route `/recurring`, sidebar, dan bottom navigation.
- `recurringService` sudah mendukung localStorage fallback dan Firestore.
- `transactionService` memiliki duplicate guard terpusat via `findDuplicateTransaction`.
- `firestore.rules` sudah mengizinkan collection `recurring` dengan validasi minimum.
- `firestore.indexes.json` ditambah index untuk duplicate lookup dan recurring.

### Phase 3 â€” AI Intelligence (Minggu 3)

| Task | Owner | Duration | Priority |
|------|-------|:--------:|:--------:|
| AI Monthly Financial Report | Dev/Data | 4 hari | P1 |
| Smart Budget Recommendation | Dev/Data | 3 hari | P2 |
| Spending Forecast | Dev/Data | 2 hari | P2 |

**Acceptance Criteria:**
- [x] Laporan bulanan dengan insight AI
- [x] Budget suggestion berdasarkan history 3 bulan
- [x] Forecast spending sampai akhir bulan

**Status Implementasi Phase 3: selesai.**

**Catatan implementasi:**
- `ReportsPage` menggunakan seluruh histori transaksi untuk laporan, bukan hanya 50 transaksi terakhir.
- AI Monthly Report memanggil endpoint server `/api/gemini/monthly-report` dan otomatis fallback ke rule-based insight jika Gemini/server tidak tersedia.
- Spending Forecast menghitung proyeksi pengeluaran sampai akhir bulan berdasarkan rata-rata harian bulan berjalan dan tren vs bulan sebelumnya.
- `BudgetsPage` menampilkan Smart Budget Recommendation dari histori 3 bulan sebelumnya, lengkap dengan confidence, nominal rata-rata, budget saat ini, nominal saran, serta aksi buat/terapkan budget.
- Logika AI intelligence dipusatkan di `src/services/aiInsightService.ts` agar reusable dan tidak tersebar di komponen UI.

### Phase 4 â€” Professional Suite (Minggu 4+)

| Task | Owner | Duration | Priority |
|------|-------|:--------:|:--------:|
| Multi-Wallet/Account | Dev | 4 hari | P3 |
| Export PDF | Dev | 2 hari | P2 |
| Goal/Saving Target | Dev | 3 hari | P3 |
| Cashflow Health Score | Dev/Data | 3 hari | P3 |
| Subscription Tracker | Dev | 2 hari | P2 |

**Acceptance Criteria:**
- [x] Multi-wallet/account tersedia untuk mencatat saldo per akun.
- [x] Export PDF tersedia dari halaman Reports dan Professional Suite.
- [x] Goal/Saving Target tersedia dengan progress dan status.
- [x] Cashflow Health Score menghitung skor dari saving rate, expense ratio, budget discipline, subscription load, dan progress target.
- [x] Subscription Tracker tersedia dengan input manual dan deteksi rule-based dari transaksi berulang.

**Status Implementasi Phase 4: selesai.**

**Catatan implementasi:**
- Halaman baru `/professional` menyatukan Professional Suite dalam UI modern minimalis: health score, next actions, wallet, goal, subscription, dan detected subscriptions.
- Data wallet, saving goal, dan subscription disimpan lokal per user melalui `src/services/professionalSuiteService.ts`, sehingga tidak membutuhkan migrasi Firestore besar pada tahap ini.
- Deteksi subscription memakai pattern matching merchant + nominal + interval transaksi, sesuai prinsip dokumen bahwa subscription tracking lebih cocok rule-based daripada AI.
- Export PDF memakai `src/services/pdfExportService.ts` dengan HTML print report agar ringan, cepat, dan tidak menambah bundle dependency besar.
- Navigasi desktop dan mobile sudah ditambahkan ke Professional Suite.

---

## 6. Technical Improvement

### 6.1 Yang Perlu Segera Diperbaiki

| Improvement | Masalah | Dampak | Prioritas |
|-------------|---------|--------|:---------:|
| Error Boundary | Crash menyebabkan blank screen | User experience buruk | P1 |
| `tsconfig.json` strict mode | `noUnusedLocals: false` menyembunyikan dead code | Code quality | P2 |
| Env vars validation | Tidak ada build-time check | Runtime error | P1 |
| `react-hook-form` + `zod` tidak terpakai | Bundle size 12KB+ tidak berguna | Performance | P2 |
| Tidak ada logging strategy | Error sulit di-debug | Maintenance | P2 |

### 6.2 Yang Perlu Ditambahkan

| Improvement | Manfaat | Prioritas |
|-------------|---------|:---------:|
| Zod schema untuk setiap form data | Type safety runtime + validation | P2 |
| Firestore indexes file (firestore.indexes.json) | Performance di scale | P1 |
| Vite PWA plugin (workbox) | Offline mode + installable | P3 |
| Bundle analyzer di CI | Mencegah bundle terlalu besar | P3 |
| Sentry/Rollbar error tracking | Monitoring error di production | P2 |

---

## 7. AI Improvement

### 7.1 Status Saat Ini

| Komponen | Status | Notes |
|----------|--------|-------|
| Gemini extraction via proxy | Selesai | `server/index.js` menyediakan `/api/gemini/extract-transaction` dan health check |
| Fallback regex parser | Selesai | Jalur lama `extractTransactionWithAI` memakai `geminiFallbackParser`, bukan `simulateExtraction` |
| Frontend JSON parser | Selesai | `safeParseGeminiJson` tetap menjadi parser repair di frontend |
| Error classification | Selesai | `classifyRawGeminiError`, `getGeminiErrorInfo` |
| Exponential backoff retry | Selesai | `retryWithBackoff` untuk rate limit/network/model unavailable |
| AI Insight di Reports | Selesai | Monthly report via `/api/gemini/monthly-report` dengan fallback rule-based |

### 7.2 Rekomendasi AI

| Fitur AI | Pakai Gemini? | Fallback? | Notes |
|----------|:------------:|:---------:|-------|
| Email transaction extraction | Ya | Rule-based regex | Via server proxy |
| Monthly report insight | Ya | Rule-based template | Generate via proxy |
| Budget recommendation | Opsional | Simple average | Saat ini deterministic average berdasarkan history 3 bulan |
| Merchant auto-categorization | Opsional | Lookup table | Lebih baik rule-based |
| Duplicate detection | Tidak | Rule-based | Cukup match amount + merchant + date |
| Subscription detection | Tidak | Pattern matching | Sudah ada di Professional Suite |
| Spending anomaly | Future | Statistical outlier | Belum dijadikan fitur tersendiri |
| Financial chatbot | Future | N/A | Phase berikutnya |

**Prinsip:**
- Gunakan AI hanya untuk tugas yang benar-benar butuh NLP/pemahaman konteks
- Extraction, insight, dan anomaly lebih cocok AI
- Duplicate detection, subscription tracking, merchant categorization lebih cocok rule-based
- Selalu sediakan fallback jika AI gagal

---

## 8. Security & Privacy Audit

### 8.1 Temuan & Risiko

| Area | Temuan | Severity | Solusi | Prioritas |
|------|--------|:--------:|--------|:---------:|
| Auth | Firebase Auth resmi digunakan untuk login Google | Low | Tetap gunakan Firebase Auth token | - |
| Gmail OAuth | Scope hanya `gmail.readonly` | Low | Tetap minimal scope | - |
| API Key | `VITE_GOOGLE_API_KEY` tidak lagi dibaca dan dihapus dari env frontend | Low | Gmail memakai OAuth bearer token | - |
| Gemini API Key | Dipindah ke server env `GEMINI_API_KEY` | Low | Jangan gunakan prefix `VITE_` | - |
| Firestore Rules | Validasi write cukup ketat | Low | Maintain rules + indexes | - |
| Email Body | Tidak disimpan ke database | Low | Tetap hanya simpan hasil ekstraksi yang disetujui | - |
| Logging | Console detail diganti `logger` development-only | Low | Integrasi Sentry/Rollbar untuk production future | P2 |
| Session | Token Gmail tidak lagi disimpan di `sessionStorage` | Low | Untuk production penuh, backend httpOnly cookie tetap opsi lanjutan | P2 |
| User Data Isolation | Firestore rules `ownsUserDoc` | Low | Maintain per-user path | - |
| Delete Flow | `resetUserData` menghapus semua subcollection | Low | Backend function tetap direkomendasikan untuk reset besar | P2 |

### 8.2 Firestore Security Rules â€” Review

```js
// firestore.rules - Saat ini âœ…
function ownsUserDoc(userId) {
  return signedIn() && request.auth.uid == userId;
}
```

**RULES AMAN** â€” Setiap user hanya bisa read/write data miliknya sendiri. Validasi type, amount, status sudah ada untuk transactions, categories, budgets, dan gmailSyncLogs.

âš ï¸ **TAPI** â€” Jika tidak menggunakan Firebase Auth, `request.auth` akan null, dan semua aturan akan reject. Ini alasan utama migrasi ke Firebase Auth adalah **P0**.

### 8.3 Data Privacy

- âœ… Hanya email transaksi yang diproses (bukan semua email)
- âœ… Email body tidak disimpan ke database
- âœ… Hanya data transaksi hasil ekstraksi yang disimpan (setelah user setujui)
- âœ… User bisa menghapus semua data kapan saja
- âœ… User bisa mencabut akses Gmail kapan saja

---

## 9. UI/UX Enhancement

### 9.1 Yang Sudan Baik

| Aspek | Rating | Notes |
|-------|:-----:|-------|
| Visual design | 8/10 | Modern, clean, glassmorphism, gradient |
| Typography | 7/10 | Manrope + Outfit font pairing |
| Dark mode | 8/10 | CSS variables, smooth transition |
| Animasi | 8/10 | Framer Motion, spring transitions |
| Loading states | 7/10 | Skeleton untuk major views |
| Empty states | 7/10 | Icon + title + description + action |
| Responsive mobile | 7/10 | Bottom nav, responsive padding/grid |

### 9.2 Yang Perlu Ditingkatkan

| Aspek | Gap | Rekomendasi |
|-------|-----|-------------|
| Onboarding | Selesai | Walkthrough 3 langkah untuk user baru sudah ditambahkan |
| Empty states | Selesai | Empty state memakai icon surface + glow halus yang theme-safe |
| Typography scale | Belum konsisten | Buat design token untuk font sizes |
| Spacing scale | Ada variasi (p-4, p-5, p-6) | Standarisasi ke spacing scale Tailwind |
| Chart readability | Pie chart legend overload di mobile | Pindahkan legend ke list di bawah chart |
| Toast position | Selesai | Mobile bottom-center, desktop top-right |
| Touch target | Selesai | `.app-icon-button` minimal 44px pada coarse pointer |
| Form validation | Sebagian selesai | Zod diterapkan di form Professional Suite; form lama bisa dimigrasi bertahap |

---

## 10. Acceptance Criteria

File `ANALISIS_FITUR_CASHFLOW.md` dianggap selesai jika:

- [x] âœ… Berisi analisis kondisi sistem saat ini (arsitektur, struktur folder, maturity fitur)
- [x] âœ… Berisi temuan utama (kritis + signifikan + stabil)
- [x] âœ… Berisi rekomendasi fitur yang perlu di-improve dengan priority matrix
- [x] âœ… Berisi ranking prioritas Top 10 fitur
- [x] âœ… Berisi roadmap implementasi 4 fase
- [x] âœ… Berisi rekomendasi teknis (improvement + additions)
- [x] âœ… Berisi analisis AI (status + rekomendasi)
- [x] âœ… Berisi security & privacy audit (10 temuan)
- [x] âœ… Berisi UI/UX enhancement
- [x] âœ… Berisi next action plan yang jelas

---

## 11. Next Action Plan

### Immediate (Hari Ini)

| No | Action | PIC |
|:--:|--------|:---:|
| 1 | **Migrasi auth ke Firebase Auth** â€” Hapus `parseGoogleIdToken`, install `firebase/auth`, implement `signInWithPopup` | Developer |
| 2 | **Buat server proxy** â€” `server/index.js` dengan endpoint `/api/gemini/extract-transaction` + health check | Developer |
| 3 | **Commit file lib yang hilang** â€” Pastikan `geminiErrors.ts`, `geminiParser.ts`, `geminiFallbackParser.ts`, `gmailClassifier.ts` ada di repo | Developer |
| 4 | **Buat Error Boundary** â€” `src/components/ErrorBoundary.tsx` | Developer |

### Minggu Ini

| No | Action | PIC |
|:--:|--------|:---:|
| 5 | Implementasi Quick Add Transaction | Developer |
| 6 | Buat Firestore indexes (`firestore.indexes.json`) | Developer |
| 7 | Aktifkan `noUnusedLocals: true` di tsconfig dan bersihkan dead code | Developer |
| 8 | Validasi env vars di build time (vite plugin) | Developer |

### Minggu Depan

| No | Action | PIC |
|:--:|--------|:---:|
| 9 | Implementasi Recurring Transaction | Developer |
| 10 | AI Monthly Financial Report | Developer |
| 11 | Duplicate Detection untuk Gmail + manual | Developer |

### Bulan Depan

| No | Action | PIC |
|:--:|--------|:---:|
| 12 | Smart Budget Recommendation | Developer/Data |
| 13 | Multi-Wallet/Account | Developer |
| 14 | Export PDF | Developer |
| 15 | Unit Test setup (vitest) untuk service layer | Developer/QA |

---

*Dokumen ini dibuat berdasarkan analisis kode sumber CashFlow versi 1.0.0.  
Untuk pertanyaan atau klarifikasi, hubungi tim pengembang.*
