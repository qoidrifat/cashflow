# [design.md](https://design.md)

# CashFlow Supabase Core Schema Fix Design

## 1. Overview

Dokumen ini menjelaskan desain teknis untuk memperbaiki error:

```txt
Could not find the table 'public.transactions' in the schema cache
```

Perbaikan berfokus pada Supabase core schema, migration, RLS, schema cache reload, dan service layer compatibility.

Fitur yang sudah berhasil:

* Supabase Google Auth real login.

Fitur yang harus tetap aman:

* Gmail Sync.

* Dashboard.

* Transactions.

* Budgets.

* Reports.

* Notifications.

* Supabase Auth.

## 2. Root Cause Hypothesis

Error `public.transactions` tidak ditemukan di schema cache biasanya disebabkan oleh:

1. Table belum dibuat.

2. Migration belum diterapkan.

3. App memakai Supabase project yang salah.

4. Table berada di schema selain `public`.

5. Schema cache PostgREST belum reload.

6. Nama table di code tidak sesuai database.

7. Env Supabase URL/anon key salah.

## 3. Target Architecture

```txt
Supabase Auth Google
        ↓
session.user.id
        ↓
Frontend Supabase Client
        ↓
Service Layer
        ↓
Supabase Public Tables
        ↓
RLS: user_id = auth.uid()
        ↓
Dashboard / Transactions / Gmail Sync / Reports
```

## 4. Core Database Tables

Core table yang wajib tersedia:

| Table             | Purpose                                 |
| ----------------- | --------------------------------------- |
| `profiles`        | menyimpan profil user                   |
| `categories`      | kategori income/expense/transfer/refund |
| `transactions`    | data transaksi utama                    |
| `budgets`         | budget bulanan per kategori             |
| `gmail_sync_logs` | log Gmail Sync dan hasil AI extraction  |
| `notifications`   | notifikasi realtime/user events         |

## 5. Database Schema

### 5.1 Extension

```sql
create extension if not exists pgcrypto;
```

### 5.2 Profiles

```sql
create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique not null,
  email text,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

### 5.3 Categories

```sql
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null,
  type text not null check (type in ('income', 'expense', 'transfer', 'refund')),
  icon text,
  color text,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name, type)
);
```

### 5.4 Transactions

```sql
create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  type text not null check (type in ('income', 'expense', 'transfer', 'refund')),
  amount numeric(14,2) not null check (amount >= 0),
  currency text not null default 'IDR',
  category_id uuid references public.categories(id) on delete set null,
  category_name text,
  merchant text,
  payment_method text,
  note text,
  transaction_date date not null,
  source text not null default 'manual' check (source in ('manual', 'gmail', 'fallback', 'import')),
  gmail_message_id text,
  confidence_score numeric(4,3),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

### 5.5 Budgets

```sql
create table if not exists public.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  category_id uuid references public.categories(id) on delete cascade,
  category_name text,
  amount numeric(14,2) not null check (amount >= 0),
  month int not null check (month >= 1 and month <= 12),
  year int not null,
  status text not null default 'safe' check (status in ('safe', 'warning', 'overbudget')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, category_id, month, year)
);
```

### 5.6 Gmail Sync Logs

```sql
create table if not exists public.gmail_sync_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  gmail_message_id text not null,
  subject text,
  sender text,
  sender_domain text,
  email_date timestamptz,
  prefilter_status text,
  ai_called boolean not null default false,
  ai_parsed boolean not null default false,
  final_status text,
  error_message text,
  confidence_score numeric(4,3),
  extracted_transaction_id uuid references public.transactions(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  scanned_at timestamptz not null default now(),
  unique (user_id, gmail_message_id)
);
```

### 5.7 Notifications

```sql
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  type text not null,
  priority text not null default 'normal',
  title text not null,
  message text not null,
  read boolean not null default false,
  action_label text,
  action_href text,
  dedupe_key text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

## 6. Index Design

```sql
create index if not exists idx_transactions_user_date
on public.transactions (user_id, transaction_date desc);

create index if not exists idx_transactions_user_type_date
on public.transactions (user_id, type, transaction_date desc);

create index if not exists idx_transactions_user_category_date
on public.transactions (user_id, category_id, transaction_date desc);

create unique index if not exists idx_transactions_user_gmail_message_unique
on public.transactions (user_id, gmail_message_id)
where gmail_message_id is not null;

create index if not exists idx_budgets_user_month_year
on public.budgets (user_id, year, month);

create index if not exists idx_categories_user_type
on public.categories (user_id, type);

create index if not exists idx_gmail_logs_user_scanned
on public.gmail_sync_logs (user_id, scanned_at desc);

create index if not exists idx_gmail_logs_user_status
on public.gmail_sync_logs (user_id, final_status);

create index if not exists idx_notifications_user_read_created
on public.notifications (user_id, read, created_at desc);

create index if not exists idx_notifications_user_created
on public.notifications (user_id, created_at desc);

