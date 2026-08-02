create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

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

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique not null references auth.users(id) on delete cascade,
  email text,
  name text,
  display_name text,
  photo_url text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists user_id uuid,
  add column if not exists email text,
  add column if not exists name text,
  add column if not exists display_name text,
  add column if not exists photo_url text,
  add column if not exists avatar_url text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

update public.profiles
set
  display_name = coalesce(display_name, name, email, 'User'),
  avatar_url = coalesce(avatar_url, photo_url, '')
where display_name is null or avatar_url is null;

create unique index if not exists idx_profiles_id_unique on public.profiles (id);
create unique index if not exists idx_profiles_user_id_unique on public.profiles (user_id);

create table if not exists public.categories (
  id text not null default gen_random_uuid()::text,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  type text not null check (type in ('income', 'expense', 'transfer', 'refund')),
  icon text,
  color text,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id),
  unique (user_id, name, type)
);

alter table public.categories
  add column if not exists id text default gen_random_uuid()::text,
  add column if not exists user_id uuid,
  add column if not exists name text,
  add column if not exists type text,
  add column if not exists icon text,
  add column if not exists color text,
  add column if not exists is_default boolean not null default false,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if exists (
    select 1
    from pg_constraint
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

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('income', 'expense', 'transfer', 'refund')),
  amount numeric(14,2) not null check (amount >= 0),
  currency text not null default 'IDR',
  category_id text,
  category_name text,
  merchant text,
  payment_method text,
  note text,
  date date,
  transaction_date date,
  source text not null default 'manual' check (source in ('manual', 'gmail', 'fallback', 'import')),
  gmail_message_id text,
  confidence_score numeric(4,3),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.transactions
  add column if not exists user_id uuid,
  add column if not exists type text,
  add column if not exists amount numeric(14,2),
  add column if not exists currency text not null default 'IDR',
  add column if not exists category_id text,
  add column if not exists category_name text,
  add column if not exists merchant text,
  add column if not exists payment_method text,
  add column if not exists note text,
  add column if not exists date date,
  add column if not exists transaction_date date,
  add column if not exists source text not null default 'manual',
  add column if not exists gmail_message_id text,
  add column if not exists confidence_score numeric(4,3),
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

update public.transactions
set
  transaction_date = coalesce(transaction_date, date),
  date = coalesce(date, transaction_date)
where transaction_date is null or date is null;

create table if not exists public.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category_id text,
  category_name text,
  amount numeric(14,2) not null check (amount >= 0),
  used_amount numeric(14,2) not null default 0 check (used_amount >= 0),
  month int not null check (month >= 1 and month <= 12),
  year int not null,
  status text not null default 'safe' check (status in ('safe', 'warning', 'overbudget')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, category_id, month, year)
);

alter table public.budgets
  add column if not exists user_id uuid,
  add column if not exists category_id text,
  add column if not exists category_name text,
  add column if not exists amount numeric(14,2),
  add column if not exists used_amount numeric(14,2) not null default 0,
  add column if not exists month int,
  add column if not exists year int,
  add column if not exists status text not null default 'safe',
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.gmail_sync_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  message_id text,
  gmail_message_id text,
  subject text,
  sender text,
  sender_domain text,
  email_date timestamptz,
  prefilter_status text,
  ai_called boolean not null default false,
  ai_parsed boolean not null default false,
  status text,
  final_status text,
  error_message text,
  confidence_score numeric(4,3),
  extracted_transaction_id uuid references public.transactions(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  scanned_at timestamptz not null default now(),
  unique (user_id, message_id)
);

alter table public.gmail_sync_logs
  add column if not exists user_id uuid,
  add column if not exists message_id text,
  add column if not exists gmail_message_id text,
  add column if not exists subject text,
  add column if not exists sender text,
  add column if not exists sender_domain text,
  add column if not exists email_date timestamptz,
  add column if not exists prefilter_status text,
  add column if not exists ai_called boolean not null default false,
  add column if not exists ai_parsed boolean not null default false,
  add column if not exists status text,
  add column if not exists final_status text,
  add column if not exists error_message text,
  add column if not exists confidence_score numeric(4,3),
  add column if not exists extracted_transaction_id uuid,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists scanned_at timestamptz not null default now();

update public.gmail_sync_logs
set
  gmail_message_id = coalesce(gmail_message_id, message_id),
  message_id = coalesce(message_id, gmail_message_id),
  final_status = coalesce(final_status, status),
  status = coalesce(status, final_status)
