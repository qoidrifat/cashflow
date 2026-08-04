# ADR-004: AI Pipeline — Gemini, Resilience Layer, Cost Tracking

> **Status:** Accepted · **Date:** 2026-07 · **Owner:** Core Engineering · **Related:** [ADR-006](ADR-006-discovery-engine.md), [ADR-005](ADR-005-monitoring.md)
>
> **Update (2026-08-04):** the `@google/generative-ai` / Gemini API-key path was removed. AI now runs **exclusively via Vertex AI** (`@google/genai` + service account); `GEMINI_API_KEY` is dead/legacy config not consumed by code.

## Context

CashFlow uses AI for: Gmail email → transaction extraction, receipt OCR, monthly reports, and (via Discovery Engine) agent search. These calls are latency- and cost-sensitive, and third-party quota/timeout failures must not break the app.

## Decision

Build a resilient AI gateway:

- **Models:** Gemini primary + fallback (`GEMINI_PRIMARY_MODEL` / `GEMINI_FALLBACK_MODEL`), invoked via Vertex/Gemini SDKs (`@google/genai`, `@google/generative-ai`).
- **Resilience (Sprint 3):**
  - LRU response cache + stats endpoint `/api/admin/metrics/cache`
  - Single-flight dedup for identical concurrent requests (anti thundering-herd)
  - Exponential-backoff retry on `VERTEX_QUOTA_EXCEEDED` / `VERTEX_TIMEOUT`
  - Fallback parser when primary JSON parse fails; confidence scoring
- **Cost/latency:** every call records feature, user, tokens, latency → `ai_usage_metrics`.

## Alternatives Considered

| Option | Reason rejected |
|---|---|
| OpenAI | Vendor lock; cost; no Discovery Engine integration |
| Pure serverless per-call | No resilience/cost visibility |
| No caching | Duplicate requests for identical inputs (e.g., same email re-scan) |

## Consequences

**Positive:** Resilient to quota; measurable cost; cached responses fast; fallback parser keeps the review queue usable.
**Negative:** Cache invalidation rules must be maintained; token/cost estimates are approximations (unit-tested vs recorded).
