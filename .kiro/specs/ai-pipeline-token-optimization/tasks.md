# Tasks: AI Pipeline Token Optimization

## Phase 1: Token Estimator Utility

- [x] 1.1 Create `src/utils/aiTokenEstimator.ts` with token estimation functions
- [x] 1.2 Implement `estimateTokensFromText()` — chars-to-tokens approximation
- [x] 1.3 Implement `estimateTokensFromImageBytes()` — receipt image token estimation
- [x] 1.4 Implement `estimateGeminiCost()` — USD cost calculation
- [x] 1.5 Implement `buildAiUsageSummary()` — aggregate sync run statistics
- [x] 1.6 Implement format helpers (`formatCostUsd`, `formatTokenCount`)
- [x] 1.7 Verify TypeScript compilation passes

## Phase 2: Documentation

- [x] 2.1 Create `docs/ai-pipeline/AI_PIPELINE_TOKEN_AUDIT_REPORT.md`
- [x] 2.2 Create `docs/ai-pipeline/AI_PIPELINE_OPTIMIZATION_CHECKLIST.md`
- [x] 2.3 Document current pipeline architecture and optimization state
- [x] 2.4 Document remaining optimization opportunities

## Phase 3: Build Verification

- [x] 3.1 Run `npx tsc -p tsconfig.json --noEmit` — no type errors
- [x] 3.2 Run `npx vite build` — production build succeeds

## Phase 4: Future Integration (Not in this PR)

- [ ] 4.1 Add AI usage tracking to `processEmailBatch()` in gmail sync
- [ ] 4.2 Store `ai_usage` metadata in `gmail_sync_runs.metadata` jsonb
- [ ] 4.3 Display AI usage summary in sync result dialog
- [ ] 4.4 Evaluate Gemini prompt caching for system prompt
- [ ] 4.5 Evaluate Gemini Batch API for background sync
