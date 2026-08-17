# security — Documentation Index

> **Status:** Active · **Owner:** Core Engineering · **Last Updated:** 2026-08-09

## Overview

Laporan audit keamanan (auth, cookies, secrets, PII, prompt injection, Gmail tokens) + kontrak lifecycle sesi.

## Documents

| Document | Description |
|---|---|
| [SECURITY_AUDIT.md](SECURITY_AUDIT.md) | SECURITY_AUDIT — lihat dokumen. |
| [SESSION_LIFECYCLE.md](SESSION_LIFECYCLE.md) | Kontrak lifecycle sesi (cookie HttpOnly+SameSite=Lax, expiresIn/updateAge, cache 300s, CSRF Origin check 403, prosedur verifikasi script + bukti) |
| [BETTER_AUTH_CONFIG_CONTRACT.md](BETTER_AUTH_CONFIG_CONTRACT.md) | Kontrak konfigurasi better-auth eksplisit (audit P1-2): semua setting dengan default aktif di produksi di-pin (session expiresIn/updateAge/freshAge/cookieCache, rateLimit disabled, basePath, cookiePrefix, advanced origin/CSRF/subdomain) + deployment notes + test config |
| [RATE_LIMITING.md](RATE_LIMITING.md) | **Keputusan rate limiting**: express-rate-limit = single source of truth (4 limiter: general/auth/AI/receipt) — alasan 2 lapis limiter berbahaya (format 429 berbeda, budget ganda, memory storage), env override `RATE_LIMIT_*`, urutan middleware & keying per-user, format 429 kontrak, regression guards E2E + catatan operasional |
| [ACCOUNT_DATA_EXPORT.md](ACCOUNT_DATA_EXPORT.md) | **P0.2 Data portability**: GET /api/privacy/export (requireAuth, user-scoped) — format exportVersion 1.0, tabel yang diexport vs dikecualikan (OAuth token/session/telemetry mentah), security (tanpa storage publik), observability, test matrix |
| [ACCOUNT_DELETION.md](ACCOUNT_DELETION.md) | **P0.3 Account deletion**: DELETE /api/privacy/account + konfirmasi eksplisit "DELETE" — wipe lengkap per-tabel dalam SATU batch atomik, revoke sesi, hapus user better-auth & legacy, idempotent (404 kedua), audit email-redact, post-deletion behavior |
| [ADMIN_AUDIT_TRAIL.md](ADMIN_AUDIT_TRAIL.md) | **P0.3 Admin audit**: tabel admin_audit_log (+result/request_id via migration 0002), helper buildAdminAuditStatement/recordAdminAudit (single source of truth), coverage SUCCESS/DENIED/FAILURE, fail policy (atomic vs fail-open), metadata sanitization, keputusan metrics-read, retention decision required |
| [SCHEMA_DRIFT_GUARD.md](SCHEMA_DRIFT_GUARD.md) | **P0.4 Schema drift guard**: npm run db:migrate:check (live/local tanpa kredensial) — kontrak tabel/kolom/index (verifikasi definisi aktual, incl. unique partial idempotency), baseline sync statis, CI gate di quality + e2e jobs |

## Related

- [Documentation Map](../DOCUMENTATION_MAP.md) — peta lengkap seluruh dokumentasi.
- [Meta documentation](../meta/INDEX.md) — sistem dokumentasi & konvensi.
- [Root README](../../README.md) — entry point repository.
