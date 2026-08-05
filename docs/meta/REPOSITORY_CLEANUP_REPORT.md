# Repository Cleanup Report

> **Status:** Approved · **Version:** 1.0 · **Owner:** Core Engineering · **Last Updated:** 2026-08-04
> **Related:** [DOCUMENTATION_AUDIT](DOCUMENTATION_AUDIT.md) · **Mode:** Recommendations only — **no automatic deletion**

---

## 1. Executed Cleanup (this pass)

| Item | Action | Result |
|---|---|---|
| Root legacy `.md` (6 files) | Moved → `docs/archive/root/` | Root is now clean (only `README.md`, `agent.md`, `task-list.md`, `LICENSE`) |
| Workflow/review docs (10 folders, 35 files) | Moved → `docs/archive/workflow-reviews/` | Active docs separated from point-in-time reports |
| Early feature docs (3 folders, 13 files) | Moved → `docs/archive/feature-docs/` | History preserved, not deleted |
| `docs/CF-052-REVIEW-PLAN.md` | Moved → `docs/archive/root/` | Point-in-time plan |
| Folder indexes | 32 `INDEX.md` created | Every folder (incl. nested archive) navigable |

## 2. Identified — Recommend, Do NOT Auto-Delete

| Item | Location | Recommendation | Severity |
|---|---|---|---|
| Duplicate workflow template files (`IMPLEMENTATION_PLAN.md`, `PATCH_REPORT.md`, `ROOT_CAUSE_ANALYSIS.md` ×6) | `docs/archive/workflow-reviews/` | Keep as history; consolidate only if re-read | Low |
| Supabase/Firebase mentions in archived docs | `docs/archive/*` | Leave (historical truth); add `Deprecated` banner only when edited | Low |
| `docs/gmail-sync/` (18 checklists) | active | Mark Historical reference (done in INDEX); migrate to `guides/` in Phase 2 | Medium |
| `docs/transactions/`, `docs/mobile/`, `docs/ui/`, `docs/ai-pipeline/` | active | Same — historical; archive in Phase 2 | Medium |
| `docs/notification-database-schema.md` | `docs/` root | ✅ Archived → `archive/root/` (2026-08-05 — self-declared superseded); rekomendasi Phase 2 batal | Low |
| `task-list.md` (root) | active | Keep as task tracker; consider moving to `docs/meta/` or GitHub Projects | Low |
| Hardcoded root-doc paths (`GMAIL_SYNC_SETUP_GUIDE.md`, `SETUP_GEMINI_SERVER.md`, …) di `server/services/agentSearchService.js` `syncCashFlowDocs()` | code | **Stale setelah archive move** — harmless (`existsSync` memfilter; dokumen tetap terindeks via walk `docs/` rekursif). Rekomendasi: hapus blok `rootDocs` saat refactor Phase 2 | Low |
| Duplicate images (none found) | — | 21 screenshots are unique (validated) | — |
| Temp files (`*.log`, `*.err.log` at root) | `.dev-server*.log` etc. | Confirm git-ignored; add to `.gitignore` if not | Low |
| `agent.md` (root) | active | Keep — AI agent instructions (referenced by tooling) | — |

## 3. Root Directory Target State

```text
/ (repo root)
├── README.md          # entry point + documentation hub
├── LICENSE            # MIT
├── agent.md           # AI agent instructions (tooling)
├── task-list.md       # task tracker
├── docs/              # all documentation (see DOCUMENTATION_MAP.md)
├── src/ server/ e2e/ scripts/ .github/
└── (config files)
```

## 4. Next Steps (Phase 2+)

1. Archive `docs/transactions|mobile|ui|ai-pipeline` → `docs/archive/` (or migrate troubleshooting to `docs/guides/`).
2. ✅ **Done (Phase B, 2026-08-04)** — `docs/audit/` split → `docs/security/` (1), `docs/performance/` (1), `docs/architecture/` (7); `DOCUMENTATION_CONSISTENCY.md` → `docs/meta/`.
3. Add `.github/workflows/docs.yml` (link check + header lint + Mermaid lint).
4. Move `task-list.md` to GitHub Projects when convenient.
