# CashFlow — Documentation Map

> **Status:** Approved · **Version:** 1.3 · **Owner:** Core Engineering · **Last Updated:** 2026-08-14
> **2026-08-14 (P0.14):** `docs/google-agent-platform/` baru — `ELIGIBILITY.md` (credit "Trial credit for GenAI App Builder", tabel eligibility per SKU berbasis evidence, gate BLOCKED), `ARCHITECTURE.md` (adapter read-only feature-flagged `GOOGLE_AGENT_PLATFORM_ENABLED=false`, security boundary, IAM), `BILLING_PROOF.md` (baseline, workload plan minimal 1–5 query, matrix, status PENDING VERIFICATION) + `docs/cashflow-ai/` (manifest knowledge base topik → file nyata, non-sensitif).
> **2026-08-09 (P0 hardening):** `docs/database/` baru — `MIGRATIONS.md` (migration runner versioned: baseline existing schema, checksum sha256 + drift detection, batch atomik per migration, lock transaksional via PK version, commands `db:migrate`/`db:migrate:status`/`db:migrate:check`/`db:migrate:baseline`, forward-fix rollback). `docs/security/` +4 — `ACCOUNT_DATA_EXPORT.md` (GET /api/privacy/export, format versioned, secret exclusion), `ACCOUNT_DELETION.md` (DELETE /api/privacy/account, konfirmasi "DELETE", wipe batch atomik, idempoten), `ADMIN_AUDIT_TRAIL.md` (helper recordAdminAudit, coverage SUCCESS/DENIED/FAILURE, fail policy), `SCHEMA_DRIFT_GUARD.md` (kontrak tabel/kolom/index, guard statis baseline sync, CI gate).
> **2026-08-09 (sebelumnya):** `docs/security/` +3 — `SESSION_LIFECYCLE.md` (kontrak cookie HttpOnly+SameSite=Lax, expiresIn/updateAge, cache 300s, CSRF Origin check 403, verifikasi script) + `scripts/verify-session-lifecycle.mjs`; `BETTER_AUTH_CONFIG_CONTRACT.md` (daftar setting better-auth eksplisit di-pin — rateLimit disabled, session freshAge, basePath, cookiePrefix, advanced origin/CSRF/subdomain cookies + deployment notes); `RATE_LIMITING.md` (keputusan express-rate-limit = single source of truth — alasan 2 lapis limiter berbahaya, 4 limiter, env override `RATE_LIMIT_*`, guards E2E auth+AI+general).
> **2026-08-06 (Sprint 0.7):** `docs/ci/` diperluas 1 → 7 file (CI architecture, testing strategy, Playwright guide, seed database guide, release process, troubleshooting, index) — stabilisasi pipeline CI (seed batch).
> **2026-08-05 (sync audit):** 11 file one-off/duplikat di root docs/ di-archive ke `archive/root/` (lihat [audit/DOCUMENTATION_SYNC_AUDIT.md](audit/DOCUMENTATION_SYNC_AUDIT.md)); `docs/ci/` ditambahkan.
> **2026-08-05 (Phase-2):** `docs/gmail-sync/` (19) + `docs/transactions/` (5) di-archive (self-declared "ARSIP HISTORIS" — era Supabase/Firebase); `docs/ai/` + `docs/deployment/` dibuat; ADR 008–011; `server/Dockerfile` + `/api/ready`; cache AI L2 + invalidation admin.
> **Related:** [README](../README.md) · This file is the **single navigation hub** for all documentation.

---

## 1. Quick Navigation

