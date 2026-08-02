# CashFlow — AI Evolution Roadmap

> Audit READ-ONLY · 2 Agustus 2026 · Evaluasi model tambahan TANPA mengubah model existing. Prinsip: incremental, evidence-based, cost-conscious.

---

## 1. Maturity Arsitektur AI Saat Ini

- **Level 3.2/5** (lihat AI_PLATFORM_AUDIT): single-provider proxy kompeten, parsing 3-tier, observability AI, agent search RAG — tapi tanpa cache, retry-backoff, safety tuning, streaming, semantic cache.
- Model aktif: `gemini-2.5-flash` (primary) + `gemini-2.5-flash-lite` (fallback) + Discovery Engine Agent Search.
- Provider: **Vertex AI saja** (Google Cloud project `snappy-weft-479506-h5`, region us-central1/global).

---

## 2. Evaluasi Model Tambahan (tanpa mengganti existing)

| Use Case | Model Kandidat | Prioritas | Alasan / Evidence |
|---|---|---|---|
| **Reasoning** (analisis keuangan kompleks, multi-step) | Gemini 2.5 Pro / DeepSeek-R1 via API | P2 | Insight generator kini prompt tunggal; kasus "kenapa saldo turun + rekomendasi" butuh reasoning. Mulai dari `gemini-2.5-pro` sebagai model OPSIONAL per request (feature flag) |
| **Planning/Forecasting** (cashflow forecast) | Gemini/LLM + rule engine hybrid | P2 | Data historis ada (541 tx); forecast bulanan = agregasi statistik + narasi LLM. Rule-based dulu (moving average), LLM untuk insight |
| **Budget Prediction** | Lightweight regresi + LLM narasi | P2 | Budget usage (`used_amount`) + pattern bulanan; mulai rule-based, LLM untuk rekomendasi |
| **Classification (kategori otomatis)** | `gemini-2.5-flash` existing sudah dipakai; alternatif: classifier kecil | P3 | Accuracy kategori dari parse extractor cukup; evaluasi dulu (precision/recall) sebelum tambah model |
| **Anomaly Detection** (fraud/mis-spend) | Rule (z-score/IQR) + LLM explain | P1 | Data finansial personal; deteksi outlier amount vs kategori; LLM hanya untuk narasi (hemat cost) |
| **Fraud Detection** (transaksi mencurigakan) | Rule + Discovery Engine search lintas-user AGGREGAT ANONIM | P3 | Privasi dulu: hash userId; jangan pernah agregat data user asli. Mulai dari rule (amount/kategori/sender anomali) |
| **Embeddings** (semantic cache / clustering kategori) | Vertex AI text-embedding (`text-embedding-005`) | P1 | Sudah ada `user_id_hash` indexing di Discovery Engine; embedding eksplisit membuka: semantic cache prompt, similar-transaction, kategori auto-grouping |
| **Reranking** | Discovery Engine `rankService` / reranker | P2 | Agent search relevansi menengah; rerank hasil `:search` sebelum `:answer` |
| **Safety** | Llama Guard / input-output guardrails | P2 | Roadmap menyebut Llama Guard tapi belum ada di kode; prioritas untuk Gmail email input (prompt injection) |
| **Cost Optimization** | Model routing (flash-lite untuk klasifikasi sederhana, flash untuk ekstraksi, pro untuk insight) | P1 | `FEATURE_PROVIDER` sudah ada — perbesar ke routing per-complexity; cache + compression prompt |

---

## 3. Rekomendasi Arsitektur Tanpa Ubah Model Existing

1. **Model Router layer** (di atas `generateVertexContent`): klasifikasi kesulitan → pilih model (lite/flash/pro) per request, default tetap flash. 100% backward compatible.
2. **Semantic cache**: embedding prompt → cari similar → reuse response (hemat 20–40% call untuk gmail sync berulang).
3. **Safety gateway**: input sanitizer + instruction guard sebelum prompt; output validator (schema enforcement sudah ada via parseGeminiResponse).
4. **Batch/streaming**: OCR batch (multi-receipt), streaming insight ke SSE.

---

## 4. Roadmap 3/6/12 Bulan

### 3 Bulan — Foundation (P1)
- [ ] Model router (flash-lite untuk klasifikasi/skip cepat; flash default; opsional pro flag).
- [ ] Semantic cache (embedding + LRU) untuk call berulang.
- [ ] Anomaly detection rule-based (amount/kategori/sender) + narasi LLM.
- [ ] Safety gateway prompt-injection guard untuk input email.
- [ ] Agent Search delta sync + cost riil (`perQueryUsd`).

### 6 Bulan — Intelligence (P2)
- [ ] Forecast cashflow bulanan (rule hybrid + insight LLM).
- [ ] Budget prediction + early-warning (sebelum overbudget).
- [ ] Reranking hasil Agent Search; evaluasi relevansi (nDCG kecil).
- [ ] Embedding untuk similar-transaction & kategori auto-suggest.
- [ ] LLM evaluation harness (golden set email/struk → precision/recall/cost) — kunci kepercayaan.

### 12 Bulan — Differentiated AI Platform (P3)
- [ ] Fraud/mis-spend detection lintas fitur (privasi-first, hash-only).
- [ ] Multi-provider fallback (OpenRouter/Anthropic) — resilience bukan pengganti Gemini.
- [ ] Personal financial advisor (multi-turn, memory konteks per user, streaming).
- [ ] Observability AI penuh: tracing, evals CI, drift detection (prompt/model versioning).

---

## 5. Cost Strategy

| Aksi | Efek |
|---|---|
| Routing per-complexity | -15–25% cost |
| Semantic cache | -20–40% call berulang |
| Prompt compression (sudah parsial) | -10–20% token |
| Batch (OCR) | -latency, -overhead |
| Alert cost harian (`ai_cost_daily` > Rp50k) | guard biaya |

**Catatan**: `AI_PRICING` adalah estimasi — kalibrasi dengan bill aktual Google Cloud; masukkan Agent Search per-query cost.

---

## 6. Konklusi

CashFlow berada di posisi bagus untuk berevolusi tanpa migrasi model: **router + cache + safety + evals** adalah 4 pilar 3-bulan pertama. Jangan tambah model baru sebelum evaluasi harness ada (evidence-based, bukan gimmick).
