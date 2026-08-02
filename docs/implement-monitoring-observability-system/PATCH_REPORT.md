# Patch Report: CF-053 Monitoring & Observability

## Files Created / Modified

| File | Type | Description |
|------|------|-------------|
| `supabase/migrations/20260622000000_create_monitoring_tables.sql` | migration | ai_usage_metrics, system_metrics, alert_rules + indexes + RLS + seed |
| `server/config/metricsConfig.js` | config | AI pricing, USD_TO_IDR, features, alert defaults, getAdminEmails |
| `server/services/metricsService.js` | feature | record + query + health + alerts (non-blocking) |
| `server/index.js` | instrumentation + endpoints | generateVertexContent token capture, agent search metrics, gmail metrics, 5 admin endpoints, requireAdmin |
| `server/.env.example` | config | ADMIN_EMAILS, USD_TO_IDR |
| `src/types/metrics.ts` | types | AIUsageSummary, MetricsSummary, FeatureHealth, AlertStatus, etc |
| `src/services/adminMetrics.ts` | api client | fetch summary/ai-usage/feature-health/alerts |
| `src/pages/admin/MonitoringPage.tsx` | page | dashboard: cards, trend chart, breakdown, health, alerts |
| `src/app/router.tsx` | routing | /admin/monitoring route |
| `.kiro/specs/monitoring.md` | spec | behavior contract + Tahap 1/6 docs |

## Architecture Decisions

1. **Admin via ADMIN_EMAILS env** (no role column) — simplest, no migration to profiles.
2. **Token capture at `generateVertexContent`** — single chokepoint, captures usageMetadata for gmail_sync/ocr_receipt/insight_generator.
3. **Agent Search = count/latency only** — Discovery Engine REST exposes no token data.
4. **RLS deny-by-default** — metrics tables have RLS enabled with no permissive policy; only service role accesses.
5. **Non-blocking recording** — all `recordX().catch(() => {})`.

## Validation Results

| Check | Status | Notes |
|-------|--------|-------|
| type-check (tsc --noEmit) | ✓ PASS | 0 errors |
| build (vite build) | ✓ PASS | 12s |
| server syntax (node --check) | ✓ PASS | index.js, metricsService.js, metricsConfig.js |
| lint | ⚠️ N/A | no lint script in package.json |

## Risk Level: LOW
- Migration is additive (CREATE TABLE only, no ALTER on existing).
- Instrumentation is fire-and-forget; cannot break features.
- Admin endpoints guarded; RLS blocks non-service-role access.

## Backward Compatible: YES
- No existing API/schema changed.
- AI helper functions accept optional params (default null) — existing calls unaffected.

## Manual Steps Remaining
1. Run the migration on Supabase.
2. Set `ADMIN_EMAILS` in `server/.env`.
3. Verify: trigger Gmail Sync/OCR/Search → rows appear; non-admin gets 403.
