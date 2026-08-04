# CashFlow — Technical Architecture

> Verified against source code **2026-08-03**. This document describes the **current** architecture: Better Auth + Turso + Google Cloud AI.

---

## 1. System Overview

```
┌─────────────────────────────── Client ───────────────────────────────┐
│  React 18 SPA (Vite) · Zustand · Tailwind · SSE client               │
│  Port 5180 (dev) · Dark/light · Mobile responsive                    │
└────────────────────────────────┬─────────────────────────────────────┘
                                 │ HTTP + SSE
┌────────────────────────────────▼─────────────────────────────────────┐
│                        Express 4 API · Port 5181                     │
│  ├─ Better Auth (Google OAuth, DB sessions, req.user)                │
│  ├─ Observability: request-ID → pino logs → HTTP metrics             │
│  ├─ Rate limiting (auth) · Helmet · CORS · Multer                    │
│  ├─ Domain routes: transactions · budgets · categories · gmail ·     │
│  │   notifications · recurring · wallets · goals · subscriptions ·   │
│  │   admin/metrics · agent-search · gemini · ai                      │
│  └─ AI resilience: LRU cache + single-flight + backoff retry         │
└───────────────┬──────────────────┬───────────────────┬───────────────┘
                │                  │                   │
     ┌──────────▼─────┐   ┌────────▼────────┐   ┌──────▼──────────────┐
     │  Turso (libSQL)│   │ Google Cloud    │   │ SSE Hub             │
     │  22 tables     │   │ Gemini/Vertex   │   │ (realtime push)     │
     │  Kysely        │   │ Discovery Engine│   │                     │
     │  backup/restore│   │ Gmail API       │   │                     │
     └────────────────┘   │ Cloud Storage   │   └─────────────────────┘
                          └─────────────────┘
```

---

## 2. Frontend (React SPA)

- **Entry:** `src/main.tsx` → `src/app/App.tsx` → router (`src/app/router.tsx`): public routes (`/landing`, `/login`) + 16 protected routes (dashboard, transactions, budgets, recurring, reports, professional, suite/ai-search, gmail-sync, categories, notifications, profile, settings, privacy, admin/monitoring, …).
- **State:** Zustand stores (`src/store/`) — auth, app/session, session-expiry.
- **Styling:** Tailwind design system; `src/lib/theme.ts` toggles light/dark; `src/styles/globals.css`.
- **API layer:** typed service modules (`src/services/*`) calling the Express API; `src/lib/sse.ts` for realtime.
- **AI client-side:** Gemini parser/fallback helpers (`src/lib/geminiParser.ts`, `geminiFallbackParser.ts`), confidence scorer, gmail classifiers, promo-cashback classifier, receipt pipeline (`src/services/receiptScanService.ts`).

---

## 3. Backend (Express 4)

- **Bootstrap:** `server/index.js` — middleware chain, route mounting, SSE hub, alert scheduler, graceful shutdown (SIGINT/SIGTERM).
- **Auth:** `server/lib/auth.js` — Better Auth instance; Google social provider; `BETTER_AUTH_SECRET` (dev fallback guarded by log warning); `useSecureCookies` in production; `trustedOrigins` from env.
- **Middleware:** `server/middleware/authMiddleware.js` (session → `req.user`; admin gate via `ADMIN_EMAILS`), `observabilityMiddleware.js` (request-ID, pino, HTTP metrics).
- **Routes:** `server/routes/` — transactionRoutes, budgetRoutes, categoryRoutes, gmailRoutes, notificationRoutes, professionalSuiteRoutes, recurringRoutes; plus inline admin/metrics, agent-search, gemini, ai, health endpoints.
- **Services:** `server/services/agentSearchService.js` (Discovery Engine), `metricsService.js` (aggregation), etc.
- **AI context:** `server/lib/vertexContext.js` — Gemini/Vertex invocation with timeout, quota mapping, exponential-backoff retry; LRU response cache + single-flight dedup.
- **Realtime:** `server/lib/sse.js` — SSE hub broadcasting notification events.

---

## 4. Database (Turso / libSQL)

- **Client:** `@libsql/client` + `@libsql/kysely-libsql` (Kysely query builder).
- **Schema:** `turso-schema.sql` — 22 tables:

