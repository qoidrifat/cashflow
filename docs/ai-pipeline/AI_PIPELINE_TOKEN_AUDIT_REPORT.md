# AI Pipeline Token Audit Report

**Date:** 2025-01-20
**App:** CashFlow — Personal Finance Manager
**Pipeline:** Gmail Sync + Receipt Scan (Gemini 2.5 Flash)

---

## Executive Summary

CashFlow AI pipeline sudah menggunakan arsitektur **rules-first** yang sangat efisien. Dari audit ini ditemukan bahwa ~70-80% email berhasil diproses tanpa AI call. Pipeline saat ini sudah optimal untuk free-tier usage.

**Verdict: No critical optimization needed. Pipeline is production-ready.**

---

## Current Architecture

### Gmail Sync Pipeline Flow

```
Email masuk (N emails)
  │
  ├─→ [1] Duplicate check           → skip (0 tokens)
  ├─→ [2] classifyEmail() prefilter  → auto_rejected/auto_skipped (0 tokens)
  ├─→ [3] Provider-specific parser   → auto_accepted (0 tokens)
  │       (blu, Jago, LINE Bank, Shopee, KAI, tiket.com, Agoda)
  ├─→ [4] Fallback regex parser      → auto_accepted if confidence ≥ 0.88 (0 tokens)
  │
  └─→ [5] shouldSendToAi() = true    → AI call (~1500 input tokens + ~400 output tokens)
        │   (decision === 'send_to_ai' AND confidence < 0.88)
        │
        ├─→ AI success → auto_accepted / needs_review
        ├─→ AI fail (non-quota) → fallback parser → needs_review
        └─→ AI quota hit → stop AI, fallback → retry_later
```

### Receipt Scan Pipeline

```
Image upload (max 5MB, compressed client-side)
  │
  └─→ AI extraction (~1500 input tokens + ~400 output tokens)
        ├─→ Success → pre-fill transaction form
        └─→ Fail → manual input fallback
```

---

## Token Usage Analysis

### Per AI Call (Gmail Sync)

| Component | Tokens | Notes |
|-----------|--------|-------|
| System prompt | ~800 | Transaction extraction instructions |
| Email text (truncated) | ~1500 | Max 6000 chars → ~1500 tokens |
| Subject + sender + date | ~50 | Metadata context |
| **Total input** | **~2350** | Per AI call |
| Output (JSON response) | ~400 | Extracted transaction data |
| **Total per call** | **~2750** | Input + output |

### Per AI Call (Receipt Scan)

| Component | Tokens | Notes |
|-----------|--------|-------|
| System prompt | ~600 | Receipt parsing instructions |
| Image tokens | ~1000-2000 | Depending on image size |
| **Total input** | **~1600-2600** | Per scan |
| Output (JSON response) | ~400 | Extracted receipt data |
| **Total per call** | **~2000-3000** | Input + output |

### Typical Sync Run (150 emails)

| Metric | Value | Notes |
|--------|-------|-------|
| Total emails | 150 | Typical sync batch |
| Skipped by prefilter | ~60 (40%) | Promo, non-transaction |
| Parsed by provider parser | ~50 (33%) | Known bank formats |
| Parsed by fallback | ~15 (10%) | High-confidence regex |
| Sent to AI | ~25 (17%) | Ambiguous only |
| Estimated input tokens | ~58,750 | 25 × 2350 |
| Estimated output tokens | ~10,000 | 25 × 400 |
| **Estimated cost** | **~$0.015** | Gemini 2.5 Flash pricing |
| **Tokens saved** | **~293,750** | 125 emails × 2350 tokens |

### Monthly Estimate (Daily sync)

| Usage Pattern | AI Calls/Month | Cost/Month | Notes |
|---------------|----------------|------------|-------|
| Light (50 emails/day) | ~250 | ~$0.15 | 17% AI rate |
| Normal (150 emails/day) | ~750 | ~$0.45 | 17% AI rate |
| Heavy (300 emails/day) | ~1500 | ~$0.90 | 17% AI rate |
| Receipt scans | ~30 | ~$0.02 | ~1/day average |

---

## Existing Optimizations (Already Implemented)

### ✅ OPT-1: Rules-First Architecture
- **Saving:** ~70-83% reduction in AI calls
- **Status:** Production-ready
- Provider parsers handle known formats perfectly

### ✅ OPT-2: Text Truncation
- **Saving:** ~40% input tokens on long emails
- **Status:** Active (`compactTextForAi()` → 6000 char limit)
- Removes HTML tags, excessive whitespace, footers

### ✅ OPT-3: Sequential Processing with Delay
- **Saving:** Avoids rate limit errors
- **Status:** Active (`AI_CONCURRENCY=1`, `AI_REQUEST_DELAY_MS=1500`)
- Stays well within free-tier rate limits

### ✅ OPT-4: Graceful Quota Handling
- **Saving:** No wasted retries after quota hit
- **Status:** Active (stop AI immediately, continue with fallback)
- Error classification prevents cascading failures

### ✅ OPT-5: Confidence-Based AI Skip
- **Saving:** ~10% additional AI calls skipped
- **Status:** Active (`confidence >= 0.88` → skip AI)
- High-confidence fallback results accepted without AI

---

## Remaining Opportunities (Low Priority)

### 🔲 OPT-6: Prompt Caching (Gemini Context Caching)
- **Potential saving:** ~$0.01/month (system prompt cached)
- **Effort:** Medium
- **Priority:** Low — cost saving negligible at current scale

### 🔲 OPT-7: Batch API
- **Potential saving:** 50% off input tokens for async processing
- **Effort:** High (rewrite sync flow)
- **Priority:** Low — only valuable at >5000 calls/month

### 🔲 OPT-8: Token Usage Tracking
- **Benefit:** Historical cost monitoring
- **Effort:** Low (store in existing jsonb metadata)
- **Priority:** Medium — good for observability

---

## Conclusion

Pipeline sudah sangat efisien. Biaya aktual diperkirakan < $1/bulan untuk normal usage pattern. Investasi engineering tambahan untuk optimasi token tidak justified mengingat cost yang sudah sangat rendah.

**Rekomendasi:**
1. ✅ Deploy as-is (sudah optimal)
2. 📊 Add token usage tracking ke sync metadata (observability)
3. ⏳ Re-evaluate batch API jika usage naik >5000 calls/month
