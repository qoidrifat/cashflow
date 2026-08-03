# Naming Convention — Documentation

> **Status:** Approved · **Version:** 1.0 · **Owner:** Core Engineering · **Last Updated:** 2026-08-04
> **Related:** [DOCUMENTATION_STYLE_GUIDE](DOCUMENTATION_STYLE_GUIDE.md)

---

## 1. Rules

| Scope | Convention | Example |
|---|---|---|
| **Folders** | `kebab-case`, lowercase | `docs/agent-search-fix/` |
| **Files (docs)** | `UPPER_SNAKE_CASE.md` for reports/audits/checklists | `SYSTEM_AUDIT_REPORT.md`, `GMAIL_SYNC_TROUBLESHOOTING.md` |
| **Files (ADRs)** | `ADR-NNN-slug.md` | `ADR-001-better-auth.md` |
| **Index files** | Always `INDEX.md` (or `README.md` for the root) | `docs/architecture/INDEX.md` |
| **Assets** | `kebab-case.png` | `dashboard-overview.png`, `gmail-sync-page.png` |
| **Diagrams** | `kebab-case.md` (Mermaid source) | `docs/assets/diagrams/ARCHITECTURE.md` |
| **Meta docs** | `UPPER_SNAKE_CASE.md` | `DOCUMENTATION_STYLE_GUIDE.md` |

## 2. Good Examples

```
docs/meta/DOCUMENTATION_STRUCTURE.md
docs/adr/ADR-004-ai-pipeline.md
docs/assets/screenshots/admin-monitoring.png
docs/e2e/E2E_COVERAGE_REPORT.md
```

## 3. Avoid

| Anti-pattern | Why |
|---|---|
| `notes.md`, `temp.md`, `new.md`, `copy.md`, `final.md`, `final-final.md`, `backup.md`, `Untitled.md` | Meaningless, non-searchable |
| `IMPLEMENTATION_PLAN.md` duplicated across folders | Ambiguous ownership (historical archive only) |
| Mixed case file names (`MyDoc.md`) | Inconsistent on case-sensitive CI |
| Underscore folder names (`docs/my_folder/`) | Inconsistent with kebab-case folders |

## 4. Enforcement

- New docs: follow the table above.
- Existing docs: renamed only during a documented migration (archive preserves old names).
- A CI lint (future) can flag `temp|new|copy|final|backup|untitled|notes\.md` at the repo root and in active folders.
