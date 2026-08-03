# Git Commit Guide — Safe vs Unsafe

> **Status:** Approved · **Version:** 1.0 · **Owner:** Qoid Rif'at
> **Last Updated:** 2026-08-04 · **Related:** [REPOSITORY_AUDIT](REPOSITORY_AUDIT.md), [SECURITY_REPOSITORY_REVIEW](SECURITY_REPOSITORY_REVIEW.md), [GITIGNORE_REVIEW](GITIGNORE_REVIEW.md)
> **Audience:** Maintainers, contributors

---

## 1. Safe to Commit ✅

| Path | Notes |
|---|---|
| `src/` | Frontend source |
| `server/` | Backend source (excl. `server/*.env`, `server/*.json` service accounts) |
| `e2e/` | Playwright specs, helpers, contract/perf/visual incl. 10 baselines |
| `tests/` | Vitest unit tests |
| `scripts/` | Operational utilities (seed, backup/restore, schema apply, stability gate) — *except* superseded `verify-*.mjs` (optional cleanup) |
| `public/fonts/`, `public/logo/` | Production static assets |
| `docs/` | 192 files — all active + archived documentation |
| `docs/assets/` | Screenshots (PII-aware — see Security §3.3), diagrams |
| `.github/workflows/e2e.yml` | CI pipeline |
| `.gitignore`, `.gitattributes`, `.env.example`, `server/.env.example` | Config + placeholder env |
| `package.json`, `package-lock.json`, `server/package.json`, `server/package-lock.json` | Dependencies (audited, no secrets) |
| `*.config.ts/js`, `index.html`, `turso-schema.sql` | Build/schema |
| `README.md`, `LICENSE`, `CONTRIBUTING.md`, `CHANGELOG.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md` | Docs + MIT license + collaboration layer |
| `.github/ISSUE_TEMPLATE/`, `.github/PULL_REQUEST_TEMPLATE.md`, `.github/dependabot.yml` | GitHub collaboration (new 2026-08-04) |
| `agent.md` (→ rename `AGENTS.md` optional) | Agent instructions (convention) |

---

## 2. Do Not Commit ❌

| Path | Why |
|---|---|
| `server/.env`, `.env.local`, `server/*.env` | Real credentials (TURSO, GEMINI, Google OAuth) |
| `server/*service-account*.json` | GCP service accounts = root access |
| `cashflow.db`, `*.db`, `*.sqlite*` | Dev user data |
| `backups/` | Turso dumps with PII |
| `.dev-server*.log` | Stack traces / env echo |
| `public/logout-success-recording*`, `public/recordings/` | Screen recordings |
| `node_modules/`, `server/node_modules/` | 108 MB + transitive |
| `dist/`, `test-results/`, `playwright-report/`, `blob-report/` | Generated artifacts |
| `.bob/`, `.agents/`, `.kiro/`, `skills-lock.json`, `task-list.md` | ✅ untracked + gitignored (2026-08-04) — verified via `git check-ignore` |

---

## 3. Needs Manual Review ⚠️

| Item | Decision needed |
|---|---|
| **Archived API key literal** (`AIzaSy…` in 3 `docs/archive/…/review/*.md`) | ✅ scrubbed 2026-08-04 → **revoke in GCP STILL REQUIRED** (key active in `server/.env`); optional `git filter-repo` |
| `.agents/` (40 files incl. Supabase skills) | ✅ untracked + gitignored (2026-08-04) |
| `.kiro/` (19 files, superseded specs) | ✅ untracked + gitignored (2026-08-04) |
| `task-list.md` | ✅ untracked + gitignored (2026-08-04) |
| `public/logout-debug-viewport.png` | ✅ `git rm --cached` + gitignored (2026-08-04) |
| `docs/assets/screenshots/` (21 PNG with dev PII) | Re-capture masked, or accept for private/portfolio use |
| `docs/enterprise/EXECUTIVE_SUMMARY.md` | Currently modified in working tree — commit separately |
| `scripts/verify-*.mjs` (4 files) | Superseded by E2E — archive or delete |

---

## 4. Optional Cleanup (non-blocking)

- Add `"test": "npm run test:unit"` alias.
- ~~Add `CONTRIBUTING.md`, `CHANGELOG.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, issue/PR templates, `dependabot.yml`~~ — ✅ done (2026-08-04).
- `docs/DOCUMENTATION_MAP.md` counts refreshed in this curation pass (35 INDEX, 192 total).
- Add secret-scanning job (gitleaks) to CI.
- Rename default branch `gh-pages` → `main` (or configure Pages properly).

---

## 5. Pre-Commit Checklist (reusable)

```bash
# 1. Never stage secrets
git add -n . | grep -iE '\.env$|service-account|\.pem$|\.key$|backups/'   # expect: nothing

# 2. Scan staged content
git diff --cached | grep -cE 'service_role|-----BEGIN|AIza[0-9A-Za-z_-]{20}|ghp_|sk-[A-Za-z0-9]{20}'

# 3. Verify working tree intent
git status --short
```

---

## References

- [REPOSITORY_PREPARATION_REPORT.md](REPOSITORY_PREPARATION_REPORT.md)
- [SECURITY_REPOSITORY_REVIEW.md](SECURITY_REPOSITORY_REVIEW.md)
- [GITIGNORE_REVIEW.md](GITIGNORE_REVIEW.md)
