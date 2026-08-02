# Supabase Database Schema - CashFlow

Tanggal: 2026-06-20

Schema CashFlow memakai Supabase Postgres dengan RLS berbasis `auth.uid()`. Semua query frontend wajib filter eksplisit `user_id` untuk keamanan dan performa.

## Migration Files

| File | Fungsi |
|---|---|
| `supabase/migrations/202606190001_cashflow_supabase_schema.sql` | Schema dasar CashFlow |
| `supabase/migrations/202606200001_supabase_migration_hardening.sql` | Hardening non-destruktif: notifications, Gmail log metadata, index, RLS, realtime |
| `supabase/migrations/20260619190612_cashflow_core_schema_cache_fix.sql` | Fix live schema cache: create/repair core tables, RLS, index, realtime, grants, dan `notify pgrst` |

## Table Mapping

| Sistem lama | Supabase table | Catatan |
|---|---|---|
| Firebase Auth user | `auth.users` + `profiles` | App memakai `session.user.id` sebagai `user_id` |
| Firestore `categories` / local fallback | `categories` | Default category id tetap text agar UI lama kompatibel |
| Firestore `transactions` / local fallback | `transactions` | `gmail_message_id` unik per user untuk dedupe |
| Firestore `budgets` / local fallback | `budgets` | Budget difilter user, month, year |
| Firestore `gmailSyncLogs` | `gmail_sync_logs` | Tidak menyimpan full email body |
| Local notifications | `notifications` | Persist + realtime |
| Local recurring | `recurring_transactions` | Sudah Supabase-first |
| Local wallet/goal/subscription | `wallet_accounts`, `saving_goals`, `subscriptions` | Sudah async Supabase service |

## Core Tables

### `profiles`

Kolom utama:

- `user_id uuid primary key references auth.users(id)`
- `id uuid default gen_random_uuid()`
- `email text`
- `name text`
- `display_name text`
- `photo_url text`
- `avatar_url text`
- `created_at timestamptz`
- `updated_at timestamptz`

Catatan: `name/photo_url` dipertahankan untuk kompatibilitas migration lama; `display_name/avatar_url` ditambahkan untuk mapping Supabase Auth modern.

### `categories`

Kolom utama:

- `id text`
- `user_id uuid`
- `name text`
- `type text check in ('income', 'expense', 'transfer', 'refund')`
- `icon text`
- `color text`
- `is_default boolean`
- `created_at timestamptz`
- `updated_at timestamptz`

Catatan: `id` tetap text karena default category app memakai slug seperti `makanan-minuman`.

### `transactions`

Kolom utama:

- `id uuid primary key`
- `user_id uuid`
- `type text check in ('income', 'expense', 'transfer', 'refund')`
- `amount numeric(14,2)`
- `currency text default 'IDR'`
- `category_id text`
- `category_name text`
- `merchant text`
- `payment_method text`
- `note text`
- `date date`
- `transaction_date date`
- `source text check in ('manual', 'gmail')`
- `gmail_message_id text`
- `confidence_score numeric(4,3)`
- `metadata jsonb`
- `created_at timestamptz`
- `updated_at timestamptz`

Catatan: `date` adalah kolom kompatibilitas UI existing. Trigger `sync_transaction_date_columns` menjaga `date` dan `transaction_date` sinkron.

### `budgets`

Kolom utama:

- `id uuid primary key`
- `user_id uuid`
- `category_id text`
- `category_name text`
- `amount numeric(14,2)`
- `used_amount numeric(14,2)`
- `month int`
- `year int`
- `status text check in ('safe', 'warning', 'overbudget')`
- `created_at timestamptz`
- `updated_at timestamptz`

### `gmail_sync_logs`

Kolom utama:

- `id uuid primary key`
- `user_id uuid`
- `message_id text`
- `gmail_message_id text`
- `subject text`
- `sender text`
- `sender_domain text`
- `email_date timestamptz`
- `prefilter_status text`
- `ai_called boolean`
- `ai_parsed boolean`
- `status text`
- `final_status text`
- `error_message text`
- `confidence_score numeric(4,3)`
- `extracted_transaction_id uuid`
- `extracted_note text`
- `metadata jsonb`
- `scanned_at timestamptz`

Aturan: full Gmail body tidak disimpan. `extracted_note` hanya berisi ringkasan/catatan transaksi hasil ekstraksi atau builder, bukan isi email penuh.

### `notifications`

Kolom utama:

- `id uuid primary key`
- `user_id uuid`
- `type text`
- `priority text`
- `title text`
- `message text`
- `read boolean`
- `action_label text`
- `action_href text`
- `dedupe_key text`
- `metadata jsonb`
- `created_at timestamptz`
- `updated_at timestamptz`

## Index Wajib

Migration hardening membuat index:

```sql
idx_transactions_user_date
idx_transactions_user_type_date
idx_transactions_user_category_date
idx_transactions_user_gmail_message_unique
idx_budgets_user_month_year
idx_categories_user_type
idx_gmail_logs_user_scanned
idx_gmail_logs_user_status
idx_gmail_logs_user_gmail_message_unique
idx_notifications_user_read_created
idx_notifications_user_created
idx_notifications_user_dedupe_unique
```

## RLS Policy Pattern

Semua table public user-owned memakai pola:

```sql
using (auth.uid() = user_id)
with check (auth.uid() = user_id)
```

Aturan:

- Jangan pakai `user_metadata` untuk authorization.
- UPDATE membutuhkan SELECT policy.
- Semua query frontend tetap `.eq('user_id', userId)`.
- Jangan expose service role ke frontend.

## Realtime Channels

| Feature | Channel | Table | Filter |
|---|---|---|---|
| Notifications | `notifications:{userId}` | `notifications` | `user_id=eq.{userId}` |
| Transactions | `transactions:{userId}` | `transactions` | `user_id=eq.{userId}` |
| Budgets | `budgets:{userId}` | `budgets` | `user_id=eq.{userId}` |
| Categories | `categories:{userId}` | `categories` | `user_id=eq.{userId}` |
| Gmail logs | `gmail-sync:{userId}` planned | `gmail_sync_logs` | `user_id=eq.{userId}` |

## Performance Plan

- Dashboard mengambil transaksi recent dengan limit, bukan full history.
- Reports memakai date range.
- Transactions page memakai filter dan limit.
- Gmail Sync memproses AI candidate dengan concurrency 3.
- Duplicate Gmail dicek memakai `gmail_message_id`.

## Fix: public.transactions not found in schema cache

Pada 2026-06-20, Supabase MCP menunjukkan schema `public` project `bwczweuomlwmgwgrsadt` belum memiliki core table CashFlow. Migration `20260619190612_cashflow_core_schema_cache_fix.sql` dibuat dan SQL-nya dieksekusi ke remote secara non-destruktif.

Hasil verifikasi:

| Check | Status |
|---|---|
| `public.transactions` | Ada |
| Core table `profiles/categories/transactions/budgets/gmail_sync_logs/notifications` | Ada |
| RLS core table | Aktif |
| Policy core table | `for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())` |
| Schema cache reload | `notify pgrst, 'reload schema'` dijalankan |
| REST table visibility | `/rest/v1/transactions?select=id&limit=1` mengembalikan `200 []` |

Catatan kompatibilitas:

- Source-of-truth core memakai `transaction_date`; service layer sekarang order/filter memakai kolom ini.
- Kolom `date` tetap tersedia untuk UI lama dan CSV/export, lalu disinkronkan dengan `transaction_date` melalui trigger `sync_transaction_date_columns`.
- Category id tetap `text` karena app memakai default category slug per user seperti `makanan-minuman`; semua query tetap wajib filter `user_id`.
