# Supabase Migration Checklist - CashFlow

Tanggal: 2026-06-20

## Auth

- [x] Google login memakai `supabase.auth.signInWithOAuth`.
- [x] Scope Gmail readonly ditambahkan.
- [x] OAuth memakai `access_type=offline` dan `prompt=consent`.
- [x] Route `/auth/callback` tersedia.
- [x] Session memakai Supabase Auth.
- [x] Logout memakai `supabase.auth.signOut()`.
- [x] Profile di-upsert setelah login.
- [ ] User menjalankan setup Google Provider di Supabase Dashboard.
- [ ] User menjalankan setup OAuth/Gmail API di Google Cloud.

## Gmail Sync

- [x] Gmail token diambil dari Supabase `session.provider_token`.
- [x] Gmail API memakai `Authorization: Bearer`.
- [x] Jika token kosong, user diarahkan reconnect/login consent ulang.
- [x] Full email body tidak disimpan ke Supabase.
- [x] Duplicate check memakai Gmail message id.
- [x] Pipeline prefilter -> Gemini -> fallback -> pending review tetap ada.
- [x] Concurrency AI batch diset 3.
- [ ] Test Gmail real account setelah provider manual selesai.

## Database

- [x] Supabase migration dasar tersedia.
- [x] Migration hardening non-destruktif tersedia.
- [x] Table `notifications` ditambahkan.
- [x] Table professional suite memakai Supabase service async.
- [x] Index utama ditambahkan.
- [x] RLS table user-owned aktif.
- [ ] Migration dijalankan di Supabase project user.
- [ ] Data lama production dimigrasikan jika ada export Firestore/local lama.

## Realtime

- [x] Transactions subscribe ke Supabase Realtime.
- [x] Categories subscribe ke Supabase Realtime.
- [x] Budgets subscribe ke Supabase Realtime.
- [x] Recurring subscribe ke Supabase Realtime.
- [x] Notifications subscribe ke Supabase Realtime.
- [x] Cleanup subscription saat unmount.
- [ ] Test realtime antar tab/browser setelah migration dijalankan.

## Security

- [x] `.env.local` tidak dicommit karena `.gitignore` punya `*.local`.
- [x] Tidak ada service role key di frontend env.
- [x] Firebase dependency runtime dihapus.
- [x] Gmail full body tidak masuk database.
- [x] Gemini API key tetap server-side.
- [x] RLS tidak dinonaktifkan.

## Verification

- [x] `npm uninstall firebase`
- [x] `npm run lint`
- [x] `npm run build`
- [x] `npm run dev` smoke test HTTP root app.
- [ ] Login Google real.
- [ ] Logout real.
- [ ] Session persist setelah refresh.
- [ ] Gmail provider token tersedia.
- [ ] Gmail scan real.
- [ ] Approve pending review masuk table `transactions`.
- [ ] Notification realtime real.
- [ ] Mobile UI check manual di browser.
- [ ] Dark/light mode check manual di browser.

## Residual Risk

- Nama state internal `firebaseUser` masih dipertahankan sebagai alias legacy untuk menghindari refactor luas. Runtime auth sudah Supabase.
- Provider token Gmail tetap token browser karena Gmail API dipanggil dari frontend. Untuk keamanan lebih tinggi, buat backend Gmail proxy dengan token exchange server-side.
- Supabase provider refresh token tidak otomatis di-refresh oleh Supabase Auth; reconnect/login ulang tetap diperlukan jika token provider expired.

## Fix: public.transactions not found in schema cache

- [x] `.env.local` diverifikasi mengarah ke project `bwczweuomlwmgwgrsadt` tanpa mencetak secret.
- [x] Supabase MCP inspeksi awal menunjukkan core table public belum ada.
- [x] Migration lokal dibuat: `supabase/migrations/20260619190612_cashflow_core_schema_cache_fix.sql`.
- [x] SQL core schema fix dieksekusi ke Supabase remote via MCP.
- [x] `public.transactions` tersedia.
- [x] Core table `profiles`, `categories`, `transactions`, `budgets`, `gmail_sync_logs`, `notifications` tersedia.
- [x] RLS aktif pada semua core table.
- [x] Policy authenticated berbasis `user_id = auth.uid()` tersedia pada semua core table.
- [x] Index performa wajib tersedia.
- [x] Schema cache reload dijalankan dengan `notify pgrst, 'reload schema'`.
- [x] REST endpoint `transactions` mengembalikan HTTP `200 []`, bukan schema cache error.
- [x] Smoke insert transaksi diuji dalam transaksi rollback; tidak ada data test disimpan.
- [x] Service layer transaksi memakai `transaction_date` untuk query utama.
- [x] Dashboard error message schema/RLS/column dibuat lebih jelas.
- [x] `npm run lint` final.
- [x] `npm run build` final.
- [x] Dev server merespons di `http://127.0.0.1:5180` dan route `/dashboard` HTTP `200`.
- [ ] Test dashboard real setelah refresh browser login.
- [ ] Test tambah transaksi manual dari UI authenticated.
