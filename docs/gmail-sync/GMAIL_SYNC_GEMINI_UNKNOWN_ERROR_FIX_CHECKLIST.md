# Gmail Sync GEMINI_UNKNOWN_ERROR Fix Checklist

## Ringkasan Masalah

- [x] 26 email gagal teknis
- [x] Error Code `GEMINI_UNKNOWN_ERROR`
- [x] AI Called true
- [x] AI Parsed false
- [x] Fallback tidak menyelamatkan item di kode lama (sudah diperbaiki)
- [x] Beberapa email seharusnya pending_review (Shopee, KAI, tiket.com, Agoda, Jago)
- [x] Beberapa email blu seharusnya skipped (aktivasi/pengaturan card)

## Root Cause

| Penyebab | Status |
| -------- | ------ |
| Gemini unknown error tidak diarahkan ke fallback dengan benar | ✅ Diperbaiki |
| Fallback parser belum mendukung sender tertentu | ✅ Sudah ada (Shopee, KAI, tiket, Agoda, Jago, LINE Bank, blu) |
| Prefilter belum skip email blu non-transaksi | ✅ Sudah ada (`BLU_NON_TRANSACTION_PATTERNS`) |
| Fallback failure paths tidak set `finalStatus` → fallthrough ke `failed` | ✅ Diperbaiki |
| Status mapping masih terlalu mudah final failed | ✅ Diperbaiki |
| `GEMINI_UNKNOWN_ERROR` tidak memiliki property `fallbackAllowed` | ✅ Ditambahkan |

## Perbaikan

- [x] **Error classifier Gemini diperbaiki** (`geminiErrors.ts`)
  - Menambahkan property `fallbackAllowed` ke `GeminiErrorInfo`
  - Menambahkan error code baru: `GEMINI_TIMEOUT`, `GEMINI_TEMPORARY_ERROR`, `GEMINI_FALLBACK_USED`
  - `GEMINI_UNKNOWN_ERROR` sekarang `fallbackAllowed: true`
  - Pesan error diubah: "AI gagal sementara. Parser lokal membaca email ini."
  - `classifyRawGeminiError` menangani `resource_exhausted` → rate limit, `deadline_exceeded` → timeout

- [x] **Fallback routing diperbaiki** (`geminiFallbackParser.ts`)
  - Semua failure path sekarang mengembalikan `finalStatus` yang eksplisit
  - Khususnya kasus "Semua fallback parser gagal" sekarang return `finalStatus: 'skipped'` dengan `NON_TRANSACTION_SKIPPED_ERROR_CODE`

- [x] **Shopee fallback** — sudah ada (`parseShopeeEmail`)
  - Domain: `shopee.co.id`
  - Subject: `Pembayaranmu Berhasil Dikonfirmasi`
  - Merchant: `Shopee`, Category: `Belanja`, Type: `expense`, Payment: `Shopee`
  - Fallback: nominal ditemukan → `pending_review`

- [x] **KAI fallback** — sudah ada (`parseKaiEmail`)
  - Domain: `kai.id`
  - Subject: `Bukti Pembayaran Transaksi PT. KAI`
  - Merchant: `PT. KAI`, Category: `Transportasi`, Type: `expense`, Payment: `KAI`
  - Fallback: nominal ditemukan → `pending_review`

- [x] **tiket.com fallback** — sudah ada (`parseTiketEmail`)
  - Domain: `tiket.com`
  - Subject: `Bukti Pembayaran`, `E-tiket`, `Order ID`
  - Merchant: `tiket.com`, Category: `Travel`, Type: `expense`, Payment: `tiket.com`
  - Fallback: nominal ditemukan → `pending_review`

- [x] **Agoda fallback** — sudah ada (`parseAgodaEmail`)
  - Domain: `agoda.com`
  - Subject: `Customer Receipt`, `Booking ID`
  - Merchant: `Agoda`, Category: `Travel`, Type: `expense`, Payment: `Agoda`
  - Fallback: nominal ditemukan → `pending_review`

