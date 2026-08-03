# Documentation Style Guide

> **Status:** Approved · **Version:** 1.0 · **Owner:** Core Engineering · **Last Updated:** 2026-08-04
> **Related:** [NAMING_CONVENTION](NAMING_CONVENTION.md), [DOCUMENTATION_STRUCTURE](DOCUMENTATION_STRUCTURE.md)

---

## 1. Document Metadata Header

Every document **must** start with a metadata block (single H1 title + blockquote):

```markdown
# <Title>

> **Status:** Draft · Review · Approved · Deprecated
> **Version:** 1.0
> **Owner:** <team or name>
> **Last Updated:** YYYY-MM-DD
> **Related:** [Gmail Troubleshooting](../gmail-sync/GMAIL_SYNC_TROUBLESHOOTING.md), [Documentation Map](../DOCUMENTATION_MAP.md)
> **Audience:** <who reads this>
```

Example:
```markdown
# Gmail Sync — Troubleshooting Guide

> **Status:** Approved · **Version:** 2.1 · **Owner:** Core Engineering
> **Last Updated:** 2026-08-03 · **Related:** [README](../../README.md)
> **Audience:** Support engineers, contributors
```

## 2. Heading & Structure Rules

- One `# H1` per file (the title). Use `##` for sections, `###` for subsections.
- No skipped levels (`##` → `####` is invalid).
- Section titles: **Title Case** for English (`System Architecture`), consistent capitalization.
- No duplicate headings within one file.

## 3. Spacing & Formatting

- One blank line before/after every heading, list, and code block.
- Lists: consistent markers (prefer `-`).
- Tables: header row + `|---|---|` separator; no blank lines inside tables.
- Code blocks: always declare language (` ```ts `, ` ```bash `, ` ```mermaid `).
- Line length: prefer ≤ 120 chars (soft rule).

## 4. Admonitions

| Type | Syntax | Use for |
|---|---|---|
| Note | `> **Note:** …` | Additional context |
| Warning | `> **Warning:** …` | Risk, destructive action |
| Deprecated | `> **Deprecated:** …` | Superseded content |

## 5. Language Policy

- **Public-facing docs** (`README.md`, `docs/system/`, `docs/e2e/`, `docs/enterprise/`, new docs): **English**.
- **Internal/historical docs** (archived checklists, workflow reports): Indonesian is acceptable but **not** mixed within a single new document.
- Terminology glossary: use consistent terms (`transaction`, `budget`, `sync run`, `review queue`).

## 6. Cross-References

- Use **relative links** — never absolute repo paths or `../` chains that skip an index.
- Related docs: add a `## Related` section at the bottom of every document.
- Never link into `docs/archive/` from active documentation.
- Every link target must exist (validated in [QUALITY_REPORT](DOCUMENTATION_QUALITY_REPORT.md)).

## 7. Diagrams

- Use **Mermaid** inside ` ```mermaid ` fences.
- Canonical diagrams live in `docs/assets/diagrams/`; prose docs embed or reference them.
- Validate Mermaid syntax before commit (see QUALITY_REPORT).

## 8. Templates

### Report template
```markdown
# <Title>

> **Status:** … · **Version:** 1.0 · **Owner:** … · **Last Updated:** …
> **Related:** …

## Summary
## Context
## Findings
## Recommendations
## References
```

### ADR template (see `docs/adr/ADR-001-better-auth.md`)
```markdown
# ADR-<NNN>: <Title>

> **Status:** Accepted · **Date:** YYYY-MM-DD · **Owner:** …

## Context
## Decision
## Alternatives Considered
## Consequences
```
