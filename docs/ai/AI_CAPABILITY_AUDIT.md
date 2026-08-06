# AI Capability Audit

> **Sprint 1 — Product Intelligence Refinement · Phase 1.1**
> Status: **SELESAI (audit-only; prompt TIDAK diubah sebelum audit)** · Tanggal: 2026-08-06
> Metode: evidence-first — seluruh klaim ditelusuri ke file/kode aktual, bukan asumsi.

---

## 1. Executive Summary

CashFlow memiliki **9 modul AI** yang aktif, semuanya memakai **Gemini (Vertex AI)** sebagai satu-satunya provider, dengan **Discovery Engine** sebagai satu-satunya search engine. Audit menemukan fondasi prompt **sudah matang**: setiap prompt berbounded (data ringkas, bukan PII mentah), setiap fitur punya **fallback deterministik**, dan semua jalur AI sudah punya retry + cache + single-flight (Sprint 3).

**Temuan material (2, keduanya sudah diperbaiki di sprint ini):**

| # | Temuan | Bukti | Aksi |
|---|---|---|---|
| P1.1 | Prompt duplikat mati `GEMINI_EXTRACTION_PROMPT_KEEP` di `src/config/constants.ts` (salinan lama ber-placeholder `{{...}}`, 0 referensi) | `code-searcher` → hanya 1 match (definisi sendiri); prompt server asli ada di `server/lib/vertexContext.js` | **DIHAPUS** — diganti komentar pointer ke single source of truth |
| P1.2 | L2 fraud AI scoring meminta `confidence` di prompt tapi **tidak mempersist/menampilkannya** | `server/services/fraudDetectionService.js` `runAiScoring()` menyimpan score/decision/reasons saja; `FraudPage.tsx` tidak merender confidence | **DIPERBAIKI** — `aiConfidence` dipersist ke `rule_data` + badge "Keyakinan N%" di FraudPage |

**Temuan non-material (dicatat, tidak diubah):** tidak ada prompt yang panjang berlebihan (semua ≤ ~1.500 token), tidak ada output tanpa fallback, tidak ada endpoint AI tanpa rate-limit (`aiLimiter`), tidak ada PII mentah di prompt.

---

## 2. Capability Map

| Modul | File inti | Prompt builder | Model | Fallback deterministik | Cache/Retry |
|---|---|---|---|---|---|
| **Ekstraksi transaksi email** (Gmail) | `server/lib/vertexContext.js`, `src/services/geminiService.ts`, `src/lib/gmailLocalParser.ts` | `buildExtractionPrompt` | gemini-2.5-flash | `gmailLocalParser` (L0 lokal) + `geminiFallbackParser` | `aiCache` (TTL) + retry exp-backoff |
| **OCR Receipt** | `server/lib/vertexContext.js`, `src/services/receiptScanService.ts` | `buildReceiptExtractionPrompt` | gemini-2.5-flash (vision) | validasi `normalizeReceiptResult` + `risk_flags` | retry + timeout 60s |
| **Insight bulanan** | `server/lib/vertexContext.js`, `src/services/aiInsightService.ts` | `buildMonthlyReportPrompt` | gemini-2.5-flash | `buildFallbackMonthlyReport` (rule-based, skor kesehatan 0-100) | retry |
| **Financial Advisor** | `server/lib/vertexContext.js`, `src/services/advisorService.ts` | `buildAdvisorPrompt` | gemini-2.5-flash | `buildFallbackAdvisorReport` (rule-based) | retry |
| **Fraud L1 (rule engine)** | `server/lib/fraudEngine.js` | — (murni deterministik) | — (gratis) | — | — |
| **Fraud L2 (AI scoring)** | `server/services/fraudDetectionService.js` | `buildFraudScoringPrompt` | gemini-2.5-flash | degrade ke verdict L1 | retry (off-by-default `FRAUD_AI_SCORING_ENABLED`) |
| **AI Search (Discovery Engine)** | `server/services/agentSearchService.js` | — (query, bukan prompt LLM) | Discovery Engine | `rankAndExplainResults` + template suggested queries | — |
| **Gmail classifier (L0)** | `src/lib/gmailClassifier.ts`, `gmailDocumentExtractor.ts` | — | — (heuristik lokal) | — | — |
| **Semantic cache** | `server/lib/aiCache.js`, `server/lib/vertexContext.js` | — | — | — | LRU + `normalizePromptText` (L2) + single-flight |

**Aktivasi L2 fraud** dikontrol `FRAUD_AI_SCORING_ENABLED` (default **off** — hemat biaya Vertex; verdict L1 tetap berjalan).

---

## 3. Prompt Map

Semua prompt builder di **satu file** (`server/lib/vertexContext.js`) + 1 di fraudDetectionService — single source of truth, tanpa salinan frontend.

| Prompt | Output | Panjang (perkiraan) | Data input | Bounded? |
|---|---|---|---|---|
| `buildExtractionPrompt` | 1 JSON (is_transaction, amount, date, merchant, category, decision, reason) | ±1.300 token | emailText + subject + sender + date | ✔ (route truncate emailText ke 8.000 char) |
| `buildReceiptExtractionPrompt` | 1 JSON (decision, amount, payment_method, risk_flags) | ±1.100 token | userHint opsional | ✔ |
| `buildMonthlyReportPrompt` | JSON (summary, cashflowHealth, financialHealthScore, savingOpportunities, unusualSpending, topRisks, recommendations, positiveNotes) | ±1.200 token | metrics + ≤30 transaksi sampel, `JSON.stringify(...).substring(0, 12000)` | ✔ (cap 12.000 char) |
| `buildAdvisorPrompt` | JSON (summary, spendingAdvice, savingStrategy, budgetStrategy, emergencyFund, subscriptionOptimization, actionList) | ±1.100 token | metrics + subscriptions, cap 9.000 char | ✔ |
| `buildFraudScoringPrompt` | JSON (fraud_score, decision, reasons, confidence) | ±700 token | ringkasan transaksi + flags + konteks, cap 6.000 char | ✔ |