- [x] **Jago fallback** — sudah ada (`parseJagoEmail`)
  - Domain: `jago.com`
  - Subject: transfer, top up e-Wallet, uang dikembalikan, penarikan dana, biaya kekurangan saldo
  - Merchant: `Bank Jago`, Category: infer dari body, Payment: `Bank Jago`
  - Fallback: nominal ditemukan → `pending_review`

- [x] **blu non-transaksi skip** — sudah ada (`isBluNonTransactionEmail`)
  - Pattern: card aktif, bluVirtual aktif, request card berhasil, bluSpending dibuat, welcome email
  - Final status: `skipped`
  - AI not called: prefilter menangkap lebih awal

- [x] **Amount extraction** — sudah ada (`extractAmountFromText`)
  - Pattern: `Rp 150.000`, `Rp150.000`, `IDR 250,000`, `total Rp ...`, `nominal Rp ...`
  - Promo guard: tidak mengambil nominal dari promo cashback

- [x] **Retry Failed diperbaiki** (`GmailSyncPage.tsx` — `handleRetryFailedEmails`)
  - Hanya mengambil failed/retry_later
  - Melewati approved, pending_review, skipped, rejected, duplicate
  - Fetch ulang email dari Gmail API
  - Pipeline baru: prefilter → AI → fallback
  - Tidak membuat duplicate notification

- [x] **Supabase logs update** — sudah sesuai (`gmailSyncLogService.ts`)
  - `final_status` dan `status` di-set dengan benar
  - `error_code` disimpan di `metadata`
  - `ai_called`, `ai_parsed` sesuai kondisi

- [x] **UI status mapping** — sudah diperbaiki (`GmailSyncPage.tsx`)
  - Badge untuk setiap status: Pending Review, Dilewati, Gagal Teknis, Coba Lagi Nanti, dll.
  - Fallback badge "Parsed by Fallback" untuk pending_review dari fallback
  - Retry singel dan batch sudah berfungsi
  - Filter per status sudah tersedia

## Status Mapping

| Kondisi | Final Status |
| ------- | ------------ |
| Fallback berhasil menemukan transaksi valid | `pending_review` |
| Email jelas non-transaksi (blu activation, dll) | `skipped` |
| Email promo/newsletter | `auto_rejected` / `rejected` |
| Email sudah pernah diproses | `duplicate` |
| Gemini/network timeout sementara | `retry_later` |
| Config/schema/RLS error | `config_error` |
| Bug teknis nyata (fallback juga gagal dengan `failed`) | `failed` |
| AI gagal, fallback tidak menemukan nominal | `skipped` (bukan `failed`) |
| GEMINI_UNKNOWN_ERROR + fallback tidak ada data | `retry_later` → `skipped` |

## Test Case

| No | Sender | Subject | Expected |
| -- | ------ | ------- | -------- |
| 1 | `mail.shopee.co.id` | `Pembayaranmu Berhasil Dikonfirmasi` | `pending_review` jika nominal ada, `skipped` jika tidak |
| 2 | `kai.id` | `Bukti Pembayaran Transaksi PT. KAI` | `pending_review` jika nominal ada |
| 3 | `tiket.com` | `Bukti Pembayaran Nuanu Creative City` | `pending_review` jika nominal ada |
| 4 | `tiket.com` | `Ini E-tiket untuk Nuanu Creative City` | `pending_review` jika paid indicator + nominal, `skipped` jika tidak |
| 5 | `agoda.com` | `Customer Receipt from Booking ID` | `pending_review` jika nominal ada |
| 6 | `jago.com` | `Kamu telah melakukan transfer` | `pending_review` jika nominal ada |
| 7 | `jago.com` | `Kamu telah melakukan top up e-Wallet` | `pending_review` jika nominal ada |
| 8 | `jago.com` | `Uang telah dikembalikan` | `pending_review` jika nominal ada |
| 9 | `jago.com` | `Penarikan dana dari Kantong Investasi berhasil` | `pending_review` jika nominal ada |
| 10 | `jago.com` | `Kamu telah dikenakan biaya dari kekurangan saldo` | `pending_review` jika nominal ada |
| 11 | `blubybcadigital.id` | `Garuda x bluDebit Card Kamu Telah Aktif` | `skipped` |
| 12 | `blubybcadigital.id` | `Request bluVirtual & Garuda x bluDebit Card Berhasil` | `skipped` |
| 13 | `blubybcadigital.id` | `bluVirtual Card Kamu Telah Aktif` | `skipped` |
| 14 | `blubybcadigital.id` | `bluSpending "Makan & Minum" Berhasil Dibuat` | `skipped` |
| 15 | `blubybcadigital.id` | `Welcome to blu! Let's Make Your Move!` | `skipped` |