create unique index if not exists idx_notifications_user_dedupe_unique
on public.notifications (user_id, dedupe_key)
where dedupe_key is not null;
```

## 7. RLS Design

RLS wajib aktif untuk semua table user-owned.

```sql
alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.transactions enable row level security;
alter table public.budgets enable row level security;
alter table public.gmail_sync_logs enable row level security;
alter table public.notifications enable row level security;
```

Policy pattern:

```sql
using (user_id = auth.uid())
with check (user_id = auth.uid())
```

### Policy SQL

```sql
drop policy if exists "Users can manage own profiles" on public.profiles;
create policy "Users can manage own profiles"
on public.profiles
for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "Users can manage own categories" on public.categories;
create policy "Users can manage own categories"
on public.categories
for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "Users can manage own transactions" on public.transactions;
create policy "Users can manage own transactions"
on public.transactions
for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "Users can manage own budgets" on public.budgets;
create policy "Users can manage own budgets"
on public.budgets
for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "Users can manage own gmail sync logs" on public.gmail_sync_logs;
create policy "Users can manage own gmail sync logs"
on public.gmail_sync_logs
for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "Users can manage own notifications" on public.notifications;
create policy "Users can manage own notifications"
on public.notifications
for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());
```

## 8. Schema Cache Reload

Setelah schema dibuat atau diperbaiki:

```sql
notify pgrst, 'reload schema';
```

Tujuan:

* Memaksa PostgREST/Supabase API mengenali table baru.

* Menghilangkan error `table not found in schema cache`.

## 9. Service Layer Design

### 9.1 Data Access Principle

Semua query harus:

* memakai Supabase client resmi

* filter by `user_id`

* tidak fetch global data

* menggunakan limit/date range

* memiliki error handling

* memakai mapper snake_case ↔ camelCase

### 9.2 Table Name Convention

| Feature         | Supabase Table    |
| --------------- | ----------------- |
| Transactions    | `transactions`    |
| Categories      | `categories`      |
| Budgets         | `budgets`         |
| Gmail Sync Logs | `gmail_sync_logs` |
| Notifications   | `notifications`   |
| Profiles        | `profiles`        |

### 9.3 Column Mapping

| App Model         | Database Column    |
| ----------------- | ------------------ |
| `userId`          | `user_id`          |
| `createdAt`       | `created_at`       |
| `updatedAt`       | `updated_at`       |
| `date`            | `transaction_date` |
| `categoryId`      | `category_id`      |
| `categoryName`    | `category_name`    |
| `gmailMessageId`  | `gmail_message_id` |
| `confidenceScore` | `confidence_score` |
| `paymentMethod`   | `payment_method`   |

## 10. Dashboard Data Flow

```txt
User login
  ↓
Supabase session available
  ↓
Dashboard loads
  ↓
Fetch current month transactions by user_id
  ↓
Fetch recent transactions limit 5-10
  ↓
Fetch budgets current month
  ↓
Compute summary
  ↓
Render dashboard
```

Empty data handling:

* transactions empty → summary 0

* budgets empty → budget section empty state

* recent transactions empty → empty card

* no error toast for empty database

## 11. Error Handling Design

| Error                  | UI Handling          | Developer Handling      |
| ---------------------- | -------------------- | ----------------------- |
| Table missing          | Setup database error | verify schema/migration |
| Schema cache stale     | Retry message        | run schema reload       |
| Permission denied      | Permission error     | check RLS               |
| Column missing         | Data schema error    | audit mapper/service    |
| Empty data             | Empty state          | no action               |
| Wrong Supabase project | Setup/env error      | fix env/manual step     |

## 12. Migration Strategy

Preferred:

1. Use Supabase CLI migration.

2. If MCP direct SQL is used, document SQL execution.

3. Keep local migration file for repo history.

4. Avoid destructive SQL.

Migration file name suggestion:

```txt
create_cashflow_core_tables
```

## 13. Validation Strategy

### Database Validation

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

### RLS Validation

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

### Dashboard Validation

Expected:

* Dashboard opens.

* No schema cache error.

* Summary values show 0 if empty.

* Recent transactions empty state appears.

* Manual transaction can be inserted.

* Refresh preserves data.

## 14. Documentation Updates

Update:

* `docs/supabase-migration/SUPABASE_MIGRATION_EXECUTION_REPORT.md`

* `docs/supabase-migration/SUPABASE_DATABASE_SCHEMA.md`

* `docs/supabase-migration/SUPABASE_MIGRATION_TUTORIAL.md`

* `docs/supabase-migration/SUPABASE_MIGRATION_CHECKLIST.md`

Add section:

* `Fix: public.transactions not found in schema cache`

## 15. Security Notes

Do not:

* expose service_role key

* disable RLS permanently

* drop existing tables

* delete user data

* query without user_id

* store full Gmail body

* commit `.env.local`

Do:

* enable RLS

* use `auth.uid()`

* reload schema cache

* validate project env

* document manual steps
