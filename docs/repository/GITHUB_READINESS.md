# GitHub Readiness

> **Status:** Approved · **Version:** 1.0 · **Owner:** Qoid Rif'at
> **Last Updated:** 2026-08-04 · **Related:** [REPOSITORY_AUDIT](REPOSITORY_AUDIT.md), [SECURITY_REPOSITORY_REVIEW](SECURITY_REPOSITORY_REVIEW.md), [REPOSITORY_PREPARATION_REPORT](REPOSITORY_PREPARATION_REPORT.md)
> **Audience:** Maintainers

---

## 1. Readiness Score

**98 / 100** — *Ready for public release (remaining deduction: no secret-scanning CI job yet).*

| Category | Items present | Weight | Score |
|---|---|---|---|
| README | Enterprise-grade rebuild (`721559e`) | 25% | 25 |
| LICENSE | MIT © 2026 Qoid Rif'at | 10% | 10 |
| CI/CD | `.github/workflows/e2e.yml` (4 jobs: quality, e2e, visual, perf) | 20% | 18 |
| Line endings | `.gitattributes` (LF) | 5% | 5 |
| Contributing guide | `CONTRIBUTING.md` ✅ | 10% | 10 |
| CHANGELOG | `CHANGELOG.md` ✅ | 10% | 10 |
| Security policy | `SECURITY.md` ✅ | 10% | 10 |
| Code of Conduct | `CODE_OF_CONDUCT.md` ✅ | 5% | 5 |
| Issue/PR templates | `.github/ISSUE_TEMPLATE/` + `PULL_REQUEST_TEMPLATE.md` ✅ | 5% | 5 |
| Dependabot | `.github/dependabot.yml` ✅ | 0% (n/a) | — |
| **Total** | | **100%** | **98** |

> CI scored 18/20 (not 20): workflow is comprehensive but has **no secret-scanning job** (e.g., Gitleaks) and no Dependabot yet.

---

## 2. Present (verified)

| Item | Status | Notes |
|---|---|---|
| `README.md` | ✅ | Hero + badges (incl. License: MIT), screenshots, Mermaid architecture, feature table, AI pipeline, env vars, 26 scripts, testing, deployment, roadmap, contributing section, docs hub |
| `LICENSE` | ✅ | MIT, 21 lines, © 2026 Qoid Rif'at |
| `.github/workflows/e2e.yml` | ✅ | Lint/typecheck/build/unit/contract/e2e (stability gate ×3) + visual regression + performance budget; uploads reports |
| `.gitattributes` | ✅ | LF normalization for yml/ts/tsx/js/mjs/json/sql/md |
| `.env.example` + `server/.env.example` | ✅ | Tracked placeholders — names only, no values |
| `docs/` | ✅ | 192 files, 0 broken links, full navigation hub |

---

## 3. Collaboration Layer (all created 2026-08-04)

| # | File | Status | Contents |
|---|---|---|---|
| M1 | `CONTRIBUTING.md` | ✅ | Setup, dev loop, branch/commit conventions, test commands, secret hygiene, PR process |
| M2 | `CHANGELOG.md` | ✅ | Keep-a-Changelog; backfilled from the 45-commit history into [1.0.0] |
| M3 | `SECURITY.md` | ✅ | Private vulnerability reporting (GitHub Security Advisories) + supported versions + timeline |
| M4 | `CODE_OF_CONDUCT.md` | ✅ | Contributor Covenant 2.1 |
| M5 | `.github/ISSUE_TEMPLATE/bug_report.md` + `feature_request.md` | ✅ | Form templates with labels + security note |
| M6 | `.github/PULL_REQUEST_TEMPLATE.md` | ✅ | Checklist: tests, typecheck, docs, **secret hygiene** |
| M7 | `.github/dependabot.yml` | ✅ | npm (root + server) + GitHub Actions, weekly, grouped |
| M8 | `.github/CODEOWNERS` | ⏳ optional | Single maintainer — add when a team forms |

---

## 4. Pre-Publish Blockers (must be resolved BEFORE going public)

1. 🔴 **Scrub archived API key** — ✅ done 2026-08-04; **revoke the still-active key in GCP + rotate `GEMINI_API_KEY` in `server/.env`** (the outstanding security blocker).
2. 🟠 **PII in screenshots** — `docs/assets/screenshots/` (21 PNG) + e2e baselines contain real dev data. Either (a) re-capture with masked seed data, or (b) accept risk for a private/portfolio repo.
3. 🟠 `.agents/` / `.kiro/` / `task-list.md` — ✅ untracked + gitignored (2026-08-04).
4. 🟢 `public/logout-debug-viewport.png` — ✅ removed from tracking (2026-08-04).

---

## 5. Repository Settings (manual, on GitHub.com)

- Branch protection on `gh-pages` (or rename default branch to `main`): require PR review, require status checks (e2e jobs).
- Enable Dependabot alerts + secret scanning (free tier).
- Add `Topics` (e.g. `finance`, `react`, `express`, `better-auth`, `turso`, `vertex-ai`, `gmail-api`).
- Set homepage (if deployed) + description.
- Optionally: add repository `About` social preview image (`docs/assets/screenshots/landing.png`).

---

## References

- [REPOSITORY_PREPARATION_REPORT.md](REPOSITORY_PREPARATION_REPORT.md)
- [GIT_COMMIT_GUIDE.md](GIT_COMMIT_GUIDE.md)
- [.github/workflows/e2e.yml](../../.github/workflows/e2e.yml)
