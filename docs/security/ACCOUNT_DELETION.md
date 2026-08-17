# CashFlow — Account Deletion (P0.3)

> **Status:** Active · **Owner:** Core Engineering · **Last Updated:** 2026-08-09 · **Related:** [ACCOUNT_DATA_EXPORT.md](ACCOUNT_DATA_EXPORT.md) · [ADMIN_AUDIT_TRAIL.md](ADMIN_AUDIT_TRAIL.md) · [SESSION_LIFECYCLE.md](SESSION_LIFECYCLE.md)

## Endpoint

```text
DELETE /api/privacy/account    (requireAuth)
Body: { "confirmation": "DELETE" }
```

Prinsip: **explicit · authenticated · confirmed · audited · irreversible**.

## Konfirmasi

- Body wajib `{ confirmation: "DELETE" }` — **email saja tidak cukup** (email bukan confirmation authority; attacker dengan akses sesi + tahu email tidak bisa menghapus tanpa konfirmasi eksplisit).
- Konfirmasi salah / absen → `400 INVALID_CONFIRMATION`.
- UI (PrivacyPage): input teks wajib diketik `DELETE` sebelum tombol aktif (dua langkah, non-destructive default, tombol `Batal`).

## Lifecycle

```text
confirmation ("DELETE")
   ↓
lookup user (404 bila sudah dihapus → idempoten)
   ↓
SATU batch ATOMIK:
   hapus SEMUA tabel user-owned (user_id = authUserId)
   hapus verification (identifier = email)
   tulis audit account_delete (email REDACT)
   hapus user better-auth
   hapus users legacy
   observability account_deletion_completed (user_id NULL)
   ↓
client: sign-out (cookie invalid) + redirect '/'
```

## Urutan & tabel yang dihapus

Urutan dependency-aware (walau FK pragma OFF saat libsql batch — penghapusan **eksplisit**, tidak bergantung cascade):

```text
gmail_sync_runs → gmail_sync_settings → gmail_sync_logs
fraud_flags → transactions → recurring_transactions → budgets → categories
wallet_accounts → saving_goals → subscriptions → notifications
ai_feedback → ai_memory → ai_timeline
system_metrics → ai_usage_metrics      (telemetry user-specific — privacy)
user_sessions → profiles               (legacy identity)
session → account                      (better-auth)
verification (identifier = email)
audit account_delete
user (better-auth) → users (legacy)
```

Semua dalam **satu `turso.batch`** = satu transaksi. Gagal di tengah → **rollback penuh** (tidak ada half-deleted account). Tidak ada tabel yang di-drop, tidak ada data global (alert_rules, admin_metrics, schema_migrations, admin_audit_log non-deletion) yang disentuh.

## Better Auth

Tidak ada lifecycle `deleteUser` resmi di core better-auth 1.6.25 yang dipakai project (plugin admin `banUser` tidak terpasang) → penghapusan via SQL langsung atas tabel resmi better-auth (`user`/`session`/`account`/`verification`) dianggap pendekatan yang tepat, didokumentasikan. `dash()` plugin tidak menambah tabel.

## Idempotency

- Request pertama → 200 `{ ok: true, action: 'account_delete', ... }`.
- Request kedua (akun sudah dihapus) → **404 `ACCOUNT_NOT_FOUND`** ("Akun sudah dihapus.") — aman, tidak ada partial corruption.

## Failure safety

- Batch gagal → `500 ACCOUNT_DELETE_FAILED` + pesan "Tidak ada data yang diubah" — transaksi atomik menjamin tidak ada state `deleted/pending/failed` parsial yang ambigu.
- Status yang mungkin: **deleted** (200, batch commit) atau **failed** (500, batch rollback = tidak ada perubahan). Tidak ada status menengah.

## Audit

Entri `admin_audit_log` untuk setiap deletion:

```text
action        = 'account_delete'
actor_user_id = <userId>
actor_email   = ''            ← REDACTED (aturan privasi)
target_user_id = <userId>
target_email  = null          ← REDACTED
metadata      = '{}'
result        = 'success'
request_id    = <req.id>
```

**Aturan privasi CRITICAL**: audit TIDAK menyimpan email/PII yang baru saja dihapus — hanya event + id (opaque identifier) + timestamp + result + requestId (lihat ADMIN_AUDIT_TRAIL.md §Metadata).

## Post-deletion behavior

- Sesi dihapus di server → cookie lama **tidak valid seketika**; request berikutnya → get-session null → 401 (diverifikasi unit test + `old session → unauthorized` matrix).
- Klien: `signOutUser()` (boleh gagal — cookie sudah invalid) + bersihkan cache lokal + redirect `/`.

## Observability

- `account_deletion_completed` (system_metrics, feature `privacy`, **user_id NULL** — agregat aman tanpa PII) ditulis dalam batch yang sama.

## Test coverage

`tests/unit/privacyRoutes.test.ts`:
- 401 unauth · 400 tanpa/konfirmasi salah (batch tidak dipanggil)
- 200 wipe lengkap A: semua tabel user-owned + verification + user (better-auth & legacy) + audit (email redacted, result success, requestId)
- B tetap utuh (semua statement hanya menarget B)
- sesi revoked (deletedSessions) · audit atomik
- **idempoten**: delete kedua → 404, batch tidak dipanggil
- 500 → tidak ada partial

## Gap / keputusan yang perlu perhatian

- **Retention policy**: tidak ada periode retensi yang didefinisikan untuk `admin_audit_log` (baris `account_delete` bertahan). Keputusan: **Retention policy decision required** — lihat ADMIN_AUDIT_TRAIL.md §Retention.
- `verification` dihapus berdasarkan `identifier = email` — mencakup baris verify/reset untuk email tersebut.
