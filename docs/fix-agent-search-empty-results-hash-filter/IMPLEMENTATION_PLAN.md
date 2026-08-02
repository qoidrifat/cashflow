# Implementation Plan: CF-054

## Current State
- Ingest & query use identical `hashUserId()` + salt (no divergence).
- `filterOwnedResults` strictly drops results lacking a retrievable `user_id_hash`.
- No observability → silent false-empty.
- Empty state can't distinguish "not synced" vs "no match".

## Target State
- Server-side DE filter is authoritative user-scope.
- Client re-filter keeps results when server filter applied + field absent (fixes false-empty), drops mismatched, fails closed on fallback.
- Diagnostics logged + surfaced to frontend.
- Empty state differentiates the two conditions.

## Changes (least-change, privacy-safe)
1. `filterOwnedResults(results, tab, userId, { serverFilterApplied })` — smarter ownership logic.
2. `queryAgentSearch` — track `serverFilterApplied`/`fallbackUsed`, log diagnostics, return `rawCount`/`fallbackUsed`/`userIdHashRetrievable`.
3. Frontend: capture `diagnostics.rawCount` → `notSynced` flag → empty state CTA.
4. `AiSearchEmptyState` — "Belum ada data tersinkron" vs "Tidak ada hasil".

## Privacy Analysis
- When `serverFilterApplied=true`: DE already scoped results → keeping field-absent results is safe (they belong to the user).
- When fallback (`serverFilterApplied=false`): strict exact-match required; field-absent dropped → fail-closed, no cross-user leak.
- Server-side filter NOT removed — it remains the primary guard.

## Risk & Re-ingest
- Salt/algorithm UNCHANGED → existing documents stay valid → NO forced re-ingest from code.
- Re-ingest only needed if datastore is empty (Hypothesis B) — operational, not code.

## Rollback
- Revert `filterOwnedResults` signature + `queryAgentSearch` diagnostics + 2 frontend files. No data/schema change.

## Testing
- tsc --noEmit, vite build, node --check (all pass).
- Manual: query with known data → use server logs to confirm rawCount/fallbackUsed/finalCount.

## ⚠️ NEEDS HUMAN REVIEW (GCP Console)
Confirm via new logs which GCP-side action is needed:
1. rawCount=0 → run Sync + verify import operation success.
2. fallbackUsed=true → mark `user_id_hash` Filterable in datastore schema.
3. userIdHashFieldPresent=0 → mark `user_id_hash` Retrievable in datastore schema.
