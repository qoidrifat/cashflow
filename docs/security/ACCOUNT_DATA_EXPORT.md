# CashFlow — Account Data Export (P0.2)

> **Status:** Active · **Owner:** Core Engineering · **Last Updated:** 2026-08-09 · **Related:** [ACCOUNT_DELETION.md](ACCOUNT_DELETION.md) · [ADMIN_AUDIT_TRAIL.md](ADMIN_AUDIT_TRAIL.md)

## Endpoint

```text
GET /api/privacy/export      (requireAuth)
```

- **Authority** = session terautentikasi (`req.user.id`) — endpoint **TIDAK PERNAH** menerima `userId` dari body/query.
- Semua query user-scoped: `WHERE user_id = <authenticatedUserId>` (parameterized).
- Rate limit: limiter umum `generalLimiter` (5000 req / 15 mnt / user) — tidak ada limiter khusus (keputusan: export per-user langka; lihat RATE_LIMITING.md).

## Format (versioned)

```json
{
  "exportVersion": "1.0",
  "schemaVersion": "1.0",
  "generatedAt": "2026-08-09T00:00:00.000Z",
  "user": { "...kolom user better-auth (tanpa secret)..." },
  "legacyUser": { "...tabel users (legacy)..." },
  "profile": { "...profiles..." },
  "transactions": [...],
  "categories": [...],
  "budgets": [...],
  "recurringTransactions": [...],
  "fraudFlags": [...],
  "gmailSync": { "logs": [...], "settings": {}, "runs": [...] },
  "wallets": [...],
  "savingGoals": [...],
  "subscriptions": [...],
  "notifications": [...],
  "ai": { "feedback": [...], "memory": [...], "timeline": [...] }
}
```

`exportVersion` dijamin stabil untuk klien; perubahan breaking = bump versi (bukan ubah bentuk di tempat).

## Data yang di-export (semua user-scoped)

| Tabel | Catatan |
|---|---|
| `user` (better-auth) | Metadata profil. `googleId` = identifier OAuth user (metadata, bukan secret). |
| `users` (legacy), `profiles` | Baris identitas legacy — sinkron dengan `user` (id sama). |
| `transactions`, `fraud_flags` | Data keuangan user. |
| `categories`, `budgets`, `recurring_transactions` | Preferensi & perencanaan. |
| `gmail_sync_logs`, `gmail_sync_settings`, `gmail_sync_runs` | Riwayat sinkronisasi Gmail (subject/sender milik user sendiri). |
| `wallet_accounts`, `saving_goals`, `subscriptions` | Data professional suite. |
| `notifications` | Notifikasi user. |
| `ai_feedback`, `ai_memory`, `ai_timeline` | Data AI user (preferensi, riwayat, feedback). |

## Data yang TIDAK di-export (keputusan terdokumentasi)

| Data | Alasan |
|---|---|
| `account` (better-auth) | Berisi **OAuth access/refresh token + idToken + password hash** — rahasia, tidak pernah diexport. |
| `session`, `verification` | Token sesi / kode verifikasi — secret. |
| `system_metrics`, `ai_usage_metrics` | **Analytics internal** (bukan konten user). Keputusan: tidak diexport; dihapus saat akun dihapus (lihat ACCOUNT_DELETION.md). |
| `admin_audit_log` | Log keamanan/admin — bukan data user (bisa memuat info actor admin). |
| `alert_rules`, `admin_metrics`, `schema_migrations` | Konfigurasi global / bookkeeping. |

## Keamanan

- **Tidak ada penyimpanan permanen**: export digenerate saat request → langsung dikirim sebagai response (bukan file publik, bukan URL publik, tidak ada TTL yang perlu dikelola).
- **Tidak ada logging payload**: logger pino redact `*.token`/`*.secret`; route tidak pernah log isi export.
- **Bounded**: seluruh data user diambil sekaligus (bukan streaming) — untuk closed beta (10–30 user, data per user ≤ ribuan baris) ini bounded dan aman; jika skala tumbuh besar, streaming adalah evolusi yang didokumentasikan di sini (belum diperlukan).

## Observability

- Sukses → `system_metrics`: `privacy_export_completed` (feature `privacy`, user_id) — non-PII.
- Gagal → respons `PRIVACY_EXPORT_FAILED` (500) + log error (tanpa payload).

## Test coverage

- `tests/unit/privacyRoutes.test.ts`: 401 unauth · user A hanya data A · user B hanya data B · **secret exclusion** (account/session/verification tidak pernah di-query; tidak ada token di respons) · observability · 500.

## Future compatibility

- `exportVersion` + `generatedAt` memungkinkan klien/alat migrasi mengetahui format.
- Menambah tabel baru ke export = perubahan additive (kolom baru di JSON) — tidak membutuhkan bump versi selama tidak ada field yang di-rename/dihapus.
