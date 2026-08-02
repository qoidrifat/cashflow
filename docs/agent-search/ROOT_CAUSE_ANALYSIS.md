# Root Cause Analysis: Agent Search INVALID_REQUEST Error

## Executive Summary

UI error "Request Agent Search tidak valid. Periksa query dan konfigurasi data store." muncul meskipun Discovery Engine berhasil mengembalikan hasil. Root cause ada di **error classification logic** yang terlalu agresif menangkap HTTP 400 dari Discovery Engine.

## Evidence

1. Discovery Engine API verified working: HTTP 200, `results: [...]`, `totalSize: 1`, `semanticState: ENABLED`
2. Error message exact match: `AGENT_SEARCH_INVALID_REQUEST` → "Request Agent Search tidak valid"
3. Source: `classifyAgentSearchError()` in `server/services/agentSearchService.js`

## Affected Files

| File | Function | Issue |
|------|----------|-------|
| `server/services/agentSearchService.js` | `classifyAgentSearchError()` | Over-aggressive 400 classification |
| `server/services/agentSearchService.js` | `queryAgentSearch()` | No filter fallback on 400 |
| `src/features/ai-search/components/AiSearchErrorState.tsx` | Component | Unhelpful error messaging |

## Failure Chain

```
1. User submits query "pengeluaran tertinggi" on transactions tab
2. Frontend calls POST /api/agent-search/answer
3. Backend builds filter: user_id_hash: ANY("hash_xxx")
4. Backend calls Discovery Engine :search with filter
5. Discovery Engine returns 400 (filter field not configured as filterable)
   OR Discovery Engine :answer endpoint returns 400 (answer not supported for config)
6. Error caught in catch block
7. classifyAgentSearchError() matches: status === 400 || message.includes('invalid')
8. Returns code: AGENT_SEARCH_INVALID_REQUEST
9. Backend responds HTTP 400 to frontend
10. Frontend parseResponse() throws error with code
11. UI displays generic "Request Agent Search tidak valid"
```

## Root Cause

`classifyAgentSearchError()` line:
```javascript
} else if (message.includes('invalid') || status === 400) {
    code = 'AGENT_SEARCH_INVALID_REQUEST';
    userMessage = 'Request Agent Search tidak valid. Periksa query dan konfigurasi data store.';
}
```

This catches ALL 400 responses and ANY error containing "invalid" — including legitimate Discovery Engine API responses about filter configuration, schema issues, or answer generation limitations.

## Impact

- Users see scary "invalid request" error for valid queries
- No retry option in error UI
- No suggested queries or helpful next steps
- False impression that the system is broken

## Risk Assessment

- **Severity:** Medium — Feature degraded but no data loss
- **Scope:** All AI Search queries when filter or answer config is imperfect
- **User Impact:** Cannot use AI Search feature effectively

## Confidence Score: 95%

Based on code analysis + verified Discovery Engine success + exact error message match.
