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

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name text not null default 'User',
  email text not null default '',
  photo_url text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.categories (
  id text not null default gen_random_uuid()::text,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  type text not null check (type in ('income', 'expense')),
  icon text not null default 'MoreHorizontal',
  color text not null default '#6b7280',
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('income', 'expense', 'transfer', 'refund')),
  amount numeric(14,2) not null check (amount > 0),
  category_id text not null,
  category_name text not null,
  merchant text not null default '',
  payment_method text not null default 'cash',
  note text not null default '',
  date date not null,
  source text not null default 'manual' check (source in ('manual', 'gmail')),
  gmail_message_id text,
  confidence_score numeric(4,3),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category_id text not null,
  category_name text not null,
  amount numeric(14,2) not null check (amount > 0),
  used_amount numeric(14,2) not null default 0,
  month int not null check (month between 1 and 12),
  year int not null check (year between 2000 and 2100),
  status text not null default 'safe' check (status in ('safe', 'warning', 'overbudget')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, category_id, month, year)
);

create table if not exists public.recurring_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('income', 'expense', 'transfer', 'refund')),
  amount numeric(14,2) not null check (amount > 0),
  category_id text not null,
  category_name text not null,
  merchant text not null default '',
  payment_method text not null default 'cash',
  note text not null default '',
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

create table if not exists public.gmail_sync_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  message_id text not null,
  subject text not null default 'No Subject',
  sender text not null default '',
  extracted_transaction_id uuid references public.transactions(id) on delete set null,
  status text not null check (status in (
    'pending_review', 'approved', 'rejected', 'auto_rejected', 'skipped',
    'duplicate', 'failed', 'retry_later', 'paused_config_error'
  )),
  confidence_score numeric(4,3),
  scanned_at timestamptz not null default now(),
  unique (user_id, message_id)
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
  category_id text not null,
  category_name text not null,
  next_billing_date date not null,
  status text not null default 'active' check (status in ('active', 'paused', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();
drop trigger if exists set_transactions_updated_at on public.transactions;
create trigger set_transactions_updated_at before update on public.transactions for each row execute function public.set_updated_at();
drop trigger if exists set_budgets_updated_at on public.budgets;
create trigger set_budgets_updated_at before update on public.budgets for each row execute function public.set_updated_at();
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
alter table public.recurring_transactions enable row level security;
alter table public.gmail_sync_logs enable row level security;
alter table public.wallet_accounts enable row level security;
alter table public.saving_goals enable row level security;
alter table public.subscriptions enable row level security;

create policy "profiles_own_select" on public.profiles for select using (auth.uid() = user_id);
create policy "profiles_own_insert" on public.profiles for insert with check (auth.uid() = user_id);
create policy "profiles_own_update" on public.profiles for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "profiles_own_delete" on public.profiles for delete using (auth.uid() = user_id);

create policy "categories_own_all" on public.categories for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "transactions_own_all" on public.transactions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "budgets_own_all" on public.budgets for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "recurring_own_all" on public.recurring_transactions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "gmail_logs_own_all" on public.gmail_sync_logs for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "wallets_own_all" on public.wallet_accounts for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "goals_own_all" on public.saving_goals for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "subscriptions_own_all" on public.subscriptions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists idx_transactions_user_date_created on public.transactions (user_id, date desc, created_at desc);
create index if not exists idx_transactions_user_date_amount on public.transactions (user_id, date, amount);
create unique index if not exists idx_transactions_user_gmail_message on public.transactions (user_id, gmail_message_id) where gmail_message_id is not null;
create index if not exists idx_transactions_user_category_date on public.transactions (user_id, category_id, date desc);
create index if not exists idx_budgets_user_period on public.budgets (user_id, year desc, month desc);
create index if not exists idx_categories_user_name on public.categories (user_id, name);
create index if not exists idx_recurring_user_active_due on public.recurring_transactions (user_id, active, next_due_date);
create index if not exists idx_gmail_logs_user_status_scanned on public.gmail_sync_logs (user_id, status, scanned_at desc);
create index if not exists idx_wallets_user_archived on public.wallet_accounts (user_id, archived, created_at desc);
create index if not exists idx_goals_user_created on public.saving_goals (user_id, created_at desc);
create index if not exists idx_subscriptions_user_billing on public.subscriptions (user_id, next_billing_date asc);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'transactions'
  ) then
    alter publication supabase_realtime add table public.transactions;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'budgets'
  ) then
    alter publication supabase_realtime add table public.budgets;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'categories'
  ) then
    alter publication supabase_realtime add table public.categories;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'recurring_transactions'
  ) then
    alter publication supabase_realtime add table public.recurring_transactions;
  end if;
end $$;
