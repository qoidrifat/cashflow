# Archive — Policy & Contents

> **Status:** Approved · **Version:** 1.0 · **Owner:** Core Engineering · **Last Updated:** 2026-08-04
> **Related:** [DOCUMENTATION_MAP](../DOCUMENTATION_MAP.md)

## Purpose

`docs/archive/` preserves **historical truth** — point-in-time reports, legacy-era documents, and workflow artifacts — without presenting them as the current state of the system. **Nothing here is deleted.** If a document is read again and found useful, it is migrated to an active folder with a metadata header.

## Rules

1. **Read-only by default.** Archived docs are historical snapshots.
2. **Never link to `docs/archive/` from active documentation** (README, active folders).
3. **Adding:** move a doc here only with a one-line note in its header (when edited) and update this index.
4. **Removing:** only with explicit approval (history is valuable).

## Contents

| Subfolder | Files | What it contains |
|---|---|---|
| `root/` | 6 | Legacy root-level docs (Firebase/Supabase era): `ANALISIS_FITUR_CASHFLOW.md`, `DARK_MODE_READABILITY_AUDIT.md`, `GMAIL_SYNC_SETUP_GUIDE.md`, `PROJECT_AGENT_ALIGNMENT_AUDIT.md`, `SETUP_GEMINI_SERVER.md`, `CF-052-REVIEW-PLAN.md` |
| `workflow-reviews/` | 43 | Point-in-time development workflow + post-kiro review reports (10 feature folders) |
| `feature-docs/` | 13 | Early feature development docs (`agent-search*`, `implementation/`) |

## Related

- [INDEX.md](./INDEX.md) — generated index.
- [REPOSITORY_CLEANUP_REPORT](../meta/REPOSITORY_CLEANUP_REPORT.md) — what was moved & why.