| I want to… | Go to |
|---|---|
| Understand the system | [docs/system/ARCHITECTURE.md](system/ARCHITECTURE.md) · [docs/system/SYSTEM_AUDIT_REPORT.md](system/SYSTEM_AUDIT_REPORT.md) |
| See the feature list | [docs/system/FEATURE_MATRIX.md](system/FEATURE_MATRIX.md) |
| See screenshots | [docs/assets/screenshots/INDEX.md](assets/screenshots/INDEX.md) · [SCREENSHOT_INDEX.md](system/SCREENSHOT_INDEX.md) |
| See canonical diagrams | [docs/assets/diagrams/ARCHITECTURE.md](assets/diagrams/ARCHITECTURE.md) |
| Know why we chose X | [docs/adr/](adr/INDEX.md) |
| Enterprise roadmap | [docs/enterprise/](enterprise/INDEX.md) · [EXECUTIVE_SUMMARY.md](enterprise/EXECUTIVE_SUMMARY.md) |
| E2E testing | [docs/e2e/](e2e/INDEX.md) |
| Architecture & audit | [docs/architecture/](architecture/INDEX.md) · [security](security/INDEX.md) · [performance](performance/INDEX.md) |
| Financial calculations | [docs/financial/FINANCIAL_CALCULATION_INTEGRITY.md](financial/FINANCIAL_CALCULATION_INTEGRITY.md) (definisi saldo/income/expense + insiden windowed) |
| Database migrations & schema governance | [docs/database/MIGRATIONS.md](database/MIGRATIONS.md) · [docs/security/SCHEMA_DRIFT_GUARD.md](security/SCHEMA_DRIFT_GUARD.md) |
| Privacy: export & account deletion | [docs/security/ACCOUNT_DATA_EXPORT.md](security/ACCOUNT_DATA_EXPORT.md) · [docs/security/ACCOUNT_DELETION.md](security/ACCOUNT_DELETION.md) · [ADMIN_AUDIT_TRAIL.md](security/ADMIN_AUDIT_TRAIL.md) |
| Google Agent Platform eligibility & billing proof | [docs/google-agent-platform/](google-agent-platform/INDEX.md) · [ELIGIBILITY.md](google-agent-platform/ELIGIBILITY.md) · [BILLING_PROOF.md](google-agent-platform/BILLING_PROOF.md) |
| CashFlow AI knowledge base manifest | [docs/cashflow-ai/](cashflow-ai/INDEX.md) (topik → file sumber nyata, non-sensitif) |
| Documentation system | [docs/meta/](meta/INDEX.md) |
| Repo curation & GitHub prep | [docs/repository/](repository/INDEX.md) |
| Historical / legacy | [docs/archive/ARCHIVE.md](archive/ARCHIVE.md) |

---

## 2. Complete Tree & Folder Responsibilities

**219 `.md` files** in `docs/` (2026-08-05): 111 active + 107 archived + 1 root.

| Folder | Real docs | Status | Responsibility |
|---|---|---|---|
| `docs/adr/` | 12 | 🟢 Active | Architecture Decision Records (001–011) + index |
| `docs/architecture/` | 7 | 🟢 Active | Architecture & implementation audits (system report, code quality, gap analysis, compliance matrix) |
| `docs/audit/` | 5 | 🟢 Active | Feature completion matrix, gap analysis, implementation priorities/status, **doc sync audit** |
| `docs/security/` | 8 | 🟢 Active | Security audit + secret/GCP key rotation checklists + secret reference audit + **session lifecycle contract** (cookie contract, CSRF origin check 403, verifikasi script) + **better-auth config contract** (setting eksplisit di-pin, audit P1-2) + **rate limiting decision** (express-rate-limit single source of truth, 4 limiter, env override) |
| `docs/performance/` | 2 | 🟢 Active | Performance audit + index |
| `docs/e2e/` | 11 | 🟢 Active | Playwright E2E strategy, coverage, stability, CI pipeline |
| `docs/enterprise/` | 13 | 🟢 Active | Enterprise modernization audit + roadmap + backup runbook |
| `docs/system/` | 5 | 🟢 Active | System architecture, audit report, feature matrix, screenshot index |
| `docs/google-cloud/` | 3 | 🟢 Active | GCP / Agent Builder / Discovery Engine setup |
| `docs/google-agent-platform/` | 4 | 🟢 Active | **P0.14** — Google Agent Platform eligibility + billing proof (ELIGIBILITY / ARCHITECTURE / BILLING_PROOF + index) |
| `docs/cashflow-ai/` | 2 | 🟢 Active | **P0.14** — knowledge base manifest CashFlow AI Knowledge Assistant (topik → file nyata, non-sensitif) |
| `docs/meta/` | 8 | 🟢 Active | Documentation system itself (this layer) + documentation-consistency audit |
| `docs/repository/` | 12 | 🟢 Active | Repository curation & GitHub publication prep (audit, security, readiness, commit guide) |
| `docs/ci/` | 7 | 🟢 Active | CI architecture, testing strategy, Playwright guide, seed DB guide (Sprint 0.7), release process, troubleshooting + migration report |
| `docs/ai/` | 2 | 🟢 Active | AI architecture: semantic cache (multi-layer) + fraud detection design |
| `docs/api/` | 1 | 🟢 Active | **API contract single source of truth** — `/api/ai-product/*` (conversation, timeline, feedback, memory, track) OpenAPI-style: schema request/response, enums, state machine, error shape, pagination, idempotency |
| `docs/financial/` | 1 | 🟢 Active | Financial calculation integrity: definisi saldo/income/expense, konvensi tanda, insiden windowed 2026-08-08, invariant & regression guards |
| `docs/deployment/` | 1 | 🟢 Active | Production readiness audit + deploy runbook (Docker / reverse proxy) |
| `docs/review/` | 6 | 🟢 Active | Phase-1 hardening review (root-cause, security, perf, code, readiness, final) |
| `docs/assets/` | 4 + 21 PNG | 🟢 Active | Screenshots (21) + canonical Mermaid diagrams |
| ~~`docs/gmail-sync/`~~ | 19 | ⚫ Archived | Gmail sync checklists (era Supabase/Firebase — self-declared "ARSIP HISTORIS", archived 2026-08-05) |
| ~~`docs/transactions/`~~ | 5 | ⚫ Archived | Transactions feature checklists (same era — archived 2026-08-05) |
| `docs/mobile/` | 4 | 🟡 Historical ref | Mobile UI fix checklists |
| `docs/ui/` | 4 | 🟡 Historical ref | UI polish checklists |
| `docs/ai-pipeline/` | 3 | 🟡 Historical ref | Early AI pipeline audits |
| `docs/implementation/` | 2 | 🟡 Historical ref | Baseline & P0 implementation reports |
| `docs/testing/` | 1 | 🟡 Historical ref | Baseline testing report |
| `docs/archive/` | 107 | ⚫ Archived | `root/` (18) · `gmail-sync/` (19) · `transactions/` (5) · `workflow-reviews/` · `feature-docs/` + `ARCHIVE.md` policy |
| `docs/` root | 1 | 🟢 | `DOCUMENTATION_MAP.md` (this file — single navigation hub) |

