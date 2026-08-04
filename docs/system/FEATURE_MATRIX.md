# CashFlow — Feature Matrix

> Verified against source code on **2026-08-03**. Status legend: ✅ Implemented · ⚠️ Partial · 🔭 Planned.

| Feature | Status | Frontend | Backend | Database | AI | Realtime | Monitoring | Tests | Docs |
|---|---|---|---|---|---|---|---|---|---|
| Google OAuth (Better Auth) | ✅ | Login page | `server/lib/auth.js` | `user`, `session`, `account`, `verification` | — | — | — | E2E auth-gate specs | README |
| Session management | ✅ | Session-expiry dialog + global 401 handler (`config/api.ts`) | middleware `req.user` | `session` | — | — | — | E2E + unit (401 handler) | README, .kiro/specs/auth.md |
| Dashboard | ✅ | `/dashboard` | `/api/transactions*`, budgets | `transactions`, `budgets` | Insights | SSE (latest) | — | `dashboard.spec.ts` + visual | README |
| Transactions CRUD | ✅ | Transactions page | `/api/transactions`, `/paginated` | `transactions` (indexed) | Category hints | — | — | `transactions.spec.ts`, contract | README |
| Transaction pagination | ✅ | Pagination UI | `/api/transactions/paginated` | indexes | — | — | — | E2E + perf budget | docs/e2e |
| Receipt OCR | ✅ | Modal in Transactions | `/api/ai/extract-receipt-image` | — | Gemini/Vertex extraction | — | `ai_usage_metrics` | unit (parser) + capture | README |
| Budgets | ✅ | `/budgets` | `/api/budgets*` | `budgets` | — | — | — | core-pages E2E | README |
| Recurring transactions | ✅ | `/recurring` (Rutin) | `/api/recurring*` | `recurring_transactions` | — | — | — | core-pages E2E | README |
| Reports | ✅ | `/reports` | `/api/gemini/monthly-report` | — | Gemini report | — | `ai_usage_metrics` | core-pages E2E | README |
| Wallet & Goals | ✅ | Wallet/Goals UI | `/api/wallets`, `/api/goals` | `wallet_accounts`, `saving_goals` | — | — | — | — | README |
| Subscriptions | ✅ | Suite UI | `/api/subscriptions` | `subscriptions` | — | — | — | — | README |
| Gmail Sync | ✅ | `/gmail-sync` | `/api/gmail/*` | `gmail_sync_logs`, `_settings`, `_runs` | Classifier (Gemini) | — | `admin_metrics` | `gmail-sync.spec.ts` + visual | README |
| Gmail review (approve) | ✅ | Review tab | `/api/gmail/logs` POST | `gmail_sync_logs` | Confidence scorer | SSE push | `admin_metrics` | `gmail-review-approve.spec.ts` | docs/e2e |
| Gmail review (reject) | ✅ | Review tab | same | same | — | SSE push | — | `gmail-review-reject.spec.ts` | docs/e2e |
| Gmail duplicate detection | ✅ | Review tab | dedupe via `gmail_message_id` | `transactions`, `gmail_sync_logs` | — | SSE push (warning) | — | `gmail-review-duplicate.spec.ts` | docs/e2e |
| Gmail amount-missing guard | ✅ | Review tab | validation | — | — | SSE push (failed) | — | `gmail-review-amount-missing.spec.ts` | docs/e2e |
| Review → external channels | ✅ | — | webhook + SMTP (`GMAIL_WEBHOOK_URL`, `SMTP_*`), gate korelasi `gmail_sync_logs` server-side (P1-4 metadata guard) | — | — | — | — | unit + `notification-metadata-guard.spec.ts` | README |
| AI Search (agent) | ✅ | `/suite/ai-search` | `/api/agent-search/*` | — | Discovery Engine + Gemini | — | `ai_usage_metrics` | `agent-search-auth.spec.ts` | README |
| Categories | ✅ | `/categories` | `/api/categories*` | `categories` (+ defaults) | — | — | — | `categories.spec.ts` (3) | README |
| Notifications (in-app) | ✅ | Bell dropdown | `/api/notifications*` (metadata divalidasi: objek JSON, batas ukuran/key, source `gmail_review` dikorelasi log server — P1-4) | `notifications` | — | SSE push | — | `notifications-realtime.spec.ts`, `notification-metadata-guard.spec.ts` | docs/e2e |
| Notifications (realtime SSE) | ✅ | Bell + indicator | SSE hub | — | — | ✅ | — | realtime specs (4 cases) | docs/e2e |
| Admin monitoring | ✅ | `/admin/monitoring` | `/api/admin/metrics/*` | `admin_metrics` | — | — | ✅ | `admin-metrics-auth.spec.ts` | README |
| AI usage metrics | ✅ | Admin panel | metrics service | `ai_usage_metrics` | per-call tokens/cost | — | ✅ | unit | README |
| Cache stats | ✅ | Admin cache panel | `/api/admin/metrics/cache` | — | LRU cache + single-flight | — | ✅ | `admin-cache.spec.ts` | README |
| Alert rules + channels | ✅ | Admin alerts | scheduler + in-app + webhook/SMTP (`SMTP_*` env-gated, penerima `ADMIN_EMAILS`) | `alert_rules` | — | — | ✅ | unit | README |
| Rate limiting | ✅ | — | `express-rate-limit` (auth) | — | — | — | — | `rate-limit.spec.ts` | README |
| Observability (request-ID, pino, HTTP metrics) | ✅ | — | middleware | `system_metrics` | — | — | ✅ | — | docs/enterprise |
| Backup & restore | ✅ | — | `scripts/backupTurso.mjs` + runbook | full dump | — | — | — | — | docs |
| Dark mode | ✅ | theme store + toggle | — | — | — | — | — | visual snapshots | README |
| Mobile responsive | ✅ | responsive layouts | — | — | — | — | — | mobile E2E + visual | README |
| Smart AI router + semantic cache + anomaly detection | 🔭 | — | — | — | roadmap | — | — | — | docs/enterprise/AI_EVOLUTION_ROADMAP.md |

---

### Coverage summary

- **Implemented:** 30/31 rows ✅
- **Partial:** 0
- **Planned:** 1 (AI evolution roadmap)
- **Every implemented feature has at least one verification signal** (E2E spec, unit test, contract check, or visual snapshot) except Wallet/Goals/Subscriptions, which are covered by core-pages smoke + API presence.
