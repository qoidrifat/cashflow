create extension if not exists pgcrypto;

alter table if exists public.profiles
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists display_name text,
  add column if not exists avatar_url text;

update public.profiles
set
  display_name = coalesce(display_name, name),
  avatar_url = coalesce(avatar_url, photo_url)
where display_name is null or avatar_url is null;

create unique index if not exists idx_profiles_id_unique on public.profiles (id);
create unique index if not exists idx_profiles_user_id_unique on public.profiles (user_id);

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'categories_type_check'
      and conrelid = 'public.categories'::regclass
  ) then
    alter table public.categories drop constraint categories_type_check;
  end if;

  alter table public.categories
    add constraint categories_type_check
    check (type in ('income', 'expense', 'transfer', 'refund'));
exception
  when duplicate_object then null;
end $$;

alter table if exists public.categories
  add column if not exists updated_at timestamptz not null default now();

drop trigger if exists set_categories_updated_at on public.categories;
create trigger set_categories_updated_at
before update on public.categories
for each row execute function public.set_updated_at();

alter table if exists public.transactions
  add column if not exists currency text not null default 'IDR',
  add column if not exists transaction_date date,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

update public.transactions
set transaction_date = date
where transaction_date is null;

create or replace function public.sync_transaction_date_columns()
returns trigger
language plpgsql
as $$
begin
  if new.transaction_date is null then
    new.transaction_date = new.date;
  end if;

  if new.date is null then
    new.date = new.transaction_date;
  end if;

  return new;
end;
$$;

drop trigger if exists sync_transaction_date_columns on public.transactions;
create trigger sync_transaction_date_columns
before insert or update on public.transactions
for each row execute function public.sync_transaction_date_columns();

alter table if exists public.gmail_sync_logs
  add column if not exists gmail_message_id text,
  add column if not exists sender_domain text,
  add column if not exists email_date timestamptz,
  add column if not exists prefilter_status text,
  add column if not exists ai_called boolean not null default false,
  add column if not exists ai_parsed boolean not null default false,
  add column if not exists final_status text,
  add column if not exists error_message text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

update public.gmail_sync_logs
set
  gmail_message_id = coalesce(gmail_message_id, message_id),
  final_status = coalesce(final_status, status)
where gmail_message_id is null or final_status is null;

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
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

drop trigger if exists set_notifications_updated_at on public.notifications;
create trigger set_notifications_updated_at
before update on public.notifications
for each row execute function public.set_updated_at();

alter table public.notifications enable row level security;

drop policy if exists "notifications_own_all" on public.notifications;
create policy "notifications_own_all"
on public.notifications
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

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

create unique index if not exists idx_gmail_logs_user_gmail_message_unique
on public.gmail_sync_logs (user_id, gmail_message_id)
where gmail_message_id is not null;

create index if not exists idx_notifications_user_read_created
on public.notifications (user_id, read, created_at desc);

create index if not exists idx_notifications_user_created
on public.notifications (user_id, created_at desc);

create unique index if not exists idx_notifications_user_dedupe_unique
on public.notifications (user_id, dedupe_key)
where dedupe_key is not null;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'gmail_sync_logs'
  ) then
    alter publication supabase_realtime add table public.gmail_sync_logs;
  end if;
end $$;
