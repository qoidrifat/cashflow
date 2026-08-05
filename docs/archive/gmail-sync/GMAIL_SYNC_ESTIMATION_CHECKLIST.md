# Gmail Sync Estimation Checklist

> ⚠️ **STATUS: ARSIP HISTORIS (SUPERSEDED)** — Dokumen ini ditulis pada era Supabase/Firebase (sebelum 2026-08-02) dan TIDAK mencerminkan arsitektur aktif. Arsitektur saat ini: Express 4 + Better Auth + Turso (libSQL) + SSE + Vertex AI. Lihat [ADR-001..007](../adr/INDEX.md) untuk keputusan arsitektur terkini; desain Gmail sync saat ini ada di [ADR-007](../adr/ADR-007-gmail-sync.md).

## Scope

* [x] Estimasi durasi Gmail Sync ditambahkan
* [x] Countdown real-time ditambahkan
* [x] Estimasi memindai Gmail ditambahkan
* [x] Estimasi ekstraksi AI ditambahkan
* [x] Estimasi fallback parser ditambahkan
* [x] Estimasi attachment extraction ditambahkan
* [x] Manual Scan tercover
* [x] Retry Failed tercover
* [x] Background Sync tercover jika tersedia

## Progress Data

* [x] startedAt tercatat
* [x] updatedAt tercatat
* [x] totalFound tercatat
* [x] totalEstimated tercatat
* [x] totalProcessed tercatat
* [x] aiProcessedCount tercatat
* [x] attachmentProcessedCount tercatat
* [x] fallbackProcessedCount tercatat
* [x] elapsedMs dihitung
* [x] remainingMs dihitung
* [x] estimatedFinishAt dihitung
* [x] emailsPerSecond dihitung
* [x] etaConfidence dihitung

## Accuracy

* [x] Tidak hardcode estimasi
* [x] Progress awal menampilkan `Menghitung estimasi`
* [x] Countdown memakai smoothing
* [x] Rate limit mempengaruhi ETA
* [x] Countdown tidak negatif
* [x] Countdown tidak NaN
* [x] Estimasi makin akurat setelah progress bertambah

## Realtime

* [x] Progress disimpan ke gmail_sync_runs metadata
* [ ] Supabase Realtime digunakan jika tersedia
* [x] Polling aman digunakan jika Realtime belum tersedia
* [x] Polling berhenti saat selesai/gagal
* [x] User pindah halaman lalu kembali tetap melihat progress

## UI

* [x] GmailSyncEtaCard dibuat
* [x] Progress bar dibuat
* [x] Countdown tampil
* [x] Estimasi selesai tampil
* [x] Kecepatan email/detik tampil
* [x] Current step tampil
* [x] Mobile rapi
* [x] Dark mode rapi
* [x] Light mode rapi

## Test Result

| Test                        | Result | Notes |
| --------------------------- | ------ | ----- |
| Scan 0 email                | Not run | Perlu akun Gmail/test data |
| Scan 20 email               | Not run | Perlu akun Gmail/test data |
| Scan 100+ email             | Not run | Perlu akun Gmail/test data |
| Banyak AI extraction        | Not run | Perlu akun Gmail/test data dan proxy AI |
| Banyak skipped              | Not run | Perlu akun Gmail/test data |
| Retry Failed                | Not run | Perlu failed logs existing |
| Pindah halaman lalu kembali | Code covered | Progress dibaca dari `gmail_sync_runs.metadata.progress` |
| Refresh saat running        | Code covered | Progress running dihydrate dari history run |
| Mobile 360px                | Code reviewed | Card memakai grid responsif tanpa fixed width |
| Build                       | Pass | `npm run lint` dan `npm run build` berhasil |

## File yang Diubah

| File | Perubahan |
| ---- | --------- |
| `src/lib/gmailSyncProgress.ts` | Type progress, ETA calculation, smoothing, formatter waktu, confidence |
| `src/features/gmail/GmailSyncEtaCard.tsx` | UI countdown ETA, progress bar, speed, finish estimate, breakdown |
| `src/services/gmailService.ts` | Callback progress Gmail fetch/search/detail dan retry fetch |
| `src/services/gmailSyncRunService.ts` | Metadata progress saat finish run dan perbaikan kolom `pending_review_count` |
| `src/features/gmail/GmailSyncPage.tsx` | Integrasi ETA untuk manual scan, retry failed, history/background run |
| `docs/gmail-sync/GMAIL_SYNC_ESTIMATION_CHECKLIST.md` | Checklist implementasi dan validasi |

## Final Status

* ETA Calculation: OK
* Countdown Realtime: OK
* Progress Persistence: OK
* UI ETA Card: OK
* Build: OK
