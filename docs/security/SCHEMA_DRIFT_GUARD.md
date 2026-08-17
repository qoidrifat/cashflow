# CashFlow — Schema Drift Guard (P0.4)

> **Status:** Active · **Owner:** Core Engineering · **Last Updated:** 2026-08-09 · **Related:** [MIGRATIONS.md](../database/MIGRATIONS.md)

## Tujuan

Menjamin:

```text
DB = Migration State = Application Expectations = Tests = Production Schema
```

Drift (tabel/kolom/index hilang, checksum migration berubah, baseline tak sinkron) → **FAIL** dengan exit code non-zero di CI dan CLI.

## Command

```bash
npm run db:migrate:check
```

Dua mode:

| Mode | Kapan | Yang diverifikasi |
|---|---|---|
| **LIVE** | `TURSO_DATABASE_URL` ter-set | Migration state (checksum consistent) + kontrak schema terhadap DB nyata |
| **LOCAL** | Tanpa kredensial (CI quality job) | File migration valid (duplicate/order) + baseline sync + fresh temp DB → apply semua migration → kontrak schema |

```text
Schema Drift Guard — CashFlow
Mode        : LOCAL (temp DB — tanpa kredensial Turso)
Static      : ✓ migration files valid + baseline sync (turso-schema.sql ↔ 0001_baseline.sql)
Migration   : 2 applied (fresh temp DB) → kontrak di bawah

Schema Verification Report
Tables:
  ✓ user  ✓ transactions  ✓ ai_feedback  ✓ ai_memory  ✓ ai_timeline  ...
Columns:
  ✓ transactions.idempotency_key  ...
Indexes:
  ✓ idx_transactions_user_idempotency  ✓ idx_admin_audit_created  ...
Result: PASS

✅ Schema drift guard: PASS
```

## Kontrak (server/lib/schemaContract.js — single source of truth)

- **REQUIRED_TABLES** (26): better-auth (`user`/`session`/`account`/`verification`), legacy (`users`/`user_sessions`/`profiles`), bisnis inti, Gmail, AI product, observability, `schema_migrations`, `admin_audit_log`.
- **REQUIRED_COLUMNS** (kritis): `transactions.user_id/.idempotency_key/.transaction_date`, `ai_feedback/.ai_memory/.ai_timeline.user_id`, `schema_migrations.version/.checksum`, `admin_audit_log.action/.actor_user_id/.created_at/.result/.request_id`, dsb.
- **REQUIRED_INDEXES**: verifikasi **definisi aktual**, bukan sekadar nama:
  - `idx_transactions_user_idempotency` → **unique** + **partial** (`WHERE idempotency_key IS NOT NULL`) — idempotensi create transaksi.
  - `idx_transactions_user_date`, `idx_ai_timeline_user_created`, `idx_system_metrics_name_created`, `idx_admin_audit_created`.

Verifier memeriksa `sqlite_master` + `PRAGMA table_info` + `PRAGMA index_list` + definisi SQL index.

## CI gate

- **Quality job** (tanpa secret): `npm run db:migrate:check` (mode LOCAL) — drift terdeteksi di setiap push/PR, tanpa kredensial Turso.
- **E2E/visual/perf jobs**: `npm run db:migrate` setelah `applyTursoSchema` — DB CI selalu berada di migration state terbaru.
- Gagal (missing table/column/index, checksum mismatch, invalid ordering, duplicate version) → exit 1 → job merah. **Bukan warning.**

## Guard statis (baseline sync)

`assertBaselineSynced()` (tests/unit/schemaContract.test.ts) membandingkan `turso-schema.sql` ↔ `0001_baseline.sql`: tabel & kolom CREATE TABLE harus identik, dengan dua pengecualian **intentional**:

- `schema_migrations` (hanya di baseline — tabel bookkeeping runner).
- `transactions.idempotency_key` (di turso-schema.sql hanya via ALTER → di-inject baseline ke CREATE TABLE).

Perubahan schema yang lupa di-sinkronkan ke baseline → test gagal → `npm run db:migrate:baseline` lalu review diff.

## Test coverage (tanpa DB eksternal)

`tests/unit/migrationRunner.test.ts` + `tests/unit/schemaContract.test.ts` (DB libsql temp lokal):
- Fresh DB → apply → kontrak PASS
- Repeat → no-op
- Checksum mutation → `MIGRATION_CHECKSUM_MISMATCH` (fail, tidak dijalankan ulang)
- Duplicate version → `MIGRATION_DUPLICATE_VERSION`
- Ordering deterministik (0002 di disk sebelum 0001 → tetap apply 0001 dulu)
- Failed migration → tidak dicatat applied
- Kontrak FAIL bila tabel hilang / index idempotency non-unique
- Baseline sync

## Alur kerja saat terjadi drift

1. CI merah dengan laporan `Schema Verification Report` → identifikasi yang hilang (tabel/kolom/index).
2. Bila perubahan schema legit: buat migration baru (`0003_...`), jalankan `npm run db:migrate`, `npm run db:migrate:baseline` jika `turso-schema.sql` ikut berubah, lalu `npm run db:migrate:check`.
3. Bila checksum mismatch: **jangan edit migration applied** — buat migration baru.
