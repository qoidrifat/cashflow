# Architecture Synchronization Report

**Project:** CashFlow
**Date:** 2026-08-04
**Purpose:** Validate documented architecture claims against the implementation, per subsystem.

Verdict legend: ✅ **Verified** (docs match code) · 🔧 **Corrected** (docs fixed this sync) · 🟠 **Bannered** (legacy docs marked superseded)

---

## Validation Matrix

### Database

| Aspect | Documented (pre-sync) | Implementation | Verdict |
|---|---|---|---|
| Engine | Supabase/Postgres in legacy docs | Turso/libSQL | 🟠 Legacy docs bannered |
| Schema | Supabase RLS schema in `notification-database-schema.md` | 22 tables (`turso-schema.sql`) | 🟠 Bannered |
| ADR | ADR-002-turso.md | Matches | ✅ Verified |

### Authorization

| Aspect | Documented (pre-sync) | Implementation | Verdict |
|---|---|---|---|
| Model | Row-Level Security (RLS) in legacy docs | `requireAuth` middleware + per-query ownership checks | 🟠 Bannered; ground truth documented |
| Identity | Supabase/Firebase auth in legacy briefs | Better Auth + Google OAuth (ADR-001) | 🟠 / ✅ |

### Authentication

| Aspect | Documented | Implementation | Verdict |
|---|---|---|---|
| Provider | Better Auth + Google OAuth | Better Auth + Google OAuth | ✅ Verified (ADR-001) |

### Realtime

| Aspect | Documented (pre-sync) | Implementation | Verdict |
|---|---|---|---|
| Transport | Supabase Realtime / Edge Functions in legacy docs | SSE `GET /api/events`, 12 event types (ADR-003) | 🟠 Bannered |
| README coverage | No dedicated section | Dedicated SSE section added | 🔧 Corrected |
| Edge Functions | Referenced in legacy docs | Removed from codebase | 🟠 Bannered |

### Storage (GCS)

| Aspect | Documented (pre-sync) | Implementation | Verdict |
|---|---|---|---|
| Role of GCS | "General storage" label in 3 docs | JSONL staging for Discovery Engine ingestion only | 🔧 Corrected (3 locations) |
| Receipts | Implied persistence | **Never persisted** | 🔧 Labels clarified |

### Monitoring

| Aspect | Documented | Implementation | Verdict |
|---|---|---|---|
| Metrics | `/api/admin/metrics/*` | Custom admin monitoring endpoints | ✅ Verified |
| Alerts | Scheduler 60s; webhook + SMTP | Alert scheduler 60s; webhook + SMTP channels | ✅ Verified (ADR-005) |

### AI Pipeline

| Aspect | Documented (pre-sync) | Implementation | Verdict |
|---|---|---|---|
| Credentials | `GEMINI_API_KEY` required (README env table) | Vertex AI via service account only; key is dead legacy | 🔧 Corrected |
| Model | `gemini-2.5-flash` in legacy docs | `gemini-2.5-flash-lite` | 🔧/🟠 |
| Resilience | LRU cache + single-flight + retry | Matches | ✅ Verified |
| Fallbacks | Rule-based frontend fallbacks | Matches | ✅ Verified |
| API-key path | Described in ADR-004 | Removed | 🔧 Annotated |

### Gmail Sync

| Aspect | Documented (pre-sync) | Implementation | Verdict |
|---|---|---|---|
| Driver | Supabase-era flows + History API in 17 checklists | Client-driven via Gmail REST (ADR-007) | 🟠 17 bannered |
| History | Incremental History API sync | **No History API**; `history` = `initial_history` run type | 🟠 Clarified in banners |

### Search / Discovery Engine

| Aspect | Documented | Implementation | Verdict |
|---|---|---|---|
| Integration | Discovery Engine REST + GCS JSONL staging | Matches (ADR-006) | ✅ Verified |
| GenAI App Builder checklist | Presented as current path | Superseded by shipped path | 🟠 Bannered |

### Backend Framework

| Aspect | Documented (pre-sync) | Implementation | Verdict |
|---|---|---|---|
| Express version | Express 5 in 9 documents | Express 4.22.2 | 🔧 Corrected in all 9 |
| Ports | Vite 5180 / Express 5181 | Matches | ✅ Verified |

---

## Diagram Synchronization Status

| Diagram | Location | Status |
|---|---|---|
| Canonical mermaid diagram | `docs/assets/diagrams/ARCHITECTURE.md` | ✅ GCS label corrected; declared canonical |
| README mermaid | `README.md` | 🔧 Corrected in rewrite; now embeds canonical labels |
| ASCII architecture | `docs/system/ARCHITECTURE.md` | 🔧 Express claim corrected; kept as text variant |

---

## Summary

| Subsystem | Verdict |
|---|---|
| Database | 🟠 Legacy bannered; Turso reality documented |
| Authorization | 🟠 RLS claims bannered; middleware model documented |
| Authentication | ✅ Verified |
| Realtime | 🟠 + 🔧 (SSE section added) |
| Storage | 🔧 Corrected |
| Monitoring | ✅ Verified |
| AI Pipeline | 🔧 Corrected + 🟠 |
| Gmail Sync | 🟠 Bannered |
| Search | ✅ Verified |
| Backend framework | 🔧 Corrected |

**Conclusion:** The active documentation now reflects the implemented architecture. Remaining legacy material is preserved under SUPERSEDED banners per archive policy.
