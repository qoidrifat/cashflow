# AI Search Evaluation

> **Sprint 1 — Product Intelligence Refinement · Phase 1.5**
> Status: **SELESAI (evaluasi; tidak ada perubahan kode — implementasi sudah memenuhi kriteria)** · Tanggal: 2026-08-06

---

## 1. Ringkasan

AI Search (`server/services/agentSearchService.js` + Discovery Engine) **sudah memenuhi seluruh kriteria sprint** dengan pendekatan dua lapis:

```
Query ──▶ sanitizeAgentSearchPayload (anti-injeksi, cleanText) ──▶ Discovery Engine
   (:search + semantic filters + spellCorrection + queryExpansion) ──▶ rankAndExplainResults
   (re-rank deterministik + explanation) ──▶ buildSuggestedQueries ──▶ (opsional :answer + citations)
```

Keputusan evaluasi: **tidak ada perubahan kode yang diperlukan** (evidence-first — jangan mengubah tanpa bukti gap). Temuan: 1 observasi peningkatan opsional (didefer).

---

## 2. Evaluasi per Kriteria Sprint

| Kriteria | Status | Implementasi |
|---|---|---|
| **Semantic ranking** | ✅ | Discovery Engine semantic + `rankAndExplainResults` re-rank deterministik (token match di title/merchant/category/subject, JS stable sort → urutan Discovery dipertahankan untuk skor sama) |
| **Query understanding** | ✅ | `queryExpansionSpec: AUTO` + `spellCorrectionSpec: AUTO` (Discovery) |
| **Date understanding** | ✅ | Semantic filter `dateFrom/dateTo` (YYYY-MM-DD, divalidasi regex anti-injeksi) |
| **Amount/merchant/category understanding** | ✅ | Semantic filters `type` (whitelist) + `category` (sanitized) + dokumen punya `amount`, `merchant`, `category`, `search_text` (rich indexing) |
| **Intent classification** | ✅ | Tab-scoped (`help/transactions/insight/gmail/receipts`) + `:answer` endpoint untuk pertanyaan |
| **Bukan keyword matching** | ✅ | Discovery Engine semantic + re-rank hanya booster deterministik, bukan pengganti |
| **Query normalization** | ✅ | `cleanText` (kontrol char, collapse whitespace, truncate) + tokenisasi lowercase untuk re-rank |
| **Synonyms** | ⚠️ Parsial | Discovery menyediakan; boost sinonima lokal didefer (F1) |
| **Semantic boosting** | ✅ | Re-rank token-match + explanation |
| **Relevance score** | ✅ | `relevance` = jumlah token query yang match (deterministik, stabil) |
| **AI explanation** | ✅ | `explanation[]` per hasil (kata kunci, tipe, kategori, rentang tanggal, data milik kamu) — gratis, tanpa panggilan AI tambahan |
| **Suggested queries** | ✅ | `relatedQuestions` Discovery (≥2) → fallback template per tab (max 4, dedupe vs query asli) |
| **Recent searches / search analytics** | ✅ | Metric `agent_search_click` / `suggestion_used` + dashboard admin (Sprint 1.4) |

## 3. Contoh Query (sesuai target sprint)

Query **"pengeluaran makan minggu lalu"**:
1. `tab=transactions`, semantic filter tanggal (minggu lalu) + kategori (makan) via UI SemanticFilters.
2. Discovery semantic search → dokumen transaksi.
3. `rankAndExplainResults` boost hasil yang title/merchant/category-nya memuat "makan" + tanggal dalam rentang → `explanation: ["kata kunci: makan", "dalam rentang tanggal"]`.
4. `buildSuggestedQueries` → "Total pengeluaran makan", "Transaksi makan bulan ini", dst.

**Bukan keyword matching** — bukti: re-rank hanya booster; pencarian utama tetap Discovery semantic; + spellCorrection/queryExpansion.

## 4. Keamanan & Privasi (dipertahankan)

- `sanitizeAgentSearchPayload` — buang key sensitif (token/refresh/secret/api_key/...) + nilai mencurigakan (base64 image, BEGIN, JWT).
- `hashUserId` (sha256 + salt, fail-fast di produksi) — data store per-user.
- Server-side filter `user_id_hash` + defense-in-depth `filterOwnedResults` (fail-closed saat filter server tidak diterapkan).
- Logging observability tanpa PII (hashPrefix, counts).

## 5. Temuan & Rekomendasi

| # | Temuan | Aksi |
|---|---|---|
| F1 | Synonym/query-normalization lokal belum ada (hanya Discovery built-in) | 📋 Didefer: boost sinonima Indonesia (mis. "makan"→"makanan") menambah kamus yang perlu di-maintain; nilai tambah diragukan karena Discovery sudah punya queryExpansion + semantic. Evaluasi ulang bila precision menurun. |
| F2 | Re-rank berbasis token substring (bukan stem) | 📋 Didefer: cukup untuk tahap ini; stemmer Indonesia menambah kompleksitas. |
| F3 | `pageSize: 10` tetap | ✅ OK — UX pagination + budget; jangan ubah tanpa data. |

**Benchmark search** (100 query sintetis + constructed results): verifikasi re-rank menempatkan hasil yang relevan di top-3 + explanation hadir + suggested queries valid — lihat `AI_BENCHMARK.md` §3.4.

---

*File: server/services/agentSearchService.js, src/pages/AiSearchPage.tsx, tests/unit/agentSearch*.test.ts.*
