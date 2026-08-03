# Security — Repository Review

> **Status:** Approved · **Version:** 1.0 · **Owner:** Qoid Rif'at
> **Last Updated:** 2026-08-04 · **Related:** [GIT_COMMIT_GUIDE](GIT_COMMIT_GUIDE.md), [GITIGNORE_REVIEW](GITIGNORE_REVIEW.md), [REPOSITORY_PREPARATION_REPORT](REPOSITORY_PREPARATION_REPORT.md)
> **Audience:** Maintainers, security reviewers

---

## 1. Executive Verdict

**Blocked for public release until the active key in §3.1 is revoked.** Literal scrub executed 2026-08-04; **GCP revocation + rotation still required**.

- ✅ **No secret values in tracked source code or configs.**
- ✅ **All real secrets on disk are git-ignored** (verified via `git check-ignore` + 0 untracked files).
- 🔴 **One real credential literal exists in 3 archived documents** (must be scrubbed and/or revoked).
- ✅ No `ghp_*` (GitHub), `sk-*` (OpenAI), private-key blocks, or `service_role` values in tracked files.

---

## 2. Scan Method

```bash
git grep -l -E 'service_role|-----BEGIN (RSA|EC|OPENSSH|PRIVATE)|AIza[0-9A-Za-z_-]{20}|ghp_[A-Za-z0-9]{20}|sk-[A-Za-z0-9]{20}'
```

plus file-name audit (`*.env`, `*service-account*`, `*.pem`, `*.key`, `*.db`, `*.sqlite*`, `*.webm`, `*.log`) and `git check-ignore` verification of every on-disk secret.

---

## 3. Findings

### 3.1 🔴 CRITICAL — Real Google API key literal in 3 archived docs

A Google-API-key-format literal (`AIzaSy…iyI`, 39 chars) appears in:

| File | Context |
|---|---|
| `docs/archive/workflow-reviews/review/BOB_AI_PIPELINE_POST_KIRO_REVIEW_REPORT.md` | Quote of a `GEMINI_API_KEY=…` found during an old incident review |
| `docs/archive/workflow-reviews/review/FINAL_VERDICT_AND_ACTION_PLAN.md` | "Delete key: AIzaSy…" remediation note |
| `docs/archive/workflow-reviews/review/SECURITY_PERFORMANCE_AUDIT.md` | Same incident report |

The archived reports document a plan to delete the key, **but audit verification (2026-08-04) shows the SAME key is still the active `GEMINI_API_KEY` in `server/.env`** — the key was never rotated and is an **active credential exposed in git history**.

**Required actions (in order):**
1. **Revoke/confirm-revoked** the key in Google Cloud Console → APIs & Services → Credentials. If it maps to the current `GEMINI_API_KEY`, rotate it now.
2. **Scrub the literal** from the 3 files: replace with `<REDACTED>` (keep surrounding context — these are historical incident reports, content integrity matters).
3. **Confirm no other copies** of the full string exist (`git grep` for a distinctive fragment).
4. Because the string exists in **history**, post-publish exposure is possible even after scrubbing the working tree. Revocation (step 1) is the actual mitigation; optionally rewrite history with `git filter-repo` if the repo is not yet public (45 commits — cheap to do now, expensive later).

> **Note:** treated as HIGH and blocking regardless of whether the key is still valid — a key literal in a repo is a credential hygiene violation.

> **Resolution (2026-08-04):** literal scrubbed from all 3 archived docs → `<REDACTED>`; verified **0 matches remaining in tracked files**. **GCP revocation + rotating `GEMINI_API_KEY` in `server/.env` remains REQUIRED** (key still active). Optional: `git filter-repo` to purge history before public push.

### 3.2 False positives (verified — NOT secrets)

| Match | Why it's safe |
|---|---|
| `service_role` (several files) | SQL/RLS documentation, security-discussion prose, and a **regex pattern** in `server/services/agentSearchService.js:446` that *detects* secrets in indexed docs — not a value |
| `-----BEGIN PRIVATE KEY-----` | Same classifier regex + a regex literal in archived audit docs |
| `.agents/skills/supabase-postgres-best-practices/references/security-rls-performance.md` | Skill reference material mentioning `service_role` role name |
| `.kiro/specs/supabase-core-schema-fix/design.md` | Spec checklist item "expose service_role key" (a risk item, not a value) |

### 3.3 🟠 Medium — PII in committed screenshots

- `docs/assets/screenshots/` (21 PNG, README gallery) and `e2e/visual/*-snapshots/` (10 baselines) were captured against the **development database** and contain real user data: transaction amounts, merchant names, email subjects/bodies in Gmail Sync views.
- **Options:** (a) re-capture with seed/masked data before public publish; (b) publish as private/portfolio repo; (c) accept risk. Recommendation: (a).

### 3.4 Verified-ignored secrets (evidence)

| On-disk item | Ignored by | Verification |
|---|---|---|
| `.env.local` (TURSO token, GEMINI key, Google client id) | `*.local` | `git check-ignore` ✅ |
| `server/.env` | `server/*.env` | ✅ |
| `server/cashflow-service-account.json` | `server/*.json` | ✅ |
| `server/google-agent-search-service-account.json` | explicit rule | ✅ |
| `cashflow.db` (dev user data) | `*.db` | ✅ |
| `backups/` (Turso dumps w/ PII) | `backups/` | ✅ |
| `.dev-server*.log` (stack traces, env echo) | `.dev-server*.log` | ✅ |
| `public/logout-success-recording*`, `public/recordings/` (screen recordings) | explicit rules | ✅ |

### 3.5 Environment variable hygiene

- `.env.example` (root, 13 vars) and `server/.env.example` (31 vars) contain **names only** — safe to commit (already tracked).
- `server/cashflow-agent-search.env` is covered by `server/*.env` (verified ignored).

---

## 4. Security Recommendations (pre-publish)

1. ✅ Scrub executed (2026-08-04) — **revoke + rotate the key still required** (see §3.1 resolution); optional `git filter-repo`.
2. Re-capture screenshots with masked data (§3.3) or document the PII risk.
3. Add `SECURITY.md` with a private reporting channel (see [GITHUB_READINESS](GITHUB_READINESS.md)).
4. Post-publish: enable GitHub secret scanning + push protection and Dependabot alerts.
5. Consider a scheduled `gitleaks`/`trufflehog` scan in CI (`.github/workflows`).

---

## References

- [GITIGNORE_REVIEW.md](GITIGNORE_REVIEW.md)
- [GIT_COMMIT_GUIDE.md](GIT_COMMIT_GUIDE.md)
- [REPOSITORY_PREPARATION_REPORT.md](REPOSITORY_PREPARATION_REPORT.md)
