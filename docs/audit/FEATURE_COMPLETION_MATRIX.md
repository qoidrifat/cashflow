# Feature Completion Matrix

**Report Date:** 2026-08-04
**Engagement:** Analysis-only audit (no code, config, or data was modified)

**Legend:** ✅ Complete · 🟡 Partial · 🔴 Missing · ⚫ Deprecated/Dead · ⚪ Unverifiable

**Companion Reports:**
- [IMPLEMENTATION_STATUS_REPORT.md](./IMPLEMENTATION_STATUS_REPORT.md)
- [GAP_ANALYSIS_REPORT.md](./GAP_ANALYSIS_REPORT.md)
- [DOCUMENTATION_DRIFT_REPORT.md](./DOCUMENTATION_DRIFT_REPORT.md)
- [IMPLEMENTATION_PRIORITY.md](./IMPLEMENTATION_PRIORITY.md)

---

## Master Matrix

| # | Feature | Status | Evidence (file paths) | Gap | Recommendation |
|---|---|---|---|---|---|
| 1 | Authentication | ✅ | `LoginPage`, `AuthCallbackPage`, `AuthGuard`, `src/services/authService.ts` (10s session poll), Better Auth server config | Session-expiry trigger wired only in `gmailService.ts`, not global in `config/api.ts` | Wire global 401/session-expiry handler in `config/api.ts` (P1) |
| 2 | Authorization | ✅ | Ownership checks (`WHERE user_id=?`) on ALL user-data routes across 11 route files | 3 AI endpoints + agent-search `sync-docs` lack `requireAuth` | Add `requireAuth` to AI/agent-search write endpoints (P0) |
| 3 | Dashboard | ✅ | Dashboard page (exemplary skeleton/error/empty states) | Dead `selectedTransaction` state; no-op header search; quickActions `?add=` deep link unconsumed | Remove dead state; implement or remove header search; consume `?add=` (P3/P2) |
| 4 | Transactions | ✅ | Transactions page (838 lines; all 4 types; duplicate detection) | Type filter lacks transfer/refund chips; `?add=` param ignored | Add missing filter chips; honor `?add=` (P2) |
| 5 | Categories | ✅ | Categories page | No loading/error UI | Add loading/error states (P2) |
| 6 | Budgets | ✅ | Budgets page with Smart Recommendations | No error UI; add-modal hardcodes `EXPENSE_CATEGORIES` | Error UI; use user categories (P2) |
| 7 | Reports | ✅ | Reports page (PDF export; AI monthly report) | Silent catch; hardcoded `EXPENSE_CATEGORIES` in pie chart | Surface errors; dynamic categories (P2) |
| 8 | Notifications | 🟡 | `src/services/notificationService.ts`, Notifications page, SSE realtime | **BUG:** `notificationService.ts:29` drops `offset` → "load more" duplicates; `fetchNotifications` silently returns `[]`; `adoptNotificationDedupeKey` no-op stub; page not in Sidebar | Fix offset passthrough (P0); implement dedupe key; add Sidebar link |
| 9 | Recurring | ✅ | Recurring page (pause/resume, process-now); auto due-processing in `App.tsx` | Toast-only error handling | Add proper error states (P2) |
| 10 | Wallet | 🟡 | `ProfessionalSuitePage` (add + delete only; zod validation) | No edit UI; no loading state; errors silently yield empty arrays; no client SSE handler for `wallet:changed` | Edit UI + states (P2); SSE handler (P2) |
| 11 | Saving Goals | 🟡 | `ProfessionalSuitePage` (add + delete only) | No edit UI; no loading state; silent empty-array errors; `goal:changed` SSE unhandled | Edit UI + states (P2); SSE handler (P2) |
| 12 | Subscriptions | 🟡 | `ProfessionalSuitePage` (add + delete only) | No edit UI; no loading state; silent empty-array errors; `subscription:changed` SSE unhandled | Edit UI + states (P2); SSE handler (P2) |
| 13 | Gmail Sync | ✅ | Gmail Sync UI (~2,300 lines; review queue; 60s auto-sync; ETA; retry states); `server/services/gmailNotifier.js` | `gmailAutoConfirm` setting stored but never consumed | Consume or remove `gmailAutoConfirm` (P2) |
| 14 | Receipt OCR | ✅ | Receipt OCR UI (7-step state machine; camera capture; image compression via `imageCompression.ts`) | No E2E coverage; endpoint unauthenticated | P0 auth fix; E2E later (P2) |
| 15 | AI Search | ✅ | AI Search page | `VITE_AGENT_SEARCH_ENABLED` / `VITE_AI_SEARCH_ROUTE_ENABLED` env flags DEAD (zero consumers); route + sidebar unconditional | Wire flags or remove them (P2/P3) |
| 16 | Agent Search | 🟡 | `server/services/agentSearchService`, agent-search routes | Env-flagged default off but flags are DEAD; `sync-docs` anonymous (GCS/Discovery writes); help tab anonymous (cost vector) | Auth-gate write endpoints (P0); honor or remove flags |
| 17 | Vertex AI Pipeline | ✅ | `server/lib/vertexContext.js`, receipt/transaction/monthly-report endpoints (service account) | Endpoints lack `requireAuth` (IP-keyed rate limits only); no unit tests for `vertexContext` | Add auth (P0); unit tests (P2) |
| 18 | Gemini | 🟡 | `geminiRoutes` (health + extraction) | Health leaks `projectId` + credential paths; legacy fallback path vs Vertex reality | Sanitize health payload (P1); consolidate on Vertex (P3) |
| 19 | Discovery Engine | ✅ | Agent Search discovery service (ADR-006) | Only reachable via agent-search surface | Keep; document (P3) |
| 20 | Monitoring | ✅ | Admin Monitoring page (403 special-case exists); `server/services/metricsService` | Unreachable from navigation (direct URL only) | Add admin nav entry or keep documented URL (P2) |
| 21 | Metrics | ✅ | `ai_usage_metrics`, `system_metrics` tables; metrics service | FEATURE_MATRIX doc falsely cites dead `admin_metrics` table; no unit tests for metrics core | Fix doc (P2); add tests (P2) |
| 22 | Alerts | 🟡 | `server/services/alertNotifier.js` | README claims SMTP alerting but only webhook + in-app implemented; no `http_5xx`/latency rules; `computeRate` understands only `agent_search*`/`ocr*`; `alert_rules` seed-only (no management API) | Implement SMTP channel or correct docs (P1); rules API (P2) |
| 23 | Realtime (SSE) | 🟡 | `/api/events`; server emitter for `transaction:deleted` at `transactionRoutes.js:235` | Client listens but never handles: `connected`, `wallet:changed`, `goal:changed`, `subscription:changed`, `gmail:log` | Implement client handlers (P2) |
| 24 | Settings | ✅ | Settings page | Dead settings: `defaultCurrency` ignored by `formatCurrency` (fixed symbol); `gmailAutoConfirm` never consumed | Honor or remove dead settings (P2) |
| 25 | Admin | ✅ | Admin Monitoring + admin cache/metrics routes (`e2e/admin-cache.spec.ts`, `e2e/admin-metrics-auth.spec.ts`) | Unreachable from nav | Nav entry (P2) |
| 26 | User Profile | ✅ | Profile page | No E2E coverage | Add E2E (P2) |
| 27 | Cloud Storage | ✅ | GCS upload in agent-search sync (service account) | `sync-docs` anonymous | Auth-gate (P0) |
| 28 | Background Sync | ✅ | Gmail background sync (60s auto-sync; history-based) | `gmailAutoConfirm` dead | See #13 |
| 29 | Performance | ✅ | Performance test plan (`e2e/performance/`, `docs/performance/`) | ⚪ No executed performance results verifiable | Run & record baseline (P3) |
| 30 | Security | 🟡 | Parameterized SQL + whitelists; CORS/helmet/cookies solid; SSE user isolation correct | 4 unauthenticated endpoints; refreshToken to browser; forged notification metadata; health leak | P0/P1 fixes per [IMPLEMENTATION_PRIORITY.md](./IMPLEMENTATION_PRIORITY.md) |
| 31 | Privacy | ✅ | Privacy page | No E2E coverage | Add E2E (P2) |
| 32 | Deployment / CI | ⚪ | `.github/workflows/` present | Pipeline behavior not verified in this audit | Verify workflow coverage (P3) |
| 33 | Testing | 🟡 | `tests/unit/` (62 files); `e2e/` (24 specs + contract/performance/visual) | No unit tests for `vertexContext`/`metricsService` core/`agentSearchService`/routes; E2E missing for Recurring, Professional Suite, Receipt OCR, Auth flow, Profile, Settings, Privacy, AI Search UI, Monitoring UI, Landing/Splash; rate-limit E2E covers `authLimiter` only; contract tests GET-only | Close gaps per priority (P2) |
| 34 | Landing / Splash | 🟡 | `/landing` route; `PublicLandingPage` | `/landing` dead route (zero inbound links); `PublicLandingPage` is the real pre-login page | Remove dead route (P3) |
| 35 | Professional Suite (overall) | 🟡 | `ProfessionalSuitePage` (only zod consumer) | No edit UI, no loading states, silent errors, hardcoded `EXPENSE_CATEGORIES`, no dedicated documentation | Composite fix (P2) |

---

## Status Summary

| Status | Count | Share |
|---|---|---|
| ✅ Complete | 22 | 63% |
| 🟡 Partial | 12 | 34% |
| 🔴 Missing (as standalone features) | 0 | 0% |
| ⚫ Deprecated/Dead | 0 tracked as features (dead items inventoried in [GAP_ANALYSIS_REPORT.md](./GAP_ANALYSIS_REPORT.md) §6) | — |
| ⚪ Unverifiable | 1 | 3% |

> Note: Missing items (global 401 handling, CRUD input validation, SMTP alert channel, `alert_rules` API, client SSE handlers) are recorded as gaps against existing features rather than standalone rows, consistent with the audit scope. See [IMPLEMENTATION_STATUS_REPORT.md](./IMPLEMENTATION_STATUS_REPORT.md) §3.3.
