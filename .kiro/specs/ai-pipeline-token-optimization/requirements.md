# Requirements: AI Pipeline Token Optimization

## Scope

Dokumentasi dan tooling untuk monitoring token usage pada CashFlow AI pipeline (Gmail Sync + Receipt Scan). Pipeline sudah menggunakan arsitektur rules-first yang optimal — fokus spec ini pada observability dan cost estimation.

## Current Pipeline State (Already Optimized)

### Gmail Sync — Rules-First Architecture
- `classifyEmail()` prefilter: skip promo, non-transaction emails → `auto_rejected`/`auto_skipped`
- `evaluateLocalGmailParser()`: provider-specific parsers (blu, Jago, LINE Bank, Shopee, KAI, tiket.com, Agoda) → `auto_accepted`
- `shouldSendToAi()`: hanya true jika `decision === 'send_to_ai' AND confidence < 0.88`
- Fallback regex parser ketika AI gagal
- `compactTextForAi()` + `buildAiInputForEmail()`: truncate ke 6000 chars max
- Concurrency: `AI_CONCURRENCY = 1`, `AI_REQUEST_DELAY_MS = 1500`

### Receipt Scan
- Multer upload limit: 5MB
- Rekomendasi compress di client
- Manual fallback tersedia jika AI gagal

### Error Handling
- Error codes: `GEMINI_QUOTA_EXCEEDED`, `GEMINI_CREDITS_DEPLETED`, `GEMINI_RATE_LIMITED`
- Behavior saat quota hit: stop AI calls, continue fallback, mark ambiguous as `retry_later`
- Config errors: stop batch processing entirely

## Token Estimation Requirements

### REQ-1: Token Estimator Utility
- Estimasi token count dari text (mixed Indonesian/English)
- Estimasi token dari image bytes (receipt scan)
- Cost estimation berdasarkan Gemini 2.5 Flash pricing
- Summary builder untuk aggregate stats per sync run
- Format helpers (cost USD, token count)

### REQ-2: Pricing Constants
- Gemini 2.5 Flash input: $0.15 per 1M tokens
- Gemini 2.5 Flash output: $0.60 per 1M tokens
- Approximation ratio: 1 token ≈ 4 chars (mixed ID/EN)
- Average AI output: ~400 tokens (JSON response)

### REQ-3: AI Usage Summary
- Track: total emails, skipped by rules, parsed by fallback, sent to AI, quota-skipped
- Calculate: estimated input/output tokens, cost USD
- Calculate: saved AI calls, estimated tokens saved
- Provide formatted output for debug UI

## Remaining Optimization Opportunities

### OPT-1: Prompt Caching (Future)
- Gemini supports cached context for repeated system prompts
- System prompt ~800 tokens bisa di-cache → hemat per-call cost

### OPT-2: Batch API (Future)
- Gemini Batch API for non-realtime processing
- 50% discount on input tokens
- Suitable for background sync runs

### OPT-3: Token Usage Metadata in Sync Runs (Future)
- Store estimated token usage di `gmail_sync_runs.metadata` jsonb
- Enable historical cost tracking tanpa migration

## Validation
- `npx tsc -p tsconfig.json --noEmit` pass
- `npx vite build` pass
- Token estimator functions return correct estimates
