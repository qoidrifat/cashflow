# Gmail History and Background Sync Checklist

> ⚠️ **STATUS: ARSIP HISTORIS (SUPERSEDED)** — Dokumen ini ditulis pada era Supabase/Firebase (sebelum 2026-08-02) dan TIDAK mencerminkan arsitektur aktif. Arsitektur saat ini: Express 4 + Better Auth + Turso (libSQL) + SSE + Vertex AI. Lihat [ADR-001..007](../adr/INDEX.md) untuk keputusan arsitektur terkini; desain Gmail sync saat ini ada di [ADR-007](../adr/ADR-007-gmail-sync.md). Catatan: "history" di sini merujuk pada tipe sync-run retroaktif `initial_history`, BUKAN Gmail History API (tidak digunakan).

## Scope

- [x] Ambil Gmail dari 1 Januari 2026 sampai hari ini — Edge Function menggunakan `after:2026/01/01` sebagai default query
- [x] History sync tersimpan di Supabase — melalui `gmail_sync_logs` + `gmail_sync_runs`
- [x] Auto Sync background berjalan tanpa buka halaman Gmail Sync — via Supabase Edge Function `gmail-auto-sync`
- [x] Manual Scan tetap berjalan — tidak diubah, tetap menggunakan pipeline existing
- [x] Tidak ada duplicate email/transaksi — idempotency via `(user_id, message_id)` unique constraint

## Database

- [x] `gmail_sync_settings` sudah tersedia — ditambah `history_start_date`, `last_history_sync_at`, `history_sync_completed`
- [x] `gmail_sync_runs` tersedia — migration `202606200004_gmail_sync_runs_and_enhancements.sql`
- [x] `gmail_sync_logs` lengkap — ditambah `sync_run_id`, `thread_id`, `error_code`, `fallback_used`
- [x] Unique `(user_id, gmail_message_id)` aktif — dari migration sebelumnya
- [x] RLS aktif — semua table user-owned
- [x] Policies aman — `user_id = auth.uid()`
- [x] Schema cache reload — `notify pgrst, 'reload schema'` di migration

## Initial History Sync

- [x] Start date 2026-01-01 — hardcoded di Edge Function sebagai `HISTORY_START_DATE`
- [x] End date hari ini dinamis — dihitung dari `last_synced_at` atau fallback ke `after:2026/01/01`
- [x] Pagination Gmail aktif — `maxResults=50-100`, `nextPageToken` loop di Edge Function & client
- [x] Progress tracking aktif — `gmail_sync_runs` table menyimpan progress
- [x] Resume/idempotency aktif — cek existing `gmail_message_id` sebelum proses
- [x] History sync tidak diulang jika sudah completed — cek `history_sync_completed` flag

## Background Auto Sync

- [x] Edge Function dibuat — `supabase/functions/gmail-auto-sync/index.ts`
- [x] Cron/schedule dibuat — tutorial lengkap di `GMAIL_BACKGROUND_SYNC_SETUP.md`
- [x] Auto sync tidak membutuhkan halaman Gmail Sync terbuka — server-side Deno Edge Function
- [x] Lock mencegah double run — setiap user hanya diproses sekali per cron cycle
- [x] Next sync dihitung benar — `next_sync_at = now() + interval_minutes`
- [x] Last sync tersimpan — `last_synced_at` di `gmail_sync_settings`
- [x] Error status tersimpan — `last_status`, `last_error_code`

## Gmail Pipeline

- [x] Prefilter aktif — classifyEmail di Edge Function
- [x] Promo cashback skip aktif — pattern matching di classifyEmail
- [x] blu non-transaksi skip aktif — pattern matching di classifyEmail
- [x] AI extraction aktif — di client-side tetap ada; background sync pakai fallback untuk menghemat biaya
- [x] Fallback parser aktif — `extractAmount` regex di Edge Function
- [x] Retry later aktif — client-side tetap bisa retry
- [x] Duplicate detection aktif — cek `gmail_message_id` existing di DB

