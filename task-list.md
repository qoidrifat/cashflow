# CashFlow Notification System Task List

Updated: 2026-06-20

## Implementation Status

| Phase | Status | Notes |
|---|---|---|
| Phase 1 Project Audit | Done | Header already used `NotificationBell`; no static red dot remained. Supabase client/session and router audited. |
| Phase 2 Database Planning | Done | Added migration `20260619182050_notification_system_hardening.sql` with constraints, indexes, RLS, cleanup, realtime. |
| Phase 3 Type and Service Layer | Done | Added notification priority/input types, full service CRUD/filter/realtime/upsert APIs, and feature re-export. |
| Phase 4 Hook and State | Done | Added `useNotifications`, unread count, loading/error/refetch, realtime state, and optimistic rollback. |
| Phase 5 UI Components | Done | Bell/dropdown/item moved to feature folder; empty state, filters, and page components added. |
| Phase 6 Header Integration | Done | Header renders functional `<NotificationBell />`; layout unchanged. |
| Phase 7 Event Integration | Done | Manual transaction, quick add, Gmail summary/failure, low-confidence Gmail transaction, and budget alerts integrated. |
| Phase 8 Budget Notification Logic | Done | Added budget notification helper and dashboard/budget-page triggers with dedupe keys. |
| Phase 9 Realtime Testing | Pending manual Supabase project test | Code subscribes to filtered Supabase Realtime channel. Needs live DB migration applied. |
| Phase 10 Security Testing | Pending live multi-user test | RLS SQL is present. Cross-user test requires seeded users/session. |
| Phase 11 UI Testing | Pending browser visual pass | Build/type checks pass; mobile/dark/light visual inspection still manual. |
| Phase 12 Build and Final Verification | Done | `npm run lint`, `npm run build`, and dev HTTP smoke check run after implementation. |
| Phase 13 Documentation | Done | Added `docs/notification-database-schema.md` and updated task status. |

## Remaining Manual Checks

- Apply pending Supabase migrations to the target Supabase project.
- Verify Realtime insert/update/delete against a live authenticated user.
- Verify RLS isolation with two different users.
- Perform mobile checks at 360px, 390px, and 414px.
- Perform dark/light mode visual pass.

## Final Definition of Done Status

- Bell icon functional: done.
- Static red dot removed: done.
- Unread badge works in state and realtime path: done in code, pending live Supabase verification.
- Dropdown works: done.
- Dedicated page works: done.
- Supabase realtime works: implemented, pending live DB verification.
- Budget notifications avoid spam: done via deterministic dedupe keys.
- Gmail Sync summary notification works: done.
- RLS active: done in migration.
- Mobile UI clean: implemented responsive layout, pending visual pass.
- Dark/light mode clean: semantic tokens used, pending visual pass.
- Build passes: done.
- No secrets exposed: done.
