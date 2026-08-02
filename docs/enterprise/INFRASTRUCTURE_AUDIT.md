# CashFlow — Infrastructure Audit

> Audit READ-ONLY · 2 Agustus 2026 · Evidence-based · Sumber: env vars (server/src/scripts), `.gitignore`, `.github/workflows/e2e.yml`, `server/index.js`, `package.json`, file-system scan (Dockerfile/nginx/Procfile).

---

## 1. Inventaris Environment Variables

### Server (`process.env.*` — ~20 variabel dipakai langsung)
| Kelompok | Variabel | Status |
|---|---|---|
| Turso | `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | ✅ Wajib (boot gagal warning tanpa URL) |
| Better Auth | `BETTER_AUTH_SECRET` (atau `AUTH_SECRET`), `BETTER_AUTH_URL`, `BETTER_AUTH_TRUSTED_ORIGINS` | ✅ Wajib produksi (fail-fast) |
| Google OAuth | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | ✅ Wajib login |
| Vertex AI | `GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_CLOUD_PROJECT`/`GCP_PROJECT_ID`, `GCP_LOCATION`, `GEMINI_PRIMARY_MODEL`, `GEMINI_FALLBACK_MODEL` | ✅ |
| Agent Search | `AGENT_SEARCH_ENABLED`, `_PROJECT_ID`, `_LOCATION`, `_COLLECTION`, `_ENGINE_ID`, `_SERVING_CONFIG_ID`, `_KNOWLEDGE_DATA_STORE_ID`, `_TRANSACTIONS_DATA_STORE_ID`, `_GMAIL_LOGS_DATA_STORE_ID`, `_RECEIPTS_DATA_STORE_ID`, `_DOCS_BUCKET`, `_DATA_BUCKET`, `_USER_HASH_SALT` | ✅ Opsional (feature-gated) |
| Admin | `ADMIN_EMAILS` | ✅ Gate admin |
| Misc | `PORT`, `NODE_ENV`, `ALLOWED_ORIGINS`, `USD_TO_IDR` | ✅ |

### Frontend (`import.meta.env.*`)
| Variabel | Status |
|---|---|
| `VITE_API_BASE_URL` | ✅ dipakai `src/config/env.ts` |
| `VITE_AGENT_SEARCH_ENABLED`, `VITE_AI_SEARCH_ROUTE_ENABLED` | ✅ feature flags |
| `VITE_TURSO_DATABASE_URL`, `VITE_TURSO_AUTH_TOKEN` | ⚠️ **dead config — 0 consumer** (lihat SECURITY_AUDIT) |
| `VITE_FUNCTIONS_BASE_URL` (di .env.example) | ⚠️ legacy template |

### Scripts
- `scripts/seedE2eDataset.mjs` — `SEED_E2E` (safety guard), `TURSO_*`, `ADMIN_EMAILS`, `BETTER_AUTH_SECRET`.
- `scripts/migrateSupabaseToTurso.js`, `migrateGmailSupabaseToTurso.mjs` — `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `VITE_SUPABASE_*` (**LEGACY** — hanya skrip migrasi arsip).

---

## 2. Cloud Resources (Google Cloud)

| Resource | Bukti | Status |
|---|---|---|
| Vertex AI Gemini | `GoogleGenAI({ vertexai: true })` | ✅ Terkonfigurasi (health 200) |
| Discovery Engine | REST `discoveryengine.googleapis.com` | ✅ |
| GCS buckets | `AGENT_SEARCH_DOCS_BUCKET` / `_DATA_BUCKET` via `@google-cloud/storage` | ✅ |
| Gmail API | OAuth scope `gmail.readonly` | ✅ |
| Service account | `GOOGLE_APPLICATION_CREDENTIALS` (file JSON, di-gitignore) | ✅ |

**Gap IAM**: role service account tidak terdokumentasi eksplisit (disebut "Vertex AI User" di pesan error, tapi tidak ada dokumen IAM minimal). Tidak ada audit key rotation policy.

---

## 3. Secrets & Credential Management

| Item | Status |
|---|---|
| `server/.env` di `.gitignore` | ✅ (`server/.env`, `server/*.env`, `!server/.env.example`) |
| service-account JSON di `.gitignore` | ✅ (`server/*service-account*.json`, `*.service-account.json`) |
| `.env.example` root + `server/.env.example` | ✅ template aman (tanpa nilai riil) |
| Audit staging commit 1 (`113563f`) | ✅ 367 file, **0 secret** terverifikasi |
| Fail-fast `BETTER_AUTH_SECRET` produksi | ✅ (TEST A: exit 1 tanpa secret; TEST B: boot dengan secret) |
| `VITE_TURSO_AUTH_TOKEN` deklarasi di `env.ts` | ⚠️ Risiko: bila di-set di `.env.local`, masuk bundle client (lihat SECURITY_AUDIT) |
| `AGENT_SEARCH_USER_HASH_SALT` fallback dev hardcoded | ⚠️ `'cashflow-dev-agent-search-salt-change-in-production'` — perlu di-set produksi |

---

## 4. Monitoring, Logging, Deployment

### Logging — ⚠️ Console-only
- `console.log/warn/error` di seluruh server (index.js 12, vertexContext 8, turso 5, geminiRoutes 4, dst).
- ❌ **Tidak ada structured logging** (pino/winston/morgan tidak terinstall).
- ❌ Tidak ada log rotation, tidak ada correlation ID global (requestId hanya di geminiRoutes).
- ❌ Tidak ada central log sink (Cloud Logging/Grafana Loki/dst).

