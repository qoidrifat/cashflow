# Changelog

All notable changes to **CashFlow** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **GitHub collaboration layer** — `CONTRIBUTING.md`, `CHANGELOG.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, issue/PR templates, and `dependabot.yml` (repository curation, 2026-08-04).
- **CI secret scan** — Gitleaks job in `.github/workflows/e2e.yml` (full-history scan, pinned binary v8.30.1, license-free; 8 known findings allowlisted in `.gitleaksignore`) — GITHUB_READINESS score 98 → 100.

### Security

- Archived Google API key literal scrubbed from review documents; `.agents/`, `.kiro/`, `skills-lock.json`, `task-list.md` and debug artifacts removed from tracking; `.gitignore` hardened (repository curation, 2026-08-04).

## [1.0.0] - 2026-08-04

Initial enterprise baseline. Full-stack AI-native personal finance platform: React 18 + Vite + Express 5 + Better Auth + Turso (libSQL) + Google Vertex AI / Gemini / Discovery Engine / Gmail API.

### Added

- **Gmail sync & review flow** — inbox scanning, AI classification (Gemini), confidence scoring, "Perlu Review" queue, approve / reject / duplicate / amount-missing handling with realtime notifications.
- **Gmail review notification channels** — in-app bell (SSE push) + webhook (Slack/Discord/generic) + SMTP email, so users know results even when the app is closed.
- **AI features** — receipt OCR (photo → transaction draft), Discovery Engine agent search (transactions/gmail/receipts data stores), monthly AI insights & financial advisor.
- **AI resilience** — LRU response cache with hit/miss metrics, single-flight dedup for identical concurrent requests (anti thundering-herd), exponential-backoff retry for `VERTEX_QUOTA_EXCEEDED` / `VERTEX_TIMEOUT`, fallback parser.
- **Observability** — pino structured logging, request-ID middleware with `metricMeta` correlation, HTTP metrics (4xx/5xx/latency), feature & AI usage metrics, alert rules with webhook/SMTP channels + 60s scheduler.
- **Admin monitoring** — `/admin/monitoring` dashboard: summary cards, feature health, AI usage, system metrics, AI response-cache panel, cache hit-rate degradation alert.
- **Hardening (Sprint 0–1)** — auth rate limiting (429) + helmet, graceful shutdown (SIGINT/SIGTERM), Turso backup/restore (`backupTurso.mjs` / `restoreTurso.mjs`, Windows Task Scheduler), dev-salt fail-fast, `@libsql/client` 0.17.4.
- **Enterprise testing** — 41 E2E tests / 14 specs (auth gates, Gmail review flows, realtime notifications, categories, admin metrics, cache panel, rate limit), 9 API contract checks (schema-drift detection), 113 unit tests, 10 visual-regression snapshots (light/dark × desktop/mobile), performance-budget suite.
- **CI pipeline** — GitHub Actions: quality gate, E2E stability gate ×3 (fail only on 3× flaky), visual regression, performance budget; CI-isolated Turso DB with deterministic seed; artifact uploads (reports, traces, screenshots, perf JSON).
- **Documentation** — enterprise documentation system: `docs/meta/` governance, 7 ADRs, `DOCUMENTATION_MAP.md` navigation hub, 21 live screenshots, enterprise modernization audit (11 docs).

### Fixed

- Gmail "Perlu Review" approve flow persisting candidate transaction + status + notification (`f0e665d`).
- Visual-regression gmail-sync CI diffs (7%/12%) by masking AutoSync card, bell badge, and content-driven email cards in snapshots.
- CI run failures — Turso schema applied before E2E seed (`no such table: user`), pinned regression guards overridable via `E2E_PINNED_*` env.
- Realtime (SSE) flakiness — deterministic `waitRealtimeConnected` gate before review actions; `testMessageId` race fixed.
- Admin auth — `resolveAdmin` / `resolveAgentSearchUser` migrated from Supabase JWT to Better Auth `req.user` + `ADMIN_EMAILS`.

### Changed

- **Migration:** Supabase → **Better Auth + Turso** (auth, database, monitoring, Gmail tokens) — Supabase project fully decommissioned.
- **Modularization:** monolithic `server/index.js` split into domain route modules (`server/routes/`, `server/services/`).
- **Tech-debt cleanup:** removed `@supabase/supabase-js` dependency, deleted `supabase/` + Firestore artifacts, renamed legacy `firebaseUser` naming → `authUser`.
- **Docs:** README enterprise rebuild + MIT license (`721559e`), documentation modernization Phase A + B (`b08659f`).

### Note

This changelog backfills the initial 45-commit history into release 1.0.0. Future releases should add an entry per notable change.

[Unreleased]: https://github.com/qoidrifat/cashflow/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/qoidrifat/cashflow/releases/tag/v1.0.0
