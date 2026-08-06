# AI Feedback (User Feedback Learning)

> **Sprint 1.5 Phase 2** — feedback loop: setiap AI card punya 👍/👎. Feedback menjadi dataset evaluasi, TIDAK langsung mengubah AI.

## 1. Arsitektur

```
feedback (UI) → POST /api/ai-product/feedback → ai_feedback table
    ↓
evaluation dataset (query by feature/rating)
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
2. Roadmap: bobot feedback pada evaluasi benchmark, lalu fine-tuning/prompt-engineering berbasis dataset.

## 6. Privasi

- Hanya `user_id` internal; tidak ada PII eksternal.
- `reason` bebas teks (max 500 char) — tetap user-scoped.
