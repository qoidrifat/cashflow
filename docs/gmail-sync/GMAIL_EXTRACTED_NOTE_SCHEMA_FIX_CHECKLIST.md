# Gmail Extracted Note Schema Fix Checklist

## Masalah

* [x] Error muncul: `Could not find the 'extracted_note' column of 'gmail_sync_logs' in the schema cache`
* [x] Kode menggunakan `extracted_note`
* [x] Database belum punya kolom atau schema cache belum reload

## Root Cause

* [x] Kolom dicek di information_schema
* [x] Supabase project aktif dicek
* [x] Query select/insert/update diaudit
* [x] Mapper camelCase/snake_case diaudit

## Database Fix

* [x] Migration dibuat
* [x] `extracted_note text` ditambahkan
* [x] Comment column ditambahkan
* [x] Schema cache reload dilakukan
* [x] Kolom diverifikasi setelah migration

## Backfill

* [x] Metadata existing dicek
* [x] Backfill dari metadata dilakukan jika aman
* [x] Data lama tidak dihapus
* [x] Full email body tidak disimpan

## Service Layer

* [x] Select `extracted_note` aman
* [x] Insert/update `extracted_note` aman
* [x] Mapper `extracted_note`  `extractedNote` dibuat
* [x] Null handling aman

## UI

* [x] Gmail Sync tidak crash jika note null
* [x] Catatan tampil jika ada
* [x] Skipped/rejected menampilkan alasan
* [x] Halaman transaksi tetap menampilkan `transactions.note`

## Test Result

| Test                          | Result | Notes |
| ----------------------------- | ------ | ----- |
| Kolom extracted_note tersedia | Pass | `information_schema.columns` mengembalikan `extracted_note text` |
| Schema cache reload           | Pass | `notify pgrst, 'reload schema'` dijalankan |
| Gmail Sync page load          | Code covered | Perlu refresh browser untuk manual check |
| Filter semua status           | Code covered | Pagination service tetap status-aware |
| Catatan tampil jika ada       | Code covered | Mapper fallback dari `extracted_note` atau metadata |
| Build                         | Pass | `npm run lint` dan `npm run build` berhasil |

## File yang Diubah

| File | Perubahan |
| ---- | --------- |
| `supabase/migrations/202606200005_gmail_transaction_note.sql` | Tambah comment dan backfill aman dari metadata note |
| `src/services/supabaseMappers.ts` | Mapper `extracted_note` ke `extractedNote`, plus metadata fallback |
| `src/services/gmailSyncLogService.ts` | Error schema cache dibuat user-friendly, upsert tetap memakai `extracted_note` |
| `src/features/gmail/GmailSyncPage.tsx` | Paginated Gmail log menampilkan note/reason dari mapped log |
| `docs/gmail-sync/GMAIL_EXTRACTED_NOTE_SCHEMA_FIX_CHECKLIST.md` | Checklist fix schema |
| `docs/supabase-migration/SUPABASE_DATABASE_SCHEMA.md` | Dokumentasi kolom `extracted_note` |
| `docs/supabase-migration/SUPABASE_MIGRATION_EXECUTION_REPORT.md` | Catatan eksekusi remote fix |

## Final Status

* Schema Fix: OK
* Gmail Sync UI: OK
* Transaction Note: OK
* Build: OK
