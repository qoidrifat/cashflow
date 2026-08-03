# Legacy Files Report

> **Status:** Approved · **Version:** 1.0 · **Owner:** Qoid Rif'at
> **Last Updated:** 2026-08-04 · **Related:** [CLUTTER_REPORT](CLUTTER_REPORT.md), [REPOSITORY_AUDIT](REPOSITORY_AUDIT.md), [GIT_COMMIT_GUIDE](GIT_COMMIT_GUIDE.md)
> **Audience:** Maintainers

---

## 1. Summary

CashFlow has evolved through **three storage/auth generations** (Firebase → Supabase → Turso + Better Auth). Earlier cleanup commits (`55d11d2`) removed `supabase/`, `firestore.*`, and the `@supabase/supabase-js` dependency. This report classifies the **remaining** legacy traces.

Classification legend: **SAFE TO DELETE** · **KEEP FOR HISTORY** · **NEEDS REVIEW**.

---

## 2. Findings by Category

### 2.1 Firebase / Firestore

| Item | Tracked? | Class |
|---|---|---|
| Naming remnant `firebaseUser` in source | No — renamed to `authUser` in `55d11d2` (0 matches in `src/`) | ✅ Resolved |
| `firestore.rules` / `firestore.indexes.json` | No — deleted in `55d11d2` | ✅ Resolved |
| Docs mentioning Firebase (dated snapshots in `docs/archive/`) | Yes — archived | KEEP FOR HISTORY |

### 2.2 Supabase

| Item | Tracked? | Class |
|---|---|---|
| `supabase/` folder (Edge Function + 10 migrations) | No — deleted in `55d11d2` | ✅ Resolved |
| `@supabase/supabase-js` dependency | No — removed in `55d11d2` | ✅ Resolved |
| Migrate scripts (`migrateSupabaseToTurso.js`, `migrateGmailSupabaseToTurso.mjs`) | No — deleted in `55d11d2` | ✅ Resolved |
| `.agents/skills/supabase/` + `.agents/skills/supabase-postgres-best-practices/` | No longer tracked (2026-08-04 — untracked + gitignored) | ✅ **RESOLVED** |
| `.kiro/specs/supabase-core-schema-fix/` (+ other Supabase-era specs in `.kiro/`) | No longer tracked (2026-08-04 — untracked + gitignored) | ✅ **RESOLVED** |
| `skills-lock.json` (pins the 2 Supabase skills) | No longer tracked (2026-08-04 — untracked + gitignored) | ✅ **RESOLVED** |
| `docs/supabase-migration/` | No — already removed earlier | ✅ Resolved |

**Assessment:** the remaining Supabase traces are **AI-agent skill bundles and internal spec notes**, not application code. They reference a stack that is fully decommissioned (project deleted from Supabase dashboard). They add noise and confusion for contributors.

### 2.3 SQLite / local DB

| Item | Class |
|---|---|
| `cashflow.db` (274 KB, on disk) | SAFE TO DELETE locally — git-ignored, dev-only; production DB is Turso |
| `tmp-e2e-test.db-journal` (on disk) | SAFE TO DELETE locally — git-ignored |

### 2.4 Old Gmail Sync / Monitoring / Auth docs

| Item | Class |
|---|---|
| `docs/archive/feature-docs/agent-search-fix/`, `docs/archive/workflow-reviews/review-*` | KEEP FOR HISTORY (already archived — this is the correct home) |
| `docs/gmail-sync/` (18 active checklists) | NEEDS REVIEW — active but historical-reference; verify links before moving (per DOCUMENTATION_STRUCTURE phased migration) |

---

## 3. Recommendation Summary

| Item | Recommended action | Why |
|---|---|---|
| `.agents/` (40 files) | ✅ **Done (2026-08-04)** — untracked + gitignored | AI-skill bundles incl. decommissioned Supabase stack; not product code |
| `.kiro/` (19 files) | ✅ **Done (2026-08-04)** — untracked + gitignored | Internal AI workflow notes; valuable specs can be migrated to `docs/` later |
| `skills-lock.json` | ✅ **Done (2026-08-04)** — untracked + gitignored | Lockfile for the skills above |
| `task-list.md` | ✅ **Done (2026-08-04)** — untracked + gitignored | Personal to-do, not product doc |
| `agent.md` | Rename to `AGENTS.md` (optional keep) | Industry convention; helps AI-assisted contributors |
| `docs/gmail-sync/` etc. | Keep for now; phased migration per meta/DOCUMENTATION_STRUCTURE | Historical reference, internally linked |
| `docs/archive/**` | KEEP FOR HISTORY — never delete | Point-in-time evidence, governance policy (`docs/archive/ARCHIVE.md`) |

---

## 4. What Must NOT Be Removed

- `docs/archive/**` — archived history is the audit trail (per `docs/archive/ARCHIVE.md` policy: archived ≠ deleted).
- `e2e/visual/*-snapshots/` — CI baselines.
- `docs/assets/screenshots/` — README gallery (though see PII note in Security Review §3.3).

---

## References

- [CLUTTER_REPORT.md](CLUTTER_REPORT.md)
- [GIT_COMMIT_GUIDE.md](GIT_COMMIT_GUIDE.md)
- [docs/archive/ARCHIVE.md](../archive/ARCHIVE.md)
- [docs/meta/DOCUMENTATION_STRUCTURE.md](../meta/DOCUMENTATION_STRUCTURE.md)
