# AI Benchmark & Evaluation Suite

> **Sprint 1 — Product Intelligence Refinement · Phase 1.6+** (phase terpenting)
> Status: **SELESAI** · Tanggal: 2026-08-06
> Runner offline: `tests/benchmark/aiQualityBenchmark.spec.ts` · `npm run benchmark:ai`
> Runner live: `tests/benchmark/aiLiveBenchmark.spec.ts` · `npm run benchmark:ai:live`
> Hasil otomatis (JANGAN hardcode): `docs/ai/benchmark-results.json` (deterministik, di-commit) · `docs/ai/benchmark-live-results.json` (live, ber-timestamp, di-.gitignore)

---

## 1. Tujuan

Benchmark resmi untuk mengukur kualitas **lapisan AI yang deterministik** (yang bisa dieksekusi offline tanpa Gemini/DB/network), sebagai:
1. **Baseline kuantitatif** sebelum/ sesudah perubahan prompt & rule (bukti "before vs after").
2. **Regression guard** — floor assertion di CI: perubahan yang menurunkan kualitas deterministik → CI merah.
3. **Estimasi biaya & token** per fitur (pricing `AI_PRICING` gemini_flash).

**Catatan scope:** dua runner melengkapi satu sama lain:
1. **Offline deterministik** — lapisan yang dapat diverifikasi tanpa model/DB/network: L1 fraud rule engine, fallback insight/advisor (jaminan kualitas AI), re-rank + suggested queries search, local gmail parser (L0), normalizer hasil OCR. Jalan di CI sebagai regression guard.
2. **Live integration (Gemini nyata, opsional)** — membuktikan prompt builders + `parseGeminiResponse` + pipeline Vertex bekerja end-to-end dengan model sungguhan. **Skip default di CI** (butuh credentials + biaya AI); aktifkan eksplisit.

---

## 2. Metodologi

- **6 kategori offline**: 5 kategori × 100 kasus sintetis (hand-crafted + generator deterministik ber-seed, **ground-truth eksplisit**) **+ kategori `hand_crafted`** = **74 kasus bernama** di `tests/benchmark/fixtures.ts` (fraud 20 · OCR 20 · gmail 10 · insight 8 · advisor 8 · search 8) — tiap kasus punya `reason` (alasan edge, auditable), bukan angka acak.
- Metrik: accuracy, precision, recall, F1 (macro), latency (ms), input tokens (estimasi `estimateTokensFromText`), cost estimasi, distribusi confidence.
- Prediktor = fungsi produksi nyata (bukan salinan): `evaluateFraudRules`, `buildFallbackMonthlyReport`, `buildFallbackAdvisorReport`+`computeAdvisorMetrics`, `rankAndExplainResults`+`buildSuggestedQueries`, `evaluateLocalGmailParser`, `normalizeReceiptResult`.
- Deterministik: seed tetap → hasil identik tiap run.
- **Live mode**: subset `fixtures.ts` bagian 7 (fraud L2 5 · gmail 5 · insight 3 · advisor 3 · **OCR receipt vision 4**) dipanggil ke Vertex AI Gemini via `generateGeminiText` (teks) & `generateGeminiVision` (gambar struk PNG); metrik = parse rate, agree/ pass rate, latency riil, token riil (`usageMetadata`). Gambar struk **di-generate programatik** (`tests/benchmark/receiptImage.ts` — PNG encoder murni + font bitmap 5×7) sehingga ground-truth diketahui persis & deterministik (0 byte biner di repo).

---

## 3. Hasil (run 2026-08-06)

### 3a. Offline deterministik — generator (5 × 100)

| Kategori | Cases | Precision | Recall | F1 | Accuracy | Latency avg | Input tokens avg | Est cost USD/case |
|---|---|---|---|---|---|---|---|---|
| **fraud_l1** | 100 | **1.000** | **1.000** | **1.000** | **1.000** | 0.01 ms | 280 | $0.000046 |
| **insight_fallback** | 100 | **1.000** | **1.000** | **1.000** | **1.000** | 0.26 ms | 262 | $0.000043 |
| **advisor_fallback** | 100 | **1.000** | **1.000** | **1.000** | **1.000** | 0.05 ms | 147 | $0.000024 |
| **search_rerank** | 100 | top1-hit **1.000** · explanation **1.000** · suggestions valid **1.000** | — | — | — | 0.02 ms | — | — |
| **ocr_parsing_local** | 100 | gmail decision **1.000** · gmail amount **1.000** · receipt field **1.000** | — | — | — | 0.07 ms | — | — |

