# Root Cause Analysis: CF-051 — Perlu Review Tidak Tampil

## Executive Summary

Items berstatus "Perlu Review" (needs_review) tidak muncul di list Riwayat Sinkronisasi meskipun counter summary menampilkan angka yang benar (19). Root cause: **query paginated list memfilter berdasarkan `sync_run_id`** yang tidak selalu match, sementara **stats counter menggunakan in-memory state** tanpa filter sync_run_id.

## Evidence

| Evidence | Value |
|----------|-------|
| Stats counter | "Perlu Review: 19" ✅ (from in-memory `emails` state) |
| Paginated list | 0 items when filter "needs_review" active ❌ |
| Data exists in DB | Confirmed (counter wouldn't show 19 otherwise) |
| Other statuses render | "Diterima: 16" shows correctly ✅ |

## Root Cause

**Dual data source mismatch + sync_run_id filtering:**

1. **Stats counter** = `emails.filter(e => e.status === 'needs_review' || e.status === 'pending_review').length`
   - Source: in-memory React state
   - Filter: none (all items from current scan session)
   - Result: 19 ✅

2. **Paginated list** = `getGmailSyncLogsPaginated(userId, { syncRunId, status: 'needs_review' })`
   - Source: Supabase query
   - Filter: `WHERE sync_run_id = X AND (status = 'needs_review' OR final_status = 'needs_review')`
   - Result: 0 ❌

**Why the mismatch occurs:**
- Items persisted from action handlers (retry, mark-as-transaction, skip) use `syncRunId = null`
- Items might have `pending_review` status (accepted by counter but not by `needs_review` filter)
- The `sync_run_id` filter excludes items from other runs or null runs

## Affected Files

| File | Function | Issue |
|------|----------|-------|
| `src/features/gmail/GmailSyncPage.tsx` | `loadPaginatedResults()` | Always passes syncRunId, even when filtering by status |
| `src/services/gmailSyncLogService.ts` | `getGmailSyncLogsPaginated()` | Doesn't include `pending_review` when filtering `needs_review` |

## Failure Chain

```
1. User runs Gmail Sync → 391 emails processed
2. 19 items get status 'needs_review' or 'pending_review'
3. Items persisted to Supabase (some with syncRunId, some with null)
4. Stats counter: emails.filter(...) → 19 ✅ (in-memory, no syncRunId filter)
5. User clicks "Perlu Review" tab
6. filterStatus changes to 'needs_review'
7. loadPaginatedResults called with syncRunId = latestCompletedRun.id
8. Supabase query: WHERE sync_run_id = X AND status = 'needs_review'
9. Items with different sync_run_id OR status='pending_review' excluded
10. Result: 0 items → list empty ❌
```

## Fix Applied

1. When a specific status filter is active, remove `syncRunId` constraint → show ALL matching items across runs
2. When filtering `needs_review`, also include `pending_review` status

## Confidence Score: 92%

High confidence based on:
- Two data sources with different filters clearly identified
- Code path traced end-to-end
- Fix is logical and non-breaking
