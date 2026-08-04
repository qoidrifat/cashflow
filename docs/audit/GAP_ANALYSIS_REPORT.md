# Gap Analysis Report

**Report Date:** 2026-08-04
**Engagement:** Analysis-only audit (no code, config, or data was modified)

**Companion Reports:**
- [IMPLEMENTATION_STATUS_REPORT.md](./IMPLEMENTATION_STATUS_REPORT.md)
- [FEATURE_COMPLETION_MATRIX.md](./FEATURE_COMPLETION_MATRIX.md)
- [DOCUMENTATION_DRIFT_REPORT.md](./DOCUMENTATION_DRIFT_REPORT.md)
- [IMPLEMENTATION_PRIORITY.md](./IMPLEMENTATION_PRIORITY.md)

---

## 1. Executive Summary

CashFlow is approximately 90% feature-complete. The gaps that remain fall into five clusters:

1. **Security gaps (P0/P1)** — unauthenticated AI endpoints, OAuth refreshToken exposure, forged-notification metadata, health-endpoint leakage. These are the only true production blockers.
2. **Missing infrastructure capabilities** — global 401/session-expiry handling, CRUD input validation with error logging, SMTP alert channel, `alert_rules` management API.
3. **Partial features** — Notifications (pagination bug), Professional Suite (no edit UI, no states), Gemini (legacy leakage), Landing (dead route).
4. **Documentation drift** — `.env.example` templates, architecture doc, quota strategy doc, and README SSE claims diverge from the code (details in [DOCUMENTATION_DRIFT_REPORT.md](./DOCUMENTATION_DRIFT_REPORT.md)).
5. **Technical debt** — dead code, dead tables, dead env flags, vestigial dependencies (`react-hook-form`, `@google/generative-ai`, root `express ^5.2.1`).

---

## 2. Missing Features

| # | Missing Capability | Evidence of Absence | Impact |
|---|---|---|---|
| M1 | Global session-expiry / 401 handling | Session-expiry trigger wired only in `gmailService.ts`; no global handler in `config/api.ts` | Users stay on stale sessions outside Gmail flows |
| M2 | Input validation on 35 CRUD routes | Zero body validation across all 11 route files; constraint failures → HTTP 500 with raw `err.message` | Poor error UX; leaked internals; no observability (errors never logged via pino) |
| M3 | SMTP alert channel | README claims SMTP alerting; `server/services/alertNotifier.js` implements webhook + in-app only; `nodemailer` only in `server/services/gmailNotifier.js` | Doc-vs-reality mismatch; no email alerting |
| M4 | Alert rules for `http_5xx` / latency | No rules; `computeRate` understands only `agent_search*` / `ocr*` metrics | Silent failures on generic server errors |
| M5 | `alert_rules` management API | Seed-only table; no CRUD routes | Rules cannot be tuned at runtime |
| M6 | Client SSE handlers for `connected`, `wallet:changed`, `goal:changed`, `subscription:changed`, `gmail:log` | Client listens but never handles these events | Multi-tab/multi-device staleness in Professional Suite |
| M7 | Unit tests for `vertexContext`, `metricsService` core, `agentSearchService`, routes | Absent from `tests/unit/` | Regressions undetected in AI/metrics core |
| M8 | E2E for Recurring, Professional Suite, Receipt OCR, Auth flow, Profile, Settings, Privacy, AI Search UI, Monitoring UI, Landing/Splash | Absent from `e2e/` | Coverage holes on shipped surfaces |
| M9 | Transfer/refund filter chips in Transactions | Type filter omits both chips | Users cannot filter all 4 types |
| M10 | `?add=` deep-link consumption | Dashboard quickActions emits `?add=`; Transactions/Dashboard ignore it | Broken quick-add intent |
| M11 | Notifications page in Sidebar | Page exists but no Sidebar entry | Feature undiscoverable |
| M12 | Admin Monitoring in navigation | Direct URL only (403 special-case exists) | Admin surface hidden |

---

## 3. Partial Features

### 3.1 Notifications 🟡

| Aspect | Detail |
|---|---|
| Exists | `src/services/notificationService.ts`, Notifications page, SSE realtime flow, `e2e/notifications-realtime.spec.ts` |
| Missing / Broken | **BUG:** `notificationService.ts:29` drops `offset` → "load more" returns duplicates; `fetchNotifications` silently returns `[]` on error; `adoptNotificationDedupeKey` is a no-op stub; page not linked in Sidebar; `POST /api/notifications` allows forged `metadata.source='gmail_review'` firing operator webhook + SMTP |

