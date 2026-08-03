# ADR-001: Better Auth for Authentication

> **Status:** Accepted · **Date:** 2026-07 · **Owner:** Core Engineering · **Related:** [ADR-002](ADR-002-turso.md)

## Context

CashFlow originally used Supabase Auth (and earlier, Firebase Auth). During the migration to Turso (embedded SQLite-compatible), the auth provider needed to be **self-contained and DB-agnostic** — sessions stored in the same Turso database as the application data, with Google OAuth and server-side session validation.

## Decision

Adopt **[Better Auth](https://better-auth.com)** as the sole auth framework:

- Google OAuth via `socialProviders.google`.
- Database-backed sessions in Turso tables (`user`, `session`, `account`, `verification`).
- `httpOnly` session cookies; `useSecureCookies: true` in production.
- Middleware resolves `req.user` on every API request; `ADMIN_EMAILS` gates admin routes (401/403).
- `BETTER_AUTH_SECRET` required in production (dev fallback logs a warning).

## Alternatives Considered

| Option | Reason rejected |
|---|---|
| Supabase Auth | Supabase project decommissioned; couples auth to a cloud provider |
| Firebase Auth | Legacy stack; naming remnant removed 2026-08 |
| Custom JWT | More code, weaker session revocation, no OAuth flow built-in |

## Consequences

**Positive:** Single dependency, DB sessions in Turso, easy Google OAuth, well-documented; rate limiting + E2E auth-gate tests now guard it.
**Negative:** Must manage session cleanup and secret rotation ourselves; provider lock-in to a smaller community (mitigated by standards-based cookies).
