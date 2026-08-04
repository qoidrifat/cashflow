# Legacy Documentation Report

**Project:** CashFlow
**Date:** 2026-08-04
**Scope:** Inventory, classification, and disposition of documents that no longer reflect the implementation.

**Policy:** Documents are never auto-deleted. Legacy material is either **bannered in place**, **moved to archive**, or flagged for a future human-approved update.

---

## Classification Scheme

| Class | Meaning | Disposition |
|---|---|---|
| 🟠 **Legacy** | Describes a removed/superseded architecture; kept for history | SUPERSEDED banner in place |
| 📦 **Archive** | Historical snapshot; acceptable as-is | Lives under `docs/archive/`, untouched |
| 🔄 **Update** | Still valuable but needs a refresh | Queued for future human update |

---

## Legacy Inventory

### Root briefs

| Document | Era | Class | Action Taken |
|---|---|---|---|
| `agent.md` | Firebase product brief | 🟠 Legacy | SUPERSEDED banner added |

### Standalone schemas

| Document | Era | Class | Action Taken |
|---|---|---|---|
| `docs/notification-database-schema.md` | Supabase RLS schema | 🟠 Legacy | SUPERSEDED banner added |

### Gmail sync checklists (17 of 19)

| Documents | Era | Class | Action Taken |
|---|---|---|---|
| 17 files in `docs/gmail-sync/` | Supabase-era + History API | 🟠 Legacy | SUPERSEDED banner on all 17 |

Two `docs/gmail-sync/` files remain current and were left untouched.

### Transactions (4 of 5)

| Documents | Era | Class | Action Taken |
|---|---|---|---|
| 4 files in `docs/transactions/` | Supabase-era flows | 🟠 Legacy | SUPERSEDED banner on 4 |

### Architecture (June audit)

| Document | Era | Class | Action Taken |
|---|---|---|---|
| `docs/architecture/CASHFLOW_SYSTEM_AUDIT_REPORT.md` | June audit (pre-Turso) | 🟠 Legacy | SUPERSEDED banner; **archive recommended** |

### Google Cloud

| Document | Era | Class | Action Taken |
|---|---|---|---|
| `docs/google-cloud/GENAI_APP_BUILDER_IMPLEMENTATION_CHECKLIST.md` | Superseded path | 🟠 Legacy | SUPERSEDED banner |

### `.kiro/specs/` (3 folders)

| Spec Folder | Era | Class | Action Taken |
|---|---|---|---|
| `notification-system` | Supabase auth era | 🟠 Legacy | SUPERSEDED banner |
| `supabase-core-schema-fix` | Supabase era | 🟠 Legacy | SUPERSEDED banner |
| `cashflow-audit-genai-implementation` | Superseded AI path | 🟠 Legacy | SUPERSEDED banner |

### Archive (already historical)

| Location | Count | Class | Action Taken |
|---|---|---|---|
| `docs/archive/*` | 80 | 📦 Archive | Untouched (acceptable snapshots) |

---

## Summary by Class

| Class | Count | Status |
|---|---|---|
| 🟠 Legacy (bannered this sync) | 25+ documents across 7 locations | Done |
| 📦 Archive (untouched) | 80 documents | Acceptable |
| 🔄 Update (queued) | See recommendations | Pending human action |

---

## Delete / Archive Recommendations (never auto-deleted)

| # | Item | Recommendation | Rationale |
|---|---|---|---|
| 1 | `docs/architecture/CASHFLOW_SYSTEM_AUDIT_REPORT.md` | **Archive** | Superseded by `docs/system/SYSTEM_AUDIT_REPORT.md` (2026-08-03) |
| 2 | 17 legacy `docs/gmail-sync/` checklists | **Distill, then archive** | Single-issue sprawl; extract durable lessons into one current doc |
| 3 | 4 legacy `docs/transactions/` flow docs | **Archive** after distillation | Supabase-era flows no longer match code |
| 4 | `.kiro/specs/` legacy folders | **Archive** | Specs describe removed subsystems |
| 5 | `agent.md`, `docs/notification-database-schema.md` | **Archive** | Firebase/Supabase era; no active authority |

**No documents were deleted.** All recommendations above require explicit human approval before execution.

---

## Actions Taken This Sync

1. Added SUPERSEDED banners (with pointer to the current successor document) to every legacy document listed above.
2. Left `docs/archive/` untouched as acceptable historical snapshots.
3. Recorded the archive/distill recommendations for follow-up.

See [DOCUMENTATION_STRUCTURE.md](./DOCUMENTATION_STRUCTURE.md) for the full archive policy.
