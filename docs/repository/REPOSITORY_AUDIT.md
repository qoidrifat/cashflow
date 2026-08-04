# Repository Audit

> **Status:** Approved · **Version:** 1.0 · **Owner:** Qoid Rif'at
> **Last Updated:** 2026-08-04 · **Related:** [GIT_COMMIT_GUIDE](GIT_COMMIT_GUIDE.md), [SECURITY_REPOSITORY_REVIEW](SECURITY_REPOSITORY_REVIEW.md), [CLUTTER_REPORT](CLUTTER_REPORT.md)
> **Audience:** Maintainers, collaborators, security reviewers

---

## 1. Executive Summary

CashFlow is a full-stack AI-native personal finance platform (React + Vite + Express + Better Auth + Turso + Google Cloud/Vertex AI). The repository is **structurally healthy** for public release:

- **499 tracked files**, **11.9 MB** tracked size, **45 commits** on branch `gh-pages`.
- **No secrets tracked** in source: `.env` files, service-account JSONs, SQLite DBs, recordings, and backups are all verified git-ignored (see [SECURITY_REPOSITORY_REVIEW](SECURITY_REPOSITORY_REVIEW.md)).
- **One critical finding**: a literal Google API key (`AIzaSy…`) appears inside **3 archived review documents** — must be scrubbed/revoked before publishing (details in Security Review §3.1).
- Working tree is clean except **1 modified file** (`docs/enterprise/EXECUTIVE_SUMMARY.md`).
- GitHub collaboration layer is **incomplete**: no `CONTRIBUTING.md`, `CHANGELOG.md`, `SECURITY.md`, issue/PR templates, or Dependabot (see [GITHUB_READINESS](GITHUB_READINESS.md)).

---

## 2. Repository Snapshot

| Metric | Value | Source |
|---|---|---|
| Branch | `gh-pages` | `git branch` |
| Commits | 45 | `git log --oneline \| wc -l` |
| Tracked files | 499 | `git ls-files \| wc -l` |
| Tracked size | 11.9 MB (12,179 KB) | `git ls-files -z \| xargs du -sk` |
| Largest tracked files | `docs/assets/screenshots/*.png` (≤ 484 KB), e2e visual baselines (≤ 436 KB) | `git ls-files \| xargs du` |
| Working tree (post-cleanup) | 62 staged deletions (untrack cleanup) + 3 scrubbed docs + updated `.gitignore` + audit docs | `git status --short` |
| Tracked docs | 192 `.md` (157 real + 35 `INDEX.md`) | `find docs -name '*.md'` |
| Archived docs | 63 (workflow-reviews 43, feature-docs 13, root 6, + `ARCHIVE.md`) | `find docs/archive` |
| Unit tests | `tests/` (11 files, Vitest) | `git ls-files tests/` |
| E2E specs | 13 specs + 9 helpers + contract/perf/visual (37 files) | `git ls-files e2e/` |
| npm scripts | 26 | `package.json` |

---

## 3. Directory Structure

```text
cashflow/
├─ src/            # React frontend (pages, services, store, utils, types)
├─ server/         # Express 4 (4.22.2) API (index.js monolith + routes/services/middleware/lib)
├─ e2e/            # Playwright (specs, helpers, contract, performance, visual baselines)
├─ tests/          # Vitest unit tests
├─ scripts/        # Ops utilities (seed, backup/restore Turso, apply schema, stability gate)
├─ public/         # Static assets (fonts, logo) — +1 debug artifact (see Clutter Report)
├─ docs/           # 180 markdown docs (system, enterprise, e2e, adr, meta, archive…)
├─ .github/        # workflows/e2e.yml (only)
├─ .agents/        # AI-agent skills (40 files — see Legacy Report)
├─ .kiro/          # AI-agent specs/notes (19 files — see Legacy Report)
├─ *.md            # README, agent.md, task-list.md
├─ *.config.*      # vite, tsconfig*, tailwind, postcss, playwright
├─ turso-schema.sql
└─ .env.example, server/.env.example   # tracked placeholders (safe)
```

On-disk-but-ignored (never committed): `node_modules/` (root + `server/node_modules` 108 MB), `cashflow.db`, `server/.env`, `.env.local`, `.dev-server*.log` ×6 (~1.1 MB), `backups/`, `dist/`, `playwright-report/`, `tmp-e2e-test.db-journal`.

---

## 4. Git History Assessment

- 45 commits, conventional prefixes used (`feat:`, `fix:`, `chore:`, `docs:`, `test+ci:`).
- Recent history shows disciplined workflow: E2E stabilization, CI integration, docs modernization, tech-debt cleanup.
- **No fabricated history**; single author line; no signed commits (optional for public repos).

---

## 5. Test & CI Inventory

| Layer | Tooling | Status |
|---|---|---|
| Unit | Vitest (`tests/`, 113 passing per last run) | ✅ |
| API contract | Playwright `e2e/contract/contract-check.spec.ts` | ✅ |
| E2E | Playwright — 13 specs (gmail, transactions, dashboard, categories, auth gates, rate-limit, notifications-realtime, admin) | ✅ |
| Visual regression | 10 snapshot baselines (light/dark, desktop/mobile) | ✅ |
| Performance budget | `e2e/performance/` with budget config | ✅ |
| CI | `.github/workflows/e2e.yml` — quality, e2e (stability gate ×3), visual, performance jobs | ✅ |

---

## 6. Findings Summary

| # | Severity | Finding |
|---|---|---|
| R1 | 🔴 Critical | Literal Google API key in 3 archived docs — **scrubbed 2026-08-04**; key still active in `server/.env` → **GCP rotation required** (Security §3.1) |
| R2 | 🟠 High | `public/logout-debug-viewport.png` (debug artifact) tracked — **✅ resolved** (untracked + gitignored) |
| R3 | 🟠 High | GitHub collaboration files missing — **✅ resolved** (8 files created 2026-08-04) |
| R4 | 🟡 Medium | `.agents/` (40), `.kiro/` (19), `task-list.md` tracked — **✅ resolved** (untracked + gitignored) |
| R5 | 🟡 Medium | 4 one-off `verify-*.mjs` scripts superseded by E2E specs |
| R6 | 🟢 Low | `.vscode/settings.json` empty `{}` tracked |
| R7 | 🟢 Low | Documentation Map had stale counts (35 vs 19 INDEX; 192 vs 180 total) — corrected in this curation |

---

## 7. Recommendations

1. ✅ Scrub executed (2026-08-04); **revoke + rotate the still-active key** (R1). Keep `git filter-repo` optional.
2. ~~Remove R2 from tracking~~ — ✅ done (2026-08-04, untracked + gitignored).
3. ~~Decide on R4~~ — ✅ done (2026-08-04: `.agents/` `.kiro/` `task-list.md` `skills-lock.json` untracked + gitignored). Optional follow-up: rename `agent.md` → `AGENTS.md`.
4. Add GitHub collaboration files (CONTRIBUTING, CHANGELOG, SECURITY, templates, Dependabot) — see [GITHUB_READINESS](GITHUB_READINESS.md).
5. Archive or delete superseded `verify-*.mjs` scripts after confirming no CI reference.

---

## References

- [GIT_COMMIT_GUIDE.md](GIT_COMMIT_GUIDE.md) — safe-to-commit matrix
- [SECURITY_REPOSITORY_REVIEW.md](SECURITY_REPOSITORY_REVIEW.md) — secret scan evidence
- [GITHUB_READINESS.md](GITHUB_READINESS.md) — release checklist
- [Documentation Map](../DOCUMENTATION_MAP.md)
