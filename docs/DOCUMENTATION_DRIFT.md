# Documentation Drift Register

**Project:** CashFlow
**Date:** 2026-08-04
**Status:** All active drift resolved (this sync)

This register records every discrepancy found between documentation claims and the implementation, grouped by subsystem. Format: **Document | Claim | Reality | Resolution**.

---

## 1. Backend / Architecture

| Document | Claim | Reality | Resolution |
|---|---|---|---|
| `README.md` | Express 5 stack, stale env table, wrong folder structure | Express 4.22.2; env without `GEMINI_API_KEY`; current layout | **Rewritten** |
| `CONTRIBUTING.md` | Express 5 | Express 4.22.2 | Corrected |
| `CHANGELOG.md` | Express 5 | Express 4.22.2 | Corrected |
| `docs/system/ARCHITECTURE.md` | Express 5 | Express 4.22.2 | Corrected |
| `docs/system/SYSTEM_AUDIT_REPORT.md` | Express 5; GCS mislabeled | Express 4; GCS = JSONL staging | Corrected |
| `docs/repository/REPOSITORY_AUDIT.md` | Express 5 | Express 4.22.2 | Corrected |
| `docs/enterprise/EXECUTIVE_SUMMARY.md` | Express 5 | Express 4.22.2 | Corrected |
| `docs/enterprise/ARCHITECTURE_AUDIT.md` | Express 5 | Express 4.22.2 | Corrected |
| `docs/architecture/IMPLEMENTATION_AUDIT_REPORT.md` | Express 5 | Express 4.22.2 | Corrected |

**Drift count: 9 documents.** Root cause: an upgrade plan documented before Express 5 was actually adopted; the project remained on Express 4.

---

## 2. Database & Authorization

| Document | Claim | Reality | Resolution |
|---|---|---|---|
| `docs/notification-database-schema.md` | Supabase/Postgres schema with RLS policies | Turso/libSQL, 22 tables; authorization via `requireAuth` middleware + ownership checks, **not RLS** | SUPERSEDED banner |
| `docs/transactions/*` (4 of 5 files) | Supabase-era transaction flows | Client-driven flows over Turso | SUPERSEDED banners |
| `.kiro/specs/supabase-core-schema-fix/*` | Supabase schema fix spec | Supabase fully removed | SUPERSEDED banner |
| `docs/security/SECURITY_AUDIT.md` §4 | References Supabase stub | Stub since deleted | Annotated |
| Legacy docs generally | Supabase/Firebase anywhere in active stack | Zero Supabase/Firebase in active code | Banners/annotations |

---

## 3. Authentication

| Document | Claim | Reality | Resolution |
|---|---|---|---|
| `agent.md` | Firebase-era product brief | Better Auth + Google OAuth | SUPERSEDED banner |
| `.kiro/specs/notification-system/*` | Supabase-auth-era spec | Better Auth session model | SUPERSEDED banner |

---

## 4. Realtime

| Document | Claim | Reality | Resolution |
|---|---|---|---|
| Legacy gmail-sync/notification docs | Supabase Realtime / Edge Functions | SSE `GET /api/events` with 12 event types; Edge Functions removed | SUPERSEDED banners |
| `README.md` (pre-rewrite) | No dedicated realtime description | SSE is a first-class subsystem | New dedicated SSE section added |

---

## 5. AI Pipeline

| Document | Claim | Reality | Resolution |
|---|---|---|---|
| `README.md` env table | `GEMINI_API_KEY` required | Vertex AI via **service account only**; `GEMINI_API_KEY` is dead legacy config | Removed from env table |
| `docs/adr/ADR-004-ai-pipeline.md` | Describes API-key path | API-key path removed | Annotation added |
| Legacy docs | `gemini-2.5-flash` model | `gemini-2.5-flash-lite` in production | Bannered/corrected where active |
| `docs/google-cloud/GENAI_APP_BUILDER_IMPLEMENTATION_CHECKLIST.md` | GenAI App Builder path as current | Discovery Engine REST + GCS JSONL staging is the shipped path | SUPERSEDED banner |

Note: LRU cache + single-flight + retry and rule-based frontend fallbacks are accurately documented in `docs/ai-pipeline/*` (no drift).

---

## 6. Gmail Sync

| Document | Claim | Reality | Resolution |
|---|---|---|---|
| 17 of 19 `docs/gmail-sync/*` checklists | Supabase-era storage; Gmail **History API** incremental sync | Client-driven Gmail REST sync; **no History API** — `history` denotes the `initial_history` run type | SUPERSEDED banners on all 17 |
| `docs/e2e/CI_PIPELINE.md` | Stale stub mention | Stub removed | Annotation added |

---

## 7. Storage (GCS)

| Document | Claim | Reality | Resolution |
|---|---|---|---|
| `docs/assets/diagrams/ARCHITECTURE.md` | GCS labeled as general storage | GCS is JSONL staging for Discovery Engine ingestion only; receipts are **never persisted** | Label corrected |
| `docs/system/SYSTEM_AUDIT_REPORT.md` | Same mislabel | Same | Label corrected |
| `README.md` diagram (pre-rewrite) | Same mislabel | Same | Corrected in rewrite |

---

## 8. Monitoring

| Document | Claim | Reality | Resolution |
|---|---|---|---|
| No active drift found | — | Custom admin monitoring (`/api/admin/metrics/*`, alert scheduler 60s, webhook + SMTP) accurately described in current docs | None |

---

## 9. Cross-Cutting (Links, PII, Metadata)

| Document | Claim | Reality | Resolution |
|---|---|---|---|
| `.github/PULL_REQUEST_TEMPLATE.md` | Relative link target | Target moved/missing | Link fixed |
| `README.md` | `[1.0.0]` reference | Reference target undefined | Fixed |
| `docs/system/SCREENSHOT_INDEX.md` | Plain-text harness reference | Harness renamed/removed | Fixed |
| `docs/architecture/IMPLEMENTATION_COMPLIANCE_MATRIX.md` | Private personal email | PII must not ship in docs | **Redacted** |
| `docs/DOCUMENTATION_MAP.md` | repository: 12 docs; assets count inflated | 11 real docs in repository; assets has 1 real doc | Counts corrected |

---

## Summary

| Category | Discrepancies | Fixed | Bannered/Annotated |
|---|---|---|---|
| Backend/Architecture | 9 | 9 | — |
| Database/Authorization | ~10 | 1 annotation | 9 banners |
| Authentication | 2 | — | 2 banners |
| Realtime | ~19 | README section | banners |
| AI Pipeline | 4 | 1 env table | 2 banners + 1 annotation |
| Gmail Sync | 18 | 1 annotation | 17 banners |
| Storage (GCS) | 3 | 3 | — |
| Cross-cutting | 5 | 5 | — |

**All active drift is resolved as of 2026-08-04.** Historical documents are preserved under SUPERSEDED banners rather than edited or deleted; see [LEGACY_DOCUMENTATION_REPORT.md](./LEGACY_DOCUMENTATION_REPORT.md).
