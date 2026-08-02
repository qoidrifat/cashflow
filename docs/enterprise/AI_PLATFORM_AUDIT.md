# CashFlow — AI Platform Audit

> Audit READ-ONLY · 2 Agustus 2026 · Evidence-based · Sumber: `server/lib/vertexContext.js` (714 L), `server/services/agentSearchService.js` (755 L), `server/routes/geminiRoutes.js`, `server/services/metricsService.js`, `server/config/metricsConfig.js`.

---

## 1. Komponen AI yang Ada

| Komponen | Implementasi | Status |
|---|---|---|
| **Gemini (Vertex AI)** | `@google/genai` → `GoogleGenAI({ vertexai: true })`; primary `gemini-2.5-flash`, fallback `gemini-2.5-flash-lite` | ✅ Live |
| **Prompt Builder** | `buildExtractionPrompt` (email → transaksi), `buildReceiptExtractionPrompt` (OCR), `buildMonthlyReportPrompt` (insight) | ✅ Terpusat |
| **Request Pipeline** | `generateVertexContent`: loop model, timeout race (45s/60s), fallback logic | ✅ Solid |
| **Response Parsing** | `parseGeminiResponse`: direct → regex-extract → repair (`repairJsonText`) | ✅ 3-tier |
| **Normalizer** | `normalizeReceiptResult` (validasi enum, clamp confidence, slice panjang) | ✅ |
| **Error Handling** | `classifyVertexError` (auth/403/billing/quota/timeout/network/model → retryable flag) + `sendGeminiError` | ✅ Kuat |
| **Agent Search** | Discovery Engine REST (`:search`, `:answer`) + GCS JSONL + data store import | ✅ |
| **Embeddings** | Tidak eksplisit — Discovery Engine mengelola internal (search + embedding server-side) | ⚠️ Opaque |
| **Reranking** | Discovery Engine `queryExpansionSpec`/`spellCorrectionSpec`; **tidak ada** reranker terpisah | ⚠️ |
| **Safety Layer** | `answerGenerationSpec.ignoreAdversarialQuery`, `Llama Guard` **disebut di roadmap tapi belum diimplementasi** di kode | ❌ |
| **Token Usage** | `usageMetadata` → `metricsService.recordAIUsage` (chokepoint di `generateVertexContent`) | ✅ |
| **Cost** | `AI_PRICING` (USD/1M token) + `USD_TO_IDR` → estimasi cost per call + agregasi | ✅ |
| **Retry Logic** | ✅ **Retry exponential backoff (Sprint 3)**: `VERTEX_QUOTA_EXCEEDED`/`VERTEX_TIMEOUT`/`VERTEX_NETWORK_ERROR` → retry model yang sama (default 3 attempt, delay `base 500ms * 2^(n-1)` + jitter 80–120%, budget `max(timeout*2, 60s)`), baru fallback model | ✅ |
| **Fallback Logic** | Model fallback (flash→flash-lite); **tidak ada fallback ke API key/Gemini non-Vertex** | ⚠️ |
| **Prompt Compression** | `buildMonthlyReportPrompt` truncate 12.000 char; `cleanText` slice 500–2000 | ⚠️ Parsial |
| **Caching** | ✅ **In-process LRU response cache (Sprint 3) + single-flight dedup**: `server/lib/aiCache.js` (max 100 entri, TTL per feature — gmail_sync 7 hari, ocr_receipt 1 jam; key sha256(feature+models+contents+config)); hit → tanpa panggil Vertex + tanpa token dipakai; observability `ai_cache_hit/miss` di system_metrics. Terverifikasi: miss 6.4s → hit 0.21s. **Single-flight (anti thundering herd)**: request identik konkuren berbagi SATU pemanggilan Vertex (`ai_single_flight_join` metric; di-cover unit test 10 kasus) | ✅ |
| **AI Gateway** | Fungsional (vertexContext = gateway logic), tapi **bukan service terpisah** — terkait lifecycle server | ⚠️ |

---

## 1b. Rekonsiliasi "Claimed vs Actual" (model yang disebut di roadmap enterprise)

Brief roadmap mencantumkan model berikut sebagai "CURRENT VERIFIED ARCHITECTURE" — **audit kode menemukan hanya `gemini-2.5-flash`/`flash-lite` + Discovery Engine yang aktif** (evidence-first, bukan asumsi):

