# Fraud Detection — Architecture Design

> **Status:** Implemented (L1 full + L2 behind feature flag) · **Owner:** Core Engineering · **Related:** [ADR-011](../adr/ADR-011-fraud-detection.md)

## Objective

Detect anomalous financial activity in the user's ledger (duplicates, unusual velocity, unknown merchants, category outliers) with early warning, without adding meaningful cost or latency to normal writes.

## Pipeline (3 layers, cheapest first)

```
Transaction created (API)
        │
        ▼
┌───────────────────────────────┐
│ L1 Rule Engine (deterministic)│  cost: 0 · latency: ~0 · runs on every write
│  duplicate · velocity ·       │
│  amount-outlier · merchant ·  │
│  category                      │
└───────────────┬───────────────┘
                │ flags?
       no       │  yes
        │       ▼
   persist   ┌───────────────────────────────┐
   normal    │ L2 AI Scoring (Gemini, async) │  cost: 1 Vertex call per flag
        │    │  prompt-bounded, feature-flag │  latency: off critical path
        │    └───────────────┬───────────────┘
        │                    │ score + reasons
        │                    ▼
        │         decision: allow | review | block
        │                    │
        │                    ▼
        │         notification + admin metric
        ▼
   ┌───────────────────────────────┐
   │ L3 ML model (future)          │  replaces L1 heuristics when labeled
   └───────────────────────────────┘  data exists; L1 stays as fallback
```

## L1 — Rule Engine (deterministic)

Pure, testable module. Signals computed per user:

| Rule | Signal | Default heuristics (tunable) |
|---|---|---|
| Duplicate | same `gmail_message_id`; or amount+merchant+date within 7 days | flag |
| Velocity | tx count per merchant / 24h | > 5 |
| Velocity (global) | tx count / day vs 30-day rolling baseline | > 3× median |
| Amount outlier | amount vs user's p99 | > p99 × 1.5 |
| New merchant | merchant never seen + amount above threshold | > 2× user median |
| Category anomaly | category flip vs history (e.g., income-shaped entry as expense) | ML/score |

Input: transaction + per-user aggregates. Output: `flags[]` with rule name + severity.

## L2 — AI Scoring (Gemini)

Only for flagged candidates, async (non-blocking):

- Prompt-bounded: summarize tx + user signals; ask for `{ fraud_score: 0..1, reasons: [], decision: allow|review|block }`.
- Uses `generateVertexContent` (retry + fallback + cache) — **never** breaks the existing Gemini flow; failure degrades to the rule verdict.
- Stored in `system_metrics` with the flag; feeds the notification system.

## Feature Engineering (shared with future ML)

- Per-user: tx count/day, amount mean/median/p99, merchant entropy, category distribution, hour-of-day histogram.
- Per-merchant: first-seen date, frequency, average amount.
- Time: gap since last tx, day-of-week, hour.

## Integration Points (no new infra)

| Concern | Reuse |
|---|---|
| Notification on "suspicious tx" | existing notification system + SSE bell |
| Admin visibility | `admin_metrics` / feature-health + alert rules |
| Dedupe | `tiketDedupe.ts` / gmail `message_id` patterns |
| AI call | `generateVertexContent` (cache + retry) |
| Storage | new `fraud_flags` table + column on transactions (migration when implemented) |

## Guardrails

- No blocking of writes: flags are advisory until human review.
- Feature flag `FRAUD_DETECTION_ENABLED` (default on); `FRAUD_AI_SCORING_ENABLED` (default off).
- False-positive budget: rules tuned against seeded fixtures; AI scoring only on flags (≤ ~1% of transactions).

## Implementation Status (Sprint 1)

| Item | Status | Evidence |
|---|---|---|
| L1 rule engine (pure) | ✅ Implemented | `server/lib/fraudEngine.js` + 13 unit tests |
| Aggregates + wiring on write | ✅ Implemented | `server/services/fraudDetectionService.js`, hook di `POST /api/transactions` (fire-and-forget) |
| Migration `fraud_flags` + kolom | ✅ Implemented | `turso-schema.sql` (tabel + indeks + ALTER idempotent) |
| Notification (bell + SSE) | ✅ Implemented | dedupe `fraud:<txId>`, type `warning`, action → /transactions |
| Admin monitoring | ✅ Implemented | metric `fraud_flag_count` + alert rule seed `fraud_flags` |
| API | ✅ Implemented | `server/routes/fraudRoutes.js` (summary / flags / review) + E2E spec |
| L2 AI scoring (Gemini) | ✅ Implemented (di balik flag) | `runAiScoring`, prompt-bounded, degrade ke verdict L1 |

## Remaining

- Tuning threshold per-rule setelah data nyata (env/konfigurasi rule).
- UI halaman detail flag (saat ini: widget dashboard + badge transaksi + notifikasi).
