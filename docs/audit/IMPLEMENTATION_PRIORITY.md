# Implementation Priority

**Report Date:** 2026-08-04
**Engagement:** Analysis-only audit (no code, config, or data was modified)
**Effort Legend:** **S** ≤ 1 day · **M** 1–3 days · **L** > 3 days

**Companion Reports:**
- [IMPLEMENTATION_STATUS_REPORT.md](./IMPLEMENTATION_STATUS_REPORT.md)
- [FEATURE_COMPLETION_MATRIX.md](./FEATURE_COMPLETION_MATRIX.md)
- [GAP_ANALYSIS_REPORT.md](./GAP_ANALYSIS_REPORT.md)
- [DOCUMENTATION_DRIFT_REPORT.md](./DOCUMENTATION_DRIFT_REPORT.md)

---

## P0 — Critical (must fix immediately)

Production blockers. The application must not be exposed publicly until all P0 items are resolved.

| # | Item | Evidence File | Effort | Risk if Skipped | Dependencies |
|---|---|---|---|---|---|
| P0-1 | Auth-gate AI endpoints: `POST /api/ai/extract-receipt-image`, `POST /api/gemini/extract-transaction`, `POST /api/gemini/monthly-report` (currently only IP-keyed rate limits) | AI route files (`server/routes/`) | S | Unauthenticated Vertex AI usage → unbounded cost + abuse; no per-user attribution | None |
| P0-2 | Auth-gate `POST /api/agent-search/sync-docs` (anonymous trigger of GCS/Discovery writes) | agent-search route file | S | Anonymous writes to cloud storage + discovery index | None |
| P0-3 | Remove OAuth `refreshToken` from `GET /api/gmail/token` response; add expiry check + server-side refresh; stop client `sessionStorage` caching | gmail route file; `src/services/gmailService.ts` | M | Refresh-token theft via XSS/storage → full Gmail account compromise | None |
| P0-4 | Fix notifications pagination: `notificationService.ts:29` drops `offset` → "load more" returns duplicates | `src/services/notificationService.ts` | S | Broken core UX; duplicate data presented to user | None |

**Recommended order:** P0-1 → P0-2 (same session, identical pattern) → P0-3 → P0-4.

---

## P1 — High (before production)

| # | Item | Evidence File | Effort | Risk if Skipped | Dependencies |
|---|---|---|---|---|---|
| P1-1 | Global 401/session-expiry handling in `config/api.ts` (expiry trigger currently only wired in `gmailService.ts`) | `src/config/api.ts`, `src/services/gmailService.ts` | S | Users operate on stale sessions outside Gmail flows; confusing silent failures | None |
| P1-2 | Body validation on all 35 CRUD routes + pino error logging (constraint failures currently → 500 with raw `err.message`; domain-route errors never logged) | All 11 route files in `server/routes/` | L | Internal error details leaked to clients; zero observability on write-path failures | None |
| P1-3 | SMTP alert channel: implement in `alertNotifier.js` **or** correct the README claim (webhook + in-app only today; `nodemailer` only in `gmailNotifier.js`) | `server/services/alertNotifier.js`, README | S (doc fix) / M (implement) | Operations relies on a documented capability that doesn't exist | None |
| P1-4 | Guard forged `metadata.source='gmail_review'` on `POST /api/notifications` (currently fires operator webhook + SMTP) | notification route file | S | Any authenticated client can spam operator alerting channels | None |

**Recommended order:** P1-4 (cheapest security win) → P1-1 → P1-3 (doc-correction decision first) → P1-2 (largest effort).

---

## P2 — Medium

