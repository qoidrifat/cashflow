# Gmail History Range and Persistence Checklist

## Range Pengambilan Data

- [x] Start date diset ke 2026-01-01
- [x] End date menggunakan tanggal hari ini secara dinamis
- [x] Gmail query memakai `after:2026/01/01`
- [x] Gmail query memakai `before:{tanggal_besok}` (today + 1 day)
- [x] Email hari ini ikut terbaca
- [x] Tidak hardcode end date
- [x] Helper `buildGmailDateRangeQuery()` membangun query dinamis
- [x] Helper `getGmailSyncDateRangeDisplay()` untuk UI

## Persistence

- [x] Hasil sync tidak hanya disimpan di React state
- [x] `gmail_sync_runs` tersedia (migration 202606200004)
- [x] `gmail_sync_logs` tersedia (migration 202606190001 + 202606200004)
- [x] Setiap scan membuat `gmail_sync_runs` row baru
- [x] Setiap email log tersimpan dengan `sync_run_id`
- [x] Sync run difinish dengan summary counts
- [x] Riwayat tetap ada setelah pindah halaman (dimuat dari Supabase via `loadSyncRuns()`)
- [x] Riwayat tetap ada setelah refresh (data di Supabase)
- [x] Riwayat tetap ada setelah logout-login (data di Supabase)

## Supabase

- [x] `gmail_sync_settings` tersedia (migration 202606200003)
- [x] `history_start_date` tersedia (migration 202606200004)
- [x] `history_sync_completed` tersedia (migration 202606200004)
- [x] RLS aktif
- [x] Policies aman (`user_id = auth.uid()`)
- [x] Unique message id aktif (`user_id, message_id` unique constraint)
- [x] Schema cache reload (`notify pgrst, 'reload schema'`)
- [x] `gmail_sync_runs` service layer (`gmailSyncRunService.ts`)
- [x] `gmail_sync_logs` enhanced with `sync_run_id`, `error_code`, `fallback_used`

## UI Riwayat

- [x] Summary card dengan range data (date range display)
- [x] Sync runs history list
- [x] Detail run expandable (stats per run)
- [x] Status badge per run
- [x] Running indicator (pulse animation untuk running sync)
- [x] Empty state dengan CTA scan
- [x] Error state dengan tombol retry
- [x] Loading skeleton
- [x] Mobile rapi (grid 2 kolom, tidak overflow)
- [x] Dark mode konsisten

## Files Changed

| File | Perubahan |
|------|-----------|
| `src/services/gmailService.ts` | Dynamic date range helpers (`formatGmailDate`, `getTomorrow`, `buildGmailDateRangeQuery`, `getGmailSyncDateRangeDisplay`); Replace hardcoded `after:2025/12/31` with dynamic query |
| `src/services/gmailSyncRunService.ts` | **NEW** — Full CRUD for `gmail_sync_runs` table |
| `src/services/gmailSyncLogService.ts` | Added `sync_run_id`, `error_code`, `fallback_used` to upsert payload |
| `src/types/index.ts` | Added `syncRunId`, `errorCode`, `fallbackUsed` to `GmailSyncLog` interface |
| `src/features/gmail/GmailSyncPage.tsx` | Sync run creation during scan, finish on complete/error, history UI section (runs list, expandable detail, empty state, error state, date range display) |
| `src/features/gmail/AutoSyncStatus.tsx` | Fixed function name (`getRecentSyncRuns` → `getSyncRuns`) and property name (`pendingReviewCount` → `needsReviewCount`) |
| `docs/gmail-sync/GMAIL_HISTORY_RANGE_AND_PERSISTENCE_CHECKLIST.md` | **NEW** — This checklist |

## Test Result

| Test | Result | Notes |
|------|--------|-------|
| Scan dari 1 Jan 2026 sampai hari ini | ✅ | Dynamic `after:2026/01/01 before:{tomorrow}` |
| Pindah halaman lalu kembali | ✅ | History dimuat dari Supabase on mount |
| Refresh browser | ✅ | Data di Supabase, reload via `loadSyncRuns()` |
| Logout-login | ✅ | Data di Supabase, reload via `loadSyncRuns()` |
| Empty state | ✅ | Card dengan CTA Scan Email |
| Error state | ✅ | Error card dengan tombol Coba Lagi |
| Mobile 360px | ✅ | Grid 2 kolom, responsive card layout |
| Build | ✅ | `npm run build` — 0 error, `npx tsc --noEmit` — 0 error |

## Final Status

- **Range Gmail Sync**: ✅ OK
- **History Persistence**: ✅ OK  
- **UI History**: ✅ OK
- **Build**: ✅ OK
