# CashFlow — Admin Audit Trail (P0.3)

> **Status:** Active · **Owner:** Core Engineering · **Last Updated:** 2026-08-09 · **Related:** [ACCOUNT_DELETION.md](ACCOUNT_DELETION.md) · [ACCOUNT_DATA_EXPORT.md](ACCOUNT_DATA_EXPORT.md)

## Tujuan

Log keamanan untuk aksi privileged/admin — **bukan** pengganti `system_metrics` (telemetry observability). Perbedaan:

| | system_metrics | admin_audit_log |
|---|---|---|
| Sifat | Aggregat/event counter (non-PII) | Log per-aksi (actor, target, result) |
| Dipakai | Dashboard monitoring | Investigasi keamanan & akuntabilitas |
| Berisi PII | Tidak | Ya (actor/target email admin) — sengaja |

## Tabel

```sql
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  target_user_id TEXT,
  target_email TEXT,
  actor_user_id TEXT NOT NULL,
  actor_email TEXT NOT NULL,
  metadata TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  result TEXT NOT NULL DEFAULT 'success',   -- migration 0002
  request_id TEXT                           -- migration 0002
);
```

`result` & `request_id` ditambahkan migration `0002` (backward-compatible: baris lama default `'success'`, request_id NULL).

## Helper (single source of truth)

`server/lib/adminAudit.js`:

- `buildAdminAuditStatement(entry)` — statement INSERT murni untuk komposisi **batch atomik** (pola suspend: [audit, DELETE] satu transaksi → audit tidak pernah hilang walau operasi sukses).
- `recordAdminAudit(client, entry)` — eksekusi langsung (jalur fail-open).
- `sanitizeMetadata(metadata)` — hanya primitif; key `token/secret/password/cookie/authorization/api key` DIBUANG; objek/array → ringkasan.

Pemakai: `adminMetricsRoutes.js` (suspend — refactor memakai helper), `privacyRoutes.js` (account delete). Tidak ada copy-paste SQL ke route lain.

## Yang diaudit (matriks coverage)

| Endpoint | Action | Admin auth | Audit |
|---|---|---|---|
| `POST /api/admin/users/:id/suspend` | suspend user | ✓ resolveAdmin | ✓ SUCCESS (batch atomik) · ✓ DENIED (403) · ✓ FAILURE (5xx) |
| `DELETE /api/privacy/account` | account delete (user-initiated) | n/a (requireAuth) | ✓ SUCCESS (batch atomik) |
| `GET /api/admin/metrics/*` (aggregate) | read metrics | ✓ | ✗ (keputusan: aggregate-only → telemetry cukup, bukan per-request) |
| `GET /api/admin/metrics/*?userId=` | read user-specific | ✓ | ✗ (dokumentasi di bawah) |

### Keputusan untuk metrics reads (§35 prompt P0)

- Endpoint metrics **aggregate** (`/summary`, `/ai-usage`, `/system`, `/retention`, dsb.) → **TIDAK diaudit per-request** — data aggregate tanpa atribusi user individual; audit per-request hanya noise.
- Endpoint dengan parameter **per-user** (`?userId=`) → data tersebut adalah telemetry non-PII (system_metrics), bukan data pribadi sensitif; keputusan: **tidak diaudit**, namun dicatat sebagai residual risk di bawah (jika interpretasi privacy ketat diinginkan, tambahkan audit `ADMIN_METRICS_VIEW` dengan targetUserId).

### Yang TIDAK diaudit

- 401 (tidak ada actor untuk diatribusikan).
- 400/404 validasi/not-found (noise tanpa nilai keamanan — bukan percobaan gagal).
- GET aggregate metrics (keputusan di atas).

## Fail policy (didokumentasikan, bukan asal)

- **Jalur success (mutasi)**: audit + operasi dalam **satu batch atomik** — audit failure = operasi failure (fail-closed atomic). Tidak ada operasi sukses tanpa audit.
- **Jalur denied/failure**: audit ditulis **best-effort (fail-open)** — kegagalan audit TIDAK boleh menimpa respons 4xx/5xx yang sudah benar; error audit di-log warning.
- Alasannya: pada kegagalan, respons yang benar (403/500) lebih penting daripada record audit; pada sukses, audit adalah bagian dari operasi.

## Metadata security

Metadata TIDAK PERNAH memuat: password, token (OAuth/sesi), cookie, secret/service credentials, isi Gmail, payload finansial penuh. Untuk suspend: `{ sourceIp }`. Untuk deletion: `{}`.

## Immutability

Tidak ada endpoint `PATCH/DELETE /api/admin/audit/*` untuk workflow normal. Audit hanya ditulis (append-only). Retention/penghapusan = kebijakan terpisah (lihat bawah).

## Retention

**Retention policy decision required** — belum ada kebijakan retensi resmi untuk `admin_audit_log` (baris dipertahankan tanpa batas saat ini). Jangan meng-invent retensi; keputusan ini menunggu pemilik produk/security. Pilihan saat diputuskan: pembersihan berkala by `created_at` (pola `sessionCleanup`), arsip, atau retain selamanya.

## Test coverage

- `tests/unit/adminSuspend.test.ts` — refactor helper: batch atomik [audit SUCCESS + DELETE], audit DENIED (403), audit FAILURE (5xx), fail-open saat audit gagal.
- `tests/unit/privacyRoutes.test.ts` — audit `account_delete` (email redacted, result, requestId) dalam batch deletion.
