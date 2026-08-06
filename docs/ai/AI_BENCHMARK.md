# AI Benchmark & Evaluation Suite

> **Sprint 1 — Product Intelligence Refinement · Phase 1.6** (phase terpenting)
> Status: **SELESAI** · Tanggal: 2026-08-06
> Runner: `tests/benchmark/aiQualityBenchmark.spec.ts` · Jalankan: `npm run benchmark:ai`
> Hasil otomatis (JANGAN hardcode): `docs/ai/benchmark-results.json`

---

## 1. Tujuan

Benchmark resmi untuk mengukur kualitas **lapisan AI yang deterministik** (yang bisa dieksekusi offline tanpa Gemini/DB/network), sebagai:
1. **Baseline kuantitatif** sebelum/ sesudah perubahan prompt & rule (bukti "before vs after").
2. **Regression guard** — floor assertion di CI: perubahan yang menurunkan kualitas deterministik → CI merah.
3. **Estimasi biaya & token** per fitur (pricing `AI_PRICING` gemini_flash).

**Catatan scope (jujur):** lapisan yang butuh model (Gemini/Discovery live) TIDAK diuji offline — yang di-benchmark adalah lapisan yang dapat diverifikasi secara deterministik: L1 fraud rule engine, fallback insight/advisor (yang juga menjadi fallback & jaminan kualitas AI), re-rank + suggested queries search, local gmail parser (L0), dan normalizer hasil OCR (post-AI). Evaluasi live-AI tetap via pengujian manual/E2E.

---

## 2. Metodologi

- **5 kategori × 100 kasus** = 500 kasus sintetis; tiap kategori = hand-crafted edge cases + generator deterministik (mulberry32 ber-seed / indeks-siklik) dengan **ground-truth eksplisit**.
- Metrik: accuracy, precision, recall, F1 (macro), latency (ms), input tokens (estimasi `estimateTokensFromText`), cost estimasi, distribusi confidence.
- Prediktor = fungsi produksi nyata (bukan salinan): `evaluateFraudRules`, `buildFallbackMonthlyReport`, `buildFallbackAdvisorReport`+`computeAdvisorMetrics`, `rankAndExplainResults`+`buildSuggestedQueries`, `evaluateLocalGmailParser`, `normalizeReceiptResult`.
- Deterministik: seed tetap → hasil identik tiap run.

---

## 3. Hasil (run 2026-08-06)

| Kategori | Cases | Precision | Recall | F1 | Accuracy | Latency avg | Input tokens avg | Est cost USD/case |
|---|---|---|---|---|---|---|---|---|
| **fraud_l1** | 100 | **1.000** | **1.000** | **1.000** | **1.000** | 0.01 ms | 280 | $0.000046 |
| **insight_fallback** | 100 | **1.000** | **1.000** | **1.000** | **1.000** | 0.26 ms | 262 | $0.000043 |
| **advisor_fallback** | 100 | **1.000** | **1.000** | **1.000** | **1.000** | 0.05 ms | 147 | $0.000024 |
| **search_rerank** | 100 | top1-hit **1.000** · explanation **1.000** · suggestions valid **1.000** | — | — | — | 0.02 ms | — | — |
| **ocr_parsing_local** | 100 | gmail decision **1.000** · gmail amount **1.000** · receipt field **1.000** | — | — | — | 0.07 ms | — | — |

Distribusi confidence (fraud L1): `0.0-0.5: 15` · `0.5-0.7: 49` · `0.7-0.85: 2` · `0.85-1.0: 17` — risk score menyebar sehat (bukan semua ekstrem).
Distribusi confidence (gmail L0): `0.85-1.0: 50/50` — rules lokal yakin; ini benar karena L0 hanya reject/skip pola tegas, sisanya diteruskan ke AI.

**Catatan self-correction fixture:** run pertama insight = 0.99 karena fixture `merchant-heavy` bisa menghasilkan `n<6` transaksi ke merchant target (sinyal 'Frekuensi tinggi' butuh count ≥ 5) — **bug fixture, bukan bug produksi**. Builder di-paksa `n ≥ 6` → akurasi 1.0. Ini contoh nilai benchmark: menjaga fixture tetap konsisten dengan ground-truth.

