# Spec: Monitoring & Observability (CF-053)

## Behavior Contract

### Metrics Recording (non-blocking)
- All AI calls record to `ai_usage_metrics` via `generateVertexContent` chokepoint.
- Feature/system metrics recorded fire-and-forget: `recordX(...).catch(() => {})`.
- If metrics DB is down, core features (Gmail Sync, OCR, Search, Insight) keep working.
- Never store PII/raw body/base64/tokens in metadata — only hash/size/category/count.

### Admin Access
- Admin = email present in `ADMIN_EMAILS` env (comma-separated).
- Verified server-side via Supabase JWT email claim in `resolveAdmin()`.
- Non-admin → HTTP 403 → dashboard shows "Akses ditolak" state.
- Metrics tables have RLS enabled with NO permissive policy → only service role reads/writes.

### Instrumented Features
| Feature | Token data | System metrics |
|---------|-----------|----------------|
| gmail_sync | ✅ usageMetadata | gmail_sync_success, gmail_sync_failed |
| ocr_receipt | ✅ usageMetadata | (status via ai_usage) |
| insight_generator | ✅ usageMetadata | (status via ai_usage) |
| agent_search | ❌ (Discovery REST, no tokens) | agent_search_count, agent_search_empty, agent_search_error, agent_search_latency |

### Alert Rules (default, seeded)
- `ai_cost_daily`: estimated_cost_idr > 50000 in 1440m
- `gmail_sync_failures`: gmail_sync_failed > 10 in 10m
- `agent_search_error_rate`: > 0.10 in 60m
- `ocr_failure_rate`: > 0.20 in 60m

## Tahap 1 — Supabase Reports (built-in, no code)

Supabase provides built-in Reports via dashboard (no implementation needed):
- **Database**: CPU, slow queries, DB size growth
- **API**: request volume, error rates
- **Auth**: login counts, active users
- **Storage / Realtime**: usage stats

Key tables to monitor via Supabase Reports:
`transactions`, `receipts`, `gmail_sync_logs`, `notifications`, `profiles`, `budgets`.

Access: Supabase Dashboard → Reports section. Use for infra-level observability
that complements the custom AI cost/health metrics built in CF-053.

## Tahap 6 — Supabase Metrics API (future, documentation only)

For future Prometheus/Grafana integration (NOT implemented in CF-053):
- Endpoint: `/customer/v1/privileged/metrics` (vendor-agnostic)
- Auth: Basic Auth with Project Ref + Service Role / metrics secret
- Scrape interval: ~60s
- Recommended visualization: Grafana Cloud Free tier

This is documented as preparation only. CashFlow's custom metrics
(`ai_usage_metrics`, `system_metrics`) cover the AI cost/health needs today.

References (rephrased for compliance with licensing restrictions):
- Supabase Metrics API: https://supabase.com/docs/guides/platform/metrics
- Supabase Reports: https://supabase.com/docs/guides/telemetry/reports/
- Vendor-agnostic Metrics: https://supabase.com/docs/guides/telemetry/metrics/vendor-agnostic

## Setup

1. Run migration `20260622000000_create_monitoring_tables.sql`
2. Set `ADMIN_EMAILS=you@example.com` in `server/.env`
3. Optionally set `USD_TO_IDR` (default 16000)
4. Restart server
5. Login as admin → visit `/admin/monitoring`

## CF-055 — Feature Detail History (drill-down)

Adds a per-feature call-history drill-down at `/admin/monitoring/:feature`.

### Behavior Contract
- Feature health cards on `/admin/monitoring` are clickable (and keyboard
  accessible) → navigate to `/admin/monitoring/:feature`.
- Detail page lists individual calls from `ai_usage_metrics` (newest first),
  default 30-day window.
- Status filter: `Semua` (all) / `Berhasil` (success) / `Gagal`
  (`error`/`timeout`/`rate_limited`). Changing filter resets to page 1.
- Failed rows expose an expandable, sanitized error log.
- Server-side pagination (`page`, `page_size` default 20, max 100).

### Endpoint
`GET /api/admin/metrics/feature/:feature/calls?status&from&to&page&page_size`
- Admin-guarded via `resolveAdmin` (ADMIN_EMAILS).
- Validates `feature ∈ FEATURES`, `status ∈ {all,success,failed}`.
- Returns `{ ok, feature, summary, page, pageSize, total, items[] }`.

### Privacy
- `error_message` sanitized (`sanitizeErrorMessage`): strips paths, JWTs, bearer
  tokens, API keys, secrets, stack frames; capped at 400 chars. Null for success
  rows. Per-row metadata re-sanitized via `sanitizeMetadata`.

### Files
- `server/services/metricsService.js` (`getFeatureCalls`, `sanitizeErrorMessage`)
- `server/index.js` (endpoint)
- `src/types/metrics.ts`, `src/services/adminMetrics.ts`
- `src/pages/admin/MonitoringPage.tsx` (clickable cards)
- `src/pages/admin/FeatureDetailPage.tsx` (new)
- `src/components/ui/Card.tsx` (a11y props), `src/app/router.tsx` (route)

Docs: `docs/feat-admin-monitoring-feature-detail-history/`.
