# Supabase Migration Execution Report - CashFlow

| Item | Detail |
|---|---|
| Tanggal/waktu eksekusi | 2026-06-20 00:12:14 +07:00 |
| Framework | React Vite |
| Package manager | npm |
| Status akhir | Core schema sudah diterapkan ke Supabase remote; build berhasil; test browser real masih perlu refresh/login user |

## Ringkasan Perubahan

| Area | Hasil |
|---|---|
| Auth | Firebase/Google GIS flow diganti Supabase Auth Google OAuth |
| Gmail Sync | Token Gmail sekarang dari Supabase `session.provider_token` |
| Database | Supabase service layer dipertahankan dan diperluas untuk notifications/professional data |
| Realtime | Notifications ditambahkan ke Supabase Realtime |
| Security | Firebase dependency dihapus; service role tetap tidak diexpose; full body Gmail tidak disimpan |
| UI | Tidak ada redesign besar; hanya teks Firebase diganti Supabase |

## File Dibuat

| File | Fungsi |
|---|---|
| `src/features/auth/AuthCallbackPage.tsx` | Callback route Supabase OAuth |
| `src/lib/supabase/client.ts` | Export client Supabase sesuai struktur yang diminta |
| `src/services/notificationService.ts` | CRUD + realtime notifications via Supabase |
| `supabase/migrations/202606200001_supabase_migration_hardening.sql` | Hardening schema, RLS, index, realtime |
| `docs/supabase-migration/SUPABASE_MIGRATION_TUTORIAL.md` | Tutorial manual migrasi |
| `docs/supabase-migration/SUPABASE_AUTH_GMAIL_SETUP.md` | Setup Google Auth dan Gmail API |
| `docs/supabase-migration/SUPABASE_DATABASE_SCHEMA.md` | Schema, index, RLS, migration plan |
| `docs/supabase-migration/SUPABASE_MIGRATION_CHECKLIST.md` | Checklist validasi |
| `docs/supabase-migration/SUPABASE_MIGRATION_EXECUTION_REPORT.md` | Laporan eksekusi |

## File Diubah

| File | Perubahan |
|---|---|
| `.env.example` | Hapus `VITE_GOOGLE_CLIENT_ID`; Supabase env tetap |
| `package.json` / `package-lock.json` | Dependency `firebase` dihapus |
| `index.html` | Hapus script Google Identity Services |
| `src/app/router.tsx` | Tambah route `/auth/callback` |
| `src/app/App.tsx` | Subscribe notification realtime setelah login |
| `src/config/env.ts` | Hapus env Google client id |
| `src/config/constants.ts` | Ganti konstanta Firestore ke Supabase table/error |
| `src/features/auth/LoginPage.tsx` | Copy login diganti Supabase Auth |
| `src/features/gmail/GmailSyncPage.tsx` | Komentar retry diganti Supabase |
| `src/features/landing/LandingPage.tsx` | Copy keamanan diganti Supabase RLS |
| `src/features/privacy/PrivacyPage.tsx` | Copy privasi diganti Supabase/server proxy |
| `src/features/professional/ProfessionalSuitePage.tsx` | Data wallet/goal/subscription dibaca async dari Supabase |
| `src/services/authService.ts` | Supabase OAuth Gmail scope, callback, provider token, profile upsert |
| `src/services/gmailService.ts` | Gmail access token dari Supabase session |
| `src/services/gmailSyncLogService.ts` | Tulis kolom Gmail log kompatibilitas baru |
| `src/store/useAppStore.ts` | Persist notification ke Supabase |
| `src/vite-env.d.ts` | Hapus tipe Google GIS |

## Dependency

| Aksi | Package |
|---|---|
| Ditambahkan | Tidak ada; `@supabase/supabase-js` sudah ada |
| Dihapus | `firebase` |

## Firebase/Firestore Usage yang Dihapus

| Item | Status |
|---|---|
| Firebase runtime dependency | Dihapus dari package |
| Google Identity Services token client | Dihapus dari auth flow |
| User-facing copy Firebase/Firestore | Diganti Supabase |
| Runtime import Firebase di `src` | Tidak ditemukan |

