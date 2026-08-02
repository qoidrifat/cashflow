# Patch Report: Agent Search INVALID_REQUEST Fix

## Files Modified

| File | Changes |
|------|---------|
| `server/services/agentSearchService.js` | Filter fallback in `queryAgentSearch()`, refined error classification |
| `src/features/ai-search/components/AiSearchErrorState.tsx` | Retry button, query suggestions, better error messaging |
| `src/pages/AiSearchPage.tsx` | Pass `onRetry` to error state |

## Changes Detail

### 1. `server/services/agentSearchService.js`

**queryAgentSearch():**
- Added try/catch around `discoveryRequest(':search', payload)`
- On 400 error with active filter: retry without filter as fallback
- Results still filtered client-side via `filterOwnedResults()`

**classifyAgentSearchError():**
- Added specific check for "invalid argument/filter/value" with 400 status
- Changed catch-all 400/invalid message from "Request tidak valid" to "Konfigurasi perlu diperiksa"
- Separated user validation errors from Discovery Engine API errors

### 2. `src/features/ai-search/components/AiSearchErrorState.tsx`

- Added `onRetry` prop with retry button
- Added query suggestions for INVALID_REQUEST errors
- Differentiated titles per error code:
  - Not configured → "AI Search belum aktif"
  - Invalid request → "Pencarian perlu penyesuaian"
  - Quota → "Limit tercapai"
  - Network → "Koneksi terputus"
  - Default → "AI Search belum bisa memproses"
- Used Search icon instead of AlertTriangle for invalid request

### 3. `src/pages/AiSearchPage.tsx`

- Added `onRetry={runSearch}` prop to `<AiSearchErrorState>`

## Build Results

| Check | Result |
|-------|--------|
| `tsc --noEmit` | ✅ Pass |
| `vite build` | ✅ Pass (16s) |
| `node --check server/index.js` | ✅ Pass |
| `node --check server/services/agentSearchService.js` | ✅ Pass |
