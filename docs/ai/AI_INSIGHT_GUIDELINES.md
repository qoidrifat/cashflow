# AI Insight Guidelines

> **Sprint 1 — Product Intelligence Refinement · Phase 1.3**
> Status: **SELESAI (guidelines + audit; metadata per-item didefer dengan desain siap-pakai)** · Tanggal: 2026-08-06

---

## 1. Standar Kualitas Insight

Setiap insight WAJIB memenuhi 6 kriteria:

1. **Spesifik (angka nyata)** — sebut nominal/%, bukan kata sifat kosong.
2. **Kontekstual** — bandingkan dengan periode sebelumnya / batas sehat.
3. **Actionable** — sertakan tindakan konkret yang bisa dilakukan minggu ini.
4. **Ringkas** — maksimal 2 kalimat per insight; summary ≤ 2 kalimat.
5. **Natural (Bahasa Indonesia)** — tidak menggurui, tidak jargon.
6. **Jujur** — insight bersumber dari data aplikasi; jangan klaim akses rekening bank.

### ❌ Tidak boleh (generik)
> "Pengeluaran Anda tinggi."

### ✅ Wajib (spesifik + kontekstual + actionable)
> "Pengeluaran kategori Makanan meningkat 18% dibanding minggu lalu. Jika tren ini berlanjut, anggaran bulanan kemungkinan habis 6 hari lebih awal. Pertimbangkan mengurangi pembelian di luar rumah sebanyak 2–3 kali minggu ini."

---

## 2. Penegakan di Implementasi Saat Ini

| Persyaratan | Fallback deterministik (`aiInsightService.ts`) | Prompt AI (`buildMonthlyReportPrompt`) |
|---|---|---|
| Angka spesifik | ✅ `Pengeluaran 85% dari pemasukan...`, `Frekuensi tinggi ke X (5× bulan ini)` | ✅ "maksimal 2 kalimat", data metrics terkirim |
| Context/komparasi | ✅ `buildSpendingForecast`: trend % vs bulan lalu + status high-risk/watch/under-control | ✅ Data lengkap metrics |
| Actionable | ✅ `Pasang batas budget khusus untuk...`, `Tahan pembelian impulsif...` | ✅ `recommendations` maks 4 |
| Skor kesehatan | ✅ `financialHealthScore` 0-100 deterministik (`computeFinancialHealthScore`) | ✅ key wajib `financialHealthScore` |
| Peluang hemat | ✅ `buildSavingOpportunities` (surplus → alihkan 20%) | ✅ `savingOpportunities` maks 3 |
| Pengeluaran tidak biasa | ✅ `buildUnusualSpending` (rasio ≥85%, frekuensi merchant) | ✅ `unusualSpending` maks 3 |

**Jaminan kualitas ganda:** fallback deterministik dipakai sebagai (a) sumber insight saat AI gagal, DAN (b) `fallback` di `normalizeReportPayload` — field AI yang kosong/invalid **tidak pernah** menggantikan insight spesifik dengan kosong. Ini jaminan anti-degradasi kualitas.

---

## 3. Prioritas & Severity Insight (desain — didefer)

Insight per-item saat ini `string[]` (datar). Untuk mendukung **priority/severity/confidence/category/actionability**, desain backward-compatible:

```ts
interface InsightItem {
  text: string;            // insight (wajib, backward-compatible dgn string)
  priority: 'high' | 'medium' | 'low';   // urutan tindakan
  severity: 'info' | 'warning' | 'critical';
  confidence: number;      // 0..1
  category?: string;       // kategori finansial terkait (Makanan, Langganan, ...)
  action?: string;         // tindakan 1 baris
}
```

- **Mengapa didefer:** (1) perubahan skema lintas `types` + fallback + normalize + prompt + UI (ReportsPage); (2) UI saat ini merender list datar — nilai tambah metadata tanpa desain display belum teruji; (3) prinsip sprint: "jangan optimasi prematur tanpa bukti". Rekomendasi: implementasi setelah 1 bulan data produksi untuk validasi distribusi prioritas.
- **Mitigasi sekarang:** `actionList` advisor sudah ber-priority (lihat FINANCIAL_ADVISOR_GUIDELINES) — actionability utama sudah tertutup.

---

## 4. Pedoman Prompt (untuk pengembangan berikutnya)

1. Selalu sertakan data kuantitatif (metrics) di prompt — jangan minta model menebak angka.
2. Minta format `maksimal N item` untuk setiap array (mencegah jawaban menggurui/panjang).
3. Larang placeholder nilai tanpa data (`undefined/NaN/null` → kosongkan).
4. Jangan pernah mengirim PII mentah; gunakan ringkasan agregat (pola `sampleTransactions` tanpa identitas).

---

*File: src/services/aiInsightService.ts, src/features/reports/ReportsPage.tsx, server/lib/vertexContext.js (buildMonthlyReportPrompt).*
