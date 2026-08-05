# CashFlow — Documentation Map

> **Status:** Approved · **Version:** 1.1 · **Owner:** Core Engineering · **Last Updated:** 2026-08-05
> **2026-08-05 (sync audit):** 11 file one-off/duplikat di root docs/ di-archive ke `archive/root/` (lihat [audit/DOCUMENTATION_SYNC_AUDIT.md](audit/DOCUMENTATION_SYNC_AUDIT.md)); `docs/ci/` ditambahkan.
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

**219 `.md` files** in `docs/` (2026-08-05): 127 active + 91 archived + 1 root.

| Folder | Real docs | Status | Responsibility |
|---|---|---|---|
| `docs/adr/` | 8 | 🟢 Active | Architecture Decision Records (001–007) + index |
| `docs/architecture/` | 7 | 🟢 Active | Architecture & implementation audits (system report, code quality, gap analysis, compliance matrix) |
| `docs/audit/` | 5 | 🟢 Active | Feature completion matrix, gap analysis, implementation priorities/status, **doc sync audit** |
| `docs/security/` | 4 | 🟢 Active | Security audit + secret/GCP key rotation checklists |
| `docs/performance/` | 2 | 🟢 Active | Performance audit + index |
| `docs/e2e/` | 11 | 🟢 Active | Playwright E2E strategy, coverage, stability, CI pipeline |
| `docs/enterprise/` | 13 | 🟢 Active | Enterprise modernization audit + roadmap + backup runbook |
| `docs/system/` | 5 | 🟢 Active | System architecture, audit report, feature matrix, screenshot index |
| `docs/google-cloud/` | 3 | 🟢 Active | GCP / Agent Builder / Discovery Engine setup |
| `docs/meta/` | 8 | 🟢 Active | Documentation system itself (this layer) + documentation-consistency audit |
| `docs/repository/` | 12 | 🟢 Active | Repository curation & GitHub publication prep (audit, security, readiness, commit guide) |
| `docs/ci/` | 1 | 🟢 Active | CI/CD migration report (GitHub Actions upgrade, 2026-08-05) |
| `docs/review/` | 6 | 🟢 Active | Phase-1 hardening review (root-cause, security, perf, code, readiness, final) |
| `docs/assets/` | 4 + 21 PNG | 🟢 Active | Screenshots (21) + canonical Mermaid diagrams |
| `docs/gmail-sync/` | 19 | 🟡 Historical ref | Gmail sync checklists + troubleshooting (self-declared historical — see INDEX) |
| `docs/transactions/` | 5 | 🟡 Historical ref | Transactions feature checklists |
| `docs/mobile/` | 4 | 🟡 Historical ref | Mobile UI fix checklists |
| `docs/ui/` | 4 | 🟡 Historical ref | UI polish checklists |
| `docs/ai-pipeline/` | 3 | 🟡 Historical ref | Early AI pipeline audits |
| `docs/implementation/` | 2 | 🟡 Historical ref | Baseline & P0 implementation reports |
| `docs/testing/` | 1 | 🟡 Historical ref | Baseline testing report |
| `docs/archive/` | 91 | ⚫ Archived | `root/` (18) · `workflow-reviews/` · `feature-docs/` + `ARCHIVE.md` policy |
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
| Auth | system §5, adr-001, security/SECURITY_AUDIT.md | archive/root |
| AI | google-cloud, adr-004/006, enterprise/AI_* | archive/feature-docs |
| Monitoring | system, adr-005, enterprise/MONITORING_AUDIT | archive/workflow-reviews |
| Testing | e2e (10) | — |
| Security/Perf | security/, performance/, enterprise | archive |
| Gmail | README, adr-007, gmail-sync (18) | archive |

---

## 5. Status Summary

- **2026-08-05 sync audit:** ✅ 11 obsolete/duplicate docs at root archived (`archive/root/`); only the canonical hub remains at root. Full evidence & classification: [audit/DOCUMENTATION_SYNC_AUDIT.md](audit/DOCUMENTATION_SYNC_AUDIT.md)
- **Navigation:** ✅ every folder has `INDEX.md` (35)
- **Why-decisions:** ✅ 7 ADRs
- **Current-state:** ✅ `docs/system/` (4)
- **Historical:** ✅ archived (63 files — 62 docs + `ARCHIVE.md` policy; nothing deleted)
- **Governance:** ✅ `docs/meta/` (7) — audit, structure, naming, style, cleanup, quality, consistency
- **Assets:** ✅ centralized under `docs/assets/`
- **Remaining debt:** content drift in historical docs; phased migration to target IA ([meta/DOCUMENTATION_STRUCTURE.md](meta/DOCUMENTATION_STRUCTURE.md))
