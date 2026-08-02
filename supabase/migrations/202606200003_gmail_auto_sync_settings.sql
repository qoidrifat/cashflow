-- Gmail Auto Sync Settings
-- Menyimpan preferensi auto sync per user
-- Client-side active session: auto sync berjalan saat aplikasi aktif

create table if not exists public.gmail_sync_settings (
    id uuid primary key default gen_random_uuid(),
    user_id uuid unique not null references auth.users(id) on delete cascade,
    auto_sync_enabled boolean not null default false,
    sync_interval_minutes int not null default 60 check (sync_interval_minutes >= 15),
    last_synced_at timestamptz,
    next_sync_at timestamptz,
    last_status text,
    last_error_code text,
    last_error_message text,
    last_result_summary text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_gmail_sync_settings_user
    on public.gmail_sync_settings (user_id);

alter table public.gmail_sync_settings enable row level security;

drop policy if exists "Users can manage own gmail sync settings" on public.gmail_sync_settings;
create policy "Users can manage own gmail sync settings"
    on public.gmail_sync_settings
    for all
    to authenticated
    using (user_id = auth.uid())
    with check (user_id = auth.uid());

-- Trigger updated_at
drop trigger if exists set_gmail_sync_settings_updated_at on public.gmail_sync_settings;
create trigger set_gmail_sync_settings_updated_at
    before update on public.gmail_sync_settings
    for each row execute function public.set_updated_at();

notify pgrst, 'reload schema';
