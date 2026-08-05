# ADR-009: GitHub Actions Node.js 24 Migration

> **Status:** Accepted · **Date:** 2026-08 · **Owner:** Core Engineering · **Related:** [ADR-008](ADR-008-github-pages-deployment.md)

## Context

Every CI run emitted 4× `Node.js 20 is deprecated` warnings — one per job. The warnings originate from the **action runtime** (`runs.using` in each action's `action.yml`), not from the project's `NODE_VERSION`: `actions/checkout@v4`, `actions/setup-node@v4`, and `actions/upload-artifact@v4` target Node 20 (EOL April 2026), which GitHub-hosted runners now force to run on Node 24. Node 20 is also EOL, so pinning project CI to it was no longer defensible.

## Decision

Upgrade every deprecated action to a major that targets the Node 24 runtime, verified directly from each upstream `action.yml` (not assumed from release notes):

| Action | Old → New | Runtime | Inputs preserved |
|---|---|---|---|
| `actions/checkout` | v4 → v5 | node24 | `fetch-depth`, `persist-credentials` |
| `actions/setup-node` | v4 → v5 | node24 | `node-version`, `cache: npm` |
| `actions/upload-artifact` | v4 → v6 | node24 | `name`, `path`, `retention-days`, `if-no-files-found` |
| `actions/cache` (new) | — → v6 | node24 | Playwright browser cache |
| `NODE_VERSION` | 20 → 24 | — | Matches local toolchain v24 |

**v7 of upload-artifact was deliberately avoided:** its `action.yml` removes `retention-days` and `if-no-files-found`, which this workflow uses — a breaking change that fails the "upgrade only when fully compatible" rule.

## Alternatives Considered

| Option | Reason rejected |
|---|---|
| Stay on v4 (Node 20) | Deprecated runtime; warnings on every run; EOL |
| Jump to latest majors (upload-artifact v7) | Verified breaking removal of used inputs |
| Reusable workflows / composite actions | Assessed in P5 (CI modernization) — low ROI at 5 jobs, see `ACTIONS_MIGRATION_REPORT.md` |

## Consequences

**Positive:** Zero Node-20 warnings (verified 0 occurrences in job logs of run `30977003715`); all 5 CI jobs green; Playwright browser cache hits cross-job (4 hits in visual job) — faster, cheaper runs; Pages workflow also fixed via `.nojekyll` (ADR-008).
**Negative:** Composite-action extraction remains future debt; action majors may introduce behavioral drift in edge cases — mitigated by keeping the 3× stability gate.
