# Supabase Migration Tutorial - CashFlow

Tanggal: 2026-06-20

Dokumen ini adalah panduan manual untuk menjalankan migrasi CashFlow ke Supabase. Project ini adalah React Vite, bukan Next.js, sehingga env frontend memakai prefix `VITE_`.

## 1. Prerequisite

- Node.js dan npm sudah terpasang.
- Akun Supabase dan satu Supabase project.
- Google Cloud project untuk OAuth.
- Gmail API aktif di Google Cloud project yang sama.
- Gemini API key disimpan di server proxy, bukan frontend.

## 2. Environment Variables

Buat `.env.local` dari `.env.example`:

```env
VITE_SUPABASE_URL=https://<PROJECT_REF>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-or-publishable-key>
VITE_FUNCTIONS_BASE_URL=
```

Aturan keamanan:

- Jangan commit `.env.local`.
- Jangan pernah membuat `VITE_SUPABASE_SERVICE_ROLE_KEY`.
- `SUPABASE_SERVICE_ROLE_KEY` hanya boleh dipakai di backend yang trusted jika nanti dibutuhkan.
- Gemini API key tetap di `server/.env` sebagai `GEMINI_API_KEY`.

## 3. Jalankan Migration Database

Migration sudah tersedia di folder `supabase/migrations/`:

- `202606190001_cashflow_supabase_schema.sql`
- `202606200001_supabase_migration_hardening.sql`

Cara manual di Supabase Dashboard:

1. Buka Supabase Dashboard.
2. Pilih project CashFlow.
3. Masuk ke SQL Editor.
4. Jalankan isi file `202606190001_cashflow_supabase_schema.sql`.
5. Jalankan isi file `202606200001_supabase_migration_hardening.sql`.
6. Pastikan tidak ada error.

Cara via Supabase CLI jika project sudah linked:

```bash
supabase db push
```

## 4. Verifikasi Table

Pastikan table berikut ada di schema `public`:

- `profiles`
- `categories`
- `transactions`
- `budgets`
- `recurring_transactions`
- `gmail_sync_logs`
- `wallet_accounts`
- `saving_goals`
- `subscriptions`
- `notifications`

## 5. Verifikasi RLS

Untuk setiap table public di atas:

1. Buka Database -> Tables.
2. Pilih table.
3. Pastikan RLS aktif.
4. Pastikan policy memakai `auth.uid() = user_id`.

Jangan disable RLS untuk memperbaiki error permission. Jika query kosong, cek:

- User sudah login Supabase.
- Query frontend sudah memakai `.eq('user_id', userId)`.
- Policy SELECT/INSERT/UPDATE/DELETE sudah ada.

## 6. Setup Realtime

Migration menambahkan realtime publication untuk:

- `transactions`
- `budgets`
- `categories`
- `recurring_transactions`
- `notifications`
- `gmail_sync_logs`

Verifikasi manual:

1. Buka Database -> Replication.
2. Pastikan table di atas masuk publication `supabase_realtime`.
3. Login aplikasi.
4. Tambahkan transaksi atau notifikasi.
5. UI harus refresh tanpa reload manual.

## 7. Setup Supabase Google Auth

Ikuti detail lengkap di `SUPABASE_AUTH_GMAIL_SETUP.md`.

Ringkasnya:

1. Aktifkan Google Provider di Supabase Authentication.
2. Masukkan Google Client ID dan Client Secret.
3. Tambahkan redirect URI Supabase di Google OAuth Client:
   `https://<PROJECT_REF>.supabase.co/auth/v1/callback`
4. Tambahkan Site URL dan Redirect URLs aplikasi:
   - `http://localhost:5180`
   - `http://127.0.0.1:5180`
   - `http://localhost:5180/auth/callback`
   - `http://127.0.0.1:5180/auth/callback`

## 8. Test Gmail Sync

1. Jalankan app:

```bash
npm run dev
```

2. Login dengan Google.
3. Buka `/gmail-sync`.
4. Klik hubungkan Gmail jika token belum tersedia.
5. Consent harus meminta scope:
   `openid email profile https://www.googleapis.com/auth/gmail.readonly`
6. Jalankan scan Gmail.
7. Cek pending review.
8. Approve transaksi.
9. Pastikan transaksi masuk ke table `transactions`.
10. Pastikan `gmail_sync_logs` tidak menyimpan full email body.

## 9. Troubleshooting

| Masalah | Penyebab umum | Solusi |
|---|---|---|
| `provider_token` kosong | Scope Gmail belum diminta atau user belum consent ulang | Klik login/hubungkan Gmail ulang dengan `prompt=consent` |
| `redirect_uri_mismatch` | Redirect URI Supabase belum masuk Google OAuth Client | Tambahkan `https://<PROJECT_REF>.supabase.co/auth/v1/callback` |
| `RLS permission denied` | Policy tidak cocok atau query tanpa session | Pastikan login Supabase dan `user_id = auth.uid()` |
| Gmail insufficient permission | Gmail API scope belum diizinkan | Tambahkan Gmail readonly scope dan consent ulang |
| Duplicate Gmail message | `gmail_message_id` sudah pernah diproses | Ini normal, email dilewati agar tidak dobel |
| Dashboard lambat | Query terlalu luas | Gunakan date range, limit, dan filter `user_id` |
| Realtime tidak update | Table belum masuk publication | Cek Database -> Replication atau jalankan migration hardening |

Referensi resmi:

- Supabase Google Auth: https://supabase.com/docs/guides/auth/social-login/auth-google
- Supabase OAuth provider tokens: https://supabase.com/docs/guides/auth/social-login
- Supabase Realtime Postgres Changes: https://supabase.com/docs/guides/realtime/postgres-changes
- Supabase RLS: https://supabase.com/docs/guides/database/postgres/row-level-security

## 10. Fix: public.transactions not found in schema cache

Jika dashboard menampilkan:

```txt
Could not find the table 'public.transactions' in the schema cache
```

jalankan langkah berikut:

1. Pastikan `.env.local` mengarah ke project yang benar:

```env
VITE_SUPABASE_URL=https://bwczweuomlwmgwgrsadt.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-or-publishable-key>
```

2. Jalankan migration terbaru:

```bash
supabase db push --linked
```

Jika project belum linked atau memakai SQL Editor, jalankan isi file:

```txt
supabase/migrations/20260619190612_cashflow_core_schema_cache_fix.sql
```

3. Verifikasi core table:

```sql
select table_schema, table_name
from information_schema.tables
where table_schema = 'public'
and table_name in (
  'profiles',
  'categories',
  'transactions',
  'budgets',
  'gmail_sync_logs',
  'notifications'
)
order by table_name;
```

4. Verifikasi RLS:

```sql
select schemaname, tablename, rowsecurity
from pg_tables
where schemaname = 'public'
and tablename in (
  'profiles',
  'categories',
  'transactions',
  'budgets',
  'gmail_sync_logs',
  'notifications'
)
order by tablename;
```

5. Reload schema cache:

```sql
notify pgrst, 'reload schema';
select pg_notification_queue_usage();
```

6. Refresh aplikasi dan klik `Coba Lagi` di dashboard.

Expected result:

- `public.transactions` ada.
- Semua core table ada.
- RLS aktif.
- Dashboard kosong menampilkan nilai `0` dan empty state, bukan error.
- Tidak ada error `schema cache`, `permission denied`, atau `column not found`.
