# CashFlow Green Baseline Report

**Date:** 2026-08-04
**Roadmap step:** 0.3 — Execute and record GREEN BASELINE
**Recorded by:** QA verification run (Task #21)

## Environment

| Item | Value |
|------|-------|
| OS | Windows 11 22H2 |
| Node.js | v24.15.0 |
| npm | 11.12.1 |
| Shell | PowerShell (pwsh) |
| Workspace | `d:\Workspace\cashflow` |

## Step-by-step status

| Step | Command | Result | Notes |
|------|---------|--------|-------|
| 1 | `node --version` / `npm --version` | ✅ PASS | Node v24.15.0 (expected ~v24), npm 11.12.1 |
| 2a | `npm install` (root) | ✅ PASS | Up to date, 399 packages audited, 0 added. Audit: 8 vulnerabilities (2 moderate, 6 high) — recorded, not fixed |
| 2b | `npm install` (server/) | ✅ PASS | Up to date, 254 packages audited, 0 added. Audit: 8 vulnerabilities (1 low, 6 moderate, 1 high) — recorded, not fixed |
| 3 | `npm run lint` (`npx tsc --noEmit`) | ✅ PASS | No type errors, no output |
| 4 | `npm run typecheck` (`tsc --noEmit`) | ✅ PASS | No type errors, no output |
| 5 | `npm run build` (`tsc -p tsconfig.json --noEmit && vite build`) | ✅ PASS | vite v5.4.21, 2999 modules transformed, built in 17.39s, 34 dist assets. No bundle-size warnings (largest: `vendor-charts` 384.76 kB raw / 112.27 kB gzip) |
| 6 | `npm run test:unit` (vitest) | ✅ PASS | 11 test files, 113/113 tests passed, duration 3.26s |
| 7 | `npm run test:e2e` (Playwright, 1 worker, retries=1) | ✅ PASS | 41/41 tests passed in 3.4m, zero failures, zero retries, zero flakes |

## Unit test tally (vitest)

**11 files passed (11) — 113 tests passed (113), 0 failed, 0 skipped.**

| Spec file | Tests | Result |
|-----------|-------|--------|
| `tests/unit/gmailLogMapper.test.ts` | 16 | ✅ |
| `tests/unit/aiCache.test.ts` | 9 | ✅ |
| `tests/unit/confidenceScorer.test.ts` | 16 | ✅ |
| `tests/unit/aiDecisionValidator.test.ts` | 15 | ✅ |
| `tests/unit/aiTokenEstimator.test.ts` | 8 | ✅ |
| `tests/unit/tiketDedupe.test.ts` | 11 | ✅ |
| `tests/unit/pagination.test.ts` | 7 | ✅ |
| `tests/unit/gmailNotifier.test.ts` | 7 | ✅ |
| `tests/unit/hitRate.test.ts` | 6 | ✅ |
| `tests/unit/alertNotifier.test.ts` | 8 | ✅ |
| `tests/unit/aiSingleFlight.test.ts` | 10 | ✅ |

## E2E tally (Playwright)

Command: `playwright test --grep-invert "@visual|@perf"` — 1 worker, retries=1, three webServers (Vite :5180, API :5181, isolated rate-limit API :5182). **41 passed (41), 0 failed, 0 flaky, 0 retries. Duration 3.4m.**

| Spec file | Tests | Result |
|-----------|-------|--------|
| `e2e/admin-cache.spec.ts` | 3 | ✅ |
| `e2e/admin-metrics-auth.spec.ts` | 3 | ✅ |
| `e2e/agent-search-auth.spec.ts` | 3 | ✅ |
| `e2e/categories.spec.ts` | 3 | ✅ |
| `e2e/contract/contract-check.spec.ts` | 9 | ✅ |
| `e2e/core-pages.spec.ts` | 3 | ✅ |
| `e2e/dashboard.spec.ts` | 2 | ✅ |
| `e2e/gmail-review-amount-missing.spec.ts` | 1 | ✅ |
| `e2e/gmail-review-approve.spec.ts` | 1 | ✅ |
| `e2e/gmail-review-duplicate.spec.ts` | 1 | ✅ |
| `e2e/gmail-review-reject.spec.ts` | 1 | ✅ |
| `e2e/gmail-sync.spec.ts` | 3 | ✅ |
| `e2e/notifications-realtime.spec.ts` | 4 | ✅ |
| `e2e/rate-limit.spec.ts` | 1 | ✅ |
| `e2e/transactions.spec.ts` | 3 | ✅ |

## Warnings and observations (recorded, not repaired)

1. **npm audit (root):** 8 vulnerabilities (2 moderate, 6 high) among 399 packages.
2. **npm audit (server/):** 8 vulnerabilities (1 low, 6 moderate, 1 high) among 254 packages.
3. **Pre-occupied ports at E2E start:** ports 5180 (PID 13352) and 5181 (PID 14088) were already occupied by stray `node.exe` dev-server processes. Because `playwright.config.ts` sets `reuseExistingServer: true` for all three webServers, Playwright reused them without conflict; no processes were killed and no retry was needed. Port 5182 was free and started fresh.
4. **Unit test stderr noise (informational):** vitest output includes repeated `TURSO_DATABASE_URL belum diisi` warnings and one expected `VERTEX_AUTH_ERROR` ("unauthenticated: default credentials not found") from `aiSingleFlight.test.ts` — these are expected behavior of the tests, not failures.
5. **Build warnings:** none. No Vite chunk-size warnings emitted.

## Baseline verdict: 🟢 GREEN

**Justification:** every gate in the baseline sequence passed cleanly on the first attempt — lint and typecheck report zero TypeScript errors, the production build succeeds with no bundle warnings, all 113 unit tests pass, and the full E2E suite (41 tests across 15 spec files) passed with zero failures, zero retries, and zero flakes. The only recorded warnings are npm audit vulnerabilities (dependency hygiene, out of scope for this baseline) and benign environment observations. No failures required repair, consistent with the snapshot-only mandate.

**Gating statement:** This GREEN baseline (2026-08-04) gates all Phase 1 implementation (P0-1/P0-2 auth gate on AI endpoints, P0-3 Gmail token hardening, P0-4 notifications pagination fix). Any Phase 1 change must keep lint, typecheck, build, and the full unit + E2E suites at least at this baseline level; regressions against this report block merge.