### 3.2 Professional Suite (Wallet / Saving Goals / Subscriptions) 🟡

| Aspect | Detail |
|---|---|
| Exists | `ProfessionalSuitePage` — add + delete for all three entities; `zod` validation (only zod usage in the app) |
| Missing | Edit UI; loading states; error surfacing (errors silently produce empty arrays); consumption of server-emitted `wallet:changed` / `goal:changed` / `subscription:changed` SSE events; hardcoded `EXPENSE_CATEGORIES`; no dedicated documentation |

### 3.3 Gmail Sync UI 🟡 (minor)

| Aspect | Detail |
|---|---|
| Exists | ~2,300-line UI: review queue, 60s auto-sync, ETA, retry states; server background sync + history |
| Missing | `gmailAutoConfirm` setting is stored but never consumed anywhere |

### 3.4 AI Search / Agent Search 🟡

| Aspect | Detail |
|---|---|
| Exists | AI Search page functional; agent-search service env-flagged default off (ADR-006) |
| Missing | `VITE_AGENT_SEARCH_ENABLED` / `VITE_AI_SEARCH_ROUTE_ENABLED` have ZERO consumers — route + sidebar render unconditionally; `POST /api/agent-search/sync-docs` anonymous (GCS/Discovery writes); help tab anonymous (cost vector) |

### 3.5 Gemini 🟡

| Aspect | Detail |
|---|---|
| Exists | Health + extraction endpoints |
| Missing | `GET /api/gemini/health` leaks `projectId` + credential paths; code reality is Vertex service-account, Gemini framing is legacy |

### 3.6 Landing / Splash 🟡

| Aspect | Detail |
|---|---|
| Exists | `/landing` route registered; `PublicLandingPage` |
| Missing | `/landing` has zero inbound links (dead route); `PublicLandingPage` is the real pre-login page |

### 3.7 Reports / Budgets / Categories / Recurring (minor UI gaps)

| Feature | Gap |
|---|---|
| Reports | Silent catch on AI monthly report; hardcoded `EXPENSE_CATEGORIES` in pie |
| Budgets | No error UI; add-modal hardcodes `EXPENSE_CATEGORIES` |
| Categories | No loading/error UI |
| Recurring | Toast-only error handling |

---

## 4. Architecture Drift

| Area | Claimed / Designed | Actual | Severity |
|---|---|---|---|
| Server entry structure | `docs/system/ARCHITECTURE.md`: "inline endpoints", "~1650 lines" | Extracted route modules (11 files); `server/index.js` ≈ 510 lines | MEDIUM |
| Route module count | EXECUTIVE_SUMMARY: "12 route modules" | 11 route files | LOW |
| Alerting | README: SMTP alerting | Webhook + in-app only (`alertNotifier.js`) | MEDIUM |
| Metrics source | FEATURE_MATRIX cites `admin_metrics` | Real metrics in `ai_usage_metrics` / `system_metrics`; `admin_metrics` dead (0 r/w) | MEDIUM |
| Agent Search gating | Env-flagged default off | Flags dead; route + sidebar unconditional | HIGH (security-adjacent) |
| Database FKs | Domain tables FK to `users` | Legacy `users` table empty (Better Auth owns identity) — FKs point at dead table | MEDIUM |
| SSE events | README: "gmail events (sync completed/review needed)" | Only `gmail:log` exists | LOW |
| AI provider | ADR-004 body lists `@google/generative-ai` | Vertex service-account reality; dep still in both `package.json` with 0 imports | LOW |

---

## 5. Documentation Drift

Full detail in [DOCUMENTATION_DRIFT_REPORT.md](./DOCUMENTATION_DRIFT_REPORT.md). Highlights:

| Doc | Issue | Severity |
|---|---|---|
| `server/.env.example` | `GEMINI_API_KEY` marked WAJIB (dead); wrong fallback model (`gemini-2.0-flash` vs code `gemini-2.5-flash-lite`); `GEMINI_HTTP_REFERER` dead; missing `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN`/`ALERT_WEBHOOK_URL`/`SMTP_*`/`GMAIL_WEBHOOK_URL`/`RATE_LIMIT_*` | HIGH |
| Root `.env.example` | Dead `GEMINI_API_KEY` guidance + `VITE_FUNCTIONS_BASE_URL` | HIGH |
| `docs/system/ARCHITECTURE.md` | Inline-endpoints claim wrong; "~1650 lines" vs actual 510 | MEDIUM |
| `docs/gmail-sync/GEMINI_QUOTA_AND_FALLBACK_STRATEGY.md` | `GEMINI_*` codes vs `VERTEX_*` reality; API-key advice contradicts service-account-only | MEDIUM |
| README SSE section | Gmail events that don't exist | LOW |
| `SECURITY_AUDIT §4` | `resolveAdmin` finding stale | LOW |

