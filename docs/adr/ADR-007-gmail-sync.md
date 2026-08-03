# ADR-007: Gmail Sync Pipeline with Human-in-the-Loop Review

> **Status:** Accepted · **Date:** 2026-07 · **Owner:** Core Engineering · **Related:** [ADR-004](ADR-004-ai-pipeline.md), [ADR-003](ADR-003-sse.md)

## Context

Users want transactions from bank emails automatically. AI extraction is imperfect, so the pipeline needs a **review queue** where low-confidence results wait for human approval — with realtime notification of the outcome.

## Decision

Implement a Gmail sync pipeline with a confidence gate:

1. **Scan:** newest-first, back to 2026-01-01 (configurable range), respecting rate limits.
2. **Classify:** Gemini extracts `{amount, merchant, category, date}`; confidence scorer decides:
   - high → auto-accepted
   - low → `needs_review` queue
   - malformed/duplicate → rejected / `duplicate` (dedupe via `gmail_message_id`)
3. **Review:** user approves/rejects in the "Perlu Review" tab → transaction created/blocked → notification pushed (SSE + optional webhook/SMTP).
4. **State:** `gmail_sync_logs`, `gmail_sync_runs`, `gmail_sync_settings` tables; settings toggle + interval.

## Alternatives Considered

| Option | Reason rejected |
|---|---|
| Full auto-accept | Unacceptable error rate on money data |
| Manual entry only | Original problem (friction) |
| Edge Function background sync | Feature removed — app-active sync only (simpler ops) |

## Consequences

**Positive:** High-accuracy outcomes via human review; dedupe prevents double entries; full observability of run state; comprehensive E2E coverage (approve/reject/duplicate/amount-missing + realtime bell).
**Negative:** Requires user attention for review queue; Gmail API quota handling and token refresh must be maintained; Edge Function removal means no background scanning when app closed.