---

## 3. Dependency Map

```text
README.md (entry point)
 └─ docs/DOCUMENTATION_MAP.md  ← you are here
     ├─ docs/meta/*            (governs how docs are written)
     ├─ docs/adr/*             (why-decisions; referenced by system docs)
     ├─ docs/system/*          (current-state reference)
     ├─ docs/e2e/*             (how it's tested)
     ├─ docs/architecture|security|performance/*  (audits)
     ├─ docs/enterprise/*      (roadmap & modernization)
     ├─ docs/assets/*          (screenshots + diagrams, embedded elsewhere)
     └─ docs/archive/*         (historical — never linked from active docs)
```

**Rules:** active docs may reference each other (relative paths) and `docs/assets/`; they **must not** reference `docs/archive/`.

---

## 4. Coverage Summary

| Domain | Active docs | Archived docs |
|---|---|---|
| Architecture | system, enterprise, adr | archive/workflow-reviews |
| Backend/API | system/ARCHITECTURE.md, audit | archive |
| Database | system, adr-002 | archive/root |
| Auth | system §5, adr-001, security/SECURITY_AUDIT.md, **security/SESSION_LIFECYCLE.md** (kontrak cookie + CSRF origin 403) | archive/root |
| AI | google-cloud, adr-004/006, enterprise/AI_* | archive/feature-docs |
| Monitoring | system, adr-005, enterprise/MONITORING_AUDIT | archive/workflow-reviews |
| Testing | e2e (10) | — |
| Security/Perf | security/, performance/, enterprise | archive |
| Gmail | README, adr-007, archive/gmail-sync (19) | archive |

---

## 5. Status Summary

- **2026-08-05 sync audit:** ✅ 11 obsolete/duplicate docs at root archived (`archive/root/`); only the canonical hub remains at root. Full evidence & classification: [audit/DOCUMENTATION_SYNC_AUDIT.md](audit/DOCUMENTATION_SYNC_AUDIT.md)
- **2026-08-05 Phase-2:** ✅ `gmail-sync/` (19) + `transactions/` (5) archived (git mv — history utuh, self-declared historical); `docs/ai/` + `docs/deployment/` created; ADR-008..011
- **Navigation:** ✅ every folder has `INDEX.md` (35)
- **Why-decisions:** ✅ 11 ADRs
- **Current-state:** ✅ `docs/system/` (4)
- **Historical:** ✅ archived (63 files — 62 docs + `ARCHIVE.md` policy; nothing deleted)
- **Governance:** ✅ `docs/meta/` (7) — audit, structure, naming, style, cleanup, quality, consistency
- **Assets:** ✅ centralized under `docs/assets/`
- **Remaining debt:** content drift in historical docs; phased migration to target IA ([meta/DOCUMENTATION_STRUCTURE.md](meta/DOCUMENTATION_STRUCTURE.md))
