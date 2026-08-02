# CashFlow — Enterprise Architecture Audit

> Audit READ-ONLY · 2 Agustus 2026 · Evidence-based · Scope: frontend, backend, auth, database, realtime, AI layer, monitoring, infra, DevOps, observability.
> Sumber utama: `server/index.js`, `server/lib/*`, `server/routes/*`, `server/services/*`, `src/**`, `turso-schema.sql`, `package.json`, `README.md`, `.github/workflows/e2e.yml`.

---

## 1. Ringkasan Arsitektur Saat Ini

```
┌─────────────────┐   HTTPS/HTTP   ┌──────────────────────────────────────────┐
│ React SPA (Vite)│ ─────────────► │ Express 5 API (server/index.js, 325 L)   │
│ port 5180       │                │  ├ /api/auth/*      → Better Auth        │
│ · Zustand store │                │  ├ authMiddleware   → req.user (cookie)   │
│ · localStorage  │                │  ├ SSE /api/events  → realtime push       │
│   cache         │                │  └ 12 route modules (server/routes/*)     │
└───────┬─────────┘                └──────┬───────────────┬──────────────┬─────┘
        │ SSE (EventSource)               │               │              │
        └────────────────────────────────►│               │              │
                              ┌───────────▼────┐   ┌──────▼─────────┐  ┌──▼──────────────┐
                              │ Turso (libSQL) │   │ Google Cloud   │  │ Admin Monitoring│
                              │ 22 tabel       │   │ · Vertex AI    │  │ /api/admin/     │
                              │ (bisnis+gmail+ │   │ · Discovery    │  │  metrics/*      │
                              │  monitoring)   │   │ · GCS · Gmail  │  └─────────────────┘
                              └────────────────┘   └────────────────┘
```

**Fakta terverifikasi:**
- Frontend: React 18 + TypeScript + Vite 5 + TailwindCSS + Zustand + React Router (`src/`, ~20 pages/features).
- Backend: Express 5, entry `server/index.js` **325 baris** (pasca-ekstraksi P4.14) + **12 route modules** (`server/routes/*`, total server 5.082 baris).
- Auth: **Better Auth** + Google OAuth (cookie httpOnly session, tabel `user/session/account/verification` di Turso).
- DB: **Turso (libSQL)** via `@libsql/client` — singleton `server/lib/turso.js`, schema auto-verify di boot (`initTursoSchema`).
- Realtime: **SSE custom** (`server/lib/sse.js` + `src/lib/sse.ts`) — heartbeat 30s, auto-reconnect browser.
- AI: Vertex AI Gemini (`@google/genai`), Discovery Engine Agent Search, Receipt OCR, Insight Generator.
- Monitoring: in-house metrics (`ai_usage_metrics`, `system_metrics`, `alert_rules`) di Turso + admin dashboard.
- Testing: Playwright E2E (25 test: 17 core + 8 contract), Vitest unit (57), visual (@visual, 6), performance (@perf).
- Git: 2 commit (`113563f` baseline, `4044cd4` P2 hardening), working tree clean.

---

## 2. Audit per Lapisan

### 2.1 Frontend — ✅ Solid
- **Routing**: React Router dengan `AuthGuard` redirect (`src/app/router.tsx`).
- **State**: Zustand stores terpisah (`useAuthStore`, `useAppStore`, `useSessionExpiryStore`) — bersih.
- **Data**: service layer `src/services/*` + cache localStorage per-user; SSE client untuk realtime.
- **UI/UX**: Tailwind + Framer Motion + lucide-react; dark mode via class `dark` (theme key `cashflow-theme`).
- ⚠️ **Naming legacy**: `firebaseUser`/`firebaseReady`/`firebaseError` di store & puluhan page (label Firebase padahal stack Better Auth) — misleading untuk developer baru (Medium).
- ⚠️ `src/config/env.ts` mendeklarasikan `env.turso` (VITE_TURSO_DATABASE_URL/AUTH_TOKEN) dengan **0 consumer** — dead config berisiko (lihat SECURITY_AUDIT).

