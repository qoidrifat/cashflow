# Gmail Deduplication Contract — CashFlow (P0)

> **Status**: AKTIF · **Terakhir diverifikasi**: 2026-08-11 (DB dev: 0 grup duplikat,
> unique index terpasang, migration 0003 applied) · Dokumen pelengkap:
> `docs/financial/FINANCIAL_CALCULATION_INTEGRITY.md` §10.2–§10.11 (audit forensik +
> hardening berlapis) dan `docs/database/MIGRATIONS.md` (0003).

Kontrak ini mendefinisikan satu aturan deduplikasi Gmail CashFlow: **satu pesan
Gmail → maksimal satu transaksi canonical** per user. Semua lapisan (klien,
server, database, tooling, sync) mematuhi aturan yang sama.

---

## 1. Canonical Gmail Identity

```text
(user_id, gmail_message_id)
```

- `gmail_message_id` = `message.id` dari Gmail API (di-populate saat import
  `source = 'gmail'`).
- Satu email = satu transaksi. Audit forensik §10.2 membuktikan **0 pesan
  legitimate multi-transaksi** di dataset dev (253 grup duplikat semuanya
  confirmed duplicate) → identity kuat tanpa index-child.
- `gmail_message_id` kosong/NULL = transaksi non-gmail → TIDAK tercakup kontrak
  (dikecualikan dari unique index partial).
- Business-key (`type+amount+transaction_date+merchant`) adalah **heuristik
  sekunder** (klasifikasi + cek klien) — BUKAN correctness boundary. Identity
  canonical hanya `(user_id, gmail_message_id)`.

## 2. Idempotency Guarantee

```text
Sync(Sync(DB, Gmail), Gmail) = Sync(DB, Gmail)     ← run kedua = 0 transaksi baru
```

Dijamin berlapis:

| Lapisan | Mekanisme |
| ------- | --------- |
| Prefilter klien | `getExistingFinalGmailMessageIds` (server) + `processedIdsRef` → email final tidak masuk antrian AI lagi |
| Cek klien | `findDuplicateTransaction` + `isAlreadyImportedLocal` (store lokal + registry cross-tab) → pesan sudah diimport → `DuplicateTransactionError` (sebelum POST) |
| Server (1) | `Idempotency-Key` (`gmail::<userId>::<msgId>`) → unique partial index `(user_id, idempotency_key)` → replay |
| Server (2) | pre-SELECT `gmail_message_id` penuh (user-scoped, `ORDER BY created_at ASC, id ASC`) → `{ id, replayed: true }` TANPA INSERT |
| Database | unique partial index `(user_id, gmail_message_id)` (migration 0003) → constraint error = duplicate, BUKAN 500 |
| Fallback offline | registry localStorage per-key + `isAlreadyImportedLocal` → replay id existing / wait-loop, tanpa baris kedua |

## 3. Database Uniqueness

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_gmail_msg_unique
  ON transactions(user_id, gmail_message_id)
  WHERE gmail_message_id IS NOT NULL AND gmail_message_id != '';
```

- Migration versioned: `server/migrations/0003_gmail_message_id_unique_index.sql`
  (fail-fast — GAGAL & tidak tercatat bila data masih duplikat).
- Enforced di semua env: `server/lib/schemaContract.js` `REQUIRED_INDEXES`
  (definitionContains `WHERE gmail_message_id IS NOT NULL AND gmail_message_id != '`),
  `turso-schema.sql`, `scripts/verifyGmailUniqueIndex.mjs`,
  `scripts/prepare-e2e-local-db.mjs`.
- Race TOCTOU (dua INSERT identik lolos pre-SELECT) → constraint menangkap →
  re-SELECT by gmail_message_id → replay, bukan 500 (test #8/#9
  `transactionGmailDedupe.test.ts`).

## 4. Sync Cursor

- **Arsitektur sync**: rescan rentang tanggal (`2026-01-01` → hari ini) dengan
  Gmail pagination `nextPageToken`; **tidak ada historyId cursor**. Idempotensi
  dicapai oleh dedupe (bagian 2), bukan oleh cursor — `Sync^n` selalu
  menghasilkan dataset yang sama.
- `gmail_sync_runs` menyimpan state `running/completed/failed/partial_failed` +
  `metadata` (progress) → crash/partial dapat diidentifikasi & diproses ulang.
- Cursor eksplisit (historyId) TIDAK diimplementasikan: menambahkan incremental
  sync = perubahan arsitektur besar tanpa kebutuhan data (dataset bounded 2026+);
  dicatat sebagai debt teknis (bagian 10).

## 5. Retry Behavior

- Retry request gmail identik → Idempotency-Key sama → server mengembalikan
  transaksi existing (replay), bukan INSERT baru.
- Sync run gagal di tengah → status `failed` tercatat; run berikutnya memproses
  ulang seluruh rentang — dedupe memastikan 0 duplikat.
