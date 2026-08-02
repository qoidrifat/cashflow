# [tasks.md](https://tasks.md)

# CashFlow Supabase Core Schema Fix Tasks

## Overview

Task list ini digunakan untuk memperbaiki error:

```txt
Could not find the table 'public.transactions' in the schema cache
```

Fokus utama:

* Verifikasi Supabase project.

* Buat/repair core schema.

* Tambah index.

* Aktifkan RLS.

* Reload schema cache.

* Audit service layer.

* Pastikan dashboard berjalan tanpa error.

* Update dokumentasi.

## Phase 1 — Project and Environment Audit

* [ ] 1.1 Audit Supabase environment variables

  * Goal: Memastikan app terhubung ke Supabase project yang benar.

  * Check:

    * `.env.local`

    * `.env.example`

    * Supabase client config

  * Expected:

    * Project URL mengarah ke project ref `bwczweuomlwmgwgrsadt`.

    * Anon key tersedia.

    * Secret/service role tidak terekspos di frontend.

  * Acceptance Criteria:

    * Env project confirmed.

    * Jika env salah, manual step terdokumentasi.

* [ ] 1.2 Audit Supabase client setup

  * Goal: Memastikan Supabase client dibuat dengan benar.

  * Files likely affected:

    * `src/lib/supabase/client.ts`

    * `src/config/supabase.ts`

  * Acceptance Criteria:

    * Client memakai env yang benar.

    * Tidak ada hardcoded secret.

* [ ] 1.3 Audit dashboard data flow

  * Goal: Menemukan query yang memicu error `public.transactions`.

  * Files likely affected:

    * dashboard page

    * dashboard hook

    * transaction service

    * report service

    * budget service

  * Acceptance Criteria:

    * Semua pemanggilan `.from("transactions")` teridentifikasi.

    * Query dashboard terdokumentasi.

## Phase 2 — Database Inspection via Supabase MCP

* [ ] 2.1 Inspect core tables

  * Goal: Mengecek table core di Supabase.

  * SQL:

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

* Acceptance Criteria:

  * Diketahui table mana yang ada/hilang.

* [ ] 2.2 Inspect `transactions` table

  * Goal: Memastikan `public.transactions` ada.

  * SQL:

```sql
select table_schema, table_name
from information_schema.tables
where table_name = 'transactions';
```

* Acceptance Criteria:

  * Jika table tidak ada, lanjut Phase 3.

  * Jika table ada, lanjut cek schema cache/env/service mismatch.

* [ ] 2.3 Inspect `transactions` columns

  * Goal: Memastikan kolom sesuai service layer.

  * SQL:

```sql
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
and table_name = 'transactions'
order by ordinal_position;
```

* Acceptance Criteria:

  * Kolom utama seperti `user_id`, `amount`, `type`, `transaction_date` tersedia.

* [ ] 2.4 Inspect RLS status

  * Goal: Memastikan RLS aktif.

  * SQL:

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

* Acceptance Criteria:

  * Semua table user-owned punya rowsecurity true.

* [ ] 2.5 Inspect policies

  * Goal: Memastikan policy sudah benar.

  * SQL:

```sql
select schemaname, tablename, policyname, permissive, roles, cmd
from pg_policies
where schemaname = 'public'
and tablename in (
  'profiles',
  'categories',
  'transactions',
  'budgets',
  'gmail_sync_logs',
  'notifications'
)
order by tablename, policyname;
```

* Acceptance Criteria:

  * Policy berbasis `auth.uid()` tersedia.

## Phase 3 — Schema Repair

* [ ] 3.1 Create safe migration for core tables

  * Goal: Membuat table core jika belum ada.

  * Rules:

    * Use `create table if not exists`.

    * Do not drop tables.

    * Do not delete user data.

    * Do not disable RLS permanently.

  * Tables:

    * `profiles`

    * `categories`

    * `transactions`

    * `budgets`

    * `gmail_sync_logs`

    * `notifications`

  * Acceptance Criteria:

    * Semua table core tersedia.

* [ ] 3.2 Create `profiles` table

  * Goal: Menyimpan profile Supabase user.

  * Acceptance Criteria:

    * `user_id uuid unique not null`.

    * `email`, `display_name`, `avatar_url` tersedia.

* [ ] 3.3 Create `categories` table

  * Goal: Menyimpan kategori transaksi.

  * Acceptance Criteria:

    * `user_id` tersedia.

    * `name`, `type`, `icon`, `color` tersedia.

    * Unique `(user_id, name, type)` tersedia.

* [ ] 3.4 Create `transactions` table

  * Goal: Menyimpan data transaksi utama.

  * Acceptance Criteria:

    * Table `public.transactions` ada.

    * Kolom `user_id`, `type`, `amount`, `transaction_date` ada.

    * Foreign key ke categories aman.

    * Support Gmail source via `gmail_message_id`.

