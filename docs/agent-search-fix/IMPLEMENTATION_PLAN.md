# Implementation Plan: Agent Search Fix

## Current State

- Discovery Engine returns valid results (verified)
- Backend `classifyAgentSearchError()` maps status 400 or "invalid" in message to `AGENT_SEARCH_INVALID_REQUEST`
- `queryAgentSearch()` fails completely when filter causes 400 — no fallback
- Frontend shows generic error with no retry option
- User perceives AI Search as broken

## Target State

- Query "pengeluaran tertinggi" returns results without false error
- Filter failures gracefully fallback to unfiltered search
- Results still filtered client-side by `filterOwnedResults()` for privacy
- Error messages are specific and actionable
- Retry button available on all error states
- Empty results show "Tidak ditemukan hasil" (not an error)

## Required Changes

### Change 1: Filter Fallback (Backend)

**File:** `server/services/agentSearchService.js` — `queryAgentSearch()`

**Before:**
```javascript
const data = await discoveryRequest(':search', payload);
```

**After:**
```javascript
let data;
try {
  data = await discoveryRequest(':search', payload);
} catch (searchError) {
  const errStatus = searchError?.response?.status || searchError?.code;
  if (errStatus === 400 && filter) {
    // Retry without filter — still filter client-side via filterOwnedResults
    const fallbackPayload = { ...payload };
    delete fallbackPayload.filter;
    data = await discoveryRequest(':search', fallbackPayload);
  } else {
    throw searchError;
  }
}
```

### Change 2: Error Classification Refinement (Backend)

**File:** `server/services/agentSearchService.js` — `classifyAgentSearchError()`

**Before:**
```javascript
} else if (message.includes('invalid') || status === 400) {
    code = 'AGENT_SEARCH_INVALID_REQUEST';
    userMessage = 'Request Agent Search tidak valid. Periksa query dan konfigurasi data store.';
}
```

**After:**
```javascript
} else if (status === 400 && (message.includes('invalid argument') || message.includes('invalid filter') || message.includes('invalid value'))) {
    code = 'AGENT_SEARCH_INVALID_REQUEST';
    userMessage = 'Konfigurasi filter Agent Search tidak valid. Data store mungkin belum memiliki field yang diperlukan.';
} else if (/* other checks */) { ... }
} else if (message.includes('invalid') || status === 400) {
    code = 'AGENT_SEARCH_INVALID_REQUEST';
    userMessage = 'Konfigurasi Agent Search perlu diperiksa. Pastikan data store dan engine sudah di-setup dengan benar.';
}
```

### Change 3: Frontend Error UX (Frontend)

**File:** `src/features/ai-search/components/AiSearchErrorState.tsx`

- Add `onRetry` prop
- Add retry button
- Add query suggestions for invalid request
- Differentiate titles per error code
- Use appropriate icons

### Change 4: Pass Retry Handler (Frontend)

**File:** `src/pages/AiSearchPage.tsx`

- Add `onRetry={runSearch}` to `<AiSearchErrorState>`

## Alternative Fixes Considered

| Alternative | Pros | Cons | Selected |
|-------------|------|------|----------|
| Remove filter entirely | Simple | Loses user-scoping | ❌ |
| Client-only filtering | Works offline | May return too many results | Partially ✅ |
| Filter fallback + client filter | Best of both | Extra API call on 400 | ✅ Selected |
| Catch 400 silently | Simple | Hides real errors | ❌ |

## Selected Fix: Filter Fallback + Refined Classification + UX Improvement

This approach:
1. Tries with filter first (optimal case)
2. Falls back to no filter if 400 (graceful degradation)
3. Still filters client-side (privacy maintained)
4. Classifies errors more precisely (better debugging)
5. Shows helpful UI (retry + suggestions)

## Rollback Strategy

Revert 3 files:
```
git checkout HEAD~1 -- server/services/agentSearchService.js
git checkout HEAD~1 -- src/features/ai-search/components/AiSearchErrorState.tsx
git checkout HEAD~1 -- src/pages/AiSearchPage.tsx
```

No database changes. No migration needed. Zero-downtime rollback.

## Testing Strategy

1. **TypeScript:** `npx tsc --noEmit` ✅
2. **Build:** `npx vite build` ✅
3. **Server:** `node --check server/index.js` ✅
4. **Manual:** Query "pengeluaran tertinggi" on transactions tab → expect results
5. **Edge:** Query with invalid tab → expect proper error
6. **Edge:** Query with < 2 chars → expect "minimal 2 karakter"
7. **Edge:** Query without auth on user-scoped tab → expect "login diperlukan"
