# Gmail Sync Failed Notification Fix Checklist

> ⚠️ **STATUS: ARSIP HISTORIS (SUPERSEDED)** — Dokumen ini ditulis pada era Supabase/Firebase (sebelum 2026-08-02) dan TIDAK mencerminkan arsitektur aktif. Arsitektur saat ini: Express 4 + Better Auth + Turso (libSQL) + SSE + Vertex AI. Lihat [ADR-001..007](../adr/INDEX.md) untuk keputusan arsitektur terkini; desain Gmail sync saat ini ada di [ADR-007](../adr/ADR-007-gmail-sync.md).

## Ringkasan Masalah

* [x] Notifikasi failed Gmail muncul berulang
* [x] Failed count berubah dari 171 ke 174
* [x] Dedupe notification belum berjalan benar untuk summary lintas scan/hari
* [x] Retry/fallback belum menurunkan failed count secara stabil

## Root Cause Analysis

* [x] Notification creator ditemukan: `src/services/notificationTriggers.ts`
* [x] Dedupe key diperiksa: key lama `gmail-failed-{date}`
* [x] Supabase notifications table diperiksa via MCP
* [x] Duplicate notifications diperiksa: tidak ada duplicate untuk key yang sama
* [x] Failed count calculation diperiksa
* [x] Retry Failed flow diperiksa
* [x] Server error 500 root cause diperiksa di client/proxy boundary

## Perbaikan Notification

* [x] Dedupe key Gmail failed summary dibuat stabil: `gmail-failed-summary-{userId}-{yyyy-mm-dd}`
* [x] `upsertNotificationByDedupeKey` diperbaiki dengan fallback unique-conflict
* [x] Unique index `(user_id, dedupe_key)` tersedia di Supabase aktual
* [x] Notification lama di-update saat count berubah dalam dedupe key yang sama
* [x] Notification duplicate tidak dibuat lagi untuk dedupe key yang sama
* [x] Notification resolved saat failedCount menjadi 0 jika summary sebelumnya ada

## Perbaikan Gmail Sync

* [x] Retry Failed hanya memproses failed/retry_later dari log
* [x] Status skipped/rejected/duplicate tidak ikut retry
* [x] Per-item try/catch diterapkan melalui batch concurrency
* [x] Fallback parser dipakai sebelum failed untuk AI/server error non-config
* [x] Generic Server error 500 dikurangi dengan fallback lokal dan status spesifik
* [x] Error classifier diterapkan dari proxy ke UI/log metadata

## Perbaikan Supabase

* [x] Table notifications dicek
* [x] Table gmail_sync_logs dicek
* [x] RLS notifications dicek dari migration existing
* [x] Policy notifications dicek dari migration existing
* [x] Unique index dedupe dicek
* [x] Schema cache reload disiapkan di migration idempotent

## Validasi

* [ ] Jalankan Retry Failed manual dengan akun Google
* [x] Failed count dihitung ulang di client setelah retry
* [x] Notification lama ter-update, bukan duplicate untuk key yang sama
* [x] Dropdown notification tidak spam untuk key yang sama
* [x] Halaman notification tidak spam untuk key yang sama
* [x] Build berhasil
* [x] Lint berhasil atau error terdokumentasi

## File yang Diubah

| File | Perubahan |
| ---- | --------- |
| `src/services/notificationService.ts` | Upsert dedupe dibuat race-safe dan fallback update saat unique conflict. |
| `src/services/notificationTriggers.ts` | Gmail failed summary memakai stable dedupe key, metadata count terpisah, dan resolved state. |
| `src/services/gmailSyncLogService.ts` | Query retryable status memakai `status`/`final_status`, retry limit naik, log metadata aman disimpan. |
| `src/features/gmail/GmailSyncPage.tsx` | Retry batch merge row lama, persist log, update notification summary, fallback parser untuk AI/server error. |
| `src/lib/geminiFallbackParser.ts` | Parser fallback diperluas untuk KAI, tiket.com, Agoda, Tokopedia, dan travel receipts. |
| `supabase/migrations/202606200002_gmail_failed_notification_dedupe.sql` | Migration idempotent untuk unique dedupe index dan schema reload. |
| Supabase production notifications | Cleanup non-destruktif: row `174` diadopsi ke dedupe key baru, row `171` ditandai superseded/read. |

## Error yang Ditemukan dan Solusi

| Error | Root Cause | Solusi | Status |
| ----- | ---------- | ------ | ------ |
| Summary 171 dan 174 terlihat berulang | Key lama berbasis tanggal dan row lama tetap aktif/unread | Stable key baru per user/hari, update/resolved lewat upsert | Selesai |
| Count berubah tetapi retry tidak menurunkan log | Retry UI tidak meng-update row lama dan tidak persist hasil retry ke `gmail_sync_logs` | Merge hasil retry by message id dan upsert log metadata-only | Selesai |
| Banyak AI/server error menjadi `failed` | Fallback hanya dipakai pada invalid JSON | Fallback dipakai untuk AI/server error non-config sebelum final failed | Selesai |
| Retry batch hanya 50 item | Limit `getFailedEmailIds` terlalu kecil untuk kasus 171/174 | Default dan call dinaikkan ke 200 | Selesai |

## Hasil Akhir

* Failed sebelum fix: 171 lalu 174 pada notification summary aktual
* Failed setelah retry: perlu validasi manual dengan akun Google karena butuh Gmail OAuth runtime
* Retry later: dihitung terpisah dari failed
* Pending review: hasil fallback sukses masuk `pending_review`
* Skipped/rejected: email tanpa nominal masuk `skipped`/`auto_rejected`, bukan failed
* Duplicate notification count: 0 duplicate untuk `dedupe_key` yang sama di Supabase aktual
* Build status: OK
* Lint status: OK
* Gmail Sync status: logic retry/fallback diperbaiki, manual OAuth test tersisa
* Notification status: dedupe/update OK untuk key stabil
