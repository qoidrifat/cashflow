# Documentation Structure

**Project:** CashFlow
**Date:** 2026-08-04
**Hub document:** [`docs/DOCUMENTATION_MAP.md`](./DOCUMENTATION_MAP.md)

This document defines the canonical documentation tree, the purpose of each folder, and the conventions that keep the corpus maintainable.

---

## Canonical Docs Tree

```
cashflow/
├── README.md                     # Entry point; embeds canonical architecture diagram
├── CONTRIBUTING.md               # Contributor guide (Express 4, dev workflow)
├── CHANGELOG.md                  # Release history
├── agent.md                      # 🟠 SUPERSEDED (Firebase-era brief)
├── .github/                      # PR/issue templates (3 docs)
├── .kiro/specs/                  # 🟠 Specs; 3 folders bannered (18 docs)
└── docs/                         # 192 documents total
    ├── DOCUMENTATION_MAP.md      # ★ HUB: directory of all docs
    ├── notification-database-schema.md   # 🟠 SUPERSEDED (Supabase RLS)
    ├── adr/            (8)       # Architecture Decision Records — highest prose authority
    ├── ai-pipeline/    (3)       # AI token audit & optimization
    ├── architecture/   (7)       # Audits, compliance matrix, system reports
    ├── archive/       (80)       # 📦 Historical snapshots (read-only policy)
    ├── assets/         (4)       # ★ Canonical diagram, screenshots, index
    ├── e2e/           (11)       # E2E strategy, coverage, CI pipeline
    ├── enterprise/    (13)       # Executive/enterprise audits & runbooks
    ├── gmail-sync/    (19)       # 🟠 17 bannered legacy checklists
    ├── google-cloud/   (3)       # GCP setup docs
    ├── meta/           (8)       # Documentation-curation meta docs
    ├── mobile/         (4)       # Mobile-app docs
    ├── performance/    (2)       # Performance reviews
    ├── repository/    (12)       # Repository audits & hygiene
    ├── security/       (2)       # Security audits
    ├── system/         (5)       # System architecture (ASCII), screenshots
    ├── transactions/   (5)       # 🟠 4 bannered legacy flow docs
    └── ui/             (4)       # UI documentation
```

Legend: ★ canonical/hub · 🟠 legacy (bannered) · 📦 archive

---

## Folder Purposes

| Folder | Count | Purpose | Authority |
|---|---|---|---|
| `docs/adr/` | 8 | Immutable decision records (ADR-001…007 + index) | High |
| `docs/assets/` | 4 | Canonical architecture diagram + screenshots | High (diagram) |
| `docs/system/` | 5 | System architecture (ASCII variant), audit report, screenshot index | High |
| `docs/architecture/` | 7 | Implementation audits, compliance matrix | Medium |
| `docs/enterprise/` | 13 | Executive summaries, security/infra audits, runbooks | Medium |
| `docs/repository/` | 12 | Repository structure audits (11 real docs + index) | Medium |
| `docs/e2e/` | 11 | Testing strategy, coverage, stability, CI | Medium |
| `docs/meta/` | 8 | Docs-about-docs curation processes | Low |
| `docs/ai-pipeline/` | 3 | AI pipeline audits & optimization | Medium |
| `docs/gmail-sync/` | 19 | Gmail sync checklists (17 legacy, bannered) | Low |
| `docs/transactions/` | 5 | Transaction flow docs (4 legacy, bannered) | Low |
| `docs/google-cloud/` | 3 | GCP/Vertex/Discovery Engine setup | Medium |
| `docs/security/` | 2 | Security audits | Medium |
| `docs/performance/` | 2 | Performance reviews | Medium |
| `docs/mobile/` | 4 | Mobile docs | Medium |
| `docs/ui/` | 4 | UI docs | Medium |
| `docs/archive/` | 80 | Historical snapshots | None (read-only) |

---

## Hub: `docs/DOCUMENTATION_MAP.md`

- Single entry point for navigating all documentation.
- Maintains accurate per-folder counts (corrected this sync: repository = 11 real docs, assets = 1 real doc).
- Must be updated whenever documents are added, moved, or archived.

---

## INDEX.md Convention

- Every `docs/` subfolder may carry an `INDEX.md` listing its contents.
- 35 generated INDEX.md files currently exist (17 inside `archive/`), all using one shared template.
- Archive-folder indexes duplicate `docs/archive/ARCHIVE.md`; consolidation is recommended (see [DUPLICATE_DOCUMENTATION_REPORT.md](./DUPLICATE_DOCUMENTATION_REPORT.md)).
- New folders: create an INDEX.md only when the folder holds ≥ 3 documents.

---

## Archive Policy

| Rule | Detail |
|---|---|
| Location | `docs/archive/` (mirrors original paths) |
| Trigger | A document is superseded by newer ground truth, or its subject was deleted |
| Marking | SUPERSEDED banner at top of the original file pointing at its successor, then move |
| Editing | Archived documents are **never edited** — they are historical snapshots |
| Deletion | Documents are **never auto-deleted**; removal requires explicit human approval |
| Secrets | Archived docs must be secret-scanned (3 docs previously scrubbed of `GEMINI_API_KEY`) |

---

## Naming Conventions

| Pattern | Meaning | Example |
|---|---|---|
| `ADR-NNN-slug.md` | Decision record | `ADR-002-turso.md` |
| `*_REPORT.md` | Point-in-time audit output | `SYSTEM_AUDIT_REPORT.md` |
| `*_CHECKLIST.md` | Actionable verification list | `GMAIL_SYNC_500_FIX_CHECKLIST.md` |
| `*_STRATEGY.md` / `*_PLAN.md` | Forward-looking approach | `AI_E2E_STRATEGY.md` |
| `INDEX.md` | Folder table of contents | `docs/adr/INDEX.md` |

---

## Maintenance Rules

1. Source code wins over any document (see source-of-truth priority in [DOCUMENTATION_AUDIT.md](./DOCUMENTATION_AUDIT.md)).
2. One canonical architecture diagram: `docs/assets/diagrams/ARCHITECTURE.md`; other documents embed or link, never duplicate.
3. Date every audit report; supersede rather than overwrite.
4. Update `DOCUMENTATION_MAP.md` counts whenever the tree changes.
