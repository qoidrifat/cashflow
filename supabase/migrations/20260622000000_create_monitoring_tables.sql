-- CF-053: Monitoring & Observability Tables
-- Creates ai_usage_metrics, system_metrics, alert_rules (additive, non-destructive)
--
-- ADMIN ACCESS MODEL:
-- Admin is determined server-side via ADMIN_EMAILS env var (no role column).
-- Metrics READ happens through admin-guarded server endpoints using the
-- service-role client. RLS below blocks ALL client/anon/authenticated access
-- by default; only the service role (server-side, explicit intent) can
-- INSERT/SELECT. Regular users cannot read or write these tables.

-- ===================== 1. ai_usage_metrics =====================

create table if not exists public.ai_usage_metrics (
    id uuid primary key default gen_random_uuid(),
    user_id uuid references auth.users(id) on delete set null,
    feature text not null,                 -- gmail_sync|agent_search|ocr_receipt|insight_generator
    provider text not null,                -- gemini_flash|gemini_pro|vertex_search
    model text,
    prompt_tokens integer not null default 0,
    completion_tokens integer not null default 0,
    total_tokens integer generated always as (prompt_tokens + completion_tokens) stored,
    estimated_cost_usd numeric(12,6) default 0,
    estimated_cost_idr numeric(14,2) default 0,
    execution_time_ms integer,
    status text not null default 'success', -- success|error|timeout|rate_limited
    error_message text,
    metadata jsonb default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create index if not exists idx_ai_usage_feature_created
    on public.ai_usage_metrics (feature, created_at desc);
create index if not exists idx_ai_usage_user_created
    on public.ai_usage_metrics (user_id, created_at desc);
create index if not exists idx_ai_usage_created
    on public.ai_usage_metrics (created_at desc);

-- ===================== 2. system_metrics =====================

create table if not exists public.system_metrics (
    id uuid primary key default gen_random_uuid(),
    metric_name text not null,
    metric_value numeric not null default 1,
    feature text,
    user_id uuid references auth.users(id) on delete set null,
    metadata jsonb default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create index if not exists idx_system_metrics_name_created
    on public.system_metrics (metric_name, created_at desc);
create index if not exists idx_system_metrics_feature_created
    on public.system_metrics (feature, created_at desc);

-- ===================== 3. alert_rules =====================

create table if not exists public.alert_rules (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    metric_name text not null,
    condition text not null check (condition in ('gt','lt','eq')),
    threshold numeric not null,
    window_minutes integer not null default 60,
    is_active boolean not null default true,
    last_triggered_at timestamptz,
    created_at timestamptz not null default now()
);

create index if not exists idx_alert_rules_active
    on public.alert_rules (is_active) where is_active = true;

-- ===================== RLS — service-role only =====================
-- Enable RLS but define NO permissive policy for authenticated/anon.
-- With RLS enabled and no matching policy, regular clients are denied.
-- The service-role key bypasses RLS, so server-side inserts/reads work.

alter table public.ai_usage_metrics enable row level security;
alter table public.system_metrics enable row level security;
alter table public.alert_rules enable row level security;

-- Explicit deny-by-default note: no "for all to authenticated" policy is
-- created, so authenticated/anon clients cannot SELECT/INSERT/UPDATE/DELETE.
-- This is intentional: metrics are admin-only via server endpoints.

-- ===================== Seed default alert rules =====================

insert into public.alert_rules (name, metric_name, condition, threshold, window_minutes)
select * from (values
    ('ai_cost_daily', 'estimated_cost_idr', 'gt', 50000, 1440),
    ('gmail_sync_failures', 'gmail_sync_failed', 'gt', 10, 10),
    ('agent_search_error_rate', 'agent_search_error_rate', 'gt', 0.10, 60),
    ('ocr_failure_rate', 'ocr_failure_rate', 'gt', 0.20, 60)
) as v(name, metric_name, condition, threshold, window_minutes)
where not exists (select 1 from public.alert_rules);

notify pgrst, 'reload schema';

-- ===================== Rollback (manual) =====================
-- drop table if exists public.ai_usage_metrics;
-- drop table if exists public.system_metrics;
-- drop table if exists public.alert_rules;
