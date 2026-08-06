# AI Timeline

> **Sprint 1.5 Phase 3** — riwayat rekomendasi AI yang menjelaskan "apa yang berubah & mengapa".

## 1. Konsep

User dapat melihat evolusi saran AI:

```
Senin     AI menyarankan: "Kurangi GoFood"
Rabu      AI TIDAK lagi menyarankan — spending GoFood turun
```

Setiap entri menyimpan snapshot sehingga perubahan antar periode dapat dijelaskan: insight lama vs baru, confidence lama vs baru.

## 2. Model Data

Tabel `ai_timeline`:

| Kolom | Arti |
|---|---|
| `id` | UUID |
| `user_id` | user-scoped (FK users) |
| `feature` | `advisor` \| `insight` \| `fraud` \| `search` \| `ocr` \| `health` \| `simulation` \| `memory` |
| `title` | Judul singkat ("Insight bulan ini") |
| `body` | Isi rekomendasi/insight |
| `confidence` | Confidence saat entri dibuat (bisa null) |
| `payload` | Snapshot JSON (max 8KB) — data pendukung untuk diff |
| `created_at` | Timestamp otomatis |

## 3. API

- `GET /api/ai-product/timeline?feature=` — daftar kronologis (DESC, limit default 50).
- `POST /api/ai-product/timeline` — body `{feature, title, body?, confidence?, payload?}`. Validasi: feature enum, title wajib, confidence 0-1, payload objek JSON ≤ 8KB.

## 4. UI

Di AiHubPage → kartu **AI Timeline**:
- Tombol "+ Catat insight ini" → menyimpan insight bulan ini sebagai entri.
- List kronologis dengan dot timeline, timestamp lokal, badge confidence (bila ada), dan tombol feedback per entri.

## 5. Roadmap (tidak di sprint ini)

- Diff otomatis: entri terbaru vs sebelumnya (payload comparison) → "confidence lama 0.8 → baru 0.9".
- Logging otomatis saat advisor/insight di-generate (saat ini manual via tombol).