- Retry per-email (status `failed`/`retry_later`) → hanya email tsb yang
  diproses ulang; yang sudah final (`approved`/`duplicate`) di-skip prefilter.

## 6. Concurrency Behavior

- **Dua sync/approve serentak untuk pesan sama** → tepat satu canonical
  transaction:
  1. Klien: in-flight map `pendingCreates` (create-once) + claim registry
     cross-tab (nonce + timestamp, format per-key) → satu pemenang.
  2. Server: Idempotency-Key → unique index idempotency.
  3. Database: unique partial index gmail → constraint = replay (bukan 500).
- User isolation: SEMUA query `WHERE user_id = ?`; `gmail_message_id` milik
  user lain TIDAK memblokir import (test user isolation).

## 7. Cleanup Procedure (legacy duplicates)

Tool: `scripts/gmailDuplicateCleanup.mjs` · npm: `npm run db:cleanup:gmail-duplicates`.

```text
1. DRY-RUN (default, read-only)  → laporan: user, pesan, baris, dampak saldo,
   by month, by source, by type, drift (multi-key TIDAK dihapus)
2. Klasifikasi                   → CONFIRMED (business key identik) dihapus;
                                   POSSIBLE/LEGITIMATE (beda key / type-drift)
                                   dilaporkan, TIDAK dihapus (default)
3. APPROVAL (berlapis)           → --execute + env GM_DUP_CLEANUP_EXECUTE=1
                                   + konfirmasi interaktif 'DELETE' / --yes
4. BACKUP                        → JSON seluruh baris (backups/gmail-cleanup/,
                                   gitignored) SEBELUM delete — restore penuh
5. ATOMIC                        → satu transaksi tulis; rollback bila gagal;
                                   verify recount setelah commit
6. AUDIT TRAIL                   → admin_audit_log (action
                                   gmail_duplicate_cleanup; result dry_run /
                                   success / failure; metadata agregat tanpa
                                   payload transaksi penuh)
7. IDEMPOTENT                    → rerun = "Tidak ada grup duplikat" (0 kerja)
```

### Dry-run

`npm run db:audit:gmail-duplicates` (alias dry-run read-only). Keluar dengan
laporan dampak saldo BEFORE→AFTER per user; **tidak ada mutasi**. Setiap
dry-run tercatat `result='dry_run'` di `admin_audit_log`.

### Approval

Confirmation ganda: `--execute` **dan** `GM_DUP_CLEANUP_EXECUTE=1` **dan**
konfirmasi (`DELETE` interaktif atau `--yes` non-TTY). Tanpa salah satu →
`ABORT`, nol mutasi. (Konvensi env-guard mengikuti `backupTurso.mjs`; string
konfirmasi P0 `DELETE_GMAIL_DUPLICATES` dipetakan ke konvensi ini — dokumentasi
§10.7 memakai `--execute --yes` + env guard.)

### Rollback

- Backup JSON berisi SELURUH kolom baris yang dihapus → restore = re-INSERT
  manual dari backup (tidak ada tool restore otomatis; `backups/` gitignored).
- Transaksi gagal di tengah → rollback otomatis, 0 baris terhapus, audit
  `result='failure'` tercatat.

## 8. Financial Reconciliation

- Cleanup mengubah balance hanya sebesar dampak duplikat (kontribusi baris
  duplikat: income/refund +, expense/transfer −).
- Dev (2026-08-11, dieksekusi dengan approval): 631+2 baris dihapus →
  balance −Rp9.329.062,47 → −Rp6.608.610,92 (+Rp2.720.451,55) — delta eksak =
  dampak duplikat, tidak ada delta tak terjelaskan.
- Formula canonical TIDAK berubah (income+refund − expense−transfer, windowless
  SQL `computeFinancialSummary`).

## 9. Security & Privacy

- Semua query user-scoped; cleanup global hanya via CLI ops (actor `cli`).
- TIDAK pernah: log body Gmail, OAuth/access token, payload transaksi penuh di
  audit (hanya agregat: jumlah + dampak saldo per user).
- `admin_audit_log` reuse (tabel ops), bukan tabel baru.

## 10. Remaining Debt (jujur)

| Item | Severity | Catatan |
| ---- | -------- | ------- |
| Incremental sync (historyId) belum ada | P2 | Rescan rentang + dedupe membuat sync idempoten; optimasi bila volume tumbuh |
| E2E "sync penuh dua kali" belum ada (butuh mock Gmail API) | P2 | Di-cover unit (replay/idempotency/concurrency) + E2E API-level `fraud-detection.spec.ts` (POST 2× msg sama → duplikat) |
| Tool cleanup tanpa unit test permanen (QA via temp DB) | P2 | Di-cover QA manual temp-DB + dokumentasi; refactor ke modul importable bila diperlukan |
| Recovery restore otomatis dari backup belum ada | P2 | Backup JSON lengkap; restore manual ter-dokumentasi |
