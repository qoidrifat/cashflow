# CF-055 — Implementation Plan

## Current State (pre-CF-055)
- `/admin/monitoring` shows aggregate cost/health (CF-053).
- Feature health cards are static (no drill-down).
- No per-call API; `ai_usage_metrics.error_message` never surfaced.

## Target State
- Clickable feature health cards → `/admin/monitoring/:feature`.
- Detail page: summary header, status filter (Semua/Berhasil/Gagal), paginated
  call history table, expandable sanitized error logs, loading/empty/error
  states, dark mode, mobile-responsive, "Kembali" button.

## Required Changes
1. **Backend service** (`metricsService.js`)
   - `FAILED_STATUSES = ['error','timeout','rate_limited']`.
   - `sanitizeErrorMessage(message)` — strip paths/tokens/JWT/keys/stack, cap 400.
   - `getFeatureCalls({ feature, status, from, to, page, pageSize })` — paginated
     query (`range` + `count: 'exact'`), reuse `getFeatureHealth` for summary,
     sanitize error_message + metadata. Returns
     `{ feature, summary, page, pageSize, total, items }`.
   - Export both in default object.
2. **Backend endpoint** (`server/index.js`)
   - `GET /api/admin/metrics/feature/:feature/calls` guarded by `resolveAdmin`,
     validate `feature ∈ FEATURES`, `status ∈ {all,success,failed}`, parse
     `page`/`page_size`, default 30-day range.
3. **Types** (`src/types/metrics.ts`) — `FeatureCall`, `FeatureCallsResponse`,
   `FeatureCallStatus`.
4. **API client** (`adminMetrics.ts`) — `fetchFeatureCalls`.
5. **MonitoringPage** — cards clickable + keyboard accessible.
6. **Card** — accept `role`/`tabIndex`/`onKeyDown`/`aria-label`.
7. **FeatureDetailPage** — new page.
8. **Router** — register `admin/monitoring/:feature` (lazy).

## Alternatives Considered
- Modal on the dashboard instead of a route: rejected — a dedicated route gives
  shareable URLs, back-button support, and cleaner pagination state.
- Returning raw `error_message`: rejected for privacy; always sanitize.

## Rollback Strategy
- Revert the 8 touched/added files. New route is additive; no schema change.
- No migration involved (reuses CF-053 `ai_usage_metrics`).

## Testing Strategy
- `npx tsc -p tsconfig.json --noEmit` (type-check).
- `npx vite build` (production build).
- `node --check` on both server files.
- No unit/lint scripts exist in package.json (documented N/A).