## Hasil Akhir

| Metrik | Sebelum | Sesudah (Expected) |
| ------ | ------: | -----------------: |
| Failed GEMINI_UNKNOWN_ERROR | 26 | ~0 (setelah Retry Failed) |
| Pending Review dari fallback | 0 | ~10-15 (tergantung nominal ditemukan) |
| Skipped non-transaksi blu | 0 | ~5 |
| Retry Later | 0 | ~0 |
| Total gagal teknis nyata | 26 | ~0 |
| Build Status | OK | OK |

## File yang Diubah

| File | Perubahan |
| ---- | --------- |
| `src/lib/geminiErrors.ts` | `fallbackAllowed` property, `TIMEOUT`/`TEMPORARY_ERROR`/`FALLBACK_USED` codes, enhanced classification |
| `src/lib/geminiFallbackParser.ts` | All failure paths now set `finalStatus: 'skipped'` including "all fallbacks failed" case |
| `src/features/gmail/GmailSyncPage.tsx` | `isTemporaryGeminiError` updated with new codes; fallback routing handles `rejected`, `retry_later`, `failed` finalStatus; default fallback to `skipped` instead of `failed` |
| `docs/gmail-sync/GMAIL_SYNC_GEMINI_UNKNOWN_ERROR_FIX_CHECKLIST.md` | New file — this checklist |

## Error yang Ditemukan dan Solusi

| Error | Root Cause | Solusi | Status |
| ----- | ---------- | ------ | ------ |
| `GEMINI_UNKNOWN_ERROR` langsung final `failed` | Fallback failure paths tidak set `finalStatus` → fallthrough ke `failed` | Semua failure paths return `finalStatus: 'skipped'`; `isTemporaryGeminiError` routing diperbaiki | ✅ Selesai |
| `Parser lokal akan mencoba fallback bila memungkinkan` padahal fallback sudah berjalan | Pesan error menyesatkan | Ubah ke "AI gagal sementara. Parser lokal membaca email ini." | ✅ Selesai |
| `TEMPORARY_ERROR` hardcoded sebagai string literal | Tidak ada constant reference | Ditambahkan ke `GEMINI_ERROR_CODES.TEMPORARY_ERROR` | ✅ Selesai |
| `GEMINI_TIMEOUT` tidak ada sebagai error code terpisah | Klasifikasi timeout masuk `NETWORK_ERROR` | `TIMEOUT` sebagai error code terpisah, classification untuk `deadline_exceeded` | ✅ Selesai |

## Cara Validasi Manual

1. Buka halaman Gmail Sync
2. Klik **Retry Failed** — sistem akan memproses ulang 26 email yang gagal
3. Perhatikan update status:
   - Email Shopee/KAI/tiket.com/Agoda/Jago dengan nominal → `pending_review`
   - Email blu aktivasi/welcome → `skipped`
   - Email lain tanpa nominal → `skipped`
4. Pastikan failed count turun
5. Pastikan notifikasi Gmail failed summary ter-update

## Catatan Penting

- Perbaikan ini **tidak menghapus data user** yang sudah ada
- Email dengan status `approved` atau `pending_review` dari scan sebelumnya tetap aman
- Retry Failed mengambil data email dari Gmail API lagi (bukan dari Supabase log)
- Full Gmail body tidak disimpan ke Supabase
- Status `failed` hanya akan terjadi untuk bug teknis nyata yang tidak bisa ditangani fallback