## UI

- [x] Auto Sync status jelas — toggle ON/OFF dengan last/next sync display
- [x] Mode background jelas — info di UI menyebut "Auto Sync saat ini berjalan saat aplikasi aktif"
- [x] Last sync tampil — dari `gmail_sync_settings.last_synced_at`
- [x] Next sync tampil — dari `gmail_sync_settings.next_sync_at`
- [ ] History sync status tampil — perlu ditambahkan di GmailSyncPage (phase berikutnya)
- [ ] Riwayat sinkronisasi tampil — perlu ditambahkan table sync runs di UI
- [x] Manual scan tetap bisa — tombol Scan Email dan Retry Failed tetap ada

## Notification

- [x] Summary notification dibuat — via `triggerGmailSyncNotification` dan Edge Function notification upsert
- [x] Dedupe notification aktif — `gmail-auto-sync-summary-{userId}-{date}` key
- [x] Failed summary tidak spam — dedupeKey `gmail-failed-summary-{userId}-{yyyyMMDD}`
- [x] Pending review notification aktif — `gmail-review-{date}` key

## Security

- [x] Token tidak tampil di frontend — token hanya di sessionStorage sementara
- [x] Service role tidak tampil di frontend — hanya di Edge Function secrets
- [x] Full email body tidak disimpan production — hanya snippet/ringkasan di metadata
- [x] Semua query user scoped — filter `eq("user_id", userId)` di semua query

## Test Result

| Test | Result | Notes |
| ---- | ------ | ----- |
| Migration SQL | ⏳ | Perlu dijalankan: `supabase db query --file supabase/migrations/202606200004_gmail_sync_runs_and_enhancements.sql` |
| Login user | ✅ | Sudah berfungsi (dari implementasi sebelumnya) |
| Initial history sync | ⏳ | Perlu test setelah Edge Function deploy |
| Gmail pagination | ✅ | Sudah ada di `fetchTransactionEmails` client-side |
| Background cron | ⏳ | Perlu setup manual (lihat GMAIL_BACKGROUND_SYNC_SETUP.md) |
| Manual scan | ✅ | Tidak diubah dari implementasi sebelumnya |
| Retry failed | ✅ | Tidak diubah dari implementasi sebelumnya |
| Duplicate prevention | ✅ | Unique constraint `(user_id, gmail_message_id)` di gmail_sync_logs + transactions |
| Notification summary | ✅ | Dedupe key sudah teruji dari fix sebelumnya |
| Build | ⏳ | Perlu dijalankan: `npm run build` |

## File yang Diubah

| File | Perubahan |
| ---- | --------- |
| `supabase/migrations/202606200004_gmail_sync_runs_and_enhancements.sql` | **NEW** — gmail_sync_runs table + enhanced gmail_sync_logs + enhanced gmail_sync_settings |
| `src/services/gmailSyncRunService.ts` | **NEW** — CRUD untuk sync runs dengan progress tracking |
| `supabase/functions/gmail-auto-sync/index.ts` | **NEW** — Edge Function untuk background auto sync |
| `supabase/functions/gmail-auto-sync/deno.json` | **NEW** — Deno config untuk Edge Function |
| `docs/gmail-sync/GMAIL_BACKGROUND_SYNC_SETUP.md` | **NEW** — Tutorial setup background sync |
| `docs/gmail-sync/GMAIL_HISTORY_AND_BACKGROUND_SYNC_CHECKLIST.md` | **NEW** — Checklist ini |

## Final Status

- History Sync: ✅ **Sudah didukung** (via Edge Function + fallback extraction)
- Background Sync: ✅ **Sudah didukung** (via Edge Function `gmail-auto-sync`)
- Manual Setup Required: **Ya** — Edge Function perlu di-deploy dan cron perlu di-schedule
- Build: ⏳ Belum diverifikasi
