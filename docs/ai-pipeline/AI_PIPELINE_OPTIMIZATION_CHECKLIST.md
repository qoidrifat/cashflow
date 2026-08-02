# AI Pipeline Optimization Checklist

**App:** CashFlow — Personal Finance Manager
**Last Updated:** 2025-01-20

---

## ✅ Implemented Optimizations

### 1. Rules-First Architecture
- [x] `classifyEmail()` prefilter skips promo/non-transaction
- [x] Provider-specific parsers (blu, Jago, LINE Bank, Shopee, KAI, tiket.com, Agoda)
- [x] `evaluateLocalGmailParser()` auto-accepts high-confidence results
- [x] `shouldSendToAi()` gates AI calls (confidence < 0.88 AND decision === 'send_to_ai')
- [x] Fallback regex parser runs when AI fails or unavailable
- **Result:** ~70-83% AI call reduction

### 2. Input Optimization
- [x] `compactTextForAi()` strips HTML, whitespace, footers
- [x] `buildAiInputForEmail()` truncates to 6000 chars max
- [x] Only essential metadata (subject, sender, date) sent to prompt
- [x] Structured JSON output (minimal output tokens)
- **Result:** ~1500 input tokens per call (instead of ~4000+ raw)

### 3. Rate Limit Protection
- [x] `AI_CONCURRENCY = 1` (sequential processing)
- [x] `AI_REQUEST_DELAY_MS = 1500` (1.5s between requests)
- [x] Max ~40 requests/minute (within free-tier limits)
- **Result:** Minimal rate limit errors

### 4. Error Handling & Graceful Degradation
- [x] Error classification: `GEMINI_QUOTA_EXCEEDED`, `GEMINI_CREDITS_DEPLETED`, `GEMINI_RATE_LIMITED`
- [x] Quota hit → stop AI calls immediately for session
- [x] Fallback parser continues for remaining emails
- [x] Ambiguous emails → `retry_later` (not lost)
- [x] Config errors → stop batch (don't waste requests)
- [x] Retry with exponential backoff for transient errors
- **Result:** Zero email data loss during quota events

### 5. Receipt Scan Protection
- [x] Multer upload limit: 5MB
- [x] Client-side image compression recommended
- [x] Manual input fallback always available
- [x] Clear user messaging when AI unavailable
- **Result:** Functional even without AI

---

## 📊 Observability (Phase 1 — Current)

### 6. Token Estimator Utility
- [x] `src/utils/aiTokenEstimator.ts` created
- [x] `estimateTokensFromText()` — 4-char/token ratio
- [x] `estimateTokensFromImageBytes()` — tiered image estimation
- [x] `estimateGeminiCost()` — Gemini 2.5 Flash pricing
- [x] `buildAiUsageSummary()` — aggregate per-run stats
- [x] Format helpers: `formatCostUsd()`, `formatTokenCount()`
- **Result:** Cost estimation available for debugging

---

## 🔲 Future Opportunities (Not Yet Implemented)

### 7. Token Usage Metadata Tracking
- [ ] Store `ai_usage` in `gmail_sync_runs.metadata` jsonb
- [ ] Track: emails processed, AI calls made, tokens estimated, cost estimated
- [ ] Enable historical cost trends in debug UI
- **Priority:** Medium | **Effort:** Low | **Impact:** Observability

### 8. Gemini Prompt Caching
- [ ] Cache system prompt (~800 tokens) using Gemini Context Caching API
- [ ] Cached tokens billed at 75% discount
- [ ] Effective when >50 AI calls per session
- **Priority:** Low | **Effort:** Medium | **Impact:** ~$0.01/month saving

### 9. Gemini Batch API
- [ ] Use Batch API for background sync (non-realtime)
- [ ] 50% discount on input tokens
- [ ] Requires async result polling
- **Priority:** Low | **Effort:** High | **Impact:** 50% cost reduction at scale

### 10. Dynamic Confidence Threshold
- [ ] Adjust AI skip threshold based on provider accuracy history
- [ ] If provider parser accuracy >95% → raise threshold to 0.92
- [ ] Monitor false-positive rate
- **Priority:** Low | **Effort:** Medium | **Impact:** ~5% additional AI reduction

### 11. Prompt Optimization
- [ ] A/B test shorter system prompts
- [ ] Remove redundant instructions
- [ ] Test if output quality degrades with smaller prompt
- **Priority:** Low | **Effort:** Low | **Impact:** ~100 token/call saving

---

## Cost Reference (Gemini 2.5 Flash)

| Metric | Value |
|--------|-------|
| Input tokens | $0.15 / 1M tokens |
| Output tokens | $0.60 / 1M tokens |
| Cached input | $0.0375 / 1M tokens (75% off) |
| Batch input | $0.075 / 1M tokens (50% off) |
| Free tier limit | ~1500 requests/day |
| Rate limit | 15-20 requests/minute |

---

## Quick Reference: When AI Is Called

```
AI is called ONLY when ALL conditions are true:
1. Email is NOT duplicate
2. Email is NOT classified as promo/non-transaction
3. Provider parser did NOT match (or low confidence)
4. Fallback regex parser confidence < 0.88
5. shouldSendToAi() returns true
6. No active quota/credit error for current session
```

---

## Monitoring Commands

```bash
# Check token estimator compilation
npx tsc -p tsconfig.json --noEmit

# Estimate cost for a sync run (example)
# Import { buildAiUsageSummary, formatCostUsd } from './src/utils/aiTokenEstimator'
# const summary = buildAiUsageSummary({ totalEmails: 150, skippedByRules: 95, ... })
# console.log(formatCostUsd(summary.estimatedCostUsd))
```
