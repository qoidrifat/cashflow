# Design: AI Pipeline Token Optimization

## Overview

CashFlow AI pipeline sudah menggunakan arsitektur rules-first yang efisien. Design ini menambahkan observability layer berupa token estimator utility dan usage summary — tanpa mengubah pipeline logic yang sudah berjalan.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Existing Pipeline                     │
│  Email → Prefilter → Provider Parser → Fallback → AI    │
└──────────────────────────┬──────────────────────────────┘
                           │ (no changes)
                           ▼
┌─────────────────────────────────────────────────────────┐
│              NEW: Observability Layer                     │
│                                                          │
│  ┌─────────────────┐  ┌──────────────────────────┐     │
│  │ aiTokenEstimator│  │  AiUsageSummary builder  │     │
│  │                 │  │                          │     │
│  │ • estimateTokens│  │ • buildAiUsageSummary()  │     │
│  │ • estimateCost  │  │ • formatCostUsd()        │     │
│  │ • formatHelpers │  │ • formatTokenCount()     │     │
│  └─────────────────┘  └──────────────────────────┘     │
└─────────────────────────────────────────────────────────┘
```

## Component Design

### 1. Token Estimator Utility (`src/utils/aiTokenEstimator.ts`)

Pure utility module — no side effects, no imports from existing services.

#### Functions

| Function | Input | Output | Purpose |
|----------|-------|--------|---------|
| `estimateTokensFromText(text)` | string | number | Estimate tokens using 4-char ratio |
| `estimateTokensFromImageBytes(bytes)` | number | number | Estimate tokens for receipt image |
| `estimateGeminiCost(options)` | TokenOptions | CostEstimate | Calculate USD cost |
| `buildAiUsageSummary(stats)` | SyncStats | AiUsageSummary | Aggregate sync run stats |
| `formatCostUsd(cost)` | number | string | Format cost for display |
| `formatTokenCount(tokens)` | number | string | Format token count (K/M) |

#### Interfaces

```typescript
interface TokenEstimate {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

interface CostEstimate {
  model: string;
  inputTokens: number;
  outputTokens: number;
  inputCostUsd: number;
  outputCostUsd: number;
  totalCostUsd: number;
}

interface AiUsageSummary {
  totalCalls: number;
  skippedByRules: number;
  parsedByFallback: number;
  sentToAi: number;
  aiSkippedDueQuota: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedCostUsd: number;
  savedAiCalls: number;
  estimatedTokensSaved: number;
}
```

#### Constants

| Constant | Value | Basis |
|----------|-------|-------|
| `GEMINI_FLASH_INPUT_COST_PER_MILLION` | $0.15 | Gemini 2.5 Flash pricing |
| `GEMINI_FLASH_OUTPUT_COST_PER_MILLION` | $0.60 | Gemini 2.5 Flash pricing |
| `CHARS_PER_TOKEN` | 4 | Approximation for mixed ID/EN text |
| `AVERAGE_AI_OUTPUT_TOKENS` | 400 | Typical JSON extraction response |

### 2. AI Usage Metadata (Future Integration)

Store di `gmail_sync_runs.metadata` jsonb field (sudah ada):

```json
{
  "ai_usage": {
    "total_emails": 150,
    "skipped_by_rules": 95,
    "parsed_by_fallback": 25,
    "sent_to_ai": 30,
    "estimated_cost_usd": 0.0023,
    "estimated_tokens_saved": 45000
  }
}
```

Tidak butuh migration — gunakan existing jsonb column.

### 3. Debug UI Summary (Future)

Tampilkan di sync result dialog:
- "AI dipanggil 30x dari 150 email (80% dihemat rules)"
- "Estimasi biaya: $0.002"
- "Token dihemat: ~45K tokens"

## Design Decisions

### D1: Pure Utility, No Pipeline Coupling
Token estimator adalah standalone utility. Tidak import dari services, tidak modify existing code. Bisa digunakan kapan saja tanpa risiko.

### D2: Approximation Over Precision
Menggunakan 4-char/token ratio (bukan tiktoken) karena:
- Tidak butuh dependency tambahan
- Akurasi ±20% sudah cukup untuk cost monitoring
- Mixed Indonesian/English text rata-rata sesuai

### D3: No Real-Time Tracking (Phase 1)
Phase 1 hanya utility functions. Integration ke sync pipeline (storing metadata) adalah phase 2 — butuh testing lebih lanjut.

### D4: Pricing as Constants
Hardcode pricing constants (bukan env vars) karena:
- Jarang berubah
- Hanya estimasi, bukan billing
- Mudah update saat pricing berubah

## Dependencies

- None (pure TypeScript utility)
- No external packages needed
- No database changes needed

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Pricing changes | Low | Update constants, no functional impact |
| Token ratio inaccuracy | Low | ±20% acceptable for monitoring |
| Unused utility | None | Zero runtime cost if not called |
