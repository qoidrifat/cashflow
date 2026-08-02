# CF-055 — Patch Report

## Summary
Added an admin drill-down page at `/admin/monitoring/:feature` that lists
per-call history from `ai_usage_metrics`, with a status filter, sanitized error
logs for failed calls, and server-side pagination. Reuses CF-053 monitoring
infrastructure and admin auth.

## Files Modified
| File | Change |
|------|--------|
| `server/services/metricsService.js` | Added `FAILED_STATUSES`, `sanitizeErrorMessage()`, `getFeatureCalls()`; exported new fns |
| `server/index.js` | Added `GET /api/admin/metrics/feature/:feature/calls` (admin-guarded) |
| `src/types/metrics.ts` | Added `FeatureCall`, `FeatureCallsResponse`, `FeatureCallStatus` |
| `src/services/adminMetrics.ts` | Added `fetchFeatureCalls()` |
| `src/pages/admin/MonitoringPage.tsx` | Feature health cards now clickable + keyboard accessible → navigate to detail |
| `src/components/ui/Card.tsx` | Pass-through `role`/`tabIndex`/`onKeyDown`/`aria-label` |
| `src/app/router.tsx` | Registered lazy route `admin/monitoring/:feature` |

## Files Added
| File | Purpose |
|------|---------|
| `src/pages/admin/FeatureDetailPage.tsx` | Drill-down detail page |
| `docs/feat-admin-monitoring-feature-detail-history/*.md` | Documentation |

## API Contract
`GET /api/admin/metrics/feature/:feature/calls`
- Query: `status` (all|success|failed), `from`, `to` (ISO, default 30d), `page`,
  `page_size` (default 20, max 100).
- Auth: `Authorization: Bearer <supabase token>`; admin email required.
- Response:
  ```json
  {
    "ok": true,
    "feature": "agent_search",
    "summary": { "feature": "...", "totalCalls": 0, "successRate": 0, "failureCount": 0, "avgTimeMs": 0 },
    "page": 1, "pageSize": 20, "total": 0,
    "items": [{
      "id": "...", "createdAt": "...", "provider": "...", "model": "...",
      "promptTokens": 0, "completionTokens": 0, "totalTokens": 0,
      "costIdr": 0, "executionTimeMs": null, "status": "error",
      "errorMessage": "sanitized...", "metadata": {}
    }]
  }
  ```

## UX
- Summary cards (total calls, success rate, failures, avg time).
- Status tabs: Semua / Berhasil / Gagal (resets to page 1 on change).
- History table (responsive grid; desktop header row, mobile stacked).
- Failed rows expandable → sanitized error log + provider/model.
- Loading skeleton, empty state (status-aware), error state (403-aware), retry.
- "Kembali" + Refresh buttons. Dark mode via Tailwind `dark:`.

## Security / Privacy
- Admin-only (`resolveAdmin`, ADMIN_EMAILS).
- `sanitizeErrorMessage` removes paths, JWTs, bearer tokens, API keys, secrets,
  stack frames; caps 400 chars. `error_message` null for success rows.
- `sanitizeMetadata` applied per row.

## Validation Results
| Check | Command | Result |
|-------|---------|--------|
| Type-check | `npx tsc -p tsconfig.json --noEmit` | ✅ Exit 0 |
| Build | `npx vite build` | ✅ Built in ~13.6s; `FeatureDetailPage` chunk emitted |
| Server syntax | `node --check server/index.js` | ✅ Exit 0 |
| Service syntax | `node --check server/services/metricsService.js` | ✅ Exit 0 |
| Lint | n/a | No lint script in package.json (N/A) |
| Unit tests | n/a | No test script in package.json (N/A) |

## Remaining Risks
- Pagination uses `count: 'exact'`; on very large tables this adds query cost.
  Acceptable for current volume; can switch to estimated count later.
- Detail page is reachable only via known FEATURES; unknown slugs show a
  friendly "Fitur tidak dikenal" error.
