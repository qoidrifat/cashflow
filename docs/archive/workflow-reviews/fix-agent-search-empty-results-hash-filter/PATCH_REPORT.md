# Patch Report: CF-054 Agent Search Empty Results

## Files Modified

| File | Lines Changed | Type |
|------|---------------|------|
| `server/services/agentSearchService.js` | +45 -8 | bugfix + observability |
| `src/features/ai-search/services/agentSearchClient.ts` | +3 -0 | types |
| `src/pages/AiSearchPage.tsx` | +10 -2 | UX |
| `src/features/ai-search/components/AiSearchEmptyState.tsx` | +24 -6 | UX |

## Changes
- **agentSearchService.js**: `filterOwnedResults` now accepts `serverFilterApplied` and keeps field-absent results when DE filter was applied (fixes false-empty), drops mismatched, fails closed on fallback. `queryAgentSearch` tracks `serverFilterApplied`/`fallbackUsed`, logs `[agent-search] query diagnostics` (no PII), returns `rawCount`/`fallbackUsed`/`userIdHashRetrievable`.
- **agentSearchClient.ts**: extended `diagnostics` type.
- **AiSearchPage.tsx**: derive `notSynced` from `rawCount===0` on user tabs; reset on tab change.
- **AiSearchEmptyState.tsx**: differentiate "Belum ada data tersinkron" (CTA Sync) vs "Tidak ada hasil untuk query ini".

## Validation Results
| Check | Status | Notes |
|-------|--------|-------|
| type-check (tsc --noEmit) | ✓ PASS | 0 errors |
| build (vite build) | ✓ PASS | 33s |
| server syntax (node --check) | ✓ PASS | agentSearchService.js |
| lint | ⚠️ N/A | no lint script in package.json |
| manual query | ⏳ PENDING | requires GCP datastore verification (see below) |

## Re-ingest Required: NO (from code side)
Salt/algorithm unchanged → existing documents remain valid. Re-ingest only if datastore is empty (operational).

## Risk Level: MEDIUM
Privacy preserved (server filter authoritative; fallback fails closed). GCP-side trigger needs Console verification.

## Backward Compatible: YES
No schema/API contract change; `filterOwnedResults` 4th arg is optional.

## ⚠️ NEEDS HUMAN REVIEW — Next Step
Run a query and read server log `[agent-search] query diagnostics`:
- `rawCount=0` → datastore empty → click "Sync transaksi", verify import succeeds.
- `fallbackUsed=true` → mark `user_id_hash` **Filterable** in Agent Builder datastore schema.
- `userIdHashFieldPresent=0` (rawCount>0) → mark `user_id_hash` **Retrievable** in schema.
