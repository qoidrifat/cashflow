# Turso Runtime Retry Audit

> **Audit** — jalur Turso yang belum punya retry · Tanggal: 2026-08-06
> Metode: evidence-first (pemetaan call site, klasifikasi idempotensi, pola error handling).
> **Verdict: cukup retry di boot/seed/apply. JANGAN menambah `withRetry` blanket di runtime.**

---

## 1. Inventaris Call Site

| Jalur | Status retry | Cakupan |
|---|---|---|
| **Boot** `getTurso()` → `initTursoSchema` | ✅ `{ retry: true }` (commit 31c892e) | Apply schema idempoten saat boot, fire-and-forget |
| **Seed E2E** `seedE2eDataset.mjs` | ✅ `withRetry` + batch + timed fetch | Data test CI (transient → backoff) |
| **Apply schema** `applyTursoSchema.mjs` | ✅ `withRetry` (per-statement) | CI + manual deploy |
| **Runtime** routes & services (~60 call site, 102 statement) | ❌ **0 pakai withRetry** — semuanya `execute()` polos | Inilah yang diaudit |

## 2. Klasifikasi Statement Runtime (bukti)

| Tipe | Jumlah | Idempoten? | Auto-retry aman? |
|---|---|---|---|
| `SELECT` (read) | 51 | Ya (read-only) | Aman, TAPI tidak perlu |
| `INSERT` | 19 | **Tidak** (UUID baru, tanpa `ON CONFLICT` — lihat `POST /api/transactions`) | ❌ Berbahaya — duplikat |
| `UPDATE` | 24 | **Tidak** | ❌ Berbahaya — efek ganda |
| `DELETE` | 8 | Tidak (delete 2× = no-op, tapi retry pasca-komit menghapus data lain bila WHERE berubah) | ⚠️ Risiko |
| `ON CONFLICT` (upsert idempoten) | 8 saja (gmailRoutes 3, fraud 2, category 1, notification 1, alertNotifier 1) | Ya | Aman, tapi sudah self-heal |

**51% reads / 49% writes.** Dari 51 write, hanya 8 yang idempoten (upsert dedupe_key / gmail_message_id). **Mayoritas write TIDAK idempoten.**

## 3. Mengapa Tidak Menambah Retry Runtime (analisis risiko)

1. **Risiko double-commit (bencana di app finansial).** `POST /api/transactions` melakukan `INSERT ... VALUES (?, ...)` dengan UUID baru — TIDAK ada `ON CONFLICT`. Bila request pertama sebenarnya ter-commit tapi respons hilang (timeout), retry otomatis membuat **transaksi ganda**. Fail-fast saat ini sudah benar: server kembalikan 500, client tampilkan ErrorState — user yang memutuskan retry (dengan sadar).
2. **Background async sudah self-heal.** Fraud (`runFraudDetection`), `alertNotifier`, `metricsService` — semuanya fail-open (error di-swallow + log) dan memakai `dedupe_key` / `gmail_message_id` / next-event sebagai mekanisme idempotensi. Retry tambahan = redundant.
3. **Reads sudah ditangani di client.** Sprint 1.5 menambahkan ErrorState + tombol retry di halaman (Transactions, Profile, Notifications). Retry server menyembunyikan masalah nyata (DB down) dan menambah latensi; fail-fast lebih transparan & bisa didiagnosis via requestId.
4. **Retry hanya berharga untuk jalur one-time & idempoten.** Boot schema (CREATE IF NOT EXISTS), seed (ON CONFLICT DO NOTHING), apply schema — tepat karena (a) sekali jalan, (b) deterministik, (c) gagal = state rusak permanen yang tak terlihat. Semua sudah dilengkapi.

## 4. Satu Kandidat yang Dievaluasi & Ditolak

| Kandidat | Analisis | Keputusan |
|---|---|---|
| `/api/ready` probe (`SELECT 1`, 1 attempt) | Retry 1-2× hindari flapping 503 saat blip cold-start | **TIDAK diubah** — orkestrator (Docker HEALTHCHECK / Cloud Run startup probe / reverse proxy) sudah punya toleransi/retry sendiri; flapping justru sinyal jujur. Tanpa bukti flapping, jangan tambah kompleksitas (aturan: jangan ubah tanpa evidence). |
| Wrapper read-only `withRetry` untuk hot path | Aman secara teknis | **TIDAK** — 51 SELECT, tapi tak ada bukti pain (metric `ai_usage`/observability tak mencatat Turso error rate per route); menambah latency & masking. |

## 5. Kapan Audit Ini Perlu Direvisi (trigger re-evaluasi)

- [ ] Observability mencatat **Turso network/timeout error rate > 0.5%** pada request user (saat ini tidak di-track per route — catat sebagai debt).
- [ ] Ada laporan **transaksi ganda** dari user (kalau ini muncul, solusinya dedupe key di INSERT, BUKAN retry).
- [ ] Turso pindah ke model multi-writer (SQLITE_BUSY lebih sering) → pertimbangkan retry khusus `busy`/`locked` pada writes idempoten saja.
- [ ] Read dari backend dipakai oleh job batch (bukan user) → retry read batch masuk akal.

## 6. Ringkasan

```
Boot/seed/apply : butuh retry  → ✅ SUDAH (one-time, idempoten, high-stakes)
Runtime writes  : tidak boleh  → ✅ sudah benar (fail-fast, risiko double-commit)
Runtime reads   : tidak perlu  → ✅ sudah benar (client ErrorState+retry; transparan)
Background async: tidak perlu  → ✅ sudah benar (fail-open + dedupe self-heal)
```

*File: server/lib/retry.js, server/lib/turso.js, server/routes/*.js, server/services/*.js, scripts/seedE2eDataset.mjs, scripts/applyTursoSchema.mjs.*
