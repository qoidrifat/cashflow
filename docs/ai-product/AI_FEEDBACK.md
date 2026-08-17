# AI Feedback (User Feedback Learning)

> **Sprint 1.5 Phase 2** — feedback loop: setiap AI card punya 👍/👎. Feedback menjadi dataset evaluasi, TIDAK langsung mengubah AI.

## 1. Arsitektur

```
feedback (UI) → POST /api/ai-product/feedback → ai_feedback table
    ↓
evaluation dataset (query by feature/rating)
    ↓
PRIORITAS PERBAIKAN PROMPT (SELESAI — §7) → benchmark AI
    ↓
future training (BELUM diimplementasikan — pipeline siap)
```

## 2. Opsi Rating

| Rating | Label UI | Makna |
|---|---|---|
| `helpful` | 👍 Membantu | Hasil akurat & berguna |
| `not_helpful` | 👎 Tidak membantu | Tidak berguna |
| `mismatched` | Kurang sesuai | Tidak sesuai kondisi user |
| `irrelevant` | Tidak relevan | Di luar kebutuhan |
| `already_done` | Sudah saya lakukan | Rekomendasi sudah dijalankan |
| `skip` | Lewati | Tidak mau menilai |

Alur UI: klik 👍 → langsung simpan `helpful`. Klik 👎 → menu dropdown opsi `mismatched/irrelevant/already_done/skip`.

## 3. API

- `POST /api/ai-product/feedback` — body `{feature, itemId?, rating, reason?}`. Feature di-validasi enum (`advisor, insight, fraud, search, ocr, health, simulation, memory`). Gagal → 400 `VALIDATION_ERROR`.
- `GET /api/ai-product/feedback?feature=` — daftar feedback user (opsional filter, limit default 50).

Tabel `ai_feedback` menyimpan: `id, user_id, feature, item_id, rating, reason, created_at` — timestamp, user-scoped, recommendation id.

## 4. Komponen

`AiFeedbackButtons` (`src/features/ai-product/components/`):

```tsx
<AiFeedbackButtons feature="advisor" itemId="..." />
```

- State optimistik: setelah submit menampilkan "Membantu — terima kasih!" lalu reset 4 detik.
- Error tampil inline bila request gagal (tidak menggagalkan halaman).
- Sudah dipasang di: **AdvisorPage** (hero), **AiHubPage** (insight, health, simulation, timeline).

## 5. Tidak Langsung Mengubah AI

Keputusan desain: feedback **tidak** memodifikasi respons AI saat itu juga (menghindari feedback-loop bias & non-determinisme). Penggunaan:
1. Admin/metrics dapat mengekspor dataset evaluasi per fitur/rating.
2. **Integrasi ke benchmark (SELESAI — §7)**: dataset dipakai memprioritaskan perbaikan prompt per feature.
3. Roadmap lanjutan: fine-tuning/prompt-engineering berbasis dataset.

## 6. Privasi

- Hanya `user_id` internal; tidak ada PII eksternal.
- `reason` bebas teks (max 500 char) — tetap user-scoped.

## 7. Feedback → Prioritas Perbaikan Prompt (Benchmark AI)

Dataset `ai_feedback` kini menjadi **input evaluasi benchmark** untuk memprioritaskan perbaikan prompt:

- **Agregasi murni** (`server/lib/feedbackMetrics.js`): per feature → counts per rating, `negativeRate` (not_helpful + mismatched + irrelevant), `priorityScore` (0-100), `confidence` (high ≥15 · medium ≥5 · low). Ranking = score desc, volume tie-break.
- **Action plan**: rating negatif dominan memetakan arah perbaikan prompt — `not_helpful` → saran terlalu generik (tambah konteks & angka); `mismatched` → perkuat skema/instruksi; `irrelevant` → filter data pendukung; `already_done ≥ 30%` → hindari saran berulang; `skip ≥ 40%` → kurangi frekuensi. Tiap feature dipetakan ke prompt builder & file sumber (`FEATURE_PROMPT_MAP`).
- **Script CLI**: `node scripts/feedbackPromptPriorities.mjs` — memuat `ai_feedback` asli dari Turso → tabel prioritas + action plan + snapshot `docs/ai/feedback-prompt-priorities.json`. Jalankan sebelum `npm run benchmark:ai:live` — live benchmark **otomatis membaca snapshot ini** dan hanya menjalankan kategori live dari fitur `topPriority` (feedback-driven selection; `BENCH_LIVE_ALL=1` untuk memaksa full run).
- **Benchmark offline**: kategori ke-7 `feedback_prioritization` di `aiQualityBenchmark.spec.ts` (dataset sintetis ber-label, floor deterministik — regression guard agregasi).
- **Endpoint admin**: `GET /api/admin/metrics/feedback-summary` (admin-only via `resolveAdmin`) — query seluruh `ai_feedback` → `buildFeedbackPriorityReport` → JSON; 401 tanpa user, 403 non-admin, 500 bila Turso gagal.
- **Panel monitoring**: `/admin/monitoring` menampilkan kartu "Prioritas Perbaikan Prompt" — ranking per feature (skor 0-100 merah/amber/mint, bar negativeRate, rating negatif dominan, prompt builder & file sumber, arah perbaikan) + ringkasan total feedback/negatif rate + empty state.
- **Sinkronisasi enum**: `FEEDBACK_RATINGS` di-uji sama dengan `aiProductRoutes` (unit test).
