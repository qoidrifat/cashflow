# CashFlow Notification Database Schema

> ⚠️ **STATUS: ARSIP HISTORIS (SUPERSEDED)** — Dokumen ini ditulis pada era Supabase/Firebase (sebelum 2026-08-02) dan TIDAK mencerminkan arsitektur aktif. Arsitektur saat ini: Express 4 + Better Auth + Turso (libSQL) + SSE + Vertex AI. Lihat [ADR-001..007](adr/INDEX.md) untuk keputusan arsitektur terkini. Skema database aktif saat ini ada di [`turso-schema.sql`](../turso-schema.sql) (root repo), bukan migration Supabase.

Tanggal: 2026-06-20

Migration file:

- `supabase/migrations/20260619182050_notification_system_hardening.sql`

## Table

`public.notifications`

| Column | Type | Rule |
|---|---|---|
| `id` | `uuid` | Primary key, `gen_random_uuid()` |
| `user_id` | `uuid` | Required, references `auth.users(id)` |
| `type` | `text` | One of `transaction`, `budget`, `gmail`, `system`, `success`, `warning`, `error`, `info` |
| `priority` | `text` | One of `low`, `normal`, `high`; default `normal` |
| `title` | `text` | Required, 1-200 chars |
| `message` | `text` | Required, 1-1000 chars |
| `read` | `boolean` | Default `false` |
| `action_label` | `text` | Optional |
| `action_href` | `text` | Optional app route |
| `dedupe_key` | `text` | Optional dedupe key |
| `metadata` | `jsonb` | Default `{}` |
| `created_at` | `timestamptz` | Default `now()` |
| `updated_at` | `timestamptz` | Updated by trigger |

## Indexes

- `idx_notifications_user_created` on `(user_id, created_at desc)`
- `idx_notifications_user_read_created` on `(user_id, read, created_at desc)`
- `idx_notifications_user_type_created` on `(user_id, type, created_at desc)`
- `idx_notifications_user_dedupe_unique` unique on `(user_id, dedupe_key)` where `dedupe_key is not null`

## RLS

RLS is enabled. Policies are split per operation:

- `notifications_own_select`
- `notifications_own_insert`
- `notifications_own_update`
- `notifications_own_delete`

All policies use `auth.uid() = user_id`.

## Cleanup

Function `public.cleanup_old_notifications(p_user_id uuid)` keeps at most 100 notifications per user. It deletes oldest read notifications first, then oldest unread notifications if needed.

The function is intentionally not `security definer`; it runs with caller privileges and stays subject to RLS.

## Realtime

The migration adds `public.notifications` to `supabase_realtime` publication if not already present. Client channel name:

```txt
notifications:{userId}
```

Postgres changes are filtered by:

```txt
user_id=eq.{userId}
```
