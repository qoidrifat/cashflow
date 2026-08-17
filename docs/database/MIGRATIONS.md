# CashFlow — Database Migrations (Turso/libSQL)

> **Status:** Active · **Owner:** Core Engineering · **Last Updated:** 2026-08-09 · **Related:** [SCHEMA_DRIFT_GUARD.md](../security/SCHEMA_DRIFT_GUARD.md)

## Ringkasan

CashFlow memakai migration versioned untuk mengelola schema Turso/libSQL.

```text
Development Schema (turso-schema.sql — legacy boot)
        ↓
Versioned Migrations (server/migrations/0001_baseline.sql, 0002+, ...)
        ↓
Migration Runner (server/lib/migrationRunner.js)
        ↓
Turso Production (schema_migrations mencatat state)
        ↓
Schema Verification (npm run db:migrate:check)
        ↓
Application
```

## Dua sumber schema (dan kenapa keduanya ada)

| File | Peran | Kapan dipakai |
|---|---|---|
| `turso-schema.sql` | Schema idempoten **legacy** — di-apply boot-time oleh `initTursoSchema` (server/lib/turso.js). CREATE IF NOT EXISTS + ALTER one-off untuk DB lama. | Setiap boot server (backward-compat; DB lama butuh ALTER kolom legacy). |
| `server/migrations/*.sql` | Migration **versioned** — sumber kebenaran untuk perubahan schema baru. | `npm run db:migrate` (deploy / manual). |

Kenapa bukan hanya satu? Karena mengubah perilaku boot (menghapus `initTursoSchema`) berisiko tanpa manfaat. Runner adalah lapisan governance **di atas** boot path; drift guard (lihat SCHEMA_DRIFT_GUARD.md) memastikan keduanya tidak menyimpang dari kontrak.

**Aturan emas:** perubahan schema BARU = migration baru (`0003_...`, `0004_...`), **bukan** edit `turso-schema.sql` dan **bukan** edit migration yang sudah applied.

## Struktur & naming

```text
server/migrations/
  0001_baseline.sql        ← snapshot schema (regenerable, lihat bawah)
  0002_add_admin_audit_result_request_id.sql
  0003_gmail_message_id_unique_index.sql
  0004_...                ← perubahan berikutnya
```

- Format nama: `<4-digit zero-padded>_<nama>.sql` (contoh: `0001_baseline.sql`).
- Sort deterministik **numerik** (0002 sebelum 0001 di disk tetap di-apply 0001 dulu).
- Versi duplikat → error `MIGRATION_DUPLICATE_VERSION` (fail, bukan sort diam-diam).

## Baseline (0001_baseline.sql)

Strategi **baseline existing schema** (bukan drop/recreate):

- **Fresh DB** → file dieksekusi penuh; seluruh tabel/index/seed dibuat.
- **DB existing** → statement adalah no-op idempoten (CREATE ... IF NOT EXISTS); runner mencatat `0001` sebagai applied.

Baseline di-*generate* dari `turso-schema.sql` via `npm run db:migrate:baseline` (scripts/regenerateBaseline.mjs) dengan aturan:

1. CREATE TABLE/INDEX IF NOT EXISTS + seed INSERT OR IGNORE dipertahankan.
2. ALTER TABLE ADD COLUMN one-off legacy **dibuang** (efeknya sudah di CREATE TABLE).
3. Kolom yang HANYA ada via ALTER (saat ini `transactions.idempotency_key`) **di-inject** ke definisi CREATE TABLE — fresh DB butuh kolom sebelum index partial dibuat.

Drift test (`tests/unit/schemaContract.test.ts` → `assertBaselineSynced`) memastikan `turso-schema.sql` ↔ baseline identik (tabel & kolom), dengan pengecualian intentional: tabel `schema_migrations` + kolom inject `transactions.idempotency_key`.

## 0003 — Unique partial index gmail_message_id (hardening TOCTOU final)

`idx_transactions_gmail_msg_unique ON transactions(user_id, gmail_message_id)
WHERE gmail_message_id IS NOT NULL AND gmail_message_id != ''` — membuat
jaminan dedupe gmail ENFORCED (bukan advisory): dua transaksi dengan
(user_id, gmail_message_id) sama mustahil ada, bahkan saat dua request TANPA
Idempotency-Key berlomba (direct API / importer batch). Latar belakang lengkap:
`docs/financial/FINANCIAL_CALCULATION_INTEGRITY.md` §10.8.

**⚠️ Prasyarat data BERSIH**: runner fail-fast → `CREATE UNIQUE INDEX` GAGAL
bila masih ada >1 baris per (user_id, gmail_message_id). Pre-flight read-only
sebelum `npm run db:migrate`:

```bash
node -- scripts/verifyGmailUniqueIndex.mjs --check-only   # cek duplikat (exit 1 bila kotor)
# bila kotor, bersihkan dulu:
GM_DUP_CLEANUP_EXECUTE=1 node -- scripts/gmailDuplicateCleanup.mjs --execute --yes
node -- scripts/verifyGmailUniqueIndex.mjs                  # cek + buat + verifikasi (idempoten)
```

Skrip verifikasi: `scripts/verifyGmailUniqueIndex.mjs` (standalone, tidak
dependen pada runner). Migration memakai `CREATE UNIQUE INDEX IF NOT EXISTS`
sehingga aman di env yang index-nya sudah dibuat manual, namun TETAP gagal
(fail-fast, tidak tercatat applied) pada data duplikat — diverifikasi unit
`migrationRunner.test.ts` (fresh apply + dirty fail-fast) & kontrak schema
(`REQUIRED_INDEXES` kini memeriksa index ini: unique + partial + WHERE **lengkap**
termasuk `!= ''` — definisi yang menyimpang terdeteksi, bukan hanya nama).

