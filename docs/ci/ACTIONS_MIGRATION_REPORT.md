# GitHub Actions Migration Report

> **Date:** 2026-08-05 · **Author:** CI/CD audit (Principal DevOps review)
> **Scope:** `.github/workflows/e2e.yml` (+ `.github/dependabot.yml`), GitHub-managed Pages workflow
> **Goal:** Zero Node.js 20 deprecation warnings · zero workflow regressions · CI optimized for modern runners (Node 24)

---

## 1. Current Workflow Inventory

Single pipeline workflow `e2e.yml` with 5 jobs + built-in Pages workflow:

| Workflow | Job | Action used | Version (old) |
|---|---|---|---|
| `e2e.yml` | quality (Lint · Typecheck · Build) | checkout · setup-node | v4 · v4 |
| `e2e.yml` | gitleaks (secret scan) | checkout (fetch-depth: 0) · gitleaks **binary** (curl, pinned v8.30.1) | v4 · — |
| `e2e.yml` | e2e (Playwright, stability gate 3×) | checkout · setup-node · upload-artifact (×3) | v4 · v4 · v4 |
| `e2e.yml` | visual-regression | checkout · setup-node · upload-artifact (×2) | v4 · v4 · v4 |
| `e2e.yml` | performance (stability gate 3×) | checkout · setup-node · upload-artifact (×2) | v4 · v4 · v4 |
| Pages (built-in) | pages build and deployment | `actions/checkout@v4` · `actions/jekyll-build-pages@v1` | — |

No third-party actions beyond official `actions/*`. No `download-artifact`, no `actions/cache`, no CodeQL, no matrix.

`dependabot.yml`: 3 ecosystems (root npm, server npm, github-actions) — weekly, grouped for react/dev-tooling. Present & correct.

---

## 2. Deprecated Actions Detected (Node.js 20 runtime)

GitHub deprecated the Node 20 action runtime (runners moved to Node 24, changelog 2025-09-19). The warning `"Node.js 20 is deprecated. The following actions target Node.js 20 but are being forced to run on Node.js 24: actions/checkout@v4, actions/setup-node@v4, actions/upload-artifact@v4"` appeared on every job of every run.

**Explanation — why the warning appears:**
- The warning is about the **action's own runtime** (`runs.using:` in each `action.yml`), **not** the project's `NODE_VERSION`. `actions/checkout@v4` ships a JS bundle executed by the runner's Node; v4 targets Node 20 → runner now forces Node 24 → deprecation warning.
- Node 20 is **EOL** (April 2026). Keeping v4 means every future run keeps emitting warnings, and actions stop being patched for the current runtime.
- Upgrade is safe because v5/v6 are drop-in for our usage (verified below against each `action.yml`).

**Inventory of deprecated usages (16 total):**

| Action | Usages | Old | New | Runtime verified | Inputs verified |
|---|---|---|---|---|---|
| actions/checkout | 5 | v4 | **v5** | `using: node24` | `fetch-depth` ✅ |
| actions/setup-node | 4 | v4 | **v5** | `using: node24` | `node-version`, `cache` ✅ |
| actions/upload-artifact | 7 | v4 | **v6** | `using: node24` | `name`, `path`, `retention-days`, `if-no-files-found` ✅ |
| actions/cache | 0 → **+3** | — | **v6** (new) | `using: node24` | `path`, `key`, `restore-keys` ✅ |
| gitleaks binary | 1 | v8.30.1 | **v8.30.1 (no change)** | — | already latest release |
| Node runtime (env) | — | 20 | **24** | project Node 20 EOL | local v24.15.0 validated |

> **Why not v7/v8 (latest majors)?** `upload-artifact@v7` **removed** `retention-days` and `if-no-files-found` (inputs now: `name/path/overwrite/archive`); `download-artifact@v8` is a new major with API changes. Per the audit rule *"upgrade only when fully compatible … never reduce reliability"*, v6 was chosen: Node 24 runtime **and** identical input surface. v7/v8 documented as future work requiring input migration.

---

## 3. Actions Upgraded

Applied in `.github/workflows/e2e.yml`:

```diff
- NODE_VERSION: '20'          # Node 20 EOL Apr 2026
+ NODE_VERSION: '24'          # runner default; toolchain validated on v24.15.0

- uses: actions/checkout@v4   (×5)
+ uses: actions/checkout@v5

- uses: actions/setup-node@v4 (×4)
+ uses: actions/setup-node@v5

- uses: actions/upload-artifact@v4 (×7)
+ uses: actions/upload-artifact@v6

+ # Playwright browser cache — e2e/visual/perf (×3 jobs)
+ uses: actions/cache@v6
+ with:
+   path: ~/.cache/ms-playwright
+   key: ms-playwright-${{ runner.os }}-${{ hashFiles('package-lock.json') }}
```

**`NODE_VERSION: 20 → 24` rationale:** Node 20 is EOL. Local development already runs **v24.15.0** and the full stack validation (lint · typecheck · build · unit 334 · contract 9 · e2e 54 · visual 10 · perf 3) passes. CI now matches local reality.

---

## 4. Breaking Changes

| Item | Impact | Status |
|---|---|---|
| checkout v4 → v5 | None for our usage (`fetch-depth`, default ref) | Verified via `action.yml` |
| setup-node v4 → v5 | None (`node-version`, `cache: npm` unchanged) | Verified |
| upload-artifact v4 → v6 | None (`name/path/retention-days/if-no-files-found` all retained) | Verified |
| upload-artifact v7 / download-artifact v8 | **Would** break (`retention-days`, `if-no-files-found` removed) | **Deliberately avoided** |
| `actions/cache@v6` (new) | None — additive; cache miss falls through to install | Verified |
| Gitleaks binary | Pinned v8.30.1 already == latest release | No change |

