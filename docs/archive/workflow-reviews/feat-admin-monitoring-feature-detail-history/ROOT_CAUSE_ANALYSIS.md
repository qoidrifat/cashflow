# CF-055 — Root Cause / Gap Analysis

## Executive Summary
This is a feature addition, not a bug fix. CF-053 delivered aggregate monitoring
(cost, tokens, per-feature health) but offered no way to inspect individual AI
calls. Admins could see a feature's failure count but not *which* calls failed or
*why*. CF-055 closes that gap with a drill-down detail page.

## Gap Identified
- `MonitoringPage` showed `failureCount` per feature but no call-level detail.
- No endpoint returned per-call rows from `ai_usage_metrics`.
- `error_message` was stored (capped at 500 chars) but never surfaced to admins,
  and was not sanitized for display (risk of leaking paths/tokens if shown raw).

## Affected / Added Files
- `server/services/metricsService.js` — added `getFeatureCalls`,
  `sanitizeErrorMessage`, `FAILED_STATUSES`; exported new fns.
- `server/index.js` — added `GET /api/admin/metrics/feature/:feature/calls`.
- `src/types/metrics.ts` — added `FeatureCall`, `FeatureCallsResponse`,
  `FeatureCallStatus`.
- `src/services/adminMetrics.ts` — added `fetchFeatureCalls`.
- `src/pages/admin/MonitoringPage.tsx` — feature cards now clickable/keyboard
  accessible, navigate to detail.
- `src/pages/admin/FeatureDetailPage.tsx` — new detail page.
- `src/components/ui/Card.tsx` — pass-through `role`/`tabIndex`/`onKeyDown`/
  `aria-label` for accessible clickable cards.
- `src/app/router.tsx` — registered `admin/monitoring/:feature`.

## Security / Privacy Considerations
- Admin-only via `resolveAdmin` (ADMIN_EMAILS env), identical to CF-053 endpoints.
- `sanitizeErrorMessage` strips file paths (Windows + POSIX), JWTs, bearer
  tokens, API keys, long secrets, and stack frames; caps at 400 chars.
- `sanitizeMetadata` (existing) re-applied to each row's metadata.
- `error_message` only returned for non-success rows; success rows return null.
- No raw email body, base64, or PII is read by the query (selected columns are
  metric fields only).

## Confidence
High. Build + type-check pass; reuses proven CF-053 infra and auth path.