| Model yang diklaim | Status di kode | Bukti |
|---|---|---|
| Gemini 2.5 Flash | ✅ Aktif | `vertexContext.js` primary model |
| GLM-5.2 | ❌ **Tidak ditemukan** | 0 referensi di `server/` |
| DeepSeek V4 Flash | ❌ **Tidak ditemukan** | 0 referensi di `server/` |
| Nemotron Embed | ❌ **Tidak ditemukan** | embedding dikelola internal Discovery Engine |
| Mistral Reranker | ❌ **Tidak ditemukan** | 0 referensi; tidak ada reranker terpisah |
| Llama Guard | ❌ **Tidak ditemukan** | hanya `ignoreAdversarialQuery` di `:answer` |

> Konsekuensi: narasi "multi-model/reranked/safety-layered" **belum benar** untuk saat ini — roadmap AI di AI_EVOLUTION_ROADMAP.md memposisikan hal-hal tersebut sebagai *future state*, bukan current. Tidak ada model tambahan yang perlu di-remove (tidak pernah ada di kode).

---

## 2. Pipeline Detail (generateVertexContent)

```
contents + config
   │  for model of [primary, fallback]:
   │    ├─ generateContent() ──┐
   │    ├─ Promise.race(timeout 45/60s)  → VERTEX_TIMEOUT
   │    ├─ extractTextFromGenAIResponse (text | function | candidates)
   │    ├─ recordAIUsage (success) — non-blocking, sanitized metadata
   │    └─ catch → classifyVertexError
   │          ├─ canTryFallback? (MODEL_UNAVAILABLE | QUOTA | TIMEOUT | UNKNOWN)
   │          └─ recordAIUsage (error/rate_limited/timeout) → throw
```

**Kekuatan terverifikasi:**
- Timeout race per model — mencegah hang.
- Fallback hanya untuk error yang masuk akal di-fallback (quota/timeout/model) — bukan auth/billing.
- Metrics non-blocking (`.catch(() => {})`) — tidak pernah merusak fitur utama.
- `sanitizeMetadata` menghapus key sensitif (token/secret/base64/body/raw/email) sebelum simpan.
- `sanitizeErrorMessage` redact JWT/api-key/path di admin UI.

**Kelemahan (pasca-Sprint 3):**
1. **Single-provider**: hanya Vertex AI. Bila project GCP down, seluruh AI mati (tidak ada fallback provider). Cache LRU adalah buffer biaya/latency, bukan high-availability.
2. ✅ **Sudah ditutup (Sprint 3)**: retry/backoff exponential untuk quota/timeout/network + fallback model tetap ada.
3. ✅ **Sudah ditutup (Sprint 3)**: LRU response cache (TTL per feature) — prompt identik (email yang sama di-scan ulang) langsung di-serve dari cache (0.21s vs 6.4s).
4. **Tidak ada streaming**: seluruh response menunggu selesai (SSE hanya untuk events, bukan token).
5. **Tidak ada semantic cache / embedding reuse**: Discovery Engine mengelola sendiri; tidak ada model embedding eksplisit untuk fitur lain.
6. **Safety layer parsial**: `ignoreAdversarialQuery` di `:answer` saja; tidak ada guard server-side untuk prompt injection pada input email/subject sebelum masuk prompt (hanya `cleanText`).
7. **Dual SDK**: `@google/genai` (dipakai) + `@google/generative-ai` (legacy di deps server) — kebingungan & ukuran.
8. **Usage metadata opaque**: `vertex_search.perQueryUsd = 0` — cost Agent Search tidak terhitung riil.

---

## 3. Agent Search Pipeline (Discovery Engine)

```
query → assertValidTab (help/transactions/insight/gmail/receipts)
     → assertUserForTab (user-scoped tab butuh login)
     → cleanText (max 500) → buildFilter (user_id_hash: ANY("hash_..."))
     → :search (pageSize 10, queryExpansion AUTO, spellCorrection AUTO, filter)
         └─ fallback: 400+filter → retry TANPA filter (serverFilterApplied=false)
     → extractDocumentPayload (structData, snippets)
     → filterOwnedResults (defense-in-depth re-filter by user_id_hash)
     → :answer (ignoreAdversarialQuery, citations) — optional
```

