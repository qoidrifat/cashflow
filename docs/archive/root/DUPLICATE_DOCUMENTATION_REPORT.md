# Duplicate Documentation Report

**Project:** CashFlow
**Date:** 2026-08-04
**Scope:** Identifies redundant/duplicate documentation clusters and recommends consolidation.

**Policy:** No documents are deleted or merged automatically. All actions below are recommendations requiring human approval.

---

## Overview

| # | Cluster | Duplicates | Recommendation | Priority |
|---|---|---|---|---|
| 1 | Generated INDEX.md files | 35 files (17 in archive) | Consolidate archive indexes into `docs/archive/ARCHIVE.md` | Medium |
| 2 | Architecture diagrams | 3 descriptions | Keep canonical + README embed | High |
| 3 | System audit reports | 2 reports | Archive June report | High |
| 4 | Same-name audits | architecture/ vs enterprise/ | Cross-link + disambiguate titles | Medium |
| 5 | Meta vs repository curation | docs/meta vs docs/repository | Merge or cross-link | Low |
| 6 | Gmail-sync checklist sprawl | 17 single-issue checklists | Distill into one current doc | High |
| 7 | Workflow-review twins | feat-X + review-feat-X | Merge or archive one of each pair | Low |

---

## Cluster 1 — Generated INDEX.md Files (35)

**Finding:** 35 generated `INDEX.md` files exist, all produced from one shared template. The 17 inside `docs/archive/` duplicate the single `docs/archive/ARCHIVE.md`.

| Aspect | Detail |
|---|---|
| Files | 35 `INDEX.md` (17 under `archive/`) |
| Redundancy | Archive indexes restate `ARCHIVE.md` content |
| **Recommendation** | Keep active-folder indexes; collapse the 17 archive indexes into `docs/archive/ARCHIVE.md` |

---

## Cluster 2 — Architecture Described 3×

**Finding:** The same architecture is described in three independent places, which is the root cause of repeated drift (e.g., the Express 5/4 issue propagated across all three).

| Location | Form | Disposition |
|---|---|---|
| `docs/assets/diagrams/ARCHITECTURE.md` | Mermaid (canonical) | ✅ **Keep as canonical** |
| `README.md` | Mermaid | Embed/link canonical, do not duplicate |
| `docs/system/ARCHITECTURE.md` | ASCII | Keep as text variant or link canonical |

**Recommendation:** Declare `docs/assets/diagrams/ARCHITECTURE.md` the single source; README embeds it; other docs link rather than re-describe.

---

## Cluster 3 — Two System Audit Reports

**Finding:** Two system audit reports exist: a June Supabase-era audit and the current 2026-08-03 report.

| Report | Era | Disposition |
|---|---|---|
| `docs/architecture/CASHFLOW_SYSTEM_AUDIT_REPORT.md` | June (Supabase-era) | 🟠 Bannered; **archive recommended** |
| `docs/system/SYSTEM_AUDIT_REPORT.md` | 2026-08-03 (current) | ✅ Keep |

**Recommendation:** Banner already applied; complete by archiving the June report.

---

## Cluster 4 — Same-Name Audits (architecture/ vs enterprise/)

**Finding:** Audit documents with overlapping names exist in both `docs/architecture/` and `docs/enterprise/` (e.g., `ARCHITECTURE_AUDIT.md` in both).

**Recommendation:** Cross-link the pairs and disambiguate titles by prefixing scope (e.g., `enterprise/ARCHITECTURE_AUDIT.md` → enterprise-focused; `architecture/...` → implementation-focused). No deletion needed.

---

## Cluster 5 — docs/meta vs docs/repository Overlap

**Finding:** Documentation-curation content overlaps between `docs/meta/` (8 docs) and `docs/repository/` (12 docs).

**Recommendation:** Either merge curation docs into one location or add cross-links clarifying which is authoritative. Low priority.

---

## Cluster 6 — Gmail-Sync Checklist Sprawl (17)

**Finding:** 17 single-issue checklists accumulate in `docs/gmail-sync/`, one per historical fix. All are Supabase-era and now bannered.

**Recommendation:** Distill durable lessons from the 17 checklists into a single current `GMAIL_SYNC.md`, then archive the originals. High priority — this is the largest single source of legacy noise.

---

## Cluster 7 — Workflow-Review Twins

**Finding:** Inside `docs/archive/workflow-reviews/`, pairs like `feat-X` and `review-feat-X` duplicate each other.

**Recommendation:** For each twin pair, keep one (prefer the `review-` variant) and archive the other. Low priority since already archived.

---

## Consolidation Principles

1. Prefer **linking/embedding** over copying (especially the architecture diagram).
2. Prefer **distillation + archive** over deletion for legacy sprawl.
3. Prefer **cross-linking + title disambiguation** for same-name audits.
4. Never auto-delete; all merges require human approval.
