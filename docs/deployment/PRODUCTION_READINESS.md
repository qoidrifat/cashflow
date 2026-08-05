# Production Readiness — Audit & Deployment Guide

> **Status:** Audit 2026-08-05 · **Owner:** Core Engineering · **Related:** [ADR-008](../adr/ADR-008-github-pages-deployment.md), [ADR-009](../adr/ADR-009-github-actions-node24.md), `docs/enterprise/PRODUCTION_READINESS.md` (baseline 4.4/10)

## Deployment Topology

```
┌────────────────────────┐     HTTPS      ┌───────────────────────────────┐
│  GitHub Pages (SPA)    │ ─────────────► │  API Server (Node/Express)    │
│  static Vite build     │   CORS +       │  port 5181 (reverse proxy →   │
│  .nojekyll · HTTPS      │  Better Auth   │  443 externally)              │
└────────────────────────┘  trusted origins└──────────────┬────────────────┘
                                                          │
                                  ┌───────────────────────┼──────────────────┐
                                  ▼                       ▼                  ▼
                          Turso (libSQL)         Google Cloud        SMTP/Webhook
                          primary DB             Vertex AI · GCS ·    alert channels
                                                 Discovery Engine
```

Frontend = GitHub Pages (ADR-008). API server = separate Node process (bare VM, Docker, or Cloud Run) — **not** part of Pages. Turso is the single source of truth (ADR-002).

## Audit matrix — what already exists vs gaps

| Area | Status | Evidence |
|---|---|---|
| Helmet security headers | ✅ | `helmet` with CSP (connect-src from `ALLOWED_ORIGINS` + trusted origins), HSTS in production, COEP/COOP tuned, `upgradeInsecureRequests: null` (local dev) |
| CORS | ✅ | `cors({ origin: ALLOWED_ORIGINS, credentials: true })`; origins env-configurable |
| Rate limiting | ✅ | 4 limiters (general/auth/AI/receipt) via `express-rate-limit` v7, per-user key, env-tunable, E2E-tested 429 |
| Body limits | ✅ | `express.json` 10mb + multer limits + 413/INVALID_IMAGE_TYPE mapping |
| Cookie security | ✅ | Better Auth secure cookies (production), `trust proxy` env-gated |
| Env validation | ✅ | `cleanEnv` + explicit required-var checks in `initGemini` (fail-closed with warnings) |
| Health (liveness) | ✅ | `GET /api/health` |
| **Readiness** | 🆕 **Added (P2)** | `GET /api/ready` — 200 only when Turso reachable; 503 + dependency detail otherwise |
| Graceful shutdown | ✅ | SIGTERM/SIGINT: stop intake → close SSE → close Turso → exit 0; 10s force-exit |
| Backup/restore | ✅ | `backupTurso.mjs` + restore runbook (docs); scheduled (Windows Task Scheduler / Cloud Scheduler) |
| Container image | 🆕 **Added (P2)** | `server/Dockerfile` (node:24-alpine, `npm ci --omit=dev`, HEALTHCHECK → `/api/ready`) + `.dockerignore` |
| HTTPS / reverse proxy | ⚠️ Config only | Terminate TLS at proxy (Nginx/Cloud Run); `TRUST_PROXY=1`, `ALLOWED_ORIGINS`, `BETTER_AUTH_TRUSTED_ORIGINS` must list the real domain |
| Observability | ✅ | ADR-010: request-ID + pino + HTTP metrics; admin dashboard |
| Monitoring/alerts | ✅ | ADR-005: in-db metrics + alert scheduler + webhook/SMTP channels |
| CI/CD | ✅ | 5-job workflow green (quality/gitleaks/e2e 3×/visual/perf) |
| **Prod env completeness** | ⚠️ Manual action | `NODE_ENV=production`, `BETTER_AUTH_SECRET`, `ALLOWED_ORIGINS`, trusted origins, SMTP/`ADMIN_EMAILS` must be set on the host |

## What was added this phase (safe, additive)

1. **`GET /api/ready`** (readiness probe) — `server/routes/healthRoutes.js`. Separates liveness from dependency-readiness; used by Docker HEALTHCHECK and Cloud Run startup probes. AI (`geminiReady`) is reported but does **not** block readiness (degraded ≠ down) — Turso availability does.
2. **`server/Dockerfile` + `.dockerignore`** — containerized API server: Node 24 Alpine, production deps only, HEALTHCHECK to `/api/ready`, SIGTERM graceful shutdown supported out of the box. Secrets never baked (`.dockerignore` excludes `.env*`, `google-*.json`, `*.db`).

## Deploy runbook (API server)

```bash
# Build & run (Docker)
docker build -f server/Dockerfile -t cashflow-api .
docker run -d --name cashflow-api -p 5181:5181 \
  -e NODE_ENV=production \
  -e BETTER_AUTH_SECRET=<random-64-hex> \
  -e ALLOWED_ORIGINS=https://<user>.github.io,https://<custom-domain> \
  -e BETTER_AUTH_TRUSTED_ORIGINS=https://<user>.github.io \
  -e TURSO_DATABASE_URL=libsql://... -e TURSO_AUTH_TOKEN=... \
  -e GOOGLE_APPLICATION_CREDENTIALS=/run/secrets/gcp.json \
  -e GOOGLE_CLOUD_PROJECT=<project> \
  -e ADMIN_EMAILS=admin@example.com \
  -e SMTP_HOST=... -e SMTP_USER=... -e SMTP_PASS=... \
  -e TRUST_PROXY=1 \
  -v <path>/gcp.json:/run/secrets/gcp.json:ro \
  --restart unless-stopped \
  cashflow-api

# Verify
curl -s http://localhost:5181/api/health   # liveness
curl -s http://localhost:5181/api/ready    # readiness → 200
```

Reverse proxy (Nginx example): `proxy_pass http://127.0.0.1:5181; proxy_set_header X-Forwarded-Proto $scheme;` — matches the server's `x-forwarded-proto` sanitization for Better Auth.

## Remaining risks (manual, non-code)

| Risk | Severity | Action |
|---|---|---|
| GCP key still active in `server/.env` (history leak) | Critical | Rotate per `docs/security/GCP_KEY_ROTATION_CHECKLIST.md` |
| Prod env not fully set on host | High | Fill `NODE_ENV`, `BETTER_AUTH_SECRET`, origins, SMTP per `.env.example` |
| In-process alert scheduler assumes single instance | Medium | Documented in ADR-005; use one API instance or move scheduler out |
| Metrics retention unbounded | Medium | Retention cleanup job recommended (ADR-005) |

## Scorecard

| Dimension | Before (enterprise audit) | After |
|---|---|---|
| Overall production readiness | 4.4/10 (NOT READY) | **~7.5/10** — code-level gaps closed (readiness, container, docs); remaining = manual env + GCP rotation |
| Blocking code gaps | 4 Critical | 0 code-level; 1 ops-critical (key rotation) |