**Kekuatan:**
- **Privacy by design**: `user_id_hash = sha256(userId:salt)` — tidak pernah kirim userId mentah ke Google; re-filter fail-closed bila server filter tidak diterapkan.
- **Sanitization ketat**: `SENSITIVE_KEY_PATTERN` + drop `data:image/`, `-----BEGIN`, `ya29.`, JWT di payload.
- Sync pipeline: markdown docs (skip file berisi secret) → GCS JSONL → import INCREMENTAL.
- Error taxonomy lengkap (`AGENT_SEARCH_*` 10+ code).

**Kelemahan:**
- Per-user filter bergantung pada field `user_id_hash` **retrievable** di schema data store — bila tidak, fallback ke `serverFilterApplied` dan hasil bisa kosong (bug "empty results" yang pernah terjadi).
- Sync full-rebuild per user (`LIMIT 2000` di `fetchRows`) — tidak ada incremental delta / CDC; data besar = mahal.
- `queryExpansionSpec AUTO` + no reranker → relevansi menengah untuk domain finansial.
- `console.log` diagnostics per query (PII-safe hash, tapi noise log).

---

## 4. Maturity Level

| Dimensi | Level (1–5) | Keterangan |
|---|---|---|
| Pipeline & parsing | 4 | 3-tier parsing, normalizer, error taxonomy |
| Observability AI | 3.5 | Token+cost+latency+status recorded; no tracing |
| Cost control | 3 | Estimasi per-call; no budget cap/alert channel |
| Resilience | 2.5 → **4.0** | ✅ **Retry exponential backoff (quota/timeout/network) + LRU response cache + model fallback + timeout race** (Sprint 3); minus: provider fallback non-Vertex, cache belum terdistribusi |
| Safety | 2.5 | Ignore adversarial di answer; no server prompt-injection guard, no model-level safety tuning terdokumentasi |
| RAG/Search | 3.5 | Discovery Engine solid; reranking & embedding opaque |
| **AI Platform Maturity** | **3.2 / 5** | "Competent single-provider AI proxy" → **3.4/5 pasca-Sprint 3** (cache + resilience P1 selesai); berikutnya: safety, provider fallback, streaming |

---

## 5. Enterprise Gaps & Bottlenecks

| # | Gap | Dampak | Prioritas | Status |
|---|---|---|---|---|
| 1 | No cache (response/semantic) | Biaya + latency berulang | P1 | ✅ **Ditutup (Sprint 3)** — LRU response cache, TTL per feature |
| 2 | No retry-backoff utk quota/timeout | UX jelek saat Vertex throttle | P1 | ✅ **Ditutup (Sprint 3)** — exponential backoff + budget waktu |
| 3 | No provider fallback | Single point of failure GCP | P2 |
| 4 | No streaming | Latency perceived tinggi | P2 |
| 5 | Prompt injection guard server-side | Risk di email sync | P2 |
| 6 | Agent Search cost = 0 (perQueryUsd) | Under-reporting cost | P2 |
| 7 | Dual Gemini SDK | Debt | P3 |
| 8 | No semantic cache/embedding reuse | Opportunity cost | P3 |

---

## 6. Rekomendasi

1. ✅ **SELESAI (Sprint 3)**: in-process LRU response cache — `server/lib/aiCache.js`, TTL per feature (gmail_sync 7 hari, ocr_receipt 1 jam), key sha256, statistik + `ai_cache_hit/miss` metric. Terverifikasi end-to-end (6.4s → 0.21s). Evolusi: cache terdistribusi (Redis) bila multi-instance.
2. ✅ **SELESAI (Sprint 3)**: retry exponential backoff (default 3 attempt, `AI_RETRY_MAX_ATTEMPTS`/`AI_RETRY_BASE_MS`, jitter, budget waktu) untuk `VERTEX_QUOTA_EXCEEDED`/`VERTEX_TIMEOUT`/`VERTEX_NETWORK_ERROR` sebelum fallback model.
3. **P2**: ekstrak AI gateway ke service mandiri (dependency injection) agar bisa di-deploy/scale terpisah + unit-testable.
4. **P2**: streaming via SSE untuk insight/agent-search answer.
5. **P2**: lapisan sanitasi input sebelum prompt (blocklist + instruction separator) untuk prompt injection.
6. **P3**: audit `@google/generative-ai` legacy — hapus bila 0 referensi; tetapkan single SDK.