Catatan: nama state internal `firebaseUser` masih ada sebagai alias legacy untuk menghindari refactor luas di banyak komponen. Nilainya sekarang berasal dari Supabase user.

## Status Migrasi

| Area | Status | Catatan |
|---|---|---|
| Supabase Auth | Berhasil di code | Butuh setup dashboard manual |
| Gmail Sync | Berhasil di code | Butuh consent Google real untuk validasi provider token |
| Database schema | Berhasil diterapkan ke project Supabase aktif | Core table, index, RLS, policy, dan schema cache reload sudah diverifikasi via MCP |
| RLS | Berhasil dibuat | Policy berbasis `auth.uid() = user_id` |
| Realtime | Berhasil di code dan migration | Notifications/transactions/budgets/categories/recurring |
| Notification system | Berhasil dimigrasikan | Local UI state + Supabase persistence/realtime |
| AI Gemini proxy | Dipertahankan | API key tetap server-side |

## Error Ditemukan dan Solusi

| Error | Root cause | Solusi |
|---|---|---|
| `process` tidak dikenal di browser TS | `process.env.NODE_ENV` dipakai di Vite client | Diganti `import.meta.env.DEV` |
| Promise dipasang langsung ke state Professional Suite | Service wallet/goal/subscription async | Diganti `Promise.all` dan handler async |
| `npm run lint` awal gagal | Dua issue TypeScript di atas | Diperbaiki lalu lint ulang |

## Verification

| Command | Status | Output penting |
|---|---|---|
| `npm uninstall firebase` | Berhasil | 83 packages removed |
| `npx tsc --noEmit --pretty false` | Berhasil | Tidak ada error |
| `npm run lint` | Berhasil | `npx tsc --noEmit` passed |
| `npm run build` | Berhasil | Vite build selesai dalam 8.20s pada run final |
| `npm audit --omit=dev` | Berhasil | 0 vulnerabilities |
| `npm run dev` | Berhasil | Root app `http://127.0.0.1:5180` merespons HTTP 200 |

## Performance Result

| Area | Status |
|---|---|
| Dashboard query | Sudah filter `user_id` dan recent limit |
| Transactions | Query filter `user_id`; full history dibatasi limit 2000 |
| Reports | Mengambil transaksi user; rekomendasi berikutnya adalah date range server-side lebih ketat untuk data besar |
| Gmail Sync | Batch AI concurrency 3, duplicate check message id |
| Realtime | Channel difilter `user_id` |

## Manual Step yang Masih Wajib

1. Refresh dashboard pada browser yang sudah login.
2. Test tambah transaksi manual dari UI authenticated.
3. Jika Gmail token expired/kosong, login ulang dan consent Gmail readonly.
4. Test Gmail Sync dengan akun Google real.

## Final Status

| Komponen | Status akhir |
|---|---|
| Auth migration | Berhasil di code; login real dilaporkan user sudah berhasil |
| Gmail Sync migration | Berhasil di code; butuh test Google consent real jika token expired/kosong |
| Database migration | Berhasil diterapkan ke Supabase remote |
| Realtime migration | Berhasil di code dan SQL |
| Build | Berhasil |

## Fix: public.transactions not found in schema cache

