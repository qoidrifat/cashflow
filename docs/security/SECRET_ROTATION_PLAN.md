# Secret Rotation Plan

**Date:** 2026-08-04
**Step:** Production Hardening Roadmap — Step 0.2 (Security Baseline: Secrets)
**Status:** Planning — rotation actions listed below are REQUIRED before any public publication

> **Security note:** This document intentionally contains **no secret values**. All verification was performed with `git log` pickaxe searches and file-name listings; only counts, commit hashes, and variable names are recorded.

---

## 1. History Exposure Verification (2026-08-04)

The following `git log --all` pickaxe searches were run to inventory secret-like material in history. **No matched values are reproduced here.**

| Search pattern | Commits touching the pattern | Commit hashes |
|---|---|---|
| `GEMINI_API_KEY` | 8 | `e2119f1`, `f3d593c`, `6df3910`, `721559e`, `7751dad`, `907c289`, `4044cd4`, `113563f` |
| `BEGIN PRIVATE KEY` | 2 | `6df3910`, `113563f` |
| `AIza` (Google API-key prefix) | 3 | `f3d593c`, `6df3910`, `113563f` |

Findings:

- All `GEMINI_API_KEY` hits are in documentation files (`docs/**/*.md`) and `server/.env.example` (placeholder only). A literal key value **was committed historically** in archived review documents; it was **scrubbed from all tracked docs on 2026-08-04** (commit `e2119f1`) and a working-tree scan confirms **0 remaining matches** for the API-key value pattern.
- Service-account JSON files (`server/*service-account*.json`) have **never been tracked by git** — no `--diff-filter=A` commit exists for them; only `server/.env.example` is tracked among server credential files. History hits for `BEGIN PRIVATE KEY` / `AIza` occur in docs/templates, not in committed credential files.
- **However, scrubbing tracked files does not remove secrets from git history.** The exposed key value remains recoverable from historical commits until either the key is revoked or history is purged (see §5).

## 2. Known Facts

- A `GEMINI_API_KEY` value was committed in historical documentation and scrubbed from tracked docs on 2026-08-04.
- Per [docs/repository/SECURITY_REPOSITORY_REVIEW.md](../repository/SECURITY_REPOSITORY_REVIEW.md): audit verification (2026-08-04) confirmed the **same key is still present and reportedly still active in `server/.env`** — the key was never rotated.
- The `GEMINI_API_KEY` code path is now **dead code**: AI integration runs on the **Vertex AI service account** (`GOOGLE_APPLICATION_CREDENTIALS`) only. The legacy key therefore has no legitimate use and **must be revoked regardless of rotation decisions**.

## 3. Rotation Table

| Secret | Location | Exposure status | Action | Where to rotate | Urgency |
|---|---|---|---|---|---|
| `GEMINI_API_KEY` | `server/.env` | Value committed in git history; scrubbed from tracked docs 2026-08-04; still reportedly active | **Revoke** the key (dead code path — Vertex AI service account only); remove from `server/.env` | Google AI Studio → API Keys | **High** |
| `google-agent-search-service-account.json` | `server/` (untracked) | Never committed to git | Keep active; **rotate only if leak suspected**; verify continued `.gitignore` coverage | Google Cloud Console → IAM & Admin → Service Accounts | Low (monitor) |
| `cashflow-service-account.json` | `server/` (untracked, orphan) | Never committed; file is orphaned (superseded by agent-search SA) | **Revoke/disable the key in GCP, then delete the file manually** | Google Cloud Console → IAM → Service Accounts | High |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | `server/.env` | Not found in history | OAuth client; **rotate only on confirmed leak** | Google Cloud Console → APIs & Services → Credentials | Low |
| `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` | `server/.env` | Not found in history | Rotate auth token; update connection URL token component | Turso Console → database tokens | Medium |
| `BETTER_AUTH_SECRET` | `server/.env` | Not found in history | Rotate; note all active sessions are invalidated on rotation | Generate new strong random secret locally | Medium |
| `SMTP_USER` / `SMTP_PASS` | `server/.env` (notification pipeline) | Not found in history | Rotate SMTP credentials (app password) | SMTP provider account settings | Medium |
| `ALERT_WEBHOOK_URL` / `GMAIL_WEBHOOK_URL` | `server/.env` (notification pipeline) | Not found in history | Regenerate webhook URLs (treat URL as bearer token) | Chat/webhook provider settings | Medium |
| `AGENT_SEARCH_USER_HASH_SALT` | `server/.env` | Not found in history | Rotate salt; note user-hash mappings must be recomputed after rotation | Generate new strong random salt locally | Medium |

## 4. Current Protection — .gitignore Verification

Verified via `git check-ignore -v`; the current `.gitignore` covers all credential surfaces:

| Pattern | .gitignore line | Verified coverage |
|---|---|---|
| `server/.env` | L16 | `server/.env` |
| `server/*.env` | L17 | all env variants (`!server/.env.example` exception at L18) |
| `server/*.json` | L19 | all JSON in `server/` (package.json / package-lock.json re-included at L20–21) |
| `server/*service-account*.json` | L22 | `cashflow-service-account.json` and any SA variants |
| `server/google-agent-search-service-account.json` | L23 | explicit belt-and-braces entry |
| `*.db` / `*.db-journal` | L35–36 | local SQLite containing real user data |
| `backups/` | L39 | Turso backup dumps containing PII |

## 5. Repository Cleanup Recommendation

### 5.1 Optional history purge

Scrubbing tracked files (done 2026-08-04) does **not** remove secrets from git history. Before any **public** publication of this repository:

- **Optionally run `git filter-repo`** to purge the exposed `GEMINI_API_KEY` literal (and any other confirmed leaked values) from all history.
- ⚠️ **Warning:** history rewriting changes every affected commit hash. Coordinate with **all collaborators** before running; everyone must re-clone. Do not run on a shared remote without an agreed force-push window.
- **Revocation is the primary control.** A purged history does not un-leak a secret that was already copied; rotation/revocation (§3) is required regardless of whether history is purged.

### 5.2 Gitleaks

- `.gitleaksignore` **exists in the repository** and is used to suppress known historical findings. It is a suppression list, not a fix — every suppressed finding must still be covered by an entry in the §3 rotation table.
- Gitleaks is integrated into the CI pipeline (commit `f3d593c`); keep it enabled and re-run it after any rotation or history purge.

## 6. Pre-Publication Checklist

1. **Rotate** — execute every action in §3 (revoke `GEMINI_API_KEY` first; revoke orphan `cashflow-service-account.json` key and delete the file).
2. **Verify .gitignore** — re-run `git check-ignore -v` for every credential file listed in §4; confirm no credential file appears in `git ls-files`.
3. **Optional history purge** — `git filter-repo` per §5.1, coordinated with collaborators.
4. **Re-scan** — run Gitleaks over the full repository (and rewritten history, if purged); confirm zero unresolved findings; update `.gitleaksignore` only for accepted residuals.

---

*Companion baseline: [docs/implementation/DOCUMENTATION_BASELINE_REPORT.md](../implementation/DOCUMENTATION_BASELINE_REPORT.md)*
