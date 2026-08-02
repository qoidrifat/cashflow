-- Gmail failed notification dedupe hardening.
-- Keeps one active summary notification per user and stable dedupe key.

create unique index if not exists idx_notifications_user_dedupe_unique
on public.notifications (user_id, dedupe_key)
where dedupe_key is not null;

notify pgrst, 'reload schema';