* [ ] 3.5 Create `budgets` table

  * Goal: Menyimpan budget bulanan.

  * Acceptance Criteria:

    * `user_id`, `category_id`, `amount`, `month`, `year` tersedia.

    * Unique `(user_id, category_id, month, year)` tersedia.

* [ ] 3.6 Create `gmail_sync_logs` table

  * Goal: Menyimpan log Gmail Sync.

  * Acceptance Criteria:

    * `gmail_message_id` tersedia.

    * Unique `(user_id, gmail_message_id)` tersedia.

    * Foreign key `extracted_transaction_id` ke `transactions`.

* [ ] 3.7 Create `notifications` table

  * Goal: Menyimpan notifikasi.

  * Acceptance Criteria:

    * `user_id`, `type`, `title`, `message`, `read`, `dedupe_key` tersedia.

## Phase 4 — Performance Indexes

* [ ] 4.1 Add transaction indexes

  * Goal: Mempercepat dashboard, transactions, reports.

  * Indexes:

    * `(user_id, transaction_date desc)`

    * `(user_id, type, transaction_date desc)`

    * `(user_id, category_id, transaction_date desc)`

  * Acceptance Criteria:

    * Index dibuat dengan `create index if not exists`.

* [ ] 4.2 Add Gmail duplicate index

  * Goal: Mencegah duplicate transaksi dari Gmail.

  * Index:

    * unique `(user_id, gmail_message_id)` where not null

  * Acceptance Criteria:

    * Gmail message duplicate tidak membuat transaksi ganda.

* [ ] 4.3 Add budget/category/gmail/notification indexes

  * Goal: Mempercepat query fitur lain.

  * Acceptance Criteria:

    * Semua index performa tersedia.

## Phase 5 — RLS and Policies

* [ ] 5.1 Enable RLS on all core tables

  * Goal: Mengamankan user data.

  * Tables:

    * `profiles`

    * `categories`

    * `transactions`

    * `budgets`

    * `gmail_sync_logs`

    * `notifications`

  * Acceptance Criteria:

    * RLS aktif.

* [ ] 5.2 Create user-owned policies

  * Goal: User hanya bisa akses data miliknya.

  * Policy:

    * `using (user_id = auth.uid())`

    * `with check (user_id = auth.uid())`

  * Acceptance Criteria:

    * Policy tersedia untuk semua table core.

* [ ] 5.3 Verify RLS behavior

  * Goal: Memastikan policy tidak memblokir user sendiri.

  * Acceptance Criteria:

    * User login bisa select data miliknya.

    * User tidak bisa akses data user lain.

## Phase 6 — Schema Cache Reload

* [ ] 6.1 Reload PostgREST schema cache

  * Goal: Menghilangkan schema cache stale.

  * SQL:

```sql
notify pgrst, 'reload schema';
```

* Acceptance Criteria:

  * Error table not found di schema cache hilang setelah refresh.

* [ ] 6.2 Verify API sees `transactions`

  * Goal: Memastikan Supabase API mengenali table.

  * Acceptance Criteria:

    * Query `.from("transactions")` tidak lagi mengembalikan table not found.

## Phase 7 — Service Layer Audit and Fix

* [ ] 7.1 Audit table names

  * Goal: Memastikan semua `.from()` sesuai database.

  * Check:

    * `.from("transactions")`

    * `.from("categories")`

    * `.from("budgets")`

    * `.from("gmail_sync_logs")`

    * `.from("notifications")`

    * `.from("profiles")`

  * Acceptance Criteria:

    * Tidak ada typo table.

* [ ] 7.2 Audit column names

  * Goal: Memastikan service memakai snake_case database column.

  * Check mismatch:

    * `date` vs `transaction_date`

    * `userId` vs `user_id`

    * `createdAt` vs `created_at`

    * `categoryId` vs `category_id`

    * `gmailMessageId` vs `gmail_message_id`

    * `confidenceScore` vs `confidence_score`

    * `paymentMethod` vs `payment_method`

  * Acceptance Criteria:

    * Query insert/select/update tidak memakai column yang salah.

* [ ] 7.3 Add or fix data mappers

  * Goal: Menjembatani UI camelCase dan DB snake_case.

  * Acceptance Criteria:

    * Mapper row → model tersedia.

    * Mapper input → row tersedia.

    * UI tidak perlu dirombak besar.

* [ ] 7.4 Ensure user scoped queries

  * Goal: Semua query filter berdasarkan user.

  * Acceptance Criteria:

    * Semua query user-owned memakai `.eq("user_id", user.id)`.

