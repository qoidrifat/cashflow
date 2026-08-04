# Gmail Sync Performance Optimization Checklist

> ⚠️ **STATUS: ARSIP HISTORIS (SUPERSEDED)** — Dokumen ini ditulis pada era Supabase/Firebase (sebelum 2026-08-02) dan TIDAK mencerminkan arsitektur aktif. Arsitektur saat ini: Express 4 + Better Auth + Turso (libSQL) + SSE + Vertex AI. Lihat [ADR-001..007](../adr/INDEX.md) untuk keputusan arsitektur terkini; desain Gmail sync saat ini ada di [ADR-007](../adr/ADR-007-gmail-sync.md).

## Bottleneck

* [x] Jumlah AI candidate sebelum optimasi dicatat
* [x] Speed sebelum optimasi dicatat
* [x] Batch behavior dianalisis
* [x] Supabase update frequency dianalisis
* [x] Prompt size dianalisis

## Prefilter

* [x] Promo auto rejected sebelum AI
* [x] Non-transaksi auto skipped sebelum AI
* [x] Cashback promo tidak masuk AI
* [x] Card activation/welcome/security tidak masuk AI

## Local Parser

* [x] blu parser sebelum AI
* [x] Jago parser sebelum AI
* [x] Shopee parser sebelum AI
* [x] KAI parser sebelum AI
* [x] tiket.com parser sebelum AI
* [x] Grab parser sebelum AI
* [x] Agoda parser sebelum AI

## AI Gating

* [x] `shouldSendToAi` dibuat
* [x] AI hanya untuk kasus ambigu
* [x] AI candidate berkurang
* [x] Prompt AI diperkecil
* [x] Concurrency aman diterapkan

## Persistence

* [x] Duplicate check sebelum AI
* [x] Batch upsert logs
* [x] Progress update tidak terlalu sering
* [x] ETA tetap real-time

## Test Result

| Metric                |  Before | After |
| --------------------- | ------: | ----: |
| Total email           |     388 | Perlu scan ulang |
| AI candidate          |     298 | Perlu scan ulang |
| Speed email/sec       |     0.3 | Perlu scan ulang |
| Estimated duration    | 13+ min | Perlu scan ulang |
| Failed                |       0 | Perlu scan ulang |
| Duplicate transaction |       0 | Perlu scan ulang |

## Build

* [x] npm run build berhasil
* [x] npm run lint berhasil atau error terdokumentasi

## Implementation Notes

* Pipeline diubah menjadi rules-first: duplicate check, hard skip/reject, parser lokal, lalu AI hanya untuk ambiguous email.
* Parser lokal memakai fallback/provider parser existing sebelum AI dan hanya auto accept ketika confidence lokal mencapai minimal 0.88.
* AI payload dipadatkan menjadi konteks ringkas dan body bersih maksimal 6000 karakter.
* Log Gmail Sync disimpan via bulk upsert chunk 100 item agar tidak membuat request Supabase per email.
* Progress metadata tetap di-throttle, UI lokal tetap real-time.
