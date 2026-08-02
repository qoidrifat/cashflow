-- Gmail Sync Runs & Enhancements
-- 1. gmail_sync_runs — track sync sessions (manual, initial_history, auto_background, retry_failed)
-- 2. Enhanced gmail_sync_logs — sync_run_id, thread_id, error_code, fallback_used
-- 3. Enhanced gmail_sync_settings — history_start_date, last_history_sync_at, history_sync_completed

-- ===================== 1. gmail_sync_runs =====================

create table if not exists public.gmail_sync_runs (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    sync_type text not null check (sync_type in ('manual', 'initial_history', 'auto_background', 'retry_failed')),
    status text not null default 'running' check (status in ('running', 'completed', 'partial_failed', 'failed', 'cancelled')),
    started_at timestamptz not null default now(),
    finished_at timestamptz,
    date_from date,
    date_to date,
    total_found int not null default 0,
    total_processed int not null default 0,
    pending_review_count int not null default 0,
    skipped_count int not null default 0,
    rejected_count int not null default 0,
    duplicate_count int not null default 0,
    failed_count int not null default 0,
    retry_later_count int not null default 0,
    config_error_count int not null default 0,
    last_page_token text,
    error_code text,
    error_message text,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_gmail_sync_runs_user
    on public.gmail_sync_runs (user_id, started_at desc);

create index if not exists idx_gmail_sync_runs_user_type
    on public.gmail_sync_runs (user_id, sync_type, started_at desc);

create index if not exists idx_gmail_sync_runs_user_running
    on public.gmail_sync_runs (user_id) where status = 'running';

alter table public.gmail_sync_runs enable row level security;

drop policy if exists "Users can manage own gmail sync runs" on public.gmail_sync_runs;
create policy "Users can manage own gmail sync runs"
    on public.gmail_sync_runs
    for all
    to authenticated
    using (user_id = auth.uid())
    with check (user_id = auth.uid());

drop trigger if exists set_gmail_sync_runs_updated_at on public.gmail_sync_runs;
create trigger set_gmail_sync_runs_updated_at
    before update on public.gmail_sync_runs
    for each row execute function public.set_updated_at();

-- ===================== 2. Enhanced gmail_sync_logs =====================

alter table if exists public.gmail_sync_logs
    add column if not exists sync_run_id uuid references public.gmail_sync_runs(id) on delete set null,
    add column if not exists thread_id text,
    add column if not exists error_code text,
    add column if not exists fallback_used boolean not null default false;

create index if not exists idx_gmail_logs_sync_run
    on public.gmail_sync_logs (sync_run_id);

-- ===================== 3. Enhanced gmail_sync_settings =====================

alter table if exists public.gmail_sync_settings
    add column if not exists history_start_date date not null default '2026-01-01',
    add column if not exists last_history_sync_at timestamptz,
    add column if not exists history_sync_completed boolean not null default false;

-- ===================== Sync Query Indexes =====================

create index if not exists idx_gmail_logs_error_code
    on public.gmail_sync_logs (user_id, error_code);

create index if not exists idx_gmail_logs_fallback_used
    on public.gmail_sync_logs (user_id, fallback_used);

create index if not exists idx_gmail_sync_settings_next_sync
    on public.gmail_sync_settings (auto_sync_enabled, next_sync_at)
    where auto_sync_enabled = true;

notify pgrst, 'reload schema';
