# Fraud Detection Evaluation

> **Sprint 1 — Product Intelligence Refinement · Phase 1.2**
> Status: **SELESAI** · Tanggal: 2026-08-06
> Metode: audit kode + benchmark deterministik (lihat `AI_BENCHMARK.md`). Tidak membuat engine baru — evaluasi engine yang sudah ada.

---

## 1. Ringkasan

Pipeline fraud CashFlow sudah berlapis dengan benar:

```
Transaksi baru ──▶ L1 Rule Engine (gratis, deterministik) ──▶ flags ──▶ persist + notifikasi + metric
                                              │
                                              └─[FRAUD_AI_SCORING_ENABLED=true]─▶ L2 Gemini scoring ──▶ persist + eskalasi
```

**Evaluasi: arsitektur benar, explainability hampir lengkap.** Satu gap nyata ditemukan & diperbaiki: **confidence L2 tidak dipersist** (Prompt meminta `confidence`, service hanya menyimpan score/decision/reasons). Kini `aiConfidence` tersimpan di `rule_data` dan ditampilkan di FraudPage sebagai badge **"Keyakinan N%"**.

---

## 2. Evaluasi Rule Engine (L1) — precision/recall per rule

| Rule | Sinyal | Severity | Precision risk (false positive) | Recall gap (false negative) | Verdict |
|---|---|---|---|---|---|
| `duplicate` (gmail_message_id) | ID email Gmail sama sudah tercatat | **critical** | Rendah — sinyal kuat double-sync | — | ✅ Bagus |
| `duplicate` (amount+merchant+window) | Nominal & merchant sama ≤7 hari | high | Sedang — pembelian rutin nominal sama (mis. kopi) bisa kena | Window 7 hari bisa lolos duplikat >7 hari | ⚠️ FP wajar, ditangani `review` (bukan `block`) |
| `velocity` | >5 transaksi/merchant/24 jam | medium | Sedang — merchant dengan pembelian harian wajar | — | ✅ |
| `amount_outlier` | nominal > p99×1.5 / >×3 | medium/high | Rendah — berbasis p99 historis per tipe | Data baru (p99 kecil) → outlier mudah | ⚠️ wajar |
| `new_merchant` | merchant baru + nominal > median×2 | medium | Sedang — merchant baru wajar dengan nominal sedang | — | ✅ |
| `category_anomaly` | expense di kategori ber-type income | low | Rendah | — | ✅ |

**Kesimpulan L1:** precision tinggi pada sinyal kuat (gmail duplicate, amount outlier, category anomaly); FP terkonsentrasi di rules berbasis frekuensi (velocity, amount+merchant duplicate) — **desain sudah benar** karena severity FP di `low/medium` dan label `flagged` (advisory), bukan `review`/block. **Write tidak pernah diblokir** (guardrail non-blocking).

**Metrik kuantitatif** (dari benchmark, 100 kasus sintetis ber-ground-truth): lihat `AI_BENCHMARK.md` §3.1.

---

## 3. Evaluasi L2 AI Scoring

| Aspek | Status | Catatan |
|---|---|---|
| Prompt bounded | ✅ | Ringkasan transaksi + flags + konteks, cap 6.000 char, tanpa PII |
| Degrade aman | ✅ | JSON invalid / error → verdict L1 (`logger.warn` + return) |
| Score clamp | ✅ | `clampScore` 0..1; nilai korup → null → pakai L1 |
| Decision whitelist | ✅ | Hanya allow/review/block |
| Eskalasi advisory | ✅ | `block` → notifikasi "risiko tinggi" — transaksi TETAP tercatat |
| **Confidence persisted** | ✅ **fix sprint ini** | `aiConfidence` → `rule_data.aiConfidence` → badge UI |
| Cache | ✅ | `cacheTtlMs: 0` (tidak di-cache — keputusan benar: skor per transaksi unik) |

---

## 4. Explainability — status "Why flagged / Risk factors / Recommendation / Confidence"

| Komponen | Sumber | Ditampilkan di FraudPage |
|---|---|---|
| **Why flagged** | Deskripsi L1 per rule (Bahasa Indonesia, spesifik: nominal, merchant, jendela waktu) | ✅ Paragraf deskripsi |
| **Risk factors** | `reasons[]` dari L2 AI (maks 4) | ✅ Box "Alasan AI" |
| **Recommendation** | Verdict L2 (allow/review/block) + teks notifikasi "sebaiknya diverifikasi" | ✅ Chip AI decision |
| **Confidence** | `confidence` L2 | ✅ **Badge "Keyakinan N%"** (baru) |
| Skor risiko | `riskScore` (L1 severity→0..1; L2 override) | ✅ Progress bar warna |

Contoh "why" yang dihasilkan engine (bukan sekadar skor):
> *"Transaksi dengan nominal sama ke Kopi Senja dalam 7 hari terakhir — cek kemungkinan entri ganda."* (rule duplicate)

---

## 5. Temuan & Aksi

| # | Temuan | Aksi |
|---|---|---|
| F1 | `confidence` L2 diminta di prompt tapi tidak dipersist | ✅ `aiConfidence` dipersist ke `rule_data` (`server/services/fraudDetectionService.js`) |
| F2 | Badge confidence belum ada di UI | ✅ Badge "Keyakinan N%" di `FraudPage.tsx` (tooltip penjelasan) |
| F3 | Tidak ada regression guard kuantitatif untuk kualitas L1 | ✅ Benchmark fraud 100 kasus + assertion (P1.6) |

---

## 6. Risiko Tersisa

1. **Threshold statis** — `DEFAULT_THRESHOLDS` dikunci; pada user power-user, velocity/outlier FP naik. Rekomendasi: threshold per-user (persentil) saat dataset cukup (didefer — butuh data produksi).
2. **L2 off by default** — di produksi aktifkan `FRAUD_AI_SCORING_ENABLED=true` untuk explainability penuh (biaya: ±1 panggilan Gemini per transaksi ter-flag).
3. **OCR/parse error di aggregate** — `countRows` menganggap error = 0 (fail-open); desain sengaja (non-blocking).

---

*File: server/lib/fraudEngine.js, server/services/fraudDetectionService.js, src/features/fraud/FraudPage.tsx, tests/unit/fraudEngine.test.ts.*