### 3b. Offline deterministik — hand-crafted (74 kasus bernama)

| Kategori | Cases | Metrik |
|---|---|---|
| hand_crafted_fraud | 20 | precision **1.000** · recall **1.000** · F1 **1.000** |
| hand_crafted_ocr | 20 | receipt field **1.000** |
| hand_crafted_gmail | 10 | decision **1.000** · amount **1.000** |
| hand_crafted_insight | 8 | accuracy **1.000** |
| hand_crafted_advisor | 8 | accuracy **1.000** |
| hand_crafted_search | 8 | top1-hit **1.000** |

### 3c. Live Gemini — integration (20 panggilan, `npm run benchmark:ai:live`)

| Kategori | Cases | Pass rate | Total tokens | Latency avg |
|---|---|---|---|---|
| fraud_l2_live (agree L2↔L1) | 5 | **1.000** | ~2.0k | ~7.9 s |
| gmail_extraction_live | 5 | **1.000** | ~3.5k | ~3.1 s |
| insight_live | 3 | **0.667** | ~2.5k | ~13.8 s |
| advisor_live | 3 | **1.000** | ~3.8k | ~18.8 s |
| **ocr_receipt_vision_live** | 4 | **1.000** | ~2.5k | ~11.2 s |

Live lulus 2× run berurutan (16 panggilan teks) + 1× run vision (4 panggilan gambar, total 20). Seluruh output JSON ter-parse oleh `parseGeminiResponse` produksi (0 gagal parse).

**Vision OCR (4/4 PASS):** struk QRIS (amount 150.000 · qris · 2026-08-01), struk tunai (25.000 · cash), bukti transfer bank (500.000 · transfer-bank · income), dokumen KTP → `auto_skip` (bukan transaksi). Output Gemini dinormalisasi lewat `normalizeReceiptResult` (jalur produksi `receiptScanService`) sebelum dibandingkan dengan ground-truth — membuktikan pipeline vision end-to-end, bukan sekadar parse.

**Catatan non-determinisme (insight live):** `live_insight_healthy` bisa menghasilkan `stabil`/score 78 alih-alih `sehat` (input surplus 60% — batas klasifikasi dua label positif). Floor lunak kategori (2/3 ≥ 0.5) tetap lolos; ini bukan regresi melainkan non-determinisme LLM yang sudah didokumentasikan di §8.

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
| OCR receipt (vision) | ~2.5k (4 gambar) | ~$0.0003-0.0006 | Diukur live benchmark §3c (gambar PNG 560×760 yang di-generate) |

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
| **hand_crafted_fraud** | precision ≥ 0.95 · recall ≥ 0.95 |
| **hand_crafted_ocr** | receipt field ≥ 0.9 |
| **hand_crafted_gmail** | decision ≥ 0.9 |
| **hand_crafted_insight** | accuracy ≥ 0.9 |
| **hand_crafted_advisor** | accuracy ≥ 0.9 |
| **hand_crafted_search** | top1-hit ≥ 0.9 |

Live benchmark **tidak punya floor di CI** (di-skip otomatis) — hanya floor lunak lokal (parse rate ≥ 0.5 & ≥ 1 case pass per kategori) untuk mencegah laporan yang sepenuhnya kosong.

---

## 7. Cara Menjalankan & Memperluas

```bash
npm run benchmark:ai          # offline: 7 kategori (500 + 74 + 48 feedback) → benchmark-results.json
npm run benchmark:ai:live     # live Gemini: 20 panggilan (16 teks + 4 vision OCR) → benchmark-live-results.json (skip di CI)
BENCH_LIVE_ALL=1 npm run benchmark:ai:live  # full run semua kategori (lewati seleksi feedback)
npm run test:unit             # benchmark offline TURUT dijalankan (CI) — floor = guard
node scripts/feedbackPromptPriorities.mjs  # dataset ai_feedback NYATA → prioritas perbaikan prompt (opsional, butuh Turso)
node scripts/promptChangeEvaluate.mjs --help  # alur evaluasi before/after perbaikan prompt (lihat §9)
```

