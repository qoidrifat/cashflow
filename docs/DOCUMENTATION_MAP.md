# CashFlow — Documentation Map

> **Status:** Approved · **Version:** 1.0 · **Owner:** Core Engineering · **Last Updated:** 2026-08-04
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
| Documentation system | [docs/meta/](meta/INDEX.md) |
| Repo curation & GitHub prep | [docs/repository/](repository/INDEX.md) |
| Historical / legacy | [docs/archive/ARCHIVE.md](archive/ARCHIVE.md) |

---

## 2. Complete Tree & Folder Responsibilities

**157 documents** + **35 generated indexes** = **192 `.md` files** in `docs/` (2026-08-04).

| Folder | Real docs | Status | Responsibility |
|---|---|---|---|
| `docs/adr/` | 7 | 🟢 Active | Architecture Decision Records (001–007) |
| `docs/architecture/` | 6 | 🟢 Active | Architecture & implementation audits (system report, code quality, gap analysis, compliance matrix) |
| `docs/security/` | 1 | 🟢 Active | Security audit |
| `docs/performance/` | 1 | 🟢 Active | Performance audit |
| `docs/e2e/` | 10 | 🟢 Active | Playwright E2E strategy, coverage, stability, CI pipeline |
| `docs/enterprise/` | 12 | 🟢 Active | Enterprise modernization audit (12 docs) + roadmap |
| `docs/system/` | 4 | 🟢 Active | System architecture, audit report, feature matrix, screenshot index |
| `docs/google-cloud/` | 2 | 🟢 Active | GCP / Agent Builder / Discovery Engine setup |
| `docs/meta/` | 7 | 🟢 Active | Documentation system itself (this layer) + documentation-consistency audit |
| `docs/repository/` | 12 | 🟢 Active | Repository curation & GitHub publication prep (audit, security, readiness, commit guide) |
| `docs/assets/` | 0 (21 PNG + diagrams) | 🟢 Active | Screenshots (21) + canonical Mermaid diagrams |
| `docs/gmail-sync/` | 18 | 🟡 Historical ref | Gmail sync checklists + troubleshooting |
| `docs/transactions/` | 4 | 🟡 Historical ref | Transactions feature checklists |
| `docs/mobile/` | 3 | 🟡 Historical ref | Mobile UI fix checklists |
| `docs/ui/` | 3 | 🟡 Historical ref | UI polish checklists |
| `docs/ai-pipeline/` | 2 | 🟡 Historical ref | Early AI pipeline audits |
| `docs/archive/` | 63 | ⚫ Archived | `root/` (6) · `workflow-reviews/` (43) · `feature-docs/` (13) + `ARCHIVE.md` policy |
| `docs/` root | 2 | 🟢 | `DOCUMENTATION_MAP.md` (this file) + `notification-database-schema.md` (referenced by `.kiro` spec) |

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
| Auth | system §5, adr-001, security/SECURITY_AUDIT.md | archive/root |
| AI | google-cloud, adr-004/006, enterprise/AI_* | archive/feature-docs |
| Monitoring | system, adr-005, enterprise/MONITORING_AUDIT | archive/workflow-reviews |
| Testing | e2e (10) | — |
| Security/Perf | security/, performance/, enterprise | archive |
| Gmail | README, adr-007, gmail-sync (18) | archive |

---

## 5. Status Summary

- **Navigation:** ✅ every folder has `INDEX.md` (35)
- **Why-decisions:** ✅ 7 ADRs
- **Current-state:** ✅ `docs/system/` (4)
- **Historical:** ✅ archived (63 files — 62 docs + `ARCHIVE.md` policy; nothing deleted)
- **Governance:** ✅ `docs/meta/` (7) — audit, structure, naming, style, cleanup, quality, consistency
- **Assets:** ✅ centralized under `docs/assets/`
- **Remaining debt:** content drift in historical docs; phased migration to target IA ([meta/DOCUMENTATION_STRUCTURE.md](meta/DOCUMENTATION_STRUCTURE.md))