| # | Item | Evidence File | Effort | Risk if Skipped | Dependencies |
|---|---|---|---|---|---|
| P2-1 | Client SSE handlers for `wallet:changed`, `goal:changed`, `subscription:changed`, `gmail:log`, `connected` (server emits; client listens but never handles) | SSE client hook; `transactionRoutes.js:235` (working pattern reference) | M | Stale Professional Suite data across tabs/devices | None |
| P2-2 | Professional Suite edit UI + loading states + error surfacing (errors currently silently yield empty arrays); also implement `adoptNotificationDedupeKey` no-op stub | `ProfessionalSuitePage`, `notificationService.ts` | M | Feature perceived as broken; silent data loss perception | P2-1 |
| P2-3 | E2E gap closure: Recurring, Professional Suite, Receipt OCR, Auth flow, Profile, Settings, Privacy, AI Search page UI, Monitoring UI, Landing/Splash; unit tests for `vertexContext`/`metricsService` core/`agentSearchService`/routes; extend rate-limit E2E beyond `authLimiter`; contract tests beyond GET | `e2e/`, `tests/unit/` | L | Regressions on shipped surfaces; P0/P1 fixes unverifiable | After P0/P1 |
| P2-4 | Dead-table cleanup recommendation: `users`, `user_sessions`, `profiles`, `admin_metrics` (0 reads/writes; domain FKs point at empty legacy `users`); fix FEATURE_MATRIX citation to `ai_usage_metrics`/`system_metrics` | `turso-schema.sql`, docs FEATURE_MATRIX | M | Misleading schema; FKs to dead table invite future bugs | P1-2 (FK review) |
| P2-5 | Sync `.env.example` templates: remove dead `GEMINI_API_KEY`/`GEMINI_HTTP_REFERER`/`VITE_FUNCTIONS_BASE_URL`; fix fallback model to `gemini-2.5-flash-lite`; add `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `ALERT_WEBHOOK_URL`, `SMTP_*`, `GMAIL_WEBHOOK_URL`, `RATE_LIMIT_*` | `server/.env.example`, root `.env.example` | S | New deployments misconfigured; dead "WAJIB" variables | None |
| P2-6 | Replace hardcoded `EXPENSE_CATEGORIES` in Budgets add-modal, Reports pie, Professional Suite with user categories | Budgets/Reports pages, `ProfessionalSuitePage` | M | Wrong category sets for non-expense entities; inconsistent UX | None |
| P2-7 | Honor or remove dead settings: `defaultCurrency` (ignored by `formatCurrency` fixed symbol), `gmailAutoConfirm` (stored, never consumed) | Settings page, `formatCurrency` util, Gmail sync flow | S | Settings UI promises capabilities that don't work | None |
| P2-8 | `alert_rules` management API + `http_5xx`/latency rules; extend `computeRate` beyond `agent_search*`/`ocr*` | `server/services/alertNotifier.js` | M | Alerting blind spots on generic server health | P1-3 |
| P2-9 | Sanitize `GET /api/gemini/health` (leaks `projectId` + credential paths); auth-gate agent-search help tab (anonymous cost vector) | gemini route file; agent-search route file | S | Infrastructure fingerprinting; anonymous cost accrual | None |

**Recommended order:** P2-5 → P2-7 → P2-9 (quick wins) → P2-1 → P2-2 → P2-6 → P2-4 → P2-8 → P2-3 (continuous).

---

## P3 — Optional

| # | Item | Evidence File | Effort | Risk if Skipped | Dependencies |
|---|---|---|---|---|---|
| P3-1 | Dead code cleanup: `sidebarNav` (`navigation.ts:66`), `CategoryBadge.tsx`, notification shim components, dashboard `selectedTransaction`, unused exports `broadcastAll`/`isTursoReady` | `src/lib/navigation.ts`, misc | M | Codebase noise; onboarding friction only | After P0–P2 |
| P3-2 | Remove dead `/landing` route (zero inbound links; `PublicLandingPage` is the real pre-login page) | Router config | S | Dead surface maintenance | None |
| P3-3 | Remove `react-hook-form` (zero usage); remove `@google/generative-ai` (root + server, 0 imports); remove root `express ^5.2.1` vestige; clean orphan `cashflow-service-account.json` + `cashflow-agent-search.env`; then align ADR-004 body | Both `package.json` files; `docs/adr/ADR-004-ai-pipeline.md` | M | Install bloat; doc-vs-dep mismatch persists | P3-1 |
| P3-4 | Docs date fixes: `docs/ai-pipeline/*` (2025 → 2026, free-tier framing), `SECURITY_AUDIT §4` stale finding, EXECUTIVE_SUMMARY route-count/line-count corrections, README SSE event list | See [DOCUMENTATION_DRIFT_REPORT.md](./DOCUMENTATION_DRIFT_REPORT.md) §2 | S | Low — cosmetic accuracy | P2-5 |
| P3-5 | Honor or remove `VITE_AGENT_SEARCH_ENABLED` / `VITE_AI_SEARCH_ROUTE_ENABLED` (zero consumers; route + sidebar unconditional) | Vite env consumers, router, sidebar | S | Flag semantics misleading operators | None |
| P3-6 | Delete superseded `scripts/verify-*.mjs` per CLUTTER_REPORT recommendation | `scripts/` | S | Clutter only | None |

---

## Consolidated Execution Order

| Phase | Items | Cumulative Goal |
|---|---|---|
| 1 (immediate) | P0-1, P0-2, P0-3, P0-4 | Close all public-exposure blockers |
| 2 (this sprint) | P1-4, P1-1, P1-3, P1-2 | Production-grade auth UX + observability + alerting honesty |
| 3 (next sprint) | P2-5, P2-7, P2-9, P2-1, P2-2 | Quick config wins + realtime completeness |
| 4 (ongoing) | P2-6, P2-4, P2-8, P2-3 | Feature polish, schema hygiene, test coverage |
| 5 (when stable) | P3-1 … P3-6 | Debt & docs cleanup |

## Verdict

After Phase 1–2 completion the application is **production-viable for personal/internal use**, consistent with the assessment in [IMPLEMENTATION_STATUS_REPORT.md](./IMPLEMENTATION_STATUS_REPORT.md) §6.
