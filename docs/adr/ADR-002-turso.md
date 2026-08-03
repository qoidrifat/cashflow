# ADR-002: Turso (libSQL) as Primary Database

> **Status:** Accepted · **Date:** 2026-07 · **Owner:** Core Engineering · **Related:** [ADR-001](ADR-001-better-auth.md)

## Context

The app needed a relational store for 22 tables (users, transactions, budgets, Gmail sync, notifications, metrics) with simple ops, backup, and no per-query cloud dependency — after decommissioning Supabase (Postgres) and Firebase (Firestore).

## Decision

Use **Turso (libSQL)** — SQLite-compatible, edge-replicated:

- Client: `@libsql/client`; query builder: Kysely (`@libsql/kysely-libsql`).
- Canonical schema in `turso-schema.sql` (22 tables).
- Indexes for pagination (`transactions`, `gmail_sync_logs.sync_run_id`).
- Backup/restore via `scripts/backupTurso.mjs` + runbook.
- CI uses a separate seeded Turso DB for deterministic E2E.

## Alternatives Considered

| Option | Reason rejected |
|---|---|
| Supabase Postgres | Project decommissioned; infra overhead for this workload |
| Firebase Firestore | Non-relational; auth/query mismatch; legacy |
| MySQL/Postgres self-hosted | Ops burden, no edge replication |
| SQLite file | No remote access for a web API |

## Consequences

**Positive:** SQL semantics, cheap, fast pagination, easy local dev, deterministic CI seeds, simple backup.
**Negative:** Single-region default; migrations are manual SQL files (no ORM migration framework — mitigated by `applyTursoSchema.mjs` + documented schema).
