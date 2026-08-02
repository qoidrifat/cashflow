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
  add column if not exists priority text not null default 'normal',
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'notifications_type_check'
      and conrelid = 'public.notifications'::regclass
  ) then
    alter table public.notifications drop constraint notifications_type_check;
  end if;

  if exists (
    select 1 from pg_constraint
    where conname = 'notifications_priority_check'
      and conrelid = 'public.notifications'::regclass
  ) then
    alter table public.notifications drop constraint notifications_priority_check;
  end if;

  if exists (
    select 1 from pg_constraint
    where conname = 'notifications_title_length_check'
      and conrelid = 'public.notifications'::regclass
  ) then
    alter table public.notifications drop constraint notifications_title_length_check;
  end if;

  if exists (
    select 1 from pg_constraint
    where conname = 'notifications_message_length_check'
      and conrelid = 'public.notifications'::regclass
  ) then
    alter table public.notifications drop constraint notifications_message_length_check;
  end if;
end $$;

alter table public.notifications
  add constraint notifications_type_check
    check (type in ('transaction', 'budget', 'gmail', 'system', 'success', 'warning', 'error', 'info')),
  add constraint notifications_priority_check
    check (priority in ('low', 'normal', 'high')),
  add constraint notifications_title_length_check
    check (char_length(btrim(title)) between 1 and 200),
  add constraint notifications_message_length_check
    check (char_length(btrim(message)) between 1 and 1000);

drop trigger if exists set_notifications_updated_at on public.notifications;
create trigger set_notifications_updated_at
before update on public.notifications
for each row execute function public.set_updated_at();

alter table public.notifications enable row level security;

drop policy if exists "notifications_own_all" on public.notifications;
drop policy if exists "notifications_own_select" on public.notifications;
drop policy if exists "notifications_own_insert" on public.notifications;
drop policy if exists "notifications_own_update" on public.notifications;
drop policy if exists "notifications_own_delete" on public.notifications;

create policy "notifications_own_select"
on public.notifications
for select
to authenticated
using (auth.uid() = user_id);

create policy "notifications_own_insert"
on public.notifications
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "notifications_own_update"
on public.notifications
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "notifications_own_delete"
on public.notifications
for delete
to authenticated
using (auth.uid() = user_id);

create index if not exists idx_notifications_user_created
on public.notifications (user_id, created_at desc);

create index if not exists idx_notifications_user_read_created
on public.notifications (user_id, read, created_at desc);

create index if not exists idx_notifications_user_type_created
on public.notifications (user_id, type, created_at desc);

create unique index if not exists idx_notifications_user_dedupe_unique
on public.notifications (user_id, dedupe_key)
where dedupe_key is not null;

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
        and read = false
      order by created_at asc
      limit excess
    );
  end if;
end;
$$;

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
end $$;
