# .gitignore Review

> **Status:** Approved · **Version:** 1.0 · **Owner:** Qoid Rif'at
> **Last Updated:** 2026-08-04 · **Related:** [SECURITY_REPOSITORY_REVIEW](SECURITY_REPOSITORY_REVIEW.md), [CLUTTER_REPORT](CLUTTER_REPORT.md)
> **Audience:** Maintainers

---

## 1. Verified Coverage (each rule tested with `git check-ignore`)

| Rule | Protects | Verified |
|---|---|---|
| `node_modules` | root + `server/node_modules` (108 MB) | ✅ |
| `test-results/`, `playwright-report/`, `blob-report/`, `test-results-attempt-*/`, `playwright-report-attempt-*/` | E2E artifacts | ✅ |
| `dist/`, `dist-ssr/` | build output | ✅ |
| `*.local` | `.env.local` (contains real secrets) | ✅ |
| `server/.env`, `server/*.env` | server secrets | ✅ |
| `server/*.json` (+ whitelist `!server/package.json`, `!server/package-lock.json`) | `server/cashflow-service-account.json` | ✅ |
| `server/google-agent-search-service-account.json` (explicit) | GCP service account | ✅ |
| `*.service-account.json` | any future service account | ✅ |
| `supabase/.temp/` | (folder now deleted — historical rule) | ✅ |
| `.dev-server*.log` | dev logs (~1.1 MB) | ✅ |
| `public/logout-success-recording*`, `public/recordings/` | screen recordings (PII) | ✅ |
| `*.db`, `*.db-journal` | `cashflow.db`, `tmp-e2e-test.db-journal` | ✅ |
| `backups/` | Turso dumps (PII) | ✅ |
| `.bob/` | agent runtime state | ✅ |

**Bottom line:** `git status --short` reports **0 untracked files** — every sensitive/generated item on disk is correctly ignored.

---

## 2. Gaps (all applied 2026-08-04)

| # | Rule | Target | Why |
|---|---|---|---|
| G1 | `public/logout-debug-viewport.png` | debug PNG (currently **tracked**!) | Requires `git rm --cached` first, then ignore |
| G2 | `.agents/` | AI-skill bundles (40 files, incl. Supabase stack) | Internal scaffolding (see Legacy Report) |
| G3 | `.kiro/` | AI workflow specs (19 files) | Internal; some superseded |
| G4 | `task-list.md` | personal to-do | Not product doc |
| G5 | `skills-lock.json` | skill lockfile (if `.agents/` ignored) | Companion of G2 |
| G6 | `*.tsbuildinfo` | TS incremental build cache | Hygiene (currently absent) |
| G7 | (optional) `.vscode/` | empty `settings.json` | Only if not committing workspace config |

---

## 3. Rules Already Present But Now Redundant

- `supabase/.temp/` — the whole `supabase/` folder was deleted in `55d11d2`; the rule is harmless. Keep (defensive) or remove.

---

## 4. Proposed Final .gitignore (delta only)

```gitignore
# Repository curation (2026-08-04)
.agents/
.kiro/
skills-lock.json
task-list.md
public/logout-debug-viewport.png
*.tsbuildinfo
```

> **Status: APPLIED 2026-08-04** — all rules above were appended to `.gitignore` (plus `*.tsbuildinfo`) and verified active via `git check-ignore`.

---

## References

- [SECURITY_REPOSITORY_REVIEW.md](SECURITY_REPOSITORY_REVIEW.md)
- [CLUTTER_REPORT.md](CLUTTER_REPORT.md)
- [GIT_COMMIT_GUIDE.md](GIT_COMMIT_GUIDE.md)
