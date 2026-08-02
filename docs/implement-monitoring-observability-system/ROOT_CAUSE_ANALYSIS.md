# Design Readiness Analysis: CF-053

## Executive Summary
New feature (not a bug). Implements custom AI cost/health metrics for CashFlow.
Investigation confirmed implementability with two human-decided items.

## Evidence Collected (file:line)
- AI chokepoint: `generateVertexContent()` server/index.js:785 — `response.usageMetadata` available.
- Gmail extract: `POST /api/gemini/extract-transaction` → `generateGeminiText` (server/index.js:1118).
- OCR: `POST /api/ai/extract-receipt-image` → `generateGeminiVision` (server/index.js:1023).
- Insight: `POST /api/gemini/monthly-report` → `generateGeminiText` (server/index.js:1221).
- Agent Search: `agentSearchService.js` uses Discovery Engine REST — NO token data.
- Service-role client: `getSupabaseServerClient()` server/index.js:708.
- Migration/RLS pattern: gmail_sync_runs migration (202606200004).
- Chart lib: recharts@3.8.1 (package.json:29).
- Admin role: NONE existed → built via ADMIN_EMAILS env.

## Design Decision
Capture Gemini tokens at the single `generateVertexContent` chokepoint; record
Agent Search as count/latency only; gate admin via ADMIN_EMAILS env; metrics
tables RLS deny-by-default (service-role only).

## Risks & Why Acceptable
- Non-blocking recording → cannot break features (fire-and-forget).
- Additive migration → no data risk.
- Admin via env → simple, no schema change; rotate by editing env.

## Impact
- 4 features instrumented (gmail_sync, ocr_receipt, insight_generator, agent_search).
- 1 new admin surface (/admin/monitoring) + 5 endpoints.

## Confidence Score: 90% (after human decision on admin mechanism)
## Risk Assessment: LOW
