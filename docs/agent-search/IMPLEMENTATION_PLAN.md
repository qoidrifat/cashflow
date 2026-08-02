# Implementation Plan: Agent Search Fix

## Current State

- Discovery Engine working (verified externally)
- CashFlow backend too aggressively classifies 400 errors as "invalid request"
- No filter fallback when Discovery Engine rejects filter syntax
- Frontend error UI unhelpful (no retry, no suggestions)

## Target State

- Query "pengeluaran tertinggi" returns results without false error
- Filter failures gracefully fallback to unfiltered search
- Error messages are actionable and user-friendly
- Retry button available on error states
- Query suggestions shown when results empty

## Required Changes

### 1. Backend: Filter Fallback (agentSearchService.js)
- `queryAgentSearch()`: Try with filter → if 400, retry without filter
- Preserves user-scoped filtering via `filterOwnedResults()` post-query

### 2. Backend: Error Classification (agentSearchService.js)
- `classifyAgentSearchError()`: Separate "invalid argument/filter" from generic 400
- Less scary user messaging for configuration issues
- Keep strict validation errors (tab/query) as is

### 3. Frontend: Error UX (AiSearchErrorState.tsx)
- Add retry button
- Add query suggestions for invalid request errors
- Differentiate between config errors and query issues
- Better error titles per error code

### 4. Frontend: AiSearchPage (AiSearchPage.tsx)
- Pass `onRetry` callback to error state component

## Migration Strategy

- No database changes needed
- No breaking API changes (response format same)
- Backend fix is additive (fallback, not removal)
- Frontend fix is visual only

## Rollback Strategy

- Revert 3 files to previous state
- No data migration needed
- Zero downtime operation

## Testing Strategy

1. TypeScript compilation (`tsc --noEmit`)
2. Vite production build
3. Server syntax check (`node --check`)
4. Manual test: query "pengeluaran tertinggi" on transactions tab
5. Verify no false AGENT_SEARCH_INVALID_REQUEST in response