### Deployment — ⚠️ Bare Node
- `npm run dev:all` (concurrently vite + server), CI build+test.
- ❌ **Tidak ada Dockerfile** / docker-compose / nginx.conf / Procfile / ecosystem.config.js.
- ❌ Tidak ada healthcheck config deployment (health endpoint ada: `/api/health`, `/api/gemini/health`).
- ❌ Tidak ada graceful shutdown (`SIGTERM`/`SIGINT` handler = 0 match di server).
- Env `CLOUD_RUN_JOB`, `K_SERVICE`, `GAE_*` terdeteksi di env scan (dari lib Google) — menandakan kesiapan deploy Google, tapi tanpa konfigurasi.

### Build Pipeline / CI/CD — ✅ GitHub Actions
- `.github/workflows/e2e.yml`: job `quality` (lint/typecheck/build) + `e2e` (seed CI-isolated + Playwright + contract).
- `concurrency: group: e2e` — serialisasi global anti-flaky antar run.
- Artifacts: report (always), traces/screenshots/videos (on failure).
- Secrets: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `GEMINI_API_KEY`, `ADMIN_EMAILS`.
- ⚠️ Satu workflow saja — tidak ada deploy job, tidak ada smoke-on-prod, tidak ada perf/visual job di CI (spec ada tapi di-exclude default `--grep-invert @visual|@perf`).

### Cloud Scheduler / Cron — ⚠️ Tidak ada
- Gmail auto-sync **berjalan saat aplikasi aktif** (client-triggered); background scan membutuhkan Edge Function/Cron — dokumen Supabase diarsip, **belum ada pengganti** (Cloud Scheduler/Cloud Run Job).
- ⚠️ Ini gap fungsional produksi: sinkronisasi Gmail tidak berjalan tanpa user online.

---

## 5. Network & Server Configuration

| Item | Status |
|---|---|
| CORS | ✅ `ALLOWED_ORIGINS` whitelist + credentials |
| JSON limit | ✅ 10mb |
| Proxy dev | ✅ Vite proxy `/api` → 5181 |
| Trust proxy headers | ✅ `/api/auth/*` menormalisasi `x-forwarded-proto/host` |
| Rate limiting | ❌ tidak ada |
| Security headers | ❌ tidak ada (helmet absent) |
| TLS termination | ⚠️ diharapkan di proxy eksternal (tidak dikonfigurasi di repo) |

---

## 6. Backup & Disaster Recovery — ✅ Sudah Ada (Sprint 1.3 + sisa backup, 2026-08-02)

- ✅ **Backup terjadwal**: `scripts/backupTurso.mjs` (dump 22 tabel → JSON di `backups/`, retensi `BACKUP_RETENTION_DAYS` default 14) + Windows Task Scheduler `CashFlowTursoBackup` **daily 02:00 terverifikasi** (Last Result 0). Guard `BACKUP_TURSO=1`.
- ✅ **Restore**: `scripts/restoreTurso.mjs` — skema otomatis dari `turso-schema.sql` (seed di-skip), INSERT FK-safe, generated column di-skip, verifikasi COUNT, guard `RESTORE_TURSO=1` + tolak target=source kecuali `--force`. Restore drill ke DB uji **PASS (2027/2027 rows, 22 tabel)**.
- ✅ **Runbook DR**: `docs/enterprise/BACKUP_RESTORE_RUNBOOK.md` — penjadwalan (Windows ✅ / cron / Cloud Scheduler→Cloud Run Job), prosedur restore + cut-over, drill kuartalan, troubleshooting, bukti verifikasi.
- ⚠️ **Sisa**: offsite copy ke GCS belum otomatis (lihat runbook §3.4), tidak ada region replication strategy (Turso multi-region opsional), restore drill belum di-CI.
- ⚠️ DB lokal `cashflow.db` (SQLite legacy) di-gitignore — bukan bagian runtime.

---

## 7. Skor Infrastruktur

| Dimensi | Skor /10 |
|---|---|
| Env & secrets | 8.0 (gitignore ketat, fail-fast, audit staging bersih; minus salt fallback + VITE_TURSO) |
| CI/CD | 7.5 (quality+e2e+contract+artifacts; minus deploy/smoke job) |
| Containerization | **1.0** (tidak ada Dockerfile sama sekali) |
| Logging | 2.0 (console-only, no structured, no sink) |
| Deployment | 3.0 (bare node, no graceful shutdown, no healthcheck config) |
| Backup/DR | 1.0 → **8.0** (backup terjadwal + restore script + runbook + drill tervalidasi; minus offsite GCS & region replication) |
| Security headers/rate limit | 2.0 (tidak ada) |
| **Infrastructure** | **3.5 / 10** |

---

## 8. Rekomendasi (prioritas)

1. **P1 — Dockerize**: Dockerfile multi-stage (server + FE build), `HEALTHCHECK` → `/api/health`, graceful shutdown `SIGTERM` (close Turso client, drain SSE).
2. **P1 — Observability**: pino structured logging + request-id middleware + sink ke Cloud Logging.
3. **P1 — Rate limit & headers**: `express-rate-limit` (auth + AI endpoints) + helmet.
4. **P1 — Cloud Scheduler**: ganti cron Gmail sync yang hilang (Cloud Run Job `server/index.js` + `CLOUD_RUN_JOB` flag).
5. **P2 — Backup**: `turso db dump` terjadwal ke GCS + restore runbook; dokumentasikan DR.
6. **P2 — IAM doc**: dokumen role minimal service account (Vertex AI User, Storage ObjectAdmin, Discovery Engine Editor).
7. **P3 — CI**: tambah job perf/visual (non-blocking) + deploy preview.
