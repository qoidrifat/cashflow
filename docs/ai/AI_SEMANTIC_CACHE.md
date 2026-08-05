# AI Semantic Cache — Multi-Layer Design

> **Status:** L1–L2 Implemented · L3 Planned · **Owner:** Core Engineering · **Related:** [ADR-004](ADR-004-ai-pipeline.md), `server/lib/aiCache.js`

## Context

AI calls are the largest variable cost and the main latency driver. The Gmail sync and OCR flows repeatedly call Gemini with near-identical inputs (the same email or the same receipt image), so response reuse yields direct cost savings. The initial implementation (Sprint 3) shipped an in-process LRU cache; this document formalizes the full multi-layer design and what each layer adds.

## Layers

| Layer | Name | Lookup cost | Status |
|---|---|---|---|
| **L1** | Exact fingerprint (sha256 of feature + models + contents + config) | 0 (in-memory) | ✅ Implemented (Sprint 3) |
| **L2** | Prompt normalization (whitespace/CRLF canonicalization before fingerprint) | 0 | ✅ Implemented (P2, 2026-08) |
| **L3** | Embedding-aware (semantic) lookup | embedding call (~ms, small cost) | 🔮 Planned |
| **L4** | Cross-instance / distributed (Redis) | network (~ms) | 🔮 Planned (noted in aiCache.js) |

### L1 — Exact fingerprint (implemented)

Key = `sha256(feature | models | contents | config)`. Identical inputs → identical key → hit. Stores only successful `{ text, modelUsed }` (never errors, never raw `usageMetadata`) to keep memory small. LRU eviction (default 100 entries, `AI_CACHE_MAX_ENTRIES`), TTL per entry passed by the caller (`cacheTtlMs`).

### L2 — Prompt normalization (implemented this phase)

`normalizePromptText()` canonicalizes **text parts only** before hashing:

- CRLF/CR → LF
- trailing whitespace per line removed
- 3+ consecutive blank lines → 2
- trim

This is whitespace-level only — **semantically safe**: two prompts that differ only in formatting now share a cache key, raising hit rate for real (same email, different line-wrapping) while never conflating genuinely different content. `inlineData` (receipt base64) is deliberately **not** normalized — identical images produce identical base64; any byte difference must miss.

Unit-tested in `tests/unit/aiCache.test.ts` (normalization + no-false-positive + inlineData exactness).

### L3 — Embedding-aware lookup (planned)

For "same question, different phrasing" reuse (e.g., AI Search queries, insight prompts):

- Maintain a small index of `embedding(contents) → cache key` for high-value features.
- On miss at L1/L2, embed the incoming prompt and look up cosine-similarity ≥ threshold (e.g., 0.97) against stored entries; on match, return the cached response.
- Guardrails: only for **read-only, deterministic** features (never OCR/Gmail — those are exact-match by design); cap index size; similarity threshold tuned to avoid wrong-response reuse.
- Requires an embedding model (Gemini `text-embedding-004` or Vertex embeddings) — new cost center, hence deferred and feature-flagged.

### L4 — Distributed cache (planned)

Evolve to Redis when multiple API instances run behind a load balancer (ADR-010 in-process assumption breaks at N instances). Same key scheme — drop-in key/value store behind the same `getCachedAICache`/`setCachedAICache` interface.

## Invalidation

| Trigger | Mechanism | Status |
|---|---|---|
| TTL expiry | per-entry `expiresAt` | ✅ |
| LRU eviction | maxEntries | ✅ |
| Manual/ops | `POST /api/admin/metrics/cache/clear` (admin-gated) resets store + stats | ✅ P2 |
| Prompt/schema version bump | caller changes `feature` string or config → new keys automatically | ✅ (by design) |
| Cross-instance invalidation | Redis TTL/delete (L4) | 🔮 |

## Router Support (future multi-model)

The cache key already includes the **model set** (`models`), so a future router (GLM/DeepSeek/Gemini per AI_PLATFORM_AUDIT roadmap) can select a provider without invalidating unrelated entries: different provider → different key. A per-model TTL knob is the only addition needed later.

## Observability

- `ai_cache_hit` / `ai_cache_miss` / `ai_single_flight_join` recorded as `system_metrics` (dashboard hit-rate bar).
- `GET /api/admin/metrics/cache` → `{ size, maxEntries, hits, misses, sets, evictions, inflight, hitRate }`.
- Alert rule on hit-rate degradation is configured in `alert_rules` (AI cache monitoring).

## Performance & Cost Impact

- Gmail sync duplicate emails: ~1 Vertex call eliminated per duplicate.
- OCR same-receipt retries: second attempt returns cached text.
- Single-flight prevents concurrent identical requests from double-calling Vertex (thundering-herd protection).