| Group | Tables |
|---|---|
| Better Auth core | `user`, `session`, `account`, `verification` |
| User domain | `users`, `user_sessions`, `profiles` |
| Finance | `categories`, `transactions`, `budgets`, `recurring_transactions` |
| Gmail | `gmail_sync_logs`, `gmail_sync_settings`, `gmail_sync_runs` |
| Wealth | `wallet_accounts`, `saving_goals`, `subscriptions` |
| Engagement | `notifications` |
| Observability | `admin_metrics`, `ai_usage_metrics`, `system_metrics`, `alert_rules` |

- **Indexes:** transaction pagination (source/date), gmail logs `sync_run_id`.
- **Ops:** `scripts/applyTursoSchema.mjs` (apply), `scripts/seedE2eDataset.mjs` (deterministic CI seed), `scripts/backupTurso.mjs` (scheduled dumps + restore runbook).

---

## 5. Authentication & Authorization

1. User clicks "Sign in with Google" → Better Auth OAuth redirect → callback creates DB session.
2. Session cookie (httpOnly) set; `useSecureCookies: true` in production.
3. Every API request → `authMiddleware` resolves session → `req.user`.
4. Admin routes additionally check `req.user.email ∈ ADMIN_EMAILS` → 401 (anonymous) / 403 (non-admin).
5. Rate limiting protects `/api/auth/*` (429 on burst) — isolated test server on port 5182 verifies behavior deterministically.

---

## 6. AI Layer

| Concern | Mechanism |
|---|---|
| Extraction | Gemini (primary/fallback models) parses emails/receipts to structured candidates |
| Classification | `gmailClassifier.ts` + `confidenceScorer.ts` — auto-accept vs needs-review |
| Search | Discovery Engine agent search over 3 data stores + sync endpoints |
| Reports | Gemini monthly report from aggregated transactions |
| Resilience | LRU cache (stats API), single-flight dedup, backoff retry on quota/timeout |
| Cost/monitoring | Every call records feature, user, tokens, latency → `ai_usage_metrics` |

---

## 7. Realtime (SSE)

- Server: SSE hub in `server/lib/sse.js`; events pushed on notification writes (e.g., Gmail review results).
- Client: `src/lib/sse.ts` EventSource with reconnect; `realtimeConnected` indicator (WifiOff icon) drives deterministic E2E gates.

---

## 8. Observability & Monitoring

- **Request path:** request-ID middleware → pino structured log → HTTP metrics (4xx/5xx/latency) → `system_metrics` snapshots.
- **Feature metrics:** per-feature call counts (`admin_metrics`) — endpoint `/api/admin/metrics/feature/:feature/calls`.
- **AI usage:** tokens/latency/cost per call (`ai_usage_metrics`) — `/api/admin/metrics/ai-usage`.
- **Cache:** hit/miss rate — `/api/admin/metrics/cache`.
- **Alerts:** `alert_rules` evaluated by in-process scheduler → webhook (`ALERT_WEBHOOK_URL`) and SMTP channels with cooldown (`ALERT_COOLDOWN_MINUTES`).
- **Dashboard:** `/admin/monitoring` (admin-only) renders summary, feature health, alerts, cache panel.

---

## 9. Deployment & CI

- **Local dev:** Vite `:5180` + API `:5181` (`npm run dev:all`).
- **Production:** `npm run build` → static bundle; API served by Express; secrets via env/secret manager.
- **CI (`.github/workflows/e2e.yml`):** 4 jobs — quality (lint/typecheck/build), E2E (stability gate 3×, seeded CI Turso DB), visual regression (10 snapshots, Ubuntu), performance budget (5 metrics). Artifacts: HTML reports, traces, screenshots, perf JSON.
- **Backup:** scheduled `backupTurso.mjs` + documented restore runbook.

---

## 10. Known Boundaries (documented debt)

- `server/index.js` still holds ~1650 lines; domain route modules exist and extraction continues.
- ~~Unused `@supabase/supabase-js` dependency + `supabase/` archive~~ — ✅ removed 2026-08-03.
- ~~`firebaseUser` naming remnant across ~15 files~~ — ✅ renamed to `authUser` 2026-08-03 (25 files, 0 remnants).
- See `docs/architecture/`, `docs/security/`, `docs/performance/` and `docs/enterprise/` for the full debt inventory.