### 2.2 Backend — ✅ Modular (pasca-P4.14)
- `server/index.js` 325 L: hanya wiring (env loader, express, auth middleware, route registration, error middleware, listen).
- 12 route modules per domain: transaction, category, budget, recurring, notification, professionalSuite, gmail, gemini, agentSearch, adminMetrics, health + SSE.
- Shared state/helper Vertex AI di `server/lib/vertexContext.js` (714 L) — single source of truth.
- Error middleware terpusat: 413/400/500 mapping + `detail` hanya non-produksi.
- ⚠️ **Error envelope heterogen**: beberapa route `{ success, ok, errorCode }`, admin `{ ok, code }`, auth `{ error }` — tidak konsisten antar API (Medium, sudah di-cover contract tests).

### 2.3 Authentication — ✅ Strong
- Better Auth + Google OAuth (scope `gmail.readonly`, `offline`, `consent`).
- `authMiddleware`: `req.user` dari session cookie; **membedakan** "session null" (401 benar) vs "getSession throw" (retry 150ms → 500 jujur) — fix P0 flaky.
- `requireAuth` guard 401; admin gate `resolveAdmin` via `ADMIN_EMAILS`; user-scope `resolveAgentSearchUser` via `req.user`.
- Hardening produksi: fail-fast `BETTER_AUTH_SECRET`, `useSecureCookies` otomatis, `trustedOrigins` env.
- ⚠️ Tidak ada rate-limit pada `/api/auth/*` (brute-force login non-issue karena OAuth, tapi abuse endpoint tetap terbuka).

### 2.4 Database — ✅ Turso/libSQL
- 22 tabel: Better Auth (4: user/session/account/verification) + legacy compat (3: users/user_sessions/profiles) + bisnis (11: categories/transactions/budgets/recurring/gmail_logs/gmail_settings/gmail_runs/wallet/goals/subscriptions/notifications) + admin_metrics (1) + monitoring (3: ai_usage_metrics/system_metrics/alert_rules).
- Index lengkap untuk hot query (transactions user_date, gmail_logs user_status/user_sync_run, dll).
- `initTursoSchema` idempoten di boot (CREATE IF NOT EXISTS + INSERT OR IGNORE).
- ⚠️ Dua set tabel user (Better Auth `user` + legacy `users`) — duplikasi yang membingungkan; legacy hanya dipakai frontend lama (Medium).
- ⚠️ Tidak ada backup/DR strategy terdokumentasi (lihat INFRASTRUCTURE_AUDIT).

### 2.5 Caching — ⚠️ Minimal
- Frontend: cache localStorage per-user (tidak diverifikasi mekanisme invalidasi lengkap).
- Backend: **tidak ada** cache layer (Redis/memory) — setiap request query Turso langsung.
- Better Auth `session.cookieCache` (5 menit) — satu-satunya cache server-side.
- SSE: tanpa cache (benar untuk realtime).
- **Gap**: no HTTP cache headers, no memoization untuk agregasi metrics yang berat.

### 2.6 AI Layer — ✅ Mature (detail: AI_PLATFORM_AUDIT.md)
- Pipeline lengkap: prompt builders → generate → timeout race → model fallback loop → JSON repair → normalizer → metrics recording.
- Agent Search: Discovery Engine REST + GCS + per-user hash filter + defense-in-depth re-filter.
- 0 cache/compression untuk prompt; single-provider; lihat AI_PLATFORM_AUDIT.

### 2.7 Monitoring — ✅ In-house (detail: MONITORING_AUDIT.md)
- `ai_usage_metrics` (token, cost estimasi, latency, status), `system_metrics`, `alert_rules` (4 seed rule).
- Admin dashboard `/admin/monitoring` + 6 endpoint.
- Non-blocking recording; sanitize PII (key regex + length cap).
- ⚠️ Tidak ada channel alerting (email/webhook), tidak ada metrics untuk CPU/memory, tidak ada tracing.

### 2.8 Realtime — ✅ Custom SSE
- `notifyUser`/`broadcastAll` per userId; heartbeat 30s; `X-Accel-Buffering: no`.
- Frontend auto-reconnect (EventSource bawaan).
- ⚠️ State **in-memory** (`Map<userId, Set<Response>>`) — tidak survive multi-instance / restart; tidak ada backpressure untuk slow consumer (Low-Medium untuk skala).