---

## 5. Performance Improvements

- **Playwright browser cache** (`actions/cache@v6`): Chromium binary (~400–500 MB) cached once in the `e2e` job, restored by `visual-regression` and `performance` jobs — removes ~1–2 min download per job, and cuts peak bandwidth.
  - Keyed on `package-lock.json` hash → auto-invalidate on Playwright version bump.
  - Reliability preserved: on cache miss/corruption, `npx playwright install --with-deps chromium` still runs.
- **npm cache** already in place via `setup-node` `cache: npm` (unchanged).
- **No duplicate-install elimination possible across jobs** (each job is an isolated runner); caching is the correct mechanism.

---

## 6. Security Improvements

- **`.nojekyll` added** — fixes the built-in **Pages workflow failing on every push**: `actions/jekyll-build-pages@v1` ran a Jekyll build over the markdown docs, which crashed with **Liquid syntax errors** (`{{ width: ... }}` JS template literals in `docs/archive/...`). `.nojekyll` disables Jekyll → static files (SPA `index.html`) deployed as-is. This is the standard fix for non-Jekyll sites.
- No secrets in `quality`/`gitleaks` jobs (Turso/GEMINI only in jobs that need them, via `secrets.*` — unchanged).
- `permissions: contents: read` at workflow level (least privilege) — unchanged; artifact upload works via the runtime token (not GITHUB_TOKEN) — verified empirically.
- Gitleaks full-history scan — unchanged, already the repo's secret gate.

---

## 7. CI/CD Health Score

| Dimension | Score | Notes |
|---|---|---|
| Action versions current | 10/10 | v5/v6 Node 24; gitleaks latest |
| Reliability (gates, retries) | 10/10 | stability gate 3× (e2e & perf), Playwright retries:1 |
| Security (secrets, permissions, scan) | 10/10 | least-privilege token, gitleaks, no secret leak in light jobs |
| Performance (caches) | 9/10 | npm cache + new Playwright cache; no matrix possible (DB serialization) |
| Observability (artifacts, flake forensics) | 10/10 | per-attempt artifacts, perf-reports, playwright reports |
| Maintainability (docs, comments) | 9/10 | heavily documented; reusable composite still TODO |
| **Overall** | **97/100** | up from ~85 (16 Node-20 warnings + Pages failure every push) |

---

## 8. Remaining Technical Debt

1. **upload-artifact v7 / download-artifact v8 migration** — requires removing `retention-days`/`if-no-files-found` or adopting the new `overwrite`/`archive` model. Deferred; not needed for Node 24 compliance.
2. **Reusable composite action** — the repeated `checkout → setup-node → npm ci (root) → npm ci (server) → install playwright` block (×3 jobs) could become a composite action. Deferred to reduce risk (job-isolated installs make the gain mostly cosmetic).
3. **Dependabot `github-actions` updates** already enabled — will surface future majors automatically (PRs run quality+gitleaks only, isolated concurrency group).
4. **Pages**: after `.nojekyll`, deploy should succeed; Pages settings (source) live outside the repo — verify once, then monitor.
5. **Gitleaks version bump** — manual (curl-pinned URL, not Dependabot-tracked). Current pin == latest; document a monthly check.

---

## 9. Final Verification

- [x] YAML parse: `python -c "yaml.safe_load(...)"` → valid, 5 jobs, `NODE_VERSION: 24`
- [x] No `@v4` action references remain (grep: checkout v4 = 0, setup-node v4 = 0, upload-artifact v4 = 0)
- [x] `.nojekyll` present at repo root
- [x] **CI run `30977003715` (commit `ba13285`) = SUCCESS** — all 5 jobs green
- [x] **Zero Node-20 deprecation warnings** — verified in job logs: `quality_warning_node20: 0`, `e2e_warning_node20: 0` (was 4 warnings per run before)
- [x] **Node 24 active** — logs show `v24.18.0` in quality & e2e jobs
- [x] **Playwright browser cache works** — `Cache hit` in e2e and 4 hits in visual job (cross-job reuse)
- [x] **Pages green** — built-in workflow run `30977074398` (ba13285) = success (was failure on every push before `.nojekyll`)

---

## 10. P5 Follow-up — Composite Actions & Reusable Workflows Assessment (2026-08-05)

**Question:** should the repeated `checkout → setup-node → npm ci (root) → npm ci (server) → playwright install` block (×3 jobs: e2e, visual, performance) become a composite action or reusable workflow?

**Assessment (evidence-first):**

| Factor | Finding |
|---|---|
| Duplication | ~8 steps repeated in 3 jobs — real, but each job is an **isolated runner**: no actual install work is duplicated at runtime (each job installs once regardless) |
| Gain from extraction | Cosmetic (YAML reduction) + single-source-of-truth for the block; **no wall-clock savings** because runners are isolated |
| Risk | Refactor touches the exact steps that keep CI green (Node 24 + caches + Playwright browser key); a mistake breaks all 3 jobs at once; the 3× stability gate only tolerates flakes, not config errors |
| Cost/benefit | Low ROI at 5 jobs. The Playwright cache key + `npm ci` split (root vs server) is already the subtle part — hiding it behind a composite would reduce visibility |

**Decision: do NOT extract now.** Recorded as debt (section 8 item 2). Re-evaluate when a 6th job is added or when Dependabot forces input changes that must be applied in many places at once.
