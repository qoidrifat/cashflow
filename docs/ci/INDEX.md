# ci — Documentation Index

> **Status:** Active · **Owner:** Core Engineering / DevOps · **Last Updated:** 2026-08-06

## Overview

CI/CD dan pipeline quality CashFlow: arsitektur GitHub Actions, stabilitas seed E2E (Turso), strategi testing, panduan Playwright, proses rilis, dan troubleshooting flake.

## Documents

| Document | Description |
|---|---|
| [CI_ARCHITECTURE.md](CI_ARCHITECTURE.md) | Arsitektur pipeline (5 jobs, serialisasi global, Node 24, actions v5/v6, artifacts). |
| [TESTING_STRATEGY.md](TESTING_STRATEGY.md) | Piramida testing: unit · contract · e2e · visual · performance + gate order. |
| [PLAYWRIGHT_GUIDE.md](PLAYWRIGHT_GUIDE.md) | Pola Playwright stabil (web-first, `expect.poll`, tanpa hard wait) & anti-pattern. |
| [SEED_DATABASE_GUIDE.md](SEED_DATABASE_GUIDE.md) | Seed E2E Turso: batching, retry transien, idempotensi, safety guard, PINNED. |
| [RELEASE_PROCESS.md](RELEASE_PROCESS.md) | Alur rilis: branch, commit hygiene, secret audit, tag, deploy Pages. |
| [CI_TROUBLESHOOTING.md](CI_TROUBLESHOOTING.md) | Diagnosis flake & kegagalan CI (seed, browser, perf) berbasis evidence. |
| [ACTIONS_MIGRATION_REPORT.md](ACTIONS_MIGRATION_REPORT.md) | Migrasi actions ke Node 24 (v5/v6) + penilaian composite actions (2026-08-05). |
| [INDEX.md](INDEX.md) | Indeks folder ini. |

## Related

- [Documentation Map](../DOCUMENTATION_MAP.md) — peta lengkap seluruh dokumentasi.
- [Testing Index](../testing/INDEX.md) — panduan testing lebih luas.
- [Root README](../../README.md) — entry point repository.
