# Gmail Promo Cashback Auto-Skip Checklist

## Ringkasan Masalah

* [x] Email promo cashback salah masuk pending review
* [x] Fallback regex mengambil nominal promo maksimum
* [x] Promo cashback LINE Bank/Jago dianggap transaksi
* [x] Email seharusnya skipped/rejected

## Root Cause

* [x] Prefilter belum mendeteksi promo cashback secara spesifik sebelum exception transaksi
* [x] Fallback parser belum punya guard promo cashback
* [x] AI prompt belum melarang nominal promo cashback secara eksplisit
* [x] Status mapping belum punya `PROMO_CASHBACK_SKIPPED`

## Perbaikan

* [x] Helper `isPromoCashbackEmail` dibuat
* [x] Prefilter promo cashback ditambahkan
* [x] Fallback parser guard ditambahkan
* [x] AI prompt diperbaiki
* [x] Status mapping diperbaiki
* [x] Existing pending review promo cashback dibersihkan
* [x] Approved suspicious items tidak dihapus otomatis
* [x] UI reason ditampilkan jelas

## Test Case

* [x] `Cashback hingga Rp800.000, Ajukan KTA LINE Bank` skipped
* [x] `Buka Deposito, Cashback hingga Rp4.000.000` skipped
* [x] `Hawanya cocok buat dapet CASHBACK` skipped
* [x] `Dapatkan cashback s/d Rp1.000.000` skipped
* [x] `Promo cashback sampai Rp500.000` skipped
* [x] `Cashback up to Rp250.000` skipped
* [x] `Cashback Rp25.000 berhasil diterima` bukan promo skip
* [x] `Cashback telah dikreditkan ke rekening kamu` bukan promo skip
* [x] `Kamu menerima cashback Rp10.000` bukan promo skip
* [x] `Pengembalian dana berhasil` bukan promo skip
* [x] `Transaksimu berhasil` bukan promo skip

## Hasil Akhir

| Item | Sebelum | Sesudah |
| ---- | ------- | ------- |
| Promo cashback masuk pending_review | Ya | Tidak |
| Fallback mengambil nominal promo | Ya | Tidak |
| Promo cashback skipped | Tidak | Ya |
| Cashback aktual tetap diproses | - | Ya |

## File yang Diubah

| File | Perubahan |
| ---- | --------- |
| `src/lib/promoCashbackClassifier.ts` | Helper promo-vs-actual cashback, matched rule, dan amount promo. |
| `src/lib/gmailClassifier.ts` | Prefilter promo cashback sebelum AI. |
| `src/lib/geminiFallbackParser.ts` | Guard fallback dan amount extractor agar nominal promo tidak diparse. |
| `src/features/gmail/GmailSyncPage.tsx` | Metadata debug/UI/log untuk skipped promo cashback dan manual fallback. |
| `src/types/index.ts` | Field debug metadata untuk skip reason dan ignored promo amount. |
| `server/index.js` | Prompt AI melarang nominal promo cashback sebagai transaksi. |
| `src/config/constants.ts` | Prompt reference diselaraskan. |
| Supabase production data | 8 log promo cashback diubah ke skipped; 3 transaksi suspicious ditandai `needsReview`. |

## Status Build

* [x] `npm run build` berhasil
* [x] `npm run lint` berhasil

## Cleanup Data

* Gmail logs promo cashback updated: 8
* Transactions flagged as suspicious, not deleted: 3
* Approved/inserted transaction deletion: tidak dilakukan tanpa konfirmasi user
