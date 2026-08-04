# P0 Implementation Report — Phase 1 Production Hardening

| Field | Value |
|---|---|
| **Report Date** | 2026-08-04 |
| **Phase** | Phase 1 (P0) — Critical Production Hardening |
| **Status** | ✅ **PASS** — fully re-verified GREEN |
| **Scope** | 4 P0 security/correctness items + 3-way review fixes |
| **Files Changed** | 16 |
| **Supersedes** | Pre-fix P0 entries in `docs/audit/*` (historical snapshots) |
| **Cross-references** | [`docs/testing/BASELINE_REPORT.md`](../testing/BASELINE_REPORT.md) · [`docs/security/SECRET_ROTATION_PLAN.md`](../security/SECRET_ROTATION_PLAN.md) · [`docs/implementation/DOCUMENTATION_BASELINE_REPORT.md`](DOCUMENTATION_BASELINE_REPORT.md) |

---

## 1. Executive Summary

This report documents the completed **Phase 1 (P0)** production-hardening implementation for the CashFlow application. Four P0 items were implemented to close the highest-severity gaps identified by prior security and architecture audits: unauthenticated AI endpoints, an unauthenticated document-sync endpoint, unsafe Gmail token handling, and unbounded notifications pagination.

Following initial implementation, all changes were subjected to a **3-way ultra code review** (completeness / correctness / impact) on 2026-08-04. Review findings — including two critical defects — were fixed, after which the full verification suite (typecheck, unit tests, full E2E, API probes, token probes, browser validation) was re-run and confirmed **GREEN**.

The hardened posture ensures that *every state-changing or cost-incurring endpoint requires an authenticated user* (autentikasi wajib), that no Google `refreshToken` is ever exposed to the client, and that notification queries are bounded and parameterized end-to-end.

---

## 2. P0 Items Implemented

### 2.1 Overview

| ID | Title | Target | Outcome |
|---|---|---|---|
| **P0-1** | AI endpoint auth gate | `server/routes/geminiRoutes.js` | 3 POST routes gated by `requireAuth`; `GET /api/gemini/health` intentionally public |
| **P0-2** | sync-docs auth gate | `server/routes/agentSearchRoutes.js` | `POST /api/agent-search/sync-docs` requires authentication |
| **P0-3** | Gmail token hardening | `server/routes/gmailRoutes.js`, `src/services/authService.ts` | `refreshToken` no longer returned; expiry validated fail-closed; sessionStorage caching removed |
| **P0-4** | Notifications pagination | `server/routes/notificationRoutes.js`, `src/services/notificationService.ts` | Parameterized `limit`/`offset`, SQL-side filters, regression spec added |

---

### 2.2 P0-1 — AI Endpoint Auth Gate

**File:** `server/routes/geminiRoutes.js`

`requireAuth` middleware was added to the following routes:

| Endpoint | Before | After |
|---|---|---|
| `POST /api/ai/extract-receipt-image` | Anonymous multipart uploads accepted | `requireAuth` **placed before `multer`** — anonymous multipart uploads are rejected before parsing |
| `POST /api/gemini/extract-transaction` | Anonymous | `requireAuth` gated |
| `POST /api/gemini/monthly-report` | Anonymous | `requireAuth` gated |
| `GET /api/gemini/health` | Public | **Intentionally remains public** (health probe, no data access) |

**User attribution:** `req.user.id` now flows into `recordAIUsage` and the `gmail_sync_success` / `gmail_sync_failed` system metrics, enabling per-user usage tracking and quota attribution.

---

### 2.3 P0-2 — sync-docs Auth Gate

**File:** `server/routes/agentSearchRoutes.js`

`requireAuth` was added to `POST /api/agent-search/sync-docs`.

| Aspect | Detail |
|---|---|
| Prior state | Endpoint was anonymous; **each call executed a real Discovery Engine / GCS sync** (cost + side-effect risk) |
| Fix | Authentication now mandatory before sync execution |
| Contract update | `e2e/agent-search-auth.spec.ts` updated to **expect 401** for unauthenticated calls (was previously asserting "not 401") |

---

### 2.4 P0-3 — Gmail Token Hardening

**Files:** `server/routes/gmailRoutes.js`, `src/services/authService.ts`

#### Server side — `GET /api/gmail/token`

