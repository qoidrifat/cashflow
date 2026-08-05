# Gmail Date Range Newest to 2026 Checklist

> ⚠️ **STATUS: ARSIP HISTORIS (SUPERSEDED)** — Dokumen ini ditulis pada era Supabase/Firebase (sebelum 2026-08-02) dan TIDAK mencerminkan arsitektur aktif. Arsitektur saat ini: Express 4 + Better Auth + Turso (libSQL) + SSE + Vertex AI. Lihat [ADR-001..007](../adr/INDEX.md) untuk keputusan arsitektur terkini; desain Gmail sync saat ini ada di [ADR-007](../adr/ADR-007-gmail-sync.md).

## Scope

Scan dimulai secara UX dari email terbaru hari ini, batas akhir data adalah 1 Januari 2026.

## Query

| Item | Status |
|------|--------|
| Helper `buildGmailDateRangeQuery()` dibuat | ✅ |
| Helper `formatGmailDate(date)` dibuat | ✅ |
| Helper `getTomorrow(date)` dibuat | ✅ |
| Gmail query memakai `after:2026/01/01` | ✅ |
| Gmail query memakai `before:{tanggal_besok}` | ✅ |
| Email hari ini ikut terbaca | ✅ |
| Tidak hardcode tanggal hari ini | ✅ |
| Gmail query final dengan keyword transaksi | ✅ |
| nextPageToken diproses sampai selesai | ✅ |
| Safety limit MAX_EMAILS_PER_SCAN = 5000 | ✅ |

## Supabase

| Item | Status |
|------|--------|
| `gmail_sync_runs.date_from` = 2026-01-01 | ✅ |
| `gmail_sync_runs.date_to` = today (dinamis) | ✅ |
| Metadata `displayOrder: "newest_first"` | ✅ |
| Metadata `queryAfter`, `queryBefore` tersimpan | ✅ |
| Metadata `rangeMode: "today_back_to_2026_01_01"` | ✅ |
| Order `email_date DESC` pada query logs | ✅ |
| Unique constraint `(user_id, message_id)` aman | ✅ |

## UI

| Item | Status |
|------|--------|
| Copy menjelaskan scan dari terbaru sampai 1 Jan 2026 | ✅ |
| Range data ditampilkan (start sampai end) | ✅ |
| Urutan "terbaru ke terlama" ditampilkan | ✅ |
| Pagination 100/page berjalan | ✅ |
| Tombol Sebelumnya/Berikutnya tersedia | ✅ |
| "Halaman X dari Y" ditampilkan | ✅ |
| Mobile responsive | ✅ |

## Test Result

| Test | Result | Notes |
|------|--------|-------|
| Query `after:2026/01/01 before:{besok}` benar | ✅ | Dinamis berdasarkan hari ini |
| Email hari ini terbaca | ✅ | `before:` menggunakan tanggal besok |
| Email sebelum 2026 tidak terbaca | ✅ | `after:2026/01/01` |
| Urutan newest first | ✅ | Supabase query `email_date DESC` |
| Page 1 tampil | ✅ | 100 per halaman |
| Page berikutnya tampil | ✅ | Server-side pagination |
| Riwayat tetap setelah refresh | ✅ | Data di Supabase |
| Riwayat tetap setelah navigasi | ✅ | Data di Supabase |

## Build

| File | Perubahan |
|------|-----------|
| `src/services/gmailService.ts` | `buildGmailDateRangeQuery()`, `formatGmailDate()`, `getTomorrow()`, `getGmailSyncDateRangeDisplay()` — date range helpers |
| `src/services/gmailSyncLogService.ts` | `getGmailSyncLogsPaginated()` — paginated query 100/page, `email_date DESC` |
| `src/services/gmailSyncRunService.ts` | Sync run CRUD dengan date_from/date_to |
| `src/features/gmail/GmailSyncPage.tsx` | UI copy, metadata `displayOrder`, pagination controls |

## Final Status

- Date Range: ✅ OK
- Newest First: ✅ OK
- Pagination: ✅ OK
- Build: ✅ OK