**Feedback → prioritas perbaikan prompt (Sprint 1.5):**
- `server/lib/feedbackMetrics.js` (murni): agregasi `ai_feedback` per feature/rating → `priorityScore` (negativeRate × 100), `confidence`, ranking, dan `promptActionPlan` (arah perbaikan per rating negatif dominan + threshold already_done/skip).
- Benchmark kategori ke-7 `feedback_prioritization` (dataset sintetis ber-label 48 baris): floor deterministik memastikan agregasi & ranking tidak berubah diam-diam (regression guard).
- Script CLI memuat dataset NYATA dari Turso → tabel prioritas + action plan + snapshot `docs/ai/feedback-prompt-priorities.json` (di-refresh manual, sebelum live run).

**Live = `npm run benchmark:ai:live` (BENCH_LIVE=1) saja** — `vitest ... --live` ditolak CLI vitest. File hasil di-truncate tiap run (snapshot sekali jalan).

**Feedback-driven selection (Sprint 1.5):** bila snapshot `docs/ai/feedback-prompt-priorities.json` ada dan `topPriority` punya live category, live benchmark **hanya menjalankan kategori fitur paling dikeluhkan user** (fokus biaya AI + evaluasi prompt yang bermasalah):
- Mapping: `advisor→advisor_live` · `insight→insight_live` · `fraud→fraud_l2_live` · `gmail→gmail_extraction_live` · `ocr→ocr_receipt_vision_live`; `search`/`conversation` (tanpa live category) → fallback ke fitur ranking berikutnya yang punya mapping.
- Banner 🎯 dicetak saat run + `feedbackSelection` disertakan di `benchmark-live-results.json` (alasan: `topPriority` / `firstMappedFeature`).
- Alur lengkap: `node scripts/feedbackPromptPriorities.mjs` (refresh snapshot dari Turso) → `npm run benchmark:ai:live`.
- Override: `BENCH_LIVE_ALL=1 npm run benchmark:ai:live` memaksa full run semua kategori (mis. sebelum release / untuk baseline lengkap).
- Tanpa snapshot / data feedback kosong → full run (perilaku default).

**Live mode butuh `server/.env`** berisi `GOOGLE_CLOUD_PROJECT`/`GCP_PROJECT_ID`, `GCP_LOCATION`, `GEMINI_PRIMARY_MODEL`, `GEMINI_FALLBACK_MODEL`, `GOOGLE_APPLICATION_CREDENTIALS` (service account JSON yang file-nya ada) — persis konfigurasi boot server. Tanpa itu test gagal dengan pesan konfigurasi yang jelas.

**Memperluas kasus:**
- Hand-crafted: tambah ke `tests/benchmark/fixtures.ts` (bagian 1) + otomatis ter-cover floor kategori 6.
- Generator: tambah ke builder per kategori di `aiQualityBenchmark.spec.ts`.
- Live: tambah ke `fixtures.ts` (bagian 7). Jangan mengubah prediktor benchmark — harus selalu fungsi produksi nyata.

---

## 8. Interpretasi & Batasan

- **Angka 1.0 di fraud/advisor/search** = kepastian pada fixture konstruksi sendiri — ini mengukur *regression* (jangan sampai turun), bukan akurasi dunia nyata. Akurasi nyata butuh label data produksi.
- **Non-determinisme LLM (ditemukan live run):** kasus data-kosong di insight — Gemini menjawab "stabil 70" di run pertama dan "sehat 88" di run kedua (input 0 transaksi → model menebak). Karena itu kasus data-kosong **tidak dipakai di live** (fallback offline tetap mengujinya); dokumen ini mencatatnya sebagai batas evaluasi live. Pola serupa: `live_insight_healthy` (surplus 60%) bisa dijawab `stabil` (bukan `sehat`) — dua label positif yang berbatasan, bukan gagal ekstraksi.
- **Vision OCR live memakai gambar yang di-generate** (`receiptImage.ts`, font bitmap 5×7 diskalakan 4×) — representatif untuk struk sederhana monokrom; struk kompleks (logo, tabel padat, pemisah ribuan) tidak dicakup. Ground-truth gambar diketahui persis karena kita yang menggambar.
- **Perilaku yang didokumentasikan hand-crafted** (bukan bug): spasi di payment method tidak di-trim (`' qris '`→`'cash'`); tanggal hanya format-check (`'2026-13-45'` lolos regex); filter rentang tanggal search hanya boosting (tidak drop hasil luar rentang); L0 gmail mengirim variasi QRIS ke AI (`send_to_ai`).
- **Fragilitas format amount (dokumentasi, bukan fix):** bila Gemini vision pernah membalas `amount: "150.000"` (pemisah ribuan), `Number()` normalizer → 150 → kasus gagal walau OCR benar. Ini perilaku produksi (`normalizeReceiptResult` memakai `Number()`); prompt meminta angka polos dan live run konsisten `150000`/`500000`, jadi batas ini hanya dicatat agar kegagalan masa depan dipahami sebagai known limit, bukan regresi.
- **Tech debt dari fixture (kandidat fix, bukan "intended behavior"):** `normalizeReceiptPaymentMethod` tidak men-trim spasi (`' qris '`→`'cash'`) dan `Number()` tidak memparse pemisah ribuan (`'150.000'`→150). Benchmark membekukan perilaku saat ini agar ada regression guard — bila kelak diperbaiki, update fixture expected + alasan.
- Hallucination rate: untuk lapisan deterministik tidak ada konsep hallucination (output dari kode, bukan model); lapisan live-AI memakai `parseGeminiResponse` + fallback + `normalizeReportPayload` (field invalid → fallback) sebagai jaring anti-hallucination.
- **Biaya live**: 20 panggilan (16 teks + 4 vision) ≈ 14.3k token ≈ **<$0.01** (gemini_flash, vision sedikit lebih mahal per gambar). Jangan jalankan live di CI — bukan gate.