| Item | Detail |
|---|---|
| Waktu fix | 2026-06-20 02:13:01 +07:00 |
| Error | `Could not find the table 'public.transactions' in the schema cache` |
| Root cause | Supabase project aktif `bwczweuomlwmgwgrsadt` belum memiliki core table di schema `public`; inspeksi MCP awal mengembalikan `[]` untuk `profiles`, `categories`, `transactions`, `budgets`, `gmail_sync_logs`, dan `notifications`. |
| Env project | `.env.local` mengarah ke `bwczweuomlwmgwgrsadt`; anon key hanya diverifikasi sebagai present dan tidak dicetak. |
| SQL/migration | Dibuat migration lokal `supabase/migrations/20260619190612_cashflow_core_schema_cache_fix.sql`, lalu SQL yang sama dieksekusi via Supabase MCP direct SQL ke project aktif. |
| Table dibuat/diperbaiki | Core: `profiles`, `categories`, `transactions`, `budgets`, `gmail_sync_logs`, `notifications`. Pendukung app: `recurring_transactions`, `wallet_accounts`, `saving_goals`, `subscriptions`. |
| Compatibility note | `categories.id`, `transactions.category_id`, dan `budgets.category_id` tetap `text` agar default category slug existing tetap bekerja. `transactions` menyimpan `transaction_date` sebagai kolom utama dan `date` sebagai kolom kompatibilitas UI lama, disinkronkan dengan trigger. |
| Index dibuat | Index wajib untuk `transactions`, `budgets`, `categories`, `gmail_sync_logs`, dan `notifications`, termasuk unique partial index `idx_transactions_user_gmail_message_unique`. |
| RLS | Aktif pada semua core table; policy core memakai `user_id = auth.uid()` untuk role `authenticated`. |
| Schema cache | `notify pgrst, 'reload schema'` dijalankan; verifikasi `pg_notification_queue_usage()` mengembalikan `0`. |
| REST schema cache check | `GET /rest/v1/transactions?select=id&limit=1` dengan anon key mengembalikan HTTP `200` dan body `[]`; table sudah dikenali API. |
| Smoke insert | Insert transaksi manual diuji dalam transaksi SQL `begin ... rollback`; `attempted_rows = 1` dan trigger `date`/`transaction_date` sinkron. Tidak ada data test yang disimpan. |
| Service layer fix | `transactionService` sekarang query/filter/order memakai `transaction_date`, tetap menulis `date` untuk kompatibilitas. Mapper membaca `transaction_date || date`. |
| Dashboard error handling | Error schema cache/RLS/column mismatch dibuat lebih jelas; empty data tetap dianggap state normal. |
| Build/lint | `npm run lint` berhasil; `npm run build` berhasil. |
| Dev smoke | Dev server `http://127.0.0.1:5180` sudah merespons `200`; route `/dashboard` merespons `200`. |
| Manual step tersisa | Refresh dashboard di browser login real; test add transaction dari UI authenticated untuk memverifikasi flow browser end-to-end. |

## Fix: gmail_sync_logs.extracted_note not found in schema cache

| Item | Detail |
|---|---|
| Waktu fix | 2026-06-21 01:22 +07:00 |
| Error | `Could not find the 'extracted_note' column of 'gmail_sync_logs' in the schema cache` |
| Root cause | Kode aplikasi sudah menulis/membaca `gmail_sync_logs.extracted_note`, tetapi database remote project aktif belum memiliki kolom tersebut. Migration lokal `202606200005_gmail_transaction_note.sql` ada di repo, tetapi migration history remote tidak mencatat migration tersebut. |
| Env project | `.env.local` mengarah ke `bwczweuomlwmgwgrsadt`; anon key tidak dicetak. |
| Verifikasi sebelum fix | `information_schema.columns` untuk `public.gmail_sync_logs` tidak mengembalikan `extracted_note`. RLS pada `gmail_sync_logs` tetap aktif. |
| SQL dijalankan | `alter table public.gmail_sync_logs add column if not exists extracted_note text; comment on column ...; create index if not exists idx_gmail_logs_extracted_note ...; notify pgrst, 'reload schema';` |
| Backfill | Metadata note dicek. Tidak ada row remote yang memiliki `metadata.extractedNote`, `candidateNote`, atau `note` saat inspeksi, sehingga tidak ada data yang perlu dibackfill. Full email body tidak disimpan. |
| Schema cache | `notify pgrst, 'reload schema'` dijalankan; `pg_notification_queue_usage()` mengembalikan `0`. |
| Verifikasi setelah fix | `information_schema.columns` mengembalikan `extracted_note text nullable`. |
| Service layer | Mapper `mapGmailSyncLog` membaca `extracted_note` ke `extractedNote` dan fallback ke metadata lama. Error schema cache di Gmail Sync log service dibuat user-friendly. |
| Build/lint | `npm run lint` berhasil; `npm run build` berhasil. |