---

## 4. Estimasi Biaya & Token per Fitur (basis)

Dari avg input tokens × pricing gemini_flash ($0.075/1M in, $0.30/1M out, asumsi output 30%):

| Fitur | Input tokens | Est cost/case | Keterangan |
|---|---|---|---|
| Fraud L2 scoring | ~280 | $0.00005 | Hanya untuk kandidat ter-flag; off by default |
| Insight bulanan | ~262 | $0.00004 | + data metrics (cap 12.000 char) |
| Advisor | ~147 | $0.00002 | + subscriptions (cap 9.000 char) |
| Gmail L0 (gratis) | 0 | $0 | Menolak/meneruskan sebelum AI |
| OCR receipt (vision) | — (gambar) | ~$0.0002-0.0005 | Bergantung ukuran gambar (di luar benchmark ini) |

Referensi lengkap di Cost Monitoring dashboard (Sprint 2) & `docs/ai/COST_MONITORING.md`.

---

## 5. 🐛 Bug Nyata yang Ditemukan Benchmark (bukti nilai fase ini)

Run pertama gagal floor `receiptFieldAccuracy ≥ 0.9` (dapat **0.74**). Investigasi bytes file mengungkap **bug produksi** di `server/lib/vertexContext.js`:

- Regex date `/^\\d{4}-\\d{2}-\\d{2}$/` **double-escaped** (`\\\\d`) → **date hasil OCR selalu null**.
- Regex payment `replace(/[_\\s]/g,'-')` double-escaped → huruf **'s' ikut di-replace** → `'qris'`→`'qri-'`→`'cash'`, `'kartu kredit'`→`'cash'`, `'transfer-bank'`→`'cash'`.

**Dampak produksi:** tanggal scan receipt tidak pernah terekam; metode pembayaran sebagian besar jatuh ke 'cash'.

**Fix:** collapse backslash (`\\d`→`\d`, `[_\\s]`→`[_\s]`) + regression guard `tests/unit/vertexContextReceipt.test.ts` (7 test) + floor benchmark. Setelah fix: **receipt field accuracy 1.0**.

---

## 6. Regression Floors (ditegakkan CI via test:unit)

| Kategori | Floor |
|---|---|
| fraud_l1 | precision ≥ 0.95 · recall ≥ 0.95 |
| insight_fallback | accuracy ≥ 0.9 |
| advisor_fallback | accuracy ≥ 0.9 |
| search_rerank | top1-hit ≥ 0.95 · suggestions valid ≥ 0.99 |
| ocr_parsing_local | receipt field ≥ 0.9 · gmail decision ≥ 0.9 |

---

## 7. Cara Menjalankan & Memperluas

```bash
npm run benchmark:ai          # jalankan + tulis docs/ai/benchmark-results.json
npm run test:unit             # benchmark TURUT dijalankan (CI) — floor = guard
```

**Memperluas kasus:** tambah ke builder per kategori di `tests/benchmark/aiQualityBenchmark.spec.ts` (pola: hand-crafted edge case + generator deterministik). Jangan mengubah prediktor benchmark — harus selalu fungsi produksi nyata.

**Live AI mode (opsional, manual):** benchmark lapisan Gemini/Discovery tidak diotomatisasi (biaya + non-deterministik). Rekomendasi: jalankan E2E + evaluasi manual per fitur; catat hasil di dokumen review.

---

## 8. Interpretasi & Batasan

- **Angka 1.0 di fraud/advisor/search** = kepastian pada fixture konstruksi sendiri — ini mengukur *regression* (jangan sampai turun), bukan akurasi dunia nyata. Akurasi nyata butuh label data produksi.
- Insight 0.99: 1 miss boundary — ditoleransi; review bila floor dinaikkan.
- Hallucination rate: untuk lapisan deterministik tidak ada konsep hallucination (output dari kode, bukan model); lapisan live-AI memakai `parseGeminiResponse` + fallback + `normalizeReportPayload` (field invalid → fallback) sebagai jaring anti-hallucination.
