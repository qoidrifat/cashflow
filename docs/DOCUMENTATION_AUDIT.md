# Documentation Audit

**Project:** CashFlow
**Date:** 2026-08-04
**Scope:** Full-repository documentation audit (260 Markdown files)
**Status:** Complete

---

## Methodology

The audit followed a five-stage pipeline applied to every document:

| Stage | Action |
|---|---|
| **1. READ** | Read each Markdown file in full; inventory title, era, claims, links, embedded assets |
| **2. ANALYZE** | Extract factual claims (stack versions, env vars, endpoints, schemas, flows) and classify intent (architecture, checklist, audit, spec, runbook) |
| **3. VERIFY** | Check each claim against source of truth: `package.json`, `server/` routes/services/config, `src/` frontend code, schema files, runtime configuration |
| **4. COMPARE** | Record discrepancies in the drift register (see [DOCUMENTATION_DRIFT.md](./DOCUMENTATION_DRIFT.md)) with severity |
| **5. SYNCHRONIZE** | Fix active drift, banner legacy docs, annotate historically-significant docs, fix links, redact sensitive data |

**Coverage:** 260 Markdown files scanned repo-wide, including gitignored `.kiro/` and `.agents/`. Approximately 222 are project documents; the remaining 40 are third-party skill bundles (`.agents/skills/`) excluded from project-scope validation.

---

## Source-of-Truth Priority

Where documents disagree, authority is resolved in this order:

| Priority | Source | Examples |
|---|---|---|
| 1 | Running source code | `server/index.js`, `server/routes/*`, `server/services/*`, `src/**` |
| 2 | Dependency manifests & config | `package.json`, `vite.config.ts`, `turso-schema.sql`, `.env.example` |
| 3 | Architecture Decision Records | `docs/adr/ADR-001` … `ADR-007` |
| 4 | Canonical architecture docs | `docs/assets/diagrams/ARCHITECTURE.md`, `docs/system/ARCHITECTURE.md` |
| 5 | Audit & enterprise reports | `docs/enterprise/*`, `docs/architecture/*` |
| 6 | Checklists, specs, briefs | `docs/gmail-sync/*`, `.kiro/specs/*`, `agent.md` |
| 7 | Archive | `docs/archive/*` (historical snapshots, no authority) |

**Established ground truth (2026-08-04):**

| Subsystem | Fact |
|---|---|
| Frontend | React 18 + TypeScript + Vite 5, port 5180 |
| Backend | Express **4.22.2** (not 5), port 5181 |
| Auth | Better Auth + Google OAuth |
| Database | Turso/libSQL, 22 tables; authorization via `requireAuth` middleware + ownership checks, **not** RLS |
| Realtime | SSE `GET /api/events`, 12 event types |
| Monitoring | Custom admin monitoring: `/api/admin/metrics/*`, alert scheduler 60s, webhook + SMTP |
| AI | Vertex AI via service account only; `GEMINI_API_KEY` is dead legacy config; `gemini-2.5-flash` → `gemini-2.5-flash-lite`; LRU cache + single-flight + retry; rule-based frontend fallbacks |
| Search | Agent Search via Discovery Engine REST + GCS JSONL staging (GCS is not general storage; receipts never persisted) |
| Gmail | Client-driven via Gmail REST; **no History API** (`history` = `initial_history` run type); Edge Functions removed |
| Supabase/Firebase | Zero usage in active code |

---

## Per-Directory Status

| Directory | Docs | Status | Actions |
|---|---|---|---|
| `docs/adr/` | 8 | ✅ Current | 1 annotation (ADR-004 API-key path removed) |
| `docs/ai-pipeline/` | 3 | ✅ Current | None |
| `docs/architecture/` | 7 | ⚠️ Mixed | Express corrected; redaction; June audit bannered |
| `docs/archive/` | 80 | 📦 Historical | Untouched (acceptable snapshots) |
| `docs/assets/` | 4 | ⚠️ Minor | GCS diagram label corrected |
| `docs/e2e/` | 11 | ✅ Current | 1 annotation (CI_PIPELINE stale stub) |
| `docs/enterprise/` | 13 | ⚠️ Minor | Express corrected in 2 files |
| `docs/gmail-sync/` | 19 | 🟠 Legacy | 17/19 bannered SUPERSEDED |
| `docs/google-cloud/` | 3 | 🟠 Mixed | 1 checklist bannered |
| `docs/meta/` | 8 | ✅ Current | Overlap with repository/ noted |
| `docs/mobile/` | 4 | ✅ Current | None |
| `docs/performance/` | 2 | ✅ Current | None |
| `docs/repository/` | 12 | ⚠️ Minor | Express corrected in REPOSITORY_AUDIT |
| `docs/security/` | 2 | ⚠️ Minor | §4 annotation (deleted Supabase stub) |
| `docs/system/` | 5 | ⚠️ Minor | Express + GCS label corrected; SCREENSHOT_INDEX fixed |
| `docs/transactions/` | 5 | 🟠 Legacy | 4/5 bannered |
| `docs/ui/` | 4 | ✅ Current | None |
| `docs/` root | 2 | ⚠️ Minor | DOCUMENTATION_MAP counts corrected |
| Root `*.md` | 7 | 🔴 Rewritten/bannered | README rewritten; agent.md bannered |
| `.kiro/` | 18 | 🟠 Legacy | 3 spec folders bannered |
| `.agents/skills/` | 40 | ⬜ Out of scope | Third-party, gitignored |
| `.github/` | 3 | ⚠️ Minor | Broken link fixed |

Legend: ✅ current · ⚠️ minor fixes applied · 🟠 legacy (bannered) · 🔴 rewritten · 📦 historical · ⬜ out of scope

---

## Security Scan Results

| Finding | Severity | Status |
|---|---|---|
| Private personal email in `docs/architecture/IMPLEMENTATION_COMPLIANCE_MATRIX.md` | Medium | **Redacted** this sync |
| `GEMINI_API_KEY` previously committed; scrubbed from 3 archived docs, but reportedly still active in `server/.env` | **High (open)** | **Recommend rotation + optional git history purge before public release** |
| GCP project IDs in archived docs | Low | Accepted risk (archive) |
| Missing images / secret-bearing screenshots | — | None found |
| Secrets in active (non-archived) docs | — | None found |

---

## Audit Outputs

This audit produced the following companion documents:

| Document | Purpose |
|---|---|
| [DOCUMENTATION_SYNC_REPORT.md](./DOCUMENTATION_SYNC_REPORT.md) | Executive summary of the sync |
| [DOCUMENTATION_DRIFT.md](./DOCUMENTATION_DRIFT.md) | Full drift register |
| [DOCUMENTATION_STRUCTURE.md](./DOCUMENTATION_STRUCTURE.md) | Canonical docs tree & conventions |
| [ARCHITECTURE_SYNC_REPORT.md](./ARCHITECTURE_SYNC_REPORT.md) | Architecture validation matrix |
| [LINK_VALIDATION_REPORT.md](./LINK_VALIDATION_REPORT.md) | Link & screenshot validation |
| [LEGACY_DOCUMENTATION_REPORT.md](./LEGACY_DOCUMENTATION_REPORT.md) | Legacy inventory & recommendations |
| [DUPLICATE_DOCUMENTATION_REPORT.md](./DUPLICATE_DOCUMENTATION_REPORT.md) | Duplicate clusters & merges |
| [README_IMPROVEMENT_REPORT.md](./README_IMPROVEMENT_REPORT.md) | README rewrite detail |
| [CHANGE_SUMMARY.md](./CHANGE_SUMMARY.md) | Summary of all changes |
