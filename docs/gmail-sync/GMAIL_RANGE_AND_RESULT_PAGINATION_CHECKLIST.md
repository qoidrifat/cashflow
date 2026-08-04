# Gmail Range and Result Pagination Checklist

> ⚠️ **STATUS: ARSIP HISTORIS (SUPERSEDED)** — Dokumen ini ditulis pada era Supabase/Firebase (sebelum 2026-08-02) dan TIDAK mencerminkan arsitektur aktif. Arsitektur saat ini: Express 4 + Better Auth + Turso (libSQL) + SSE + Vertex AI. Lihat [ADR-001..007](../adr/INDEX.md) untuk keputusan arsitektur terkini; desain Gmail sync saat ini ada di [ADR-007](../adr/ADR-007-gmail-sync.md).

## Range Pengambilan Gmail
- [x] Start date diset ke 2026-01-01
- [x] End date dihitung dinamis saat user login/klik scan
- [x] Gmail query memakai `after:2026/01/01`
- [x] Gmail query memakai `before:{tanggal_besok}`
- [x] Email hari ini ikut terbaca (before: besok)
- [x] Tidak hardcode end date
- [x] Tidak hardcode limit 200 email — semua email hasil query diambil

## Gmail API Pagination
- [x] `maxResults=100` per Gmail API request (per page)
- [x] `nextPageToken` diproses untuk mengambil halaman berikutnya
- [x] Semua halaman Gmail API diambil hingga tidak ada nextPageToken
- [x] Safety limit MAX_EMAILS_PER_SCAN = 5000 mencegah infinite loop
- [x] Gmail API pagination dan UI pagination dipisahkan

## Supabase Persistence
- [x] `gmail_sync_runs` tersedia — menyimpan ringkasan sync
- [x] `gmail_sync_logs` tersedia — menyimpan detail per email
- [x] `sync_run_id` tersedia di gmail_sync_logs
- [x] Hasil scan disimpan ke Supabase via `persistGmailSyncResults`
- [x] Hasil tetap tersimpan meskipun user pindah halaman/refresh/logout

## UI Result Pagination (100 per halaman)
- [x] `getGmailSyncLogsPaginated` dibuat di service layer
- [x] Query Supabase memakai `.range(from, to)` untuk server-side pagination
- [x] `count: "exact"` digunakan agar total data diketahui
- [x] Maksimal 100 data per halaman (`pageSize = Math.min(Math.max(options.pageSize || 100, 1), 100)`)
- [x] Total count dan total pages ditampilkan
- [x] Tombol "Sebelumnya" dan "Berikutnya" tersedia
- [x] Indikator "Halaman X dari Y" ditampilkan
- [x] "Menampilkan X-Y dari Z email" ditampilkan
- [x] Semua hasil bisa dilihat sampai halaman terakhir

## State Management
- [x] Pagination state (`logsCurrentPage`, `paginatedLogs`) dikelola terpusat
- [x] Filter status memicu reload pagination ke halaman 1
- [x] `logsLoading` state untuk loading indicator
- [x] `logsError` state untuk error handling
- [x] Hasil scan dimuat dari Supabase saat halaman dibuka

## UX/UI
- [x] Loading state untuk paginated results
- [x] Empty state jika belum ada hasil scan
- [x] Error state dengan tombol coba lagi
- [x] Filter bar untuk memfilter status email

## File yang Diubah
| File | Perubahan |
| ---- | --------- |
| `src/services/gmailService.ts` | Hapus hardcoded limit 200, gunakan MAX_EMAILS_PER_SCAN=5000, fetch semua email dengan Gmail API pagination |
| `src/services/gmailSyncLogService.ts` | Tambah `getGmailSyncLogsPaginated` — paginated query dengan Supabase .range() dan count:exact, max 100/page |
| `src/features/gmail/GmailSyncPage.tsx` | Import paginated function, tambah pagination state, ubah `fetchTransactionEmails(200)` jadi tanpa limit, tambah `loadPaginatedResults`, tambah pagination controls UI |
| `docs/gmail-sync/GMAIL_RANGE_AND_RESULT_PAGINATION_CHECKLIST.md` | NEW — checklist ini |

## Final Status
- Gmail Range: ✅ OK (2026-01-01 sampai hari ini, dinamis)
- Gmail API Pagination: ✅ OK (semua email diambil via nextPageToken)
- Result Pagination 100/Page: ✅ OK (server-side pagination via Supabase)
- History Persistence: ✅ OK (data di Supabase, tetap ada setelah navigasi)