**Konsistensi output:** seluruh prompt menuntut **"SATU JSON OBJECT VALID — tanpa markdown"** + `responseMimeType: application/json` + parser berlapis (`parseGeminiResponse`: direct → regex → repair). `temperature: 0.1` (determinisme).

**Token/cost estimation per fitur** diukur otomatis oleh benchmark (lihat `AI_BENCHMARK.md` §4) memakai `src/utils/aiTokenEstimator.ts` + pricing `server/config/metricsConfig.js` (gemini_flash: input $0.075/1M, output $0.30/1M).

---

## 4. Dependency Map

```
Gmail sync ──▶ gmailClassifier/LocalParser (L0, gratis) ──▶ [tak yakin] ──▶ buildExtractionPrompt ──▶ Gemini ──▶ parseGeminiResponse ──▶ fallback parser
Receipt scan ──▶ buildReceiptExtractionPrompt ──▶ Gemini Vision ──▶ normalizeReceiptResult (risk_flags)
Transaksi baru ──▶ fraudEngine L1 (gratis) ──▶ flags ──▶ [FRAUD_AI_SCORING_ENABLED] ──▶ buildFraudScoringPrompt ──▶ Gemini ──▶ persist + notifikasi
Laporan bulanan ──▶ aiInsightService ──▶ buildMonthlyReportPrompt ──▶ Gemini ──▶ normalizeReportPayload (fallback rule-based)
Advisor ──▶ advisorService ──▶ buildAdvisorPrompt ──▶ Gemini ──▶ normalizeAdvisorReport (fallback rule-based)
AI Search ──▶ Discovery Engine ──▶ rankAndExplainResults (re-rank + explanation) ──▶ buildSuggestedQueries
Semua generate ──▶ generateVertexContent: LRU cache → single-flight → retry exp-backoff → fallback model → recordAIUsage
```

Guardrail lintas modul: **AI tidak pernah memblokir alur inti** (fraud non-blocking; insight/advisor fallback; ekstraksi fallback parser; `geminiReady` tidak memblokir readiness `/api/health`).

---

## 5. Temuan & Rekomendasi

| # | Temuan | Severity | Rekomendasi | Aksi |
|---|---|---|---|---|
| F1 | Prompt duplikat mati di frontend | Medium (drift risk) | Hapus; pointer ke server | ✅ Dihapus (P1.1) |
| F2 | `confidence` L2 fraud tidak dipersist | Low (explainability) | Persist + tampilkan | ✅ Dipersist + badge (P1.2) |
| F3 | Insight per-item belum punya `priority/severity/confidence` | Low (enhancement) | Desain skema opsional (lihat AI_INSIGHT_GUIDELINES §5) | 📋 Didefer — butuh usage data; UI saat ini list datar |
| F4 | Advisor belum eksplisit short/mid/long-term | Low (enhancement) | Kerangka horizon waktu (lihat FINANCIAL_ADVISOR_GUIDELINES §5) | 📋 Didefer — actionList ber-prioritas sudah menutup actionability |
| F5 | Search belum ada synonym/query-normalization penuh | Low (enhancement) | Evaluasi (lihat AI_SEARCH_EVALUATION §6) | 📋 Didefer — cleanText + re-rank sudah memadai |
| F6 | Belum ada benchmark resmi | High (regression risk) | Benchmark deterministik 5 kategori | ✅ Dibuat (P1.6) |
| F7 | **Bug produksi nyata ditemukan benchmark P1.6**: regex date (`\\d`) & payment_method (`[_\\s]`) di `normalizeReceiptResult` **double-escaped** → date OCR selalu null & 'qris'/'kartu kredit'/'transfer-bank' jatuh ke 'cash' (huruf 's' ikut di-replace) | **High (correctness OCR)** | Collapse backslash + unit test + benchmark floor | ✅ Diperbaiki (`vertexContext.js` baris 343/376) + `tests/unit/vertexContextReceipt.test.ts` + floor receipt ≥0.9 |

**Rekomendasi prioritas implementasi (1-10):**
1. Benchmark + regression guard — **10/10** (bukti kuantitatif untuk semua keputusan berikutnya) — ✅ selesai sprint ini
2. L2 fraud confidence — **8/10** (explainability produksi) — ✅ selesai
3. Insight per-item metadata — **6/10** (nilai UX tinggi tapi butuh data penggunaan; jangan prematur)
4. Advisor horizon waktu — **5/10**
5. Search synonyms — **4/10** (Discovery sudah punya spellCorrection + queryExpansion)

---

*Lampiran: file direview — vertexContext.js, fraudEngine.js, fraudDetectionService.js, agentSearchService.js, aiInsightService.ts, advisorService.ts, geminiService.ts, gmailClassifier.ts, gmailLocalParser.ts, receiptScanService.ts, aiCache.js, metricsConfig.js, constants.ts, FraudPage.tsx, ReportsPage.tsx.*
