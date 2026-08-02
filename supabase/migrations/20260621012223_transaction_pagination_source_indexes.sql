-- Transaction page server-side pagination support.
-- These indexes keep per-user transaction pagination, source filtering, and
-- created_at tie-break sorting fast without changing existing data or RLS.

create index if not exists idx_transactions_user_created
on public.transactions (user_id, created_at desc);

create index if not exists idx_transactions_user_source_date
on public.transactions (user_id, source, transaction_date desc);

notify pgrst, 'reload schema';
