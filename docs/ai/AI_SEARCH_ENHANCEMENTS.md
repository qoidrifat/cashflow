# AI Search Enhancements — Sprint 1.4

> **Status:** Implemented · **Feature:** AI Search (Discovery Engine) · **ADRs:** n/a (extends existing agent-search architecture)

## Overview

Upgrades the existing Discovery Engine AI Search with: **semantic filtering**,
**better ranking**, **per-result explanation**, **suggested queries**, **recent
searches**, and **search analytics** — without replacing the search engine or
changing the privacy model (user-scoped via `user_id_hash`).

## Architecture

```
AiSearchPage.tsx (recent searches · filter UI · suggested chips · click tracking)
  └─ src/lib/searchHistory.ts            — recent searches (localStorage per-user, pure)
  └─ src/features/ai-search/services/agentSearchClient.ts — filters/suggested/explanation/track
       └─ POST /api/agent-search/answer | /query (filters)  ─┐
       └─ POST /api/agent-search/track (click analytics)     ─┤
            └─ server/routes/agentSearchRoutes.js (validateSearchFilters · track) ─┘
                 └─ server/services/agentSearchService.js
                      ├─ buildFilter()            — semantic filter → Discovery filter string
                      ├─ rankAndExplainResults()  — dedupe + stable re-rank + explanation[]
                      └─ buildSuggestedQueries()  — engine relatedQuestions + per-tab fallback
```

## Features

### 1. Semantic filtering
Optional `filters` object on `/query` & `/answer`: `{ dateFrom?, dateTo?, type?, category? }`.

- **Validation (route-level, defense-in-depth):** dates must be `YYYY-MM-DD`,
  `dateFrom <= dateTo`, `type` in whitelist (`expense|income|refund|transfer`),
  `category` 1–80 chars with `"` and `\` stripped (anti filter-injection).
- **Service re-validates** (`VALID_TRANSACTION_TYPES`, `DATE_ONLY_PATTERN`,
  category sanitized again) before building the Discovery Engine filter string.
- Gmail tab only supports date range (`email_date`); help tab ignores filters
  (knowledge-base docs have no transaction date).
- If Discovery rejects the filter (HTTP 400), the existing fallback path retries
  without filter and `fallbackUsed` is reported.

### 2. Better ranking
`rankAndExplainResults` post-processes Discovery results:

- **Dedupe** by document id (defense against duplicate docs in the data store).
- **Stable re-rank:** results whose title/merchant/category/subject contain query
  tokens (≥3 chars) float up; JS stable sort preserves Discovery's original order
  for equal scores.
- Each result gains `relevance` (token match count) and `explanation[]`.

### 3. AI explanation
- **Answer-level:** Gemini/Discovery-generated answer with citations (existing).
- **Result-level (new):** deterministic `explanation[]` per result — e.g.
  `kata kunci: tiket`, `tipe expense`, `dalam rentang tanggal`, `data milik kamu`
  — rendered as "Mengapa muncul" chips on each result card. No extra AI calls.

### 4. Suggested queries
`buildSuggestedQueries(query, tab, relatedQuestions, resultCount)`:

- Uses Discovery Engine `relatedQuestions` when the answer API returns ≥2
  (extracted defensively from `data.relatedQuestions` / `answer.relatedQuestions`).
- Otherwise falls back to per-tab Indonesian templates (max 4, dedupe vs the
  original query). Rendered as "Coba tanyakan" chips in the answer card; clicking
  one runs the search and records a `suggestion_used` analytics event.

### 5. Recent searches
`src/lib/searchHistory.ts` — pure localStorage helpers:

- Per-user key (`cashflow:ai-search:recent:<userId>`) → no cross-account leak.
- Case-insensitive dedupe (newest wins), collapse whitespace, cap 8 entries.
- UI shows "Pencarian terakhir" chips before the first search; click → run with the
  entry's **tab override** (fixes the stale-closure tab race), "Bersihkan" clears.

### 6. Search analytics
- Existing metrics (from CF-053) remain: `agent_search_count`, `_empty`,
  `_latency`, `_error` + `ai_usage_metrics` rows.
- **New** `POST /api/agent-search/track` — fire-and-forget `click` /
  `suggestion_used` events → `system_metrics` (`agent_search_click`,
  `agent_search_suggestion_used`) with tab + capped query (≤200 chars) metadata.
  Anonymous allowed (help tab is anonymous); no raw PII stored.

## Security

- Filter injection: whitelists + regex + character stripping at **both** route and
  service layers.
- `/track`: query capped at 200 chars, resultId at 120, no raw body/email content.
- No changes to the existing user-scoping model (`user_id_hash` filter +
  defense-in-depth re-filter).

## Testing

- `tests/unit/agentSearchEnhance.test.ts` — 12 tests: dedupe/re-rank/explanation
  (incl. filter-aware explanations), suggested-queries engine-vs-fallback,
  searchHistory (dedupe, cap, per-user isolation, corrupt storage safety).
- `tests/unit/agentSearchValidation.test.ts` — updated for the new `filters: {}`
  signature + filters validation paths.
- E2E `e2e/agent-search-auth.spec.ts` — auth gate still green (3/3).
- Full suite: 384/384 unit · typecheck 0 · lint 0.

## Future (Sprint 2+)

- Category filter UI input (server already supports it; UI has type + date presets).
- Suggested-query analytics dashboarding in admin monitoring.