### 2.9 Storage — ✅ Google Cloud Storage
- Agent Search: JSONL → GCS bucket (docs + per-user data) → Discovery Engine import (`reconciliationMode: INCREMENTAL`).
- Receipt: multer **in-memory** (bukan disk) → base64 → Gemini vision; `cacheControl: no-store`.
- ⚠️ Tidak ada lifecycle policy bucket terdokumentasi; signed URL tidak dipakai.

### 2.10 Infrastructure & DevOps — ⚠️ Early (detail: INFRASTRUCTURE_AUDIT.md)
- CI: GitHub Actions (quality + e2e, concurrency `e2e`, seed CI-isolated).
- ❌ Tidak ada Dockerfile/docker-compose/nginx/Procfile.
- ❌ Tidak ada rate-limit, helmet, structured logging, graceful shutdown, tracing.

### 2.11 Documentation — ✅ Extensive
- `README.md` lengkap (setup, arsitektur, testing, hardening).
- `docs/audit/*` (compliance matrix 100%, audit report, gap analysis), `docs/e2e/*` (5 strategi), `docs/enterprise/*` (ini).
- ⚠️ Banyak dokumen lama masih menyebut Supabase/Firebase (`docs/gmail-sync/*`, `docs/transactions/*`, `GMAIL_SYNC_SETUP_GUIDE.md`, `agent.md`, `ANALISIS_FITUR_CASHFLOW.md`) — menyesatkan (Medium).

### 2.12 Observability — ⚠️ Parsial (detail: OBSERVABILITY_REVIEW.md)
- Metrics: ada (custom). Logs: console.* saja, tanpa structured logging. Tracing: requestId hanya di geminiRoutes (AI error), **tidak ada correlation ID middleware global**.

---

## 3. Skor Arsitektur

| Dimensi | Skor /10 | Justifikasi |
|---|---|---|
| **Architecture** | **8.5** | Modular route modules, separation of concerns baik, SSE menggantikan realtime DB, AI gateway terpusat; minus: envelope error heterogen, duplikasi tabel user |
| **Scalability** | **5.0** | Single Express process; SSE in-memory (`Map` di proses — tidak survive restart/multi-instance); tanpa horizontal scaling/queue; Turso bagus tapi bottleneck di proxy AI + sync Gmail sequential (konsisten dengan PRODUCTION_READINESS §1) |
| **Maintainability** | **8.0** | Route modules + testing + docs; minus naming legacy firebase/supabase & dual Gemini SDK |
| **Modularity** | **8.5** | 12 route modules + vertexContext + services; frontend fitur per-folder |
| **Complexity** | **7.5** | AI pipeline kompleks tapi terisolasi; Gmail sync state machine kompleks; SSE handler sederhana |
| **Coupling** | **7.0** | vertexContext sebagai shared mutable state (single source) — ok; frontend service ↔ API contract via contract tests |
| **Technical Debt** | **6.5** | Banyak remnant legacy (naming, deps, docs); lihat TECHNICAL_DEBT_REPORT.md |

**Skor arsitektur gabungan: 7.4 / 10** (naik signifikan pasca-P4.14 ekstraksi monolit 1.798→325 baris).

---

## 4. Rekomendasi Prioritas (arsitektur)

1. **P1 — Observability**: request-ID middleware global + structured logging (pino) + trace antar-layanan AI.
2. **P1 — Security hardening**: helmet + express-rate-limit + hapus `env.turso` dead config.
3. **P2 — Scaling path**: pisahkan AI proxy (vertexContext) menjadi service terpisah; SSE → Redis pub/sub bila multi-instance.
4. **P2 — Konsistensi API**: standardisasi envelope `{ ok, code, data, error }` (contract tests sebagai enforcement).
5. **P2 — Debt cleanup**: hapus naming `firebaseUser` → `user`, konsolidasi tabel `users` legacy, arsip docs lama.
6. **P3 — Infra**: Dockerfile multi-stage, healthcheck, graceful shutdown, backup Turso terjadwal.