| Control | Implementation |
|---|---|
| No refreshToken exposure | The route **no longer selects or returns `refreshToken`**; response shape is `{ accessToken }` only — the SQL structurally cannot return it |
| Expiry validation | Validated via exported `parseAccessTokenExpiryMs` |
| Expiry parsing strategy | **ISO-8601 string primary** (the actual stored format per Better Auth's Kysely/SQLite adapter); numeric epoch seconds/milliseconds heuristic fallback; `null`/`undefined` treated as valid (legacy rows); **unparseable values FAIL CLOSED** |
| Clock skew tolerance | `TOKEN_EXPIRY_SKEW_MS` = 60 seconds |
| Expired token behavior | `401 token_expired` |

#### Frontend side — `src/services/authService.ts`

| Control | Implementation |
|---|---|
| sessionStorage removal | sessionStorage Google-token caching **fully removed** |
| Legacy cleanup | One-time defensive purge of the legacy `cashflow-google-provider-token` key at module load |
| In-memory cache | Retained (session-lifetime only) |
| Failure behavior | Any token fetch failure clears the cache and triggers the existing Google re-sign-in fallback |

#### Review finding on expiry logic

The 3-way review discovered that the **original expiry implementation was dead code**: it assumed a numeric epoch value, while real stored values are ISO-8601 strings — meaning expiry was never actually enforced. The logic was rewritten (ISO-primary parsing, fail-closed) and **probe-verified**: an expired ISO `accessTokenExpiresAt` now produces `401 token_expired`.

---

### 2.5 P0-4 — Notifications Pagination

**Files:** `server/routes/notificationRoutes.js`, `src/services/notificationService.ts`, `src/app/App.tsx`, `src/features/notifications/hooks/useNotifications.ts`

#### Server — `GET /api/notifications`

| Control | Implementation |
|---|---|
| `limit` | Honored with **1..100 clamp**, parameterized |
| `offset` | Honored with **≥0 clamp**, parameterized |
| Ordering | `ORDER BY created_at DESC`, with `id DESC` tiebreaker |
| Filters in SQL | `type` (whitelist-validated) and `unreadOnly`/`read` filters pushed into SQL **before** `LIMIT`/`OFFSET` — a review fix that removed prior client-side post-fetch filtering |

#### Client — `src/services/notificationService.ts`

| Change | Detail |
|---|---|
| Query transmission | `limit` / `offset` / `type` / `unreadOnly` transmitted via `URLSearchParams` |
| Error handling | Silent error-swallowing removed; `notificationExistsByDedupeKey` guards fire-and-forget triggers with `try/catch` |

#### Badge semantics preservation

The bell/dropdown fetch limit was bumped **30 → 100** in `src/app/App.tsx` and `src/features/notifications/hooks/useNotifications.ts` to preserve the prior badge semantics under the new server-side limit clamp.

#### Regression coverage

New spec **`e2e/notifications-pagination.spec.ts`** covers:

| Coverage Area | Cases |
|---|---|
| Unfiltered UI + API | No cross-page duplicates; beyond-total returns empty page; negative offset clamped |
| Filtered (`unreadOnly`) | API + UI filtered coverage |

---

## 3. Review Findings & Fixes (3-Way Ultra Review, 2026-08-04)

The 3-way review assessed **completeness**, **correctness**, and **impact**. All findings were remediated.

### 3.1 Critical

| # | Finding | Fix | Files |
|---|---|---|---|
| C-1 | `credentials: 'omit'` in `src/services/geminiService.ts` `extractWithGemini` caused the browser Gmail AI scan to hit **401** and silently degrade after the auth gate landed | Changed to `credentials: 'include'`; HTTP 401 mapped to **non-retryable** `GEMINI_UNAUTHORIZED` | `src/services/geminiService.ts`, `src/lib/geminiErrors.ts` |
| C-2 | Dead expiry check in `GET /api/gmail/token` (assumed numeric epoch; real values are ISO-8601 strings) — expiry never enforced | Rewritten with ISO-primary parsing, fail-closed, probe-verified | `server/routes/gmailRoutes.js` |

### 3.2 High

| # | Finding | Fix |
|---|---|---|
| H-1 | Filtered pagination truncation — filters applied after fetch truncated pages | Filters pushed into SQL before `LIMIT`/`OFFSET` |
| H-2 | Bell badge semantics under new limit clamp | Fetch limit bumped 30 → 100 |
| H-3 | Fire-and-forget promise rejections | `try/catch` guard around `notificationExistsByDedupeKey` triggers |
| H-4 | Documentation drift | `.kiro/specs/auth.md` + `docs/security/SECURITY_AUDIT.md` updated to the new auth contract |

### 3.3 Medium

| # | Finding | Fix |
|---|---|---|
| M-1 | Watch-mode dev server caused mid-suite restarts during E2E | `playwright.config.ts` `webServer` now uses plain `node server/index.js` with pinned `PORT` 5181 |

---

## 4. Verification Evidence

### 4.1 Final Re-Verification (2026-08-04)

| Check | Result |
|---|---|
| `tsc --noEmit` | **0 errors** |
| E2E typecheck | **0 errors** |
| Unit tests | **113 / 113 passed** (matches `docs/testing/BASELINE_REPORT.md` green baseline) |
| Full E2E suite | **45 passed / 0 failed / 0 flaky** |

### 4.2 API Probes

| Probe | Expected | Observed |
|---|---|---|
| `POST /api/ai/extract-receipt-image` (unauthenticated) | 401 | ✅ 401 |
| `POST /api/gemini/extract-transaction` (unauthenticated) | 401 | ✅ 401 |
| `POST /api/gemini/monthly-report` (unauthenticated) | 401 | ✅ 401 |
| `POST /api/agent-search/sync-docs` (unauthenticated) | 401 | ✅ 401 |
| `GET /api/gemini/health` | 200 | ✅ 200 |
| `/api/events` (unauthenticated) | 401 | ✅ 401 |

### 4.3 Token Probe

| Probe | Expected | Observed |
|---|---|---|
| Expired ISO `accessTokenExpiresAt` | `401 token_expired` | ✅ `401 token_expired` |
| Response body token fields | No `refreshToken` present | ✅ Structurally impossible (SQL does not select it) |

### 4.4 Browser Validation

| Check | Result |
|---|---|
| Login / OAuth redirect chain | ✅ Verified intact — redirect to `accounts.google.com` with correct `client_id`, `redirect_uri`, PKCE, and scope |
| Authenticated flows | Covered by the Playwright suite (no real Google credentials available in CI) |

---

## 5. Files Changed (16)

| # | File | Change Nature |
|---|---|---|
| 1 | `server/routes/agentSearchRoutes.js` | Auth gate on sync-docs |
| 2 | `server/routes/geminiRoutes.js` | Auth gates + userId attribution |
| 3 | `server/routes/gmailRoutes.js` | refreshToken removal, expiry validation (fail-closed) |
| 4 | `server/routes/notificationRoutes.js` | Parameterized pagination + SQL filters |
| 5 | `src/app/App.tsx` | Bell fetch limit 30 → 100 |
| 6 | `src/features/notifications/hooks/useNotifications.ts` | Notification fetch limit 30 → 100 |
| 7 | `src/lib/geminiErrors.ts` | `GEMINI_UNAUTHORIZED` non-retryable mapping |
| 8 | `src/services/authService.ts` | sessionStorage removal, legacy purge, cache behavior |
| 9 | `src/services/geminiService.ts` | `credentials: 'include'` |
| 10 | `src/services/notificationService.ts` | URLSearchParams query, error handling |
| 11 | `e2e/agent-search-auth.spec.ts` | Contract updated to expect 401 |
| 12 | `e2e/helpers/fixtures.ts` | Comment only |
| 13 | `e2e/notifications-pagination.spec.ts` | **New** regression spec |
| 14 | `package.json` | `dev:server` → `node --watch` (separate user-approved hardening) |
| 15 | `playwright.config.ts` | Plain `node server/index.js` webServer, pinned PORT 5181 |
| 16 | `docs/security/SECURITY_AUDIT.md` | Updated to new auth contract |

Additionally: `.kiro/specs/auth.md` updated to the new contract (gitignored, not counted in the 16 tracked changes).

---

## 6. Known Residual Notes

| Item | Note |
|---|---|
| Server-side OAuth refresh | Using the stored `refreshToken` for **server-side OAuth refresh** is a documented future improvement. Currently, expired access tokens force the user through Google re-consent via the existing re-sign-in fallback. |
| Historical audit snapshots | Audit reports in `docs/audit/` still list the pre-fix P0 state. They are retained as **historical snapshots** and are **superseded by this report**. |

---

## 7. Verdict

| Criterion | Status |
|---|---|
| All 4 P0 items implemented | ✅ |
| 3-way review findings remediated (2 critical, 4 high, 1 medium) | ✅ |
| Typecheck clean (`tsc --noEmit`, E2E typecheck) | ✅ |
| Unit tests match green baseline (113/113) | ✅ |
| Full E2E green (45/0/0) | ✅ |
| API & token probes confirm hardened behavior | ✅ |
| OAuth login chain intact | ✅ |

### ✅ PASS

Phase 1 (P0) production hardening is **complete and verified GREEN**. **Phase 2 (P1) is unblocked** and may proceed.

---

*Report generated 2026-08-04. See also: [`docs/testing/BASELINE_REPORT.md`](../testing/BASELINE_REPORT.md), [`docs/security/SECRET_ROTATION_PLAN.md`](../security/SECRET_ROTATION_PLAN.md), [`docs/implementation/DOCUMENTATION_BASELINE_REPORT.md`](DOCUMENTATION_BASELINE_REPORT.md).*