**Guard definisi (2026-08-11)**: sebelum `CREATE UNIQUE INDEX IF NOT EXISTS`,
migration 0003 menjalankan guard `SELECT CASE ... THEN 998` — memeriksa
`sqlite_master` untuk index dengan NAMA sama; bila definisi aktualnya menyimpang
(mis. non-unique, atau partial WHERE tanpa eksklusi `''` kosong), guard
menggagalkan migration (runner fail-fast → tidak tercatat applied). Ini menutup
celah `IF NOT EXISTS` yang meng-skip bila hanya NAMA index yang sudah ada.
Guard sengaja tidak memakai string literal `''` (dipakai `char(39)`) karena
`splitStatements` memecah statement pada SEMUA `;` termasuk di dalam string
literal — lihat komentar di file migration. Env yang sudah punya index benar:
guard no-op. Backstop tambahan: `scripts/dbMigrateCheck.mjs` (kontrak schema,
termasuk klausa WHERE lengkap) berjalan di CI & deploy.

## Checksum

Setiap file migration di-hash (sha256) saat apply dan disimpan di `schema_migrations.checksum`.

- File **applied** yang berubah → `MIGRATION_CHECKSUM_MISMATCH` — runner **BERHENTI** (tidak menjalankan ulang, tidak menebak).
- Remediasi: **buat migration baru**, jangan edit migration applied.

```text
✗ Migration failed
  Code    : MIGRATION_CHECKSUM_MISMATCH
  Version : 0002
  Stored  : a1b2... (checksum saat apply)
  Current : c3d4... (checksum file sekarang)
  Status  : NOT APPLIED
```

## Tabel bookkeeping

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL
);
```

Dibuat otomatis oleh runner bila belum ada. Index tambahan tidak diperlukan (tabel kecil, query point).

## Atomisitas & lock (concurrency)

- Setiap migration dieksekusi sebagai **SATU batch** (libsql batch = transaksi): `[statement SQL migration…, INSERT schema_migrations]`. Migration **tidak pernah** tercatat applied bila SQL-nya gagal — keduanya rollback bersama.
- **Lock = transaksional**: PRIMARY KEY `version` di `schema_migrations`. Dua proses yang menerapkan versi sama secara bersamaan → salah satu gagal pada INSERT → batch rollback → tidak ada double-apply parsial. Tidak ada filesystem lock (bukan production guarantee — keputusan didokumentasikan).
- Catatan kejujuran: libsql batch menonaktifkan `PRAGMA foreign_keys` selama batch (perilaku driver) — migration TIDAK boleh bergantung pada FK cascade.

## Commands

```bash
npm run db:migrate            # terapkan semua migration pending
npm run db:migrate:status     # status applied/pending/checksum (read-only)
npm run db:migrate:check      # schema drift guard (live DB atau temp lokal)
npm run db:migrate:baseline   # regenerate 0001_baseline.sql dari turso-schema.sql
```

Output `db:migrate`:

```text
CashFlow Database Migration
Database    : Turso (remote)
Environment : production
Current     : 0002
Latest      : 0003

✓ 0003_add_xyz

Migration complete (1 applied).
```

Tanpa perubahan: `✓ Database schema already up to date.`

## Menambah migration baru

1. Buat `server/migrations/0003_nama.sql` (nomor = latest + 1, lihat `db:migrate:status`).
2. Tulis SQL **idempoten bila memungkinkan** (CREATE IF NOT EXISTS); jika tidak (mis. INSERT seed), pastikan aman dijalankan sekali.
3. Jangan mengedit file migration yang sudah applied.
4. Jalankan `npm run db:migrate` (dev/test) — verifikasi output.
5. `npm run db:migrate:check` — pastikan kontrak schema tetap PASS.

## Prosedur deployment produksi

1. Backup dulu: `scripts/backupTurso.mjs` (lihat docs backup).
2. Jalankan migration: `npm run db:migrate` (env produksi) — **sebelum** server baru mulai menerima traffic.
3. Verifikasi: `npm run db:migrate:status` (checksum ✓ consistent) + `npm run db:migrate:check` (PASS).
4. Start/rollout aplikasi.
5. CI (e2e job) menjalankan `npm run db:migrate` terhadap DB CI setelah apply schema — drift terdeteksi lebih awal.

## Rollback strategy

**TIDAK ada rollback otomatis.** Migration adalah forward-only (SQLite tidak mendukung DROP COLUMN secara umum sebelum versi tertentu; migrasi data tidak reversible secara aman).

Pola yang didukung: **forward-fix migration** — jika migration `0003` bermasalah di produksi, tulis `0004` yang membalikkan efeknya (mis. re-add kolom dengan nilai yang benar), bukan mengedit `0003`.

## Kegagalan & recovery

| Skenario | Perilaku | Recovery |
|---|---|---|
| SQL migration gagal | Batch rollback; versi TIDAK dicatat; runner exit 1 | Perbaiki SQL, buat migration baru jika perlu, jalankan ulang |
| Checksum drift | Runner exit 1 dengan detail | Buat migration baru (jangan edit file applied) |
| Versi duplikat | Runner exit 1 sebelum apply | Rename salah satu file (versi unik) |
| Koneksi gagal | Runner exit 1 | Periksa URL/token, jalankan ulang |

Runner tidak pernah menghapus/reset data, tidak pernah drop table, tidak pernah truncate — aman dijalankan berulang.
