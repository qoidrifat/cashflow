# AI Financial Advisor (AI Coach) — Sprint 1.3

> **Status:** Implemented · **Owner:** Core Product · **ADR:** — (extends existing Gemini proxy pattern)

## Overview

The **AI Financial Advisor** is an "AI Personal Financial Coach" that turns the user's
financial data into structured, actionable recommendations. It reuses the existing
Gemini-on-Vertex-AI proxy (`/api/gemini/advisor`) and never breaks when AI is
unavailable — a deterministic rule-based fallback keeps the page fully functional.

## Architecture

```
src/features/advisor/AdvisorPage.tsx
  └─ src/services/advisorService.ts
       ├─ computeAdvisorMetrics()        — pure: summarize app data → prompt-safe metrics
       ├─ buildFallbackAdvisorReport()   — pure: deterministic rule-based coaching report
       ├─ normalizeAdvisorReport()       — pure: sanitize/repair Gemini JSON payload
       └─ generateAdvisorReport()        — POST /api/gemini/advisor (+ fallback on any failure)
            └─ server/routes/geminiRoutes.js → buildAdvisorPrompt() → generateGeminiText()
                 (feature: 'financial_advisor', per-user metric, LRU cache friendly)
```

### Data flow

1. **Client gathers data** — transactions, budgets, wallets, saving goals, and
   subscriptions for the current month (via existing services/SSE listeners).
2. **`computeAdvisorMetrics`** — deterministic aggregation: income, expense,
   expense ratio, savings rate, 3-month averages, top category/merchant, budget
   usage, subscription monthly costs (weekly/quarterly/yearly → monthly), goals
   progress, total balance. **No raw PII / full transaction list** leaves the client.
3. **Server validates + sanitizes** — `validateMetricsObject` clamps negative/NaN
   numbers, caps string lengths, whitelists known fields (anti prompt-injection of
   merchant/category/subscription names); `validateSubscriptionsArray` keeps only
   `{ name ≤120, monthlyCost ≥0 }`, max 100 items.
4. **Gemini generates structured JSON** — `buildAdvisorPrompt` instructs exact JSON:
   summary, spendingAdvice[], savingStrategy[], budgetStrategy[],
   subscriptionOptimization[], emergencyFund{suggestion, monthsCoverage,
   targetAmount, currentAmount}, actionList[{priority, action}].
5. **`normalizeAdvisorReport`** — trims strings, caps arrays (3 items each, 5
   actions), whitelists priority (`high|medium|low`), clamps numbers; any invalid
   field falls back to the deterministic value.
6. **Fallback** — on network error, HTTP error, invalid JSON, or missing fields,
   `buildFallbackAdvisorReport` produces a complete rule-based report
   (`generatedBy: 'rule-based'` shown in the UI).

## UI (AdvisorPage — `/advisor`)

- **Hero** — summary narrative + regenerate button + provenance badge
  ("Didukung Gemini AI" vs "Rekomendasi lokal").
- **Snapshot** — income, expense, expense ratio, savings rate.
- **Advice grid** — Spending Advice · Saving Strategy · Budget Strategy ·
  Subscription Optimization (4 cards, tone-coded icons).
- **Emergency Fund** — coverage in months + progress bar toward the 6-month target
  (capped at 99+ months).
- **Action List** — numbered, priority-chipped (`Prioritas`/`Sedang`/`Opsional`).

## Security

- **No ownership risk** — the endpoint is a Gemini proxy; no DB writes; per-user
  metric scoping via `userId` on the metrics record.
- **Prompt injection defense** — sanitization strips unknown fields and caps string
  lengths; output is forced JSON + repaired/normalized; fallback covers malformed
  responses.
- **Rate limiting** — falls under existing general API limiter.

## Testing

- `tests/unit/advisorService.test.ts` — 9 tests: metrics aggregation (ratios,
  subscription cycle conversion, top category/merchant), fallback completeness
  (never throws, 6 sections, 99-month cap), normalization (trim/cap/whitelist,
  corrupt payload → full fallback, negative/NaN clamp).
- Typecheck / lint / full Vitest suite: green (372/372 at time of writing).

## Future (Sprint 2+)

- Cost tracking per advisor request (already wired via `financial_advisor` feature metric).
- Multi-model router (Gemini remains the only provider; router architecture only).
- Deeper personalization: trend-aware advice from 3/6-month history.