where gmail_message_id is null
   or message_id is null
   or final_status is null
   or status is null;

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

alter table public.notifications
  add column if not exists user_id uuid,
  add column if not exists type text,
  add column if not exists priority text not null default 'normal',
  add column if not exists title text,
  add column if not exists message text,
  add column if not exists read boolean not null default false,
  add column if not exists action_label text,
  add column if not exists action_href text,
  add column if not exists dedupe_key text,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.recurring_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('income', 'expense', 'transfer', 'refund')),
  amount numeric(14,2) not null check (amount >= 0),
  category_id text,
  category_name text,
  merchant text,
  payment_method text,
  note text,
  interval text not null check (interval in ('daily', 'weekly', 'monthly', 'yearly')),
  interval_day int not null check (interval_day between 0 and 31),
  start_date date not null,
  end_date date,
  active boolean not null default true,
  last_processed_date date,
  next_due_date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.wallet_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  type text not null check (type in ('cash', 'bank', 'e-wallet', 'credit', 'investment', 'other')),
  institution text not null default '',
  balance numeric(14,2) not null default 0 check (balance >= 0),
  color text not null default '#8b5cf6',
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.saving_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  target_amount numeric(14,2) not null check (target_amount > 0),
  current_amount numeric(14,2) not null default 0 check (current_amount >= 0),
  target_date date not null,
  color text not null default '#10b981',
  status text not null default 'on-track' check (status in ('on-track', 'behind', 'completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (current_amount <= target_amount)
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  amount numeric(14,2) not null check (amount > 0),
  cycle text not null check (cycle in ('weekly', 'monthly', 'quarterly', 'yearly')),
  category_id text,
  category_name text,
  next_billing_date date not null,
  status text not null default 'active' check (status in ('active', 'paused', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();
drop trigger if exists set_categories_updated_at on public.categories;
create trigger set_categories_updated_at before update on public.categories for each row execute function public.set_updated_at();
drop trigger if exists set_transactions_updated_at on public.transactions;
create trigger set_transactions_updated_at before update on public.transactions for each row execute function public.set_updated_at();
drop trigger if exists sync_transaction_date_columns on public.transactions;
create trigger sync_transaction_date_columns before insert or update on public.transactions for each row execute function public.sync_transaction_date_columns();
drop trigger if exists set_budgets_updated_at on public.budgets;
create trigger set_budgets_updated_at before update on public.budgets for each row execute function public.set_updated_at();
drop trigger if exists set_notifications_updated_at on public.notifications;
create trigger set_notifications_updated_at before update on public.notifications for each row execute function public.set_updated_at();
drop trigger if exists set_recurring_transactions_updated_at on public.recurring_transactions;
create trigger set_recurring_transactions_updated_at before update on public.recurring_transactions for each row execute function public.set_updated_at();
drop trigger if exists set_wallet_accounts_updated_at on public.wallet_accounts;
create trigger set_wallet_accounts_updated_at before update on public.wallet_accounts for each row execute function public.set_updated_at();
drop trigger if exists set_saving_goals_updated_at on public.saving_goals;
create trigger set_saving_goals_updated_at before update on public.saving_goals for each row execute function public.set_updated_at();
drop trigger if exists set_subscriptions_updated_at on public.subscriptions;
create trigger set_subscriptions_updated_at before update on public.subscriptions for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.transactions enable row level security;
alter table public.budgets enable row level security;
alter table public.gmail_sync_logs enable row level security;
alter table public.notifications enable row level security;
alter table public.recurring_transactions enable row level security;
alter table public.wallet_accounts enable row level security;
alter table public.saving_goals enable row level security;
alter table public.subscriptions enable row level security;

drop policy if exists "Users can manage own profiles" on public.profiles;
drop policy if exists "profiles_own_all" on public.profiles;
drop policy if exists "profiles_own_select" on public.profiles;
drop policy if exists "profiles_own_insert" on public.profiles;
drop policy if exists "profiles_own_update" on public.profiles;
drop policy if exists "profiles_own_delete" on public.profiles;
create policy "Users can manage own profiles"
on public.profiles
for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "Users can manage own categories" on public.categories;
drop policy if exists "categories_own_all" on public.categories;
create policy "Users can manage own categories"
on public.categories
for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "Users can manage own transactions" on public.transactions;
drop policy if exists "transactions_own_all" on public.transactions;
create policy "Users can manage own transactions"
on public.transactions
for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "Users can manage own budgets" on public.budgets;
drop policy if exists "budgets_own_all" on public.budgets;
create policy "Users can manage own budgets"
on public.budgets
for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "Users can manage own gmail sync logs" on public.gmail_sync_logs;
drop policy if exists "gmail_logs_own_all" on public.gmail_sync_logs;
create policy "Users can manage own gmail sync logs"
on public.gmail_sync_logs
for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "Users can manage own notifications" on public.notifications;
drop policy if exists "notifications_own_all" on public.notifications;
drop policy if exists "notifications_own_select" on public.notifications;
drop policy if exists "notifications_own_insert" on public.notifications;
drop policy if exists "notifications_own_update" on public.notifications;
drop policy if exists "notifications_own_delete" on public.notifications;
create policy "Users can manage own notifications"
on public.notifications
for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "recurring_own_all" on public.recurring_transactions;
create policy "recurring_own_all" on public.recurring_transactions for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "wallets_own_all" on public.wallet_accounts;
create policy "wallets_own_all" on public.wallet_accounts for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "goals_own_all" on public.saving_goals;
create policy "goals_own_all" on public.saving_goals for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "subscriptions_own_all" on public.subscriptions;
create policy "subscriptions_own_all" on public.subscriptions for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create index if not exists idx_transactions_user_date on public.transactions (user_id, transaction_date desc);
create index if not exists idx_transactions_user_date_created on public.transactions (user_id, date desc, created_at desc);
create index if not exists idx_transactions_user_type_date on public.transactions (user_id, type, transaction_date desc);
create index if not exists idx_transactions_user_category_date on public.transactions (user_id, category_id, transaction_date desc);
create unique index if not exists idx_transactions_user_gmail_message_unique on public.transactions (user_id, gmail_message_id) where gmail_message_id is not null;
create index if not exists idx_budgets_user_month_year on public.budgets (user_id, year, month);
create index if not exists idx_categories_user_type on public.categories (user_id, type);
create index if not exists idx_categories_user_name on public.categories (user_id, name);
create index if not exists idx_gmail_logs_user_scanned on public.gmail_sync_logs (user_id, scanned_at desc);
create index if not exists idx_gmail_logs_user_status on public.gmail_sync_logs (user_id, final_status);
create unique index if not exists idx_gmail_logs_user_gmail_message_unique on public.gmail_sync_logs (user_id, gmail_message_id) where gmail_message_id is not null;
create index if not exists idx_notifications_user_read_created on public.notifications (user_id, read, created_at desc);
create index if not exists idx_notifications_user_created on public.notifications (user_id, created_at desc);
create index if not exists idx_notifications_user_type_created on public.notifications (user_id, type, created_at desc);
create unique index if not exists idx_notifications_user_dedupe_unique on public.notifications (user_id, dedupe_key) where dedupe_key is not null;
create index if not exists idx_recurring_user_active_due on public.recurring_transactions (user_id, active, next_due_date);
create index if not exists idx_wallets_user_archived on public.wallet_accounts (user_id, archived, created_at desc);
create index if not exists idx_goals_user_created on public.saving_goals (user_id, created_at desc);
create index if not exists idx_subscriptions_user_billing on public.subscriptions (user_id, next_billing_date asc);

create or replace function public.cleanup_old_notifications(p_user_id uuid)
returns void
language plpgsql
set search_path = public
as $$
declare
  total_count int;
  excess int;
begin
  select count(*) into total_count
  from public.notifications
  where user_id = p_user_id;

  if total_count <= 100 then
    return;
  end if;

  excess := total_count - 100;

  delete from public.notifications
  where id in (
    select id
    from public.notifications
    where user_id = p_user_id
      and read = true
    order by created_at asc
    limit excess
  );

  select count(*) into total_count
  from public.notifications
  where user_id = p_user_id;

  if total_count > 100 then
    excess := total_count - 100;

    delete from public.notifications
    where id in (
      select id
      from public.notifications
      where user_id = p_user_id
      order by created_at asc
      limit excess
    );
  end if;
end;
$$;

grant usage on schema public to authenticated;
grant select, insert, update, delete on
  public.profiles,
  public.categories,
  public.transactions,
  public.budgets,
  public.gmail_sync_logs,
  public.notifications,
  public.recurring_transactions,
  public.wallet_accounts,
  public.saving_goals,
  public.subscriptions
to authenticated;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'transactions',
    'budgets',
    'categories',
    'notifications',
    'gmail_sync_logs',
    'recurring_transactions'
  ]
  loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = table_name
    ) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
