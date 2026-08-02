# Patch Report: CF-051 — Fix Gmail Sync Perlu Review Display

## Files Modified

| File | Change |
|------|--------|
| `src/features/gmail/GmailSyncPage.tsx` | `loadPaginatedResults()` — remove syncRunId filter when status filter active |
| `src/services/gmailSyncLogService.ts` | `getGmailSyncLogsPaginated()` — include `pending_review` when filtering `needs_review` |

## Change Details

### 1. GmailSyncPage.tsx — loadPaginatedResults()

**Before:**
```javascript
const result = await getGmailSyncLogsPaginated(firebaseUser.uid, {
  syncRunId: targetRunId,           // ← always applied
  status: filterStatus === 'all' ? null : filterStatus,
});
```

**After:**
```javascript
const statusFilter = filterStatus === 'all' ? null : filterStatus;
const effectiveSyncRunId = statusFilter ? null : targetRunId; // ← removed when filtering by status

const result = await getGmailSyncLogsPaginated(firebaseUser.uid, {
  syncRunId: effectiveSyncRunId,
  status: statusFilter,
});
```

**Logic:** When user filters by a specific status (e.g., "Perlu Review"), don't limit by sync_run_id. This ensures ALL matching items across all runs are visible, matching the counter behavior.

### 2. gmailSyncLogService.ts — getGmailSyncLogsPaginated()

**Before:**
```javascript
if (options.status) {
  query = query.or(`status.eq.${options.status},final_status.eq.${options.status}`);
}
```

**After:**
```javascript
if (options.status) {
  if (options.status === 'needs_review') {
    // Include pending_review (same semantic meaning)
    query = query.or(
      'final_status.eq.needs_review,status.eq.needs_review,final_status.eq.pending_review,status.eq.pending_review'
    );
  } else {
    query = query.or(`final_status.eq.${options.status},status.eq.${options.status}`);
  }
}
```

**Logic:** `needs_review` and `pending_review` are semantically the same — both mean "needs manual review". The stats counter already combines them, so the list query should too.

## Build Results

| Check | Result |
|-------|--------|
| `tsc --noEmit` | ✅ Pass |
| `vite build` | ✅ Pass |

## Backward Compatibility

- ✅ Default "Semua" filter still uses syncRunId (no change)
- ✅ Other status filters (auto_accepted, etc.) also benefit from cross-run visibility
- ✅ No database changes needed
- ✅ No API changes
- ✅ No new dependencies
