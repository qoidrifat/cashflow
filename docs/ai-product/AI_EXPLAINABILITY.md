# AI Explainability

> **Sprint 1.5 Phase 1 + 10** — setiap hasil AI harus menjawab: *"Mengapa AI menghasilkan keputusan ini?"*

## 1. Model Explainability Terpadu

Tipe `ExplainabilityModel` (`src/lib/explainability.ts`) — setiap hasil AI **minimal** memiliki:

| Field | Arti | Contoh |
|---|---|---|
| `reason` | Alasan keputusan dalam bahasa manusia | "Duplikat: nominal & merchant sama dalam 2 menit" |
| `evidence` | Bukti pendukung (angka/threshold) | `["amount=150000", "gmailMessageId sama"]` |
| `confidence` | 0-1 | 0.95 |
| `source` | Sumber | `gemini` \| `rule-based` \| `local` |
| `ruleTrigger` | Rule yang memicu | `velocity > 5` |
| `affectedTransaction` | Transaksi terkait | `Indomaret · Rp150.000` |
| `timestamp` / `lastUpdated` | Kapan dibuat / diperbarui | ISO |
| `processingTimeMs` | Waktu proses | 7800 |
| `model` | Nama model | `gemini-2.5-flash` |
| `feature` | Kategori AI | `fraud` \| `advisor` \| ... |

## 2. Interpretasi Confidence (wajib — bukan angka mentah)

| Rentang | Label | Bucket |
|---|---|---|
| ≥ 90% | **Sangat yakin** | `very_high` |
| ≥ 70% | **Yakin** | `high` |
| ≥ 50% | **Cukup yakin** | `medium` |
| < 50% | **Perlu verifikasi** | `low` |

Implementasi: `interpretConfidence(score)` → `{label, bucket, percent}`. Badge UI `AiConfidenceBadge` menampilkan label + persen + tooltip penjelasan (bukan hanya angka).

## 3. Fallback yang Jelas

Bila AI tidak tersedia/gagal, hasil `rule-based` **wajib menjelaskan fallback**:

- `fallbackReason('rule-based')` → *"AI tidak tersedia saat ini — hasil dihitung dari aturan lokal yang deterministik."*
- `AiTrustMeta` menampilkan baris kecil: sumber, model, waktu proses, waktu diperbarui, + peringatan fallback.

## 4. Status Penerapan per Fitur

| Fitur | Sebelum | Sesudah Sprint 1.5 |
|---|---|---|
| Fraud | aiReasons/aiConfidence/badge "Keyakinan N%" | tetap + bisa diberi feedback |
| Advisor | badge "Didukung Gemini AI" | + `AiTrustMeta` + `AiFeedbackButtons` |
| Insight | cashflowHealth + score | + interpretasi, feedback, trust |
| Search | explanation[] + source | + feedback (surface sama) |
| OCR | confidence label | tetap |
| Health (baru) | — | 8 subscore dengan reason/recommendation/trend |
| Simulation (baru) | — | tabel deterministik + skor dampak |

## 5. Batas (dokumentasi, bukan bug)

- `confidence` dari Gemini bersifat non-deterministik antar run (batas LLM).
- `processingTimeMs` hanya tersedia bila pengukuran dilakukan (fraud L2 memakai; insight/advisor belum mencatat di UI).
- `ruleTrigger` dipakai penuh di fraud; fitur lain memakai `source` + `reason`.
