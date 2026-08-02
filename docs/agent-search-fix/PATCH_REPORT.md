# Patch Report: Agent Search False Error Fix

## Files Modified

| # | File | Type | Lines Changed |
|---|------|------|--------------|
| 1 | `server/services/agentSearchService.js` | Backend | +25, -8 |
| 2 | `src/features/ai-search/components/AiSearchErrorState.tsx` | Frontend | +62, -18 |
| 3 | `src/pages/AiSearchPage.tsx` | Frontend | +1, -1 |

## Patch Details

### 1. server/services/agentSearchService.js

#### A. queryAgentSearch() — Filter Fallback

Added try/catch around `discoveryRequest(':search', payload)`. On HTTP 400 with an active filter, retries the search without the filter. Results are still privacy-filtered via `filterOwnedResults()`.

```javascript
let data;
try {
  data = await discoveryRequest(':search', payload);
} catch (searchError) {
  const errStatus = searchError?.response?.status || searchError?.code;
  if (errStatus === 400 && filter) {
    const fallbackPayload = { ...payload };
    delete fallbackPayload.filter;
    data = await discoveryRequest(':search', fallbackPayload);
  } else {
    throw searchError;
  }
}
```

#### B. classifyAgentSearchError() — Refined Classification

Separated specific "invalid argument/filter/value" detection from generic 400. Changed catch-all message from "Request tidak valid" to "Konfigurasi perlu diperiksa":

- `status === 400 && message.includes('invalid argument/filter/value')` → "Konfigurasi filter tidak valid"
- Catch-all `message.includes('invalid') || status === 400` → "Konfigurasi perlu diperiksa"

### 2. src/features/ai-search/components/AiSearchErrorState.tsx

Complete rewrite of error state component:
- Added `onRetry` prop with retry button (primary CTA)
- Added query suggestions for INVALID_REQUEST (e.g., "total pengeluaran", "transaksi shopee")
- Differentiated error titles per code type
- Used appropriate icons (Search vs AlertTriangle)
- Maintained dark mode, mobile responsive, 44px touch targets

### 3. src/pages/AiSearchPage.tsx

Single-line change: pass `onRetry={runSearch}` to `<AiSearchErrorState>`.

## Backward Compatibility

| Aspect | Compatible | Notes |
|--------|-----------|-------|
| API response format | ✅ | Same `{ ok, results, answer, diagnostics }` shape |
| Error response format | ✅ | Same `{ ok, code, message }` shape |
| Frontend interface | ✅ | `onRetry` is optional prop |
| Backend behavior (success path) | ✅ | Unchanged |
| Backend behavior (error path) | ✅ | More graceful, same codes |
| Database | ✅ | No changes |
| Auth | ✅ | No changes |

## Build Verification

```
npx tsc --noEmit              → ✅ Pass (0 errors)
npx vite build                → ✅ Pass (16s, 2992 modules)
node --check server/index.js  → ✅ Pass
```