## Phase 8 — Dashboard Error Handling

* [ ] 8.1 Handle empty transaction table

  * Goal: Dashboard tetap normal saat data kosong.

  * Acceptance Criteria:

    * Saldo 0.

    * Income 0.

    * Expense 0.

    * Recent transactions empty state.

* [ ] 8.2 Improve setup/database error message

  * Goal: Error lebih jelas jika schema belum siap.

  * Acceptance Criteria:

    * Table missing error menampilkan pesan setup database.

    * Permission error menampilkan pesan RLS.

    * Empty data tidak dianggap error.

* [ ] 8.3 Add retry behavior

  * Goal: Tombol `Coba Lagi` bekerja.

  * Acceptance Criteria:

    * Klik retry memanggil ulang query dashboard.

## Phase 9 — Documentation Update

* [ ] 9.1 Update execution report

  * File:

    * `docs/supabase-migration/SUPABASE_MIGRATION_EXECUTION_REPORT.md`

  * Add section:

    * `Fix: public.transactions not found in schema cache`

  * Acceptance Criteria:

    * Root cause tertulis.

    * SQL/migration tertulis.

    * RLS status tertulis.

    * Dashboard validation tertulis.

* [ ] 9.2 Update database schema docs

  * File:

    * `docs/supabase-migration/SUPABASE_DATABASE_SCHEMA.md`

  * Acceptance Criteria:

    * Core table schema terbaru tertulis.

* [ ] 9.3 Update migration tutorial

  * File:

    * `docs/supabase-migration/SUPABASE_MIGRATION_TUTORIAL.md`

  * Acceptance Criteria:

    * Cara cek table.

    * Cara reload schema cache.

    * Cara cek env project.

* [ ] 9.4 Update migration checklist

  * File:

    * `docs/supabase-migration/SUPABASE_MIGRATION_CHECKLIST.md`

  * Acceptance Criteria:

    * Checklist fix dashboard dan core schema tersedia.

## Phase 10 — Validation

* [ ] 10.1 Test Supabase Auth login

  * Acceptance Criteria:

    * Login Google berhasil.

    * Session tersedia.

    * `session.user.id` tersedia.

* [ ] 10.2 Test dashboard load

  * Acceptance Criteria:

    * Tidak ada error `public.transactions not found`.

    * Tidak ada schema cache error.

    * Tidak ada permission denied.

    * Empty state tampil jika data kosong.

* [ ] 10.3 Test manual transaction insert

  * Acceptance Criteria:

    * Transaksi berhasil ditambahkan.

    * Row masuk ke `public.transactions`.

    * Refresh halaman data tetap ada.

* [ ] 10.4 Test reports/budget basic query

  * Acceptance Criteria:

    * Query tidak error table/column missing.

* [ ] 10.5 Test Gmail approve flow if available

  * Acceptance Criteria:

    * Transaksi Gmail masuk ke `transactions`.

    * Log masuk ke `gmail_sync_logs`.

## Phase 11 — Build and Auto-Fix

* [ ] 11.1 Run install

  * Command:

```bash
npm install
```

* [ ] 11.2 Run build

  * Command:

```bash
npm run build
```

* Acceptance Criteria:

  * Build berhasil.

* [ ] 11.3 Run lint if available

  * Command:

```bash
npm run lint
```

* Acceptance Criteria:

  * Tidak ada lint error fatal.

* [ ] 11.4 Auto-fix errors

  * Goal: Fix error minimal dan aman.

  * Rules:

    * Jangan rewrite besar.

    * Jangan expose secret.

    * Jangan disable RLS.

    * Dokumentasikan error dan solusi.

  * Acceptance Criteria:

    * Build final berhasil.

## Phase 12 — Final Report

* [ ] 12.1 Produce final report

  * Must include:

    * Root cause error.

    * Apakah `public.transactions` sudah ada.

    * Apakah table core lain sudah ada.

    * Schema cache reload status.

    * RLS status.

    * Policies status.

    * File kode yang diubah.

    * File docs yang diupdate.

    * Build/lint result.

    * Test login result.

    * Test dashboard result.

    * Test insert transaction result.

    * Manual step tersisa.

  * Acceptance Criteria:

    * Final report lengkap dan jelas.

## Definition of Done

Perbaikan dianggap selesai jika:

* Supabase Auth Google tetap berhasil.

* Table `public.transactions` tersedia.

* Semua core table tersedia.

* Schema cache sudah reload.

* RLS aktif dan policy aman.

* Dashboard tidak menampilkan schema cache error.

* Empty state tampil saat data kosong.

* Transaksi manual bisa dibuat.

* Build berhasil.

* Dokumentasi update.

* Tidak ada secret terekspos.

* Gmail Sync tidak dirusak.
