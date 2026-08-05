# ADR-011: Fraud Detection — Architecture (Design Phase)

> **Status:** Proposed (design-only — no implementation) · **Date:** 2026-08 · **Owner:** Core Engineering · **Related:** [ADR-004](ADR-004-ai-pipeline.md), [ADR-005](ADR-005-monitoring.md)

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

## Next Steps (when approved)

1. Implement rule engine v1 (duplicate + velocity + amount outlier) as a pure module with unit tests.
2. Add `fraud_flags` column/table + flag on transaction creation.
3. Wire flagged transactions into the notification system + admin monitoring.
4. Evaluate AI scoring with a prompt-bounded call; ship behind a feature flag.
