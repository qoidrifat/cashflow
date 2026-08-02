# CF-055 — Feature Detail History: Flow Analysis

## Objective
Add an admin drill-down page at `/admin/monitoring/:feature` showing per-call
history from `ai_usage_metrics`, with a status filter (Semua / Berhasil / Gagal),
sanitized error logs for failed calls, and pagination. Reuses CF-053 monitoring
infrastructure.

## Request Flow

```
Admin clicks a feature health card (MonitoringPage)
        ↓
navigate(`/admin/monitoring/:feature`)            src/pages/admin/MonitoringPage.tsx
        ↓
Route match (createBrowserRouter, inside AuthGuard/AppLayout)
                                                   src/app/router.tsx
        ↓
FeatureDetailPage mounts, reads :feature           src/pages/admin/FeatureDetailPage.tsx
        ↓
fetchFeatureCalls(feature, { status, page, pageSize })
                                                   src/services/adminMetrics.ts
        ↓
GET /api/admin/metrics/feature/:feature/calls?status&page&page_size&from&to
   - Authorization: Bearer <supabase access_token>
        ↓
resolveAdmin(req) → verify JWT email ∈ ADMIN_EMAILS   server/index.js
        ↓
metricsService.getFeatureCalls({ feature, status, from, to, page, pageSize })
                                                   server/services/metricsService.js
        ↓
Supabase query on ai_usage_metrics (range pagination + count: 'exact')
   - filter by feature
   - status: success → eq('status','success')
             failed  → in('status', ['error','timeout','rate_limited'])
   - order created_at desc, .range(from, to)
        ↓
Map rows → sanitize error_message + metadata
        ↓
{ ok, feature, summary, page, pageSize, total, items[] }
        ↓
Render: summary cards, status tabs, history table, expandable error rows, pagination
```

## Key Functions
- `MonitoringPage` feature health cards: now `role=button`, keyboard-accessible,
  navigate to detail.
- `FeatureDetailPage`: `useParams` for `:feature`, status tab state, page state,
  expandable error rows.
- `adminMetrics.fetchFeatureCalls`: builds query string, reuses shared `getJson`.
- `metricsService.getFeatureCalls`: paginated query + `getFeatureHealth` summary.
- `metricsService.sanitizeErrorMessage`: strips paths/tokens/JWT/keys/stack.

## Data Source
`ai_usage_metrics` (CF-053 migration `20260622000000_create_monitoring_tables.sql`).
RLS deny-by-default; server uses service-role client. Admin gate enforced in
`resolveAdmin`.
