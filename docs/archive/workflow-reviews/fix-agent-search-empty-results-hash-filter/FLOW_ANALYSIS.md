# Flow Analysis: CF-054 Agent Search Empty Results

## Current (Broken) Flow
```
User: ketik "transaksi shopee" → Cari
  ↓
[Page] src/pages/AiSearchPage.tsx → runSearch()
  ↓
[Client] src/features/ai-search/services/agentSearchClient.ts → answerAgentSearch()
  → POST /api/agent-search/answer  (Authorization: Bearer <supabase JWT>)
  ↓
[Route] server/index.js → resolveAgentSearchUser(req) → userId
  ↓
[Service] agentSearchService.js → answerAgentSearch() → queryAgentSearch()
  ↓
[Hash] buildFilter(tab, userId) → filter: user_id_hash: ANY("hashUserId(userId)")
        hashUserId() = hash_${sha256(userId:AGENT_SEARCH_USER_HASH_SALT)}
  ↓
[Discovery Engine] :search { query, filter }
  ├─ IF user_id_hash NOT filterable → 400
  │    → CF-052 fallback: retry WITHOUT filter (serverFilterApplied=false)
  │    → returns ALL docs (no server scope)
  └─ ELSE → returns user-scoped docs
  ↓
[Map] extractDocumentPayload() → reads document.structData.user_id_hash
  ├─ IF field NOT retrievable → user_id_hash = undefined
  ↓
[Filter] filterOwnedResults() (OLD): r.user_id_hash === expectedHash
  → undefined !== hash → DROPS ALL → final = 0
  ↓
[UI] Empty state "Pencarian perlu penyesuaian"  ← FALSE EMPTY
```

## Failure Point
- NOT hash divergence (ingest & query share `hashUserId` + salt + process).
- The client re-filter `filterOwnedResults` drops every result when DE doesn't
  return a retrievable `user_id_hash` field.
- Compounded by: non-filterable field (forces no-filter fallback) and/or empty datastore.

## Target (Fixed) Flow
```
queryAgentSearch() now tracks serverFilterApplied + logs diagnostics
  ↓
filterOwnedResults(results, tab, userId, { serverFilterApplied }):
  - hash === expected            → keep
  - hash present & mismatched     → drop (privacy)
  - hash absent & serverFilter ON → keep (DE already scoped) ← fixes false-empty
  - hash absent & fallback (no filter) → drop (fail-closed, privacy)
  ↓
diagnostics { rawCount, fallbackUsed, userIdHashRetrievable } → frontend
  ↓
[UI] differentiates:
  - rawCount=0 → "Belum ada data tersinkron" + CTA Sync
  - rawCount>0 but 0 match → "Tidak ada hasil untuk query ini"
```

## Observability Added
`console.log('[agent-search] query diagnostics', { tab, hashPrefix, serverFilterApplied, fallbackUsed, rawCount, extractedCount, userIdHashFieldPresent, finalCount })` — pinpoints exactly where results vanish, no PII.