---

## 9. Evaluasi Before/After Perbaikan Prompt (alur kerja, Sprint 1.5)

Mengubah prompt builder fitur **ber-prioritas tertinggi** (dari `scripts/feedbackPromptPriorities.mjs`) lalu membuktikan dampaknya dengan diff benchmark — bukan feeling.

```bash
# 1) Sebelum mengubah prompt — snapshot kondisi saat ini:
node scripts/promptChangeEvaluate.mjs --baseline "sebelum ubah prompt advisor"

# 2) Ubah prompt builder fitur prioritas (mis. server/lib/vertexContext.js)

# 3) Setelah mengubah — jalankan benchmark ulang & bandingkan dengan baseline:
node scripts/promptChangeEvaluate.mjs --compare "setelah ubah prompt advisor"

# Alternatif: hanya jalankan benchmark tanpa diff
node scripts/promptChangeEvaluate.mjs --run-only
```

Output `--compare`: tabel delta per kategori + verdict (`MEMBAIK` / `MENGALAMI REGRESI` / `TIDAK BERUBAH`).

**Aturan verdict (evidence-based):**
- Yang menentukan verdict: **metrik kualitas** (precision/recall/f1/accuracy/top1HitRate/dst) + **estCostUsdPerCase** (deterministik, turunan token).
- **avgLatencyMs bersifat informational** — TIDAK ikut verdict secara default. Bukti runtime 2026-08-07: jitter 18–71% antar-run pada 11 kategori dengan **kode yang sama** (latensi mikrodetik pure-JS di vitest tidak bisa membedakan perubahan prompt dari noise). Tersedia strict mode di lib (`includeLatencyInVerdict: true`) bila ingin membandingkan latensi.
- **Latensi riil Gemini** (dampak ukuran prompt ke waktu model) dipantau oleh **live benchmark** (npm run benchmark:ai:live) — diff offline hanya menilai kualitas & biaya deterministik. Jangan berasumsi verdict offline mencakup latensi model.

**Artefak:**
- `scripts/benchmarkDiff.mjs` — diff murni & deterministik (tanpa I/O, unit-testable): delta per metrik, direction good/bad, verdict per kategori & overall, kategori hilang/baru.
- `scripts/promptChangeEvaluate.mjs` — CLI pembungkus: baseline snapshot → jalankan vitest → diff. Cross-platform (Windows `npx.cmd` via shell).
- `tests/unit/benchmarkDiff.test.ts` — 12 test (identik → unchanged; naik → improved; turun → regressed; cost turun → membaik; latency default informational; strict mode; sinyal campur kualitas+latency; kategori hilang/baru).
- Snapshot `docs/ai/benchmark-before.json` = **artefak kerja, tidak di-commit** (buat ulang kapan saja via `--baseline`).

**Demo validasi (kontrol, tanpa ubah prompt):** `--baseline` → `--compare` → seluruh kategori `unchanged`, verdict **TIDAK BERUBAH (deterministik)** — membuktikan alur tidak menghasilkan verdict palsu.
