# Agent Search Flow Analysis

## Execution Flow Trace

```
User types "pengeluaran tertinggi" → clicks Search
  │
  ▼
[src/pages/AiSearchPage.tsx] → runSearch()
  │ - Validates query.trim().length >= 2
  │ - Sets loading=true, error=null
  │ - Calls answerAgentSearch(query, activeTab, userId)
  │
  ▼
[src/features/ai-search/services/agentSearchClient.ts] → answerAgentSearch()
  │ - Gets auth headers (Supabase JWT)
  │ - POST /api/agent-search/answer { query, tab, userId }
  │ - Calls parseResponse<AgentSearchResponse>(response)
  │
  ▼
[server/index.js] → app.post('/api/agent-search/answer')
  │ - Resolves user from Supabase JWT via resolveAgentSearchUser()
  │ - Calls answerAgentSearch({ query, tab, userId })
  │
  ▼
[server/services/agentSearchService.js] → answerAgentSearch()
  │ - Calls queryAgentSearch({ query, tab, userId }) first
  │ - Then calls discoveryRequest(':answer', ...) for AI answer
  │ - Catches answer errors into warning (non-fatal)
  │
  ▼
[server/services/agentSearchService.js] → queryAgentSearch()
  │ - assertValidTab(tab) — validates tab name
  │ - assertUserForTab(tab, userId) — checks auth for user-scoped tabs
  │ - cleanText(query, 500) — sanitizes query
  │ - buildFilter(tab, userId) — builds user_id_hash filter
  │ - discoveryRequest(':search', payload) — calls Discovery Engine
  │ - [FIX] If 400 + filter present → retry without filter
  │ - extractDocumentPayload() — maps Discovery Engine results
  │ - filterOwnedResults() — post-filters by user hash
  │
  ▼
[server/services/agentSearchService.js] → discoveryRequest()
  │ - assertConfigured() — checks env vars + credential file
  │ - getAuthClient() → GoogleAuth with service account
  │ - client.request({ url, method: 'POST', data })
  │ - URL: https://discoveryengine.googleapis.com/v1/{servingConfigPath}:search
  │
  ▼
[Discovery Engine API] → Returns HTTP 200
  │ { results: [...], totalSize: N, semanticState: "ENABLED" }
  │
  ▼
[server/services/agentSearchService.js] → extractDocumentPayload()
  │ - Extracts document.structData || document.derivedStructData
  │ - Extracts snippets from derivedStructData.snippets
  │ - Sanitizes all fields
  │
  ▼
[server/services/agentSearchService.js] → filterOwnedResults()
  │ - For user-scoped tabs: filter by user_id_hash match
  │ - For help tab: pass through all results
  │
  ▼
[server/index.js] → Returns JSON to frontend
  │ { ok: true, results: [...], answer: {...}, diagnostics: {...} }
  │
  ▼
[src/features/ai-search/services/agentSearchClient.ts] → parseResponse()
  │ - Checks response.ok (HTTP status)
  │ - Checks payload.ok !== false
  │ - Returns typed AgentSearchResponse
  │
  ▼
[src/pages/AiSearchPage.tsx] → Updates state
  │ - setResults(response.results || [])
  │ - setAnswer(response.answer || null)
  │ - setLoading(false)
  │
  ▼
[UI Render]
  │ - If results.length > 0 → AiSearchResultCard per result
  │ - If results.length === 0 → AiSearchEmptyState
  │ - If error → AiSearchErrorState with retry button
```

## Key Files

| Layer | File | Function |
|-------|------|----------|
| UI Page | `src/pages/AiSearchPage.tsx` | `runSearch()` |
| API Client | `src/features/ai-search/services/agentSearchClient.ts` | `answerAgentSearch()`, `parseResponse()` |
| Backend Route | `server/index.js` | `app.post('/api/agent-search/answer')` |
| Backend Service | `server/services/agentSearchService.js` | `queryAgentSearch()`, `answerAgentSearch()` |
| Error Classifier | `server/services/agentSearchService.js` | `classifyAgentSearchError()` |
| Response Mapper | `server/services/agentSearchService.js` | `extractDocumentPayload()` |
| Error UI | `src/features/ai-search/components/AiSearchErrorState.tsx` | Component |
| Empty UI | `src/features/ai-search/components/AiSearchEmptyState.tsx` | Component |
