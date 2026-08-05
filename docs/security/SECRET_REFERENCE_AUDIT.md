# Secret Reference Audit — GCP Credentials & API Keys

> **Status:** Audit completed 2026-08-05 · **Owner:** Core Engineering · **Related:** `docs/security/GCP_KEY_ROTATION_CHECKLIST.md`, `docs/security/SECRET_ROTATION_PLAN.md`

## Purpose

P3 (GCP Key Rotation) — detect **where** secrets are referenced across the repository, verify none are literal, and provide a verification checklist after rotation. The rotation procedure itself lives in `GCP_KEY_ROTATION_CHECKLIST.md` (create → update `server/.env` → restart → delete old → optional `git filter-repo`).

## Reference inventory (tracked files, non-archive)

Search: `GEMINI_API_KEY`, `GOOGLE_APPLICATION_CREDENTIALS`, `AIza*` across tracked files.

| File | Type of reference | Verdict |
|---|---|---|
| `.env.example` | placeholder (`GEMINI_API_KEY=<GEMINI_API_KEY>`) | ✅ safe |
| `server/.env.example` | placeholder + doc of credential path | ✅ safe |
| `.github/workflows/e2e.yml` | `secrets.GEMINI_API_KEY` (GitHub Actions secret ref) | ✅ safe — value only in Settings → Secrets |
| `.gitleaksignore` | fingerprints of scrubbed legacy keys | ✅ intentional (see file comments) |
| `README.md` / `CONTRIBUTING.md` | env var names in setup docs | ✅ safe |
| `docs/adr/ADR-004-ai-pipeline.md`, `docs/architecture/*`, `docs/audit/*`, `docs/enterprise/*`, `docs/google-cloud/*` | env var names & setup instructions | ✅ safe — no literals (verified by gitleaks CI green) |

**Result:** 0 literal secrets in the tracked tree. The only real secret storage is `server/.env` (git-ignored, local) + GitHub Actions secrets + Google Cloud Console. The GCP service-account JSON is git-ignored (`*.json` service-account patterns; `.dockerignore` excludes `google-*.json`).

## Verification checklist (post-rotation — from GCP_KEY_ROTATION_CHECKLIST.md)

```bash
# 1. Tree bersih dari literal key
git grep -l 'AIza' -- '*.js' '*.ts' '*.tsx' '*.json' '*.md' || echo "OK: 0 sisa"

# 2. Health AI jalan dengan key baru
curl -s http://localhost:5181/api/gemini/health | grep '"ok":true'

# 3. Readiness probe
curl -s -o /dev/null -w '%{http_code}' http://localhost:5181/api/ready   # → 200

# 4. CI gitleaks masih hijau (re-run workflow)
# 5. Key lama sudah DELETE di Google Cloud Console (bukan hanya di-disable)
```

## Manual action remaining (cannot be done from this repository)

1. Rotate the API key / service account in Google Cloud Console.
2. Update `server/.env` on the server host (and GitHub secret `GEMINI_API_KEY` if used by CI AI specs).
3. Delete the old key. Optional: `git filter-repo` to purge history (see checklist).
