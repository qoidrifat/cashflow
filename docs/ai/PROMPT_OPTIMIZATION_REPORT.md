# Prompt Optimization Report — Sprint 2

> **Status:** Approved · **Owner:** AI Platform · **Last updated:** 2026-08-05
> Terkait: [COST_MONITORING.md](./COST_MONITORING.md) · [ADR-004-ai-pipeline](../adr/ADR-004-ai-pipeline.md)

## 1. Executive Summary

Audit prompt berbasis data nyata `ai_usage_metrics` (5 hari, 1.159 calls, Rp 255) mengidentifikasi
**`gmail_sync` sebagai pemakai token prompt terbesar** — 81.000 prompt tokens (76% dari total,
avg 1.374 token/call, Rp 136) — diikuti `insight_generator` (latency 9s) dan `agent_search`
(1.020 calls, 0 token — Discovery Engine, bukan Gemini).

Optimasi diterapkan pada **dua prompt terbesar** (`buildExtractionPrompt` gmail_sync +
`buildReceiptExtractionPrompt` OCR) dengan **konservatif**: tidak mengubah schema output,
tidak menghapus aturan semantik, hanya merangkum instruksi berulang & daftar contoh.

**Hasil terukur (estimator `chars/4`, input test identik):**

| Prompt | BEFORE | AFTER | Hemat token | Penghematan |
|---|---|---|---|---|
| `buildExtractionPrompt` (static) | 792 | 552 | 240 | **−30.3%** |
| `buildExtractionPrompt` + email ~1.2k ch | 1.112 | 873 | 239 | −21.5% |
| `buildReceiptExtractionPrompt` | 556 | 448 | 108 | **−19.4%** |
| `buildMonthlyReportPrompt` | 1.327 | 1.327 | 0 | di luar target |
| `buildAdvisorPrompt` | 459 | 459 | 0 | di luar target |

## 2. Metodologi

1. **Data mining `ai_usage_metrics`** — script audit membaca summary token/cost/latency per fitur
   (bukti: `gmail_sync` dominan 76% prompt tokens).
2. **Identifikasi prompt builder** di `server/lib/vertexContext.js` (single source of truth).
3. **Ukur BEFORE** — unit test temp dengan input tetap, estimator `estimateTokensFromText`
   (`src/utils/aiTokenEstimator.ts`, `chars/4`). Versi asli diambil dari `git show HEAD` agar
   pembanding eksak.
4. **Optimasi** — splice script (bukan str_replace manual) mengganti 2 fungsi.
5. **Ukur AFTER** dengan input identik → selisih = hemat.
6. **Guard permanen** — unit test `promptOptimization.test.ts`:
   - semua key schema output tetap ada (parser frontend tidak rusak),
   - aturan semantik (decision values, promo-cashback rule, `multiple_amounts_found`), 
   - interpolasi dinamis (`emailDate`, `userHint`),
   - **size guard** ≤ baseline + 12% (anti-regresi bloat prompt).

## 3. Perubahan yang Dilakukan

### `buildExtractionPrompt` (gmail_sync)
- Gabungkan definisi transaksi valid jadi satu paragraf padat.
- Kompres daftar frasa promo cashback (`"cashback hingga/s/d/sampai/up to/dapatkan"`) —
  daftar lengkap tersirat oleh pola; aturan inti ("cashback promo → auto_reject + reason tetap")
  dipertahankan.
- Gabungkan 12 aturan output → 5 aturan ber-is-nomor tanpa kehilangan semantik.
- Schema JSON tetap **identik** (12 key).

### `buildReceiptExtractionPrompt` (OCR)
- Kompres daftar bukti valid/tidak valid jadi satu baris masing-masing.
- Gabungkan 12 aturan → 8 aturan; `multiple_amounts_found` & `date_inferred` dipertahankan.
- Schema JSON tetap **identik** (13 key termasuk `risk_flags`).

### Tidak diubah
- `buildMonthlyReportPrompt` & `buildAdvisorPrompt` — data-driven, bukan target utama;
  optimasi berisiko menurunkan kualitas insight. Direkomendasikan setelah evaluasi output.

## 4. Estimasi Dampak Biaya

Dengan data nyata gmail_sync (avg 1.374 token/call, Rp 136 / 5 hari) dan asumsi proporsi
static ≈ 57% dari prompt (792/1.374):

- Penghematan token/call gmail_sync ≈ **240 token (−17%)** → proyeksi **−17% biaya gmail_sync**
  (≈ Rp 23 / 5 hari pada volume saat ini; makin besar seiring volume email).
- OCR receipt: −108 token/call (−19%) untuk fitur `ocr_receipt`.

Angka pasti bergantung harga Gemini Flash saat ini; dashboard
[COST_MONITORING.md](./COST_MONITORING.md) akan menunjukkan efek setelah 1 siklus data baru.

## 5. Temuan Audit (Bukan Perbaikan Prompt)

- **`agent_search` 1.020 calls berstatus `error` (0 token)** — Discovery Engine gagal konsisten
  di env dev (kemungkinan belum dikonfigurasi). Dashboard menampilkan success-rate 0% dengan
  benar; bukan bug pencatatan.
- **`insight_generator` latency 9s** — kandidat optimasi berikutnya (prompt data-driven:
  kurangi `JSON.stringify` sampleTransactions atau batasi `.substring(0, 12000)`).

## 6. Regresi & Validasi

- `node --check server/lib/vertexContext.js` ✓
- Unit suite penuh ✓ (termasuk 7 test baru `promptOptimization`)
- Typecheck ✓ · Lint ✓ · Build ✓
- Tidak ada test yang mengunci konten prompt lama (verifikasi sebelum optimasi).

## 7. Rekomendasi Lanjutan

1. **Evaluasi kualitas pasca-deploy untuk `gmail_sync` (prioritas)** — fitur yang paling
   banyak berubah (76% token prompt). Daftar frasa promo dikompresi (contoh eksplisit seperti
   "bluSpending dibuat" / "request card berhasil" dihapus); risiko rendah karena
   `promoCashbackClassifier` frontend tetap fallback deterministik, namun false-positive rate
   promo harus **diukur**, bukan diasumsikan: sampling 100 email acak sebelum/sesudah,
   bandingkan rasio auto_reject salah positif. Kalibrasi baseline guard
   (`tests/unit/promptOptimization.test.ts`) saat prompt sah perlu diperluas.
2. **Optimasi `buildMonthlyReportPrompt`** — data-driven: ringkas `sampleTransactions`
   (agregasi per kategori, bukan daftar mentah) → estimasi hemat 30-40% token.
3. **`insight_generator` latency** — split jadi 2 call paralel (ringkas + detil) atau batasi
   window data.
4. **Konfigurasi Discovery Engine di env dev** — menghilangkan 1.020 error calls & membuka
   fungsionalitas AI Search sesungguhnya.