---

## 6. Technical Debt

### 6.1 Dead Code (frontend)

| Item | Location |
|---|---|
| `sidebarNav` | `navigation.ts:66` |
| `CategoryBadge.tsx` | Unused component |
| Notification shim components | Unused |
| `/landing` route | Registered, zero inbound links |
| Dashboard `selectedTransaction` state | Dead |
| `VITE_AGENT_SEARCH_ENABLED`, `VITE_AI_SEARCH_ROUTE_ENABLED` | Zero consumers |

### 6.2 Dead Tables (database)

| Table | Status |
|---|---|
| `users` | 0 reads/writes; legacy — Better Auth owns identity; domain FKs point here |
| `user_sessions` | 0 reads/writes |
| `profiles` | 0 reads/writes |
| `admin_metrics` | 0 reads/writes; FEATURE_MATRIX falsely cites it |

### 6.3 Dead Environment Variables

| Variable | Status |
|---|---|
| `GEMINI_API_KEY` | Unused (marked WAJIB in `server/.env.example`) |
| `GEMINI_HTTP_REFERER` | Unused |
| `VITE_FUNCTIONS_BASE_URL` | Unused |

### 6.4 Vestigial Dependencies & Files

| Item | Status |
|---|---|
| Root `express ^5.2.1` | Server runs Express 4.22.2; root copy unused |
| `@google/generative-ai` (root + server) | 0 imports |
| `react-hook-form` | ZERO usage (zod used only in `ProfessionalSuitePage`) |
| Orphan files | `cashflow-service-account.json`, `cashflow-agent-search.env` |
| Unused exports | `broadcastAll`, `isTursoReady` |
| Superseded scripts | `scripts/verify-*.mjs` (delete-recommendation per CLUTTER_REPORT) |

### 6.5 Silent Failure Patterns

| Location | Pattern |
|---|---|
| `notificationService.ts` | `fetchNotifications` returns `[]` on error |
| Professional Suite services | Errors silently yield empty arrays |
| Reports AI monthly report | Silent catch |
| Domain route handlers | Errors never logged via pino; raw `err.message` in 500 |

---

## 7. Priority, Effort, Dependencies & Recommended Order

Effort: **S** ≤ 1 day · **M** 1–3 days · **L** > 3 days. Full per-item detail in [IMPLEMENTATION_PRIORITY.md](./IMPLEMENTATION_PRIORITY.md).

| Order | Item | Priority | Effort | Dependencies |
|---|---|---|---|---|
| 1 | Auth-gate AI endpoints + `sync-docs` | P0 | S | None |
| 2 | Remove refreshToken from browser; server-side refresh | P0 | M | None |
| 3 | Fix notifications `offset` pagination bug | P0 | S | None |
| 4 | Global 401/session-expiry handler in `config/api.ts` | P1 | S | None |
| 5 | CRUD input validation + pino error logging | P1 | L | None |
| 6 | SMTP alert channel or doc correction | P1 | S (docs) / M (impl) | None |
| 7 | Forged-notification metadata guard | P1 | S | None |
| 8 | Client SSE handlers (`wallet/goal/subscription:changed`, `gmail:log`, `connected`) | P2 | M | None |
| 9 | Professional Suite edit UI + loading/error states | P2 | M | #8 |
| 10 | E2E gap closure | P2 | L | None |
| 11 | Dead-table cleanup recommendation & migration | P2 | M | #5 (FK review) |
| 12 | `.env.example` templates sync | P2 | S | None |
| 13 | Replace hardcoded `EXPENSE_CATEGORIES` | P2 | M | None |
| 14 | Honor or remove `defaultCurrency` / `gmailAutoConfirm` | P2 | S | None |
| 15 | `alert_rules` management API + `http_5xx`/latency rules | P2 | M | #6 |
| 16 | Dead code / dead route / `react-hook-form` / vestigial deps cleanup | P3 | M | After P0–P2 settle |
| 17 | Docs date fixes & remaining drift | P3 | S | #12 |
