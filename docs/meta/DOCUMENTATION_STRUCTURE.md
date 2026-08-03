# Documentation Structure — Target Information Architecture

> **Status:** Approved (target) · **Version:** 1.0 · **Owner:** Core Engineering · **Last Updated:** 2026-08-04
> **Related:** [DOCUMENTATION_AUDIT](DOCUMENTATION_AUDIT.md), [DOCUMENTATION_MAP](../DOCUMENTATION_MAP.md)

---

## 1. Target Hierarchy

```text
docs/
├── DOCUMENTATION_MAP.md          # Single navigation hub (Phase 15)
├── meta/                         # Documentation system itself
│   ├── DOCUMENTATION_AUDIT.md
│   ├── DOCUMENTATION_STRUCTURE.md  (this file)
│   ├── NAMING_CONVENTION.md
│   ├── DOCUMENTATION_STYLE_GUIDE.md
│   ├── REPOSITORY_CLEANUP_REPORT.md
│   └── DOCUMENTATION_QUALITY_REPORT.md
├── adr/                          # Architecture Decision Records
│   ├── ADR-001-better-auth.md
│   ├── ADR-002-turso.md
│   ├── ADR-003-sse.md
│   ├── ADR-004-ai-pipeline.md
│   ├── ADR-005-monitoring.md
│   ├── ADR-006-discovery-engine.md
│   └── ADR-007-gmail-sync.md
├── architecture/                 # ✅ ACTIVE — architecture & implementation audits
├── security/                     # ✅ ACTIVE — security audit
├── performance/                  # ✅ ACTIVE — performance audit
├── backend/                      # (target) server, API, auth, database
├── frontend/                     # (target) UI, state, theming
├── database/                     # (target) schema, migrations, backup
├── authentication/               # (target) Better Auth specifics
├── ai/                           # (target) Gemini, Vertex, Discovery Engine
├── monitoring/                   # (target) metrics, alerts, observability
├── deployment/                   # (target) CI/CD, hosting, envs
├── guides/                       # (target) how-to & troubleshooting
├── reference/                    # (target) API reference, glossary
├── assets/                       # Shared assets (ACTIVE now)
│   ├── screenshots/              #   21 PNG (kebab-case)
│   └── diagrams/                 #   Mermaid canonical diagrams
├── archive/                      # Historical/legacy (ACTIVE now)
│   ├── ARCHIVE.md                #   Archive policy
│   ├── root/                     #   Archived root-level legacy docs
│   ├── workflow-reviews/         #   Point-in-time review/feature reports
│   └── feature-docs/             #   Early feature development docs
└── <domain>/                     # Active domain folders (now):
    ├── audit/   e2e/   enterprise/   system/
    ├── google-cloud/   gmail-sync/   transactions/
    └── mobile/   ui/   ai-pipeline/
```

## 2. Current → Target Mapping

| Current folder | Target location | Status |
|---|---|---|
| ~~`docs/audit/`~~ (9) | `docs/security/`, `docs/performance/`, `docs/architecture/` (+ `meta/` for `DOCUMENTATION_CONSISTENCY.md`) | ✅ Split (Phase B, 2026-08-04) |
| `docs/e2e/` (10) | `docs/testing/e2e/` | Keep now |
| `docs/enterprise/` (12) | `docs/architecture/` + `docs/roadmap/` | Keep now |
| `docs/system/` (4) | `docs/architecture/` + `docs/reference/` | Keep now |
| `docs/google-cloud/` (2) | `docs/ai/` + `docs/deployment/` | Keep now |
| `docs/gmail-sync/` (18) | `docs/guides/gmail-sync/` | Keep now (historical reference) |
| `docs/transactions/`, `docs/mobile/`, `docs/ui/`, `docs/ai-pipeline/` | `docs/archive/` in Phase 2 | Keep now with INDEX |
| `docs/review*`, `docs/feat-*`, `docs/fix-*`, `docs/implement-*`, `docs/agent-search*`, `docs/implementation/` | `docs/archive/` | ✅ Moved (this pass) |
| Root legacy `.md` (6) | `docs/archive/root/` | ✅ Moved (this pass) |

## 3. Purpose / Ownership / Contents

| Folder | Purpose | Owner |
|---|---|---|
| `meta/` | Governance of documentation itself | Documentation architect |
| `adr/` | Why-decisions (context → decision → consequences) | Architecture team |
| `assets/` | Binary + diagram assets only (no prose) | Core Engineering |
| `archive/` | Historical truth, never deleted | Core Engineering |

## 4. Navigation Rules

1. **Entry:** `README.md` → `docs/DOCUMENTATION_MAP.md` → folder `INDEX.md` → document.
2. Every folder must have `INDEX.md` (enforced — 19 present).
3. Cross-references use **relative paths** (`../meta/STYLE_GUIDE.md`).
4. Never link into `docs/archive/` from active docs (historical only).

## 5. Phased Migration Plan

- **Phase A (this pass):** governance layer + indexes + ADRs + archive + map. ✅
- **Phase B (partial ✅):** `audit/` → security/performance/architecture done 2026-08-04; `e2e/` → testing/e2e **pending**.
- **Phase C:** migrate domain checklists → `guides/` or `archive/`; add API reference.
- **Phase D:** add docs CI (link check, header lint, Mermaid lint).
