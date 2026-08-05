# ADR-011: Fraud Detection — Architecture (Design Phase)

> **Status:** Accepted (implemented Sprint 1 — L1 full, L2 behind `FRAUD_AI_SCORING_ENABLED`) · **Date:** 2026-08 · **Owner:** Core Engineering · **Related:** [ADR-004](ADR-004-ai-pipeline.md), [ADR-005](ADR-005-monitoring.md)

## Context

CashFlow aggregates financial data (transactions, Gmail sync, receipts) into one ledger. As volume grows, users need early warning for anomalies: duplicate entries, unusual velocity, unknown merchants, and category outliers. This ADR captures the **architecture** before any code is written — the mandate for this phase is design, not implementation.

## Decision (Design)

Detect fraud in three layered stages, from cheapest to most expensive:

1. **Rule engine (deterministic, in-process)** — zero AI cost, runs on every transaction write:
   - Duplicate detection: same `gmail_message_id` / same amount+merchant+date within N days (reuses `tiketDedupe` patterns).
   - Velocity: X transactions to the same merchant within a time window; unusual daily tx count vs 30-day rolling baseline.
   - Amount outliers: tx amount > p99 of user's historical amount, or > 3× median.
   - Merchant anomalies: new merchant (never seen in user's history) with amount above threshold.
   - Category anomalies: category transitions that contradict history (e.g., income category with expense-shaped data).
2. **AI scoring (Gemini, on-demand)** — only for rule-engine flag candidates, prompt-bounded to reduce cost; returns `fraud_score 0–1` + reasons + `decision: allow | review | block`. Uses the existing resilience pipeline (`generateVertexContent` with cache/retry).
3. **Future ML integration (roadmap)** — replace heuristics with a trained model once labeled data exists; the rule layer stays as the fallback gate.

Feature engineering (for the future model and for the rules):
- Per-user aggregates: tx count/day, amount mean/median/p99, merchant entropy, category distribution, hour-of-day histogram.
- Per-merchant: first-seen date, frequency, average amount.
- Time features: gap since last tx, day-of-week, hour.

## Alternatives Considered

| Option | Reason rejected |
|---|---|
| Third-party fraud API (Stripe Radar etc.) | Cost + data leaves the ledger; overkill at this scale |
| ML-only from day one | No labeled data; unobservable; expensive |
| Heuristics-only forever | High false-positive rate; cannot catch subtle patterns |

## Consequences

**Positive:** Layered cost (rules free, AI only on flags); observable (every flag + score stored in `system_metrics`/notification); extensible to ML later without changing the interface.
**Negative:** Rule tuning requires threshold maintenance; AI scoring adds latency to flagged paths (mitigated: non-blocking, async review queue); requires notification UX for "review suspicious transaction" (reuses existing notification system).

## Implementation (Sprint 1 — accepted)

1. ✅ Rule engine v1 (`server/lib/fraudEngine.js` — duplicate/velocity/amount-outlier/new-merchant/category-anomaly, pure + 13 unit tests).
2. ✅ `fraud_flags` table + `transactions.fraud_flag/fraud_score` columns (turso-schema.sql, idempotent).
3. ✅ Wired into `POST /api/transactions` (fire-and-forget) + notification (bell/SSE, dedupe `fraud:<txId>`) + admin metric `fraud_flag_count` + alert rule seed.
4. ✅ L2 AI scoring (`server/services/fraudDetectionService.js` → `generateGeminiText`) shipped behind `FRAUD_AI_SCORING_ENABLED` (default off); failure degrades to rule verdict.
5. ✅ API `server/routes/fraudRoutes.js` (summary / flags / review) + E2E `e2e/fraud-detection.spec.ts` + widget dashboard + badge transaksi.

## Next Steps

1. Tuning threshold per-rule dari data nyata; UI halaman detail flag; ekspos skor di laporan bulanan.
