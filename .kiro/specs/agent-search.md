# Spec: Agent Search (GenAI App Builder / Discovery Engine)

## User-Scoping Hash Contract (CF-054)

**Invariant:** the `user_id_hash` value used at INGESTION must be byte-identical to
the value used at QUERY filtering.

- Single source of truth: `hashUserId(userId)` in `server/services/agentSearchService.js`.
- Algorithm: `hash_${sha256(userId + ":" + AGENT_SEARCH_USER_HASH_SALT)}` (hex).
- Salt: `AGENT_SEARCH_USER_HASH_SALT` env — MUST be identical in the process that
  ingests and the process that queries (same server `.env`).
- Field name: `user_id_hash` (snake_case) in both the indexed document and the filter.
- **If the salt changes → all existing documents become orphaned → re-ingest required.**

## Filtering Model (privacy)

1. PRIMARY scope: Discovery Engine server-side `filter: user_id_hash: ANY("...")`.
2. DEFENSE: client-side `filterOwnedResults`:
   - hash === expected → keep
   - hash present & mismatched → drop
   - hash absent & server filter applied → keep (DE already scoped)
   - hash absent & fallback (no server filter) → drop (fail-closed)
3. Never remove the server-side filter to "show results".

## Datastore Schema Requirements

`user_id_hash` MUST be configured as **Filterable**, **Retrievable**, and **Indexable**
in each user-scoped data store (transactions, gmail logs, receipts). If not:
- Not Filterable → search 400 → no-filter fallback (cross-user risk mitigated by client filter).
- Not Retrievable → field absent in results → false-empty before CF-054 fix.

## Empty State Contract

- `rawCount === 0` on a user tab → "Belum ada data tersinkron" + Sync CTA.
- `rawCount > 0` but 0 owned matches → "Tidak ada hasil untuk query ini".

## Observability

`queryAgentSearch` logs `[agent-search] query diagnostics` (no PII): tab, hashPrefix,
serverFilterApplied, fallbackUsed, rawCount, extractedCount, userIdHashFieldPresent, finalCount.
