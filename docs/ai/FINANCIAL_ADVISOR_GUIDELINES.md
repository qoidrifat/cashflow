# Financial Advisor Guidelines

> **Sprint 1 — Product Intelligence Refinement · Phase 1.4**
> Status: **SELESAI (guidelines + audit; horizon waktu didefer dengan desain siap-pakai)** · Tanggal: 2026-08-06

---

## 1. Prinsip Coaching

Advisor (`buildAdvisorPrompt` + fallback `buildFallbackAdvisorReport`) adalah **AI Personal Financial Coach**, bukan laporan. Prinsip:

1. **Tidak generik** — setiap saran berakar pada angka metrics pengguna (rasio, surplus, coverage dana darurat, usage budget).
2. **Tidak mengulang insight** — fokus tindakan; insight berisi diagnosis, advisor berisi resep.
3. **Panjang pas** — summary ≤ 2 kalimat; tiap array maks 3-5 item (di-enforce prompt & fallback).
4. **Actionable** — `actionList` ber-priority (high/medium/low) + aksi 1 baris executable.
5. **Consistency** — tidak boleh bertentangan dengan insight: keduanya membaca sumber data yang sama (metrics deterministik); advisor menerima `metrics` yang DIBANGUN dengan logika yang sama dengan insight.

## 2. Pilar Behavioral Finance yang Dipakai

| Pilar | Implementasi |
|---|---|
| **Pay yourself first** | `savingStrategy`: "sisihkan minimal 10-20% sebelum pengeluaran lain" + auto-transfer |
| **Mental accounting** | `budgetStrategy` per kategori; saran pasang budget kategori terbesar |
| **Emergency fund 3-6 bulan** | `emergencyFund`: monthsCoverage + target 6× pengeluaran + prioritas sebelum investasi |
| **Cost anchoring langganan** | `subscriptionOptimization`: total langganan vs % pemasukan (≥20% = tinggi) |
| **Loss aversion / cashflow guard** | rasio ≥85% → high action "kendalikan pengeluaran" |
| **Goal progress** | progress goal % → jaga konsistensi |

## 3. Evaluasi Implementasi Saat Ini

| Kriteria sprint | Status | Bukti |
|---|---|---|
| Tidak generik | ✅ | Fallback: `Pengeluaran sudah 85% dari pemasukan — tahan pembelian non-esensial...` |
| Tidak mengulang insight | ✅ | Fokus tindakan; insight terpisah di ReportsPage |
| Tidak terlalu panjang/pendek | ✅ | `slice(0,3)`/`slice(0,5)` di fallback + `maksimal N` di prompt |
| Financial psychology | ✅ | 6 pilar di atas |
| Actionability | ✅ | `actionList` ber-priority (high dulu), maks 5 |

## 4. Desain Short/Mid/Long-Term (didefer)

Prompt saat ini menghasilkan saran tanpa horizon waktu eksplisit. Desain backward-compatible:

```ts
// Tambahan opsional di AdvisorReport
horizonAdvice?: {
  shortTerm: string[];   // ≤1 bulan — kontrol cashflow, hentikan kebocoran
  midTerm: string[];     // 3-6 bulan — dana darurat, goal menengah
  longTerm: string[];    // 1+ tahun — investasi, goal jangka panjang
};
```

- **Mengapa didefer:** (1) `actionList` ber-priority + `emergencyFund` (jangka pendek-menengah) + `savingStrategy` (investasi = jangka panjang) **sudah menutupi 80% kebutuhan horizon**; (2) penambahan 3 array memperbesar payload AI + UI tanpa bukti permintaan pengguna; (3) sprint rule: minimal fix.
- **Mitigasi sekarang:** prompt meminta prioritas high/medium/low di `actionList` — urutan = urutan waktu tindakan.

## 5. Pedoman Prompt (pengembangan berikutnya)

1. Ringkasan data: kirim `metrics` + `subscriptions` saja (bukan transaksi mentah) — tanpa PII, cap 9.000 char.
2. Minta `emergencyFund` sebagai object (suggestion + monthsCoverage + targetAmount) — bukan free text.
3. Larang angka kosong: `0.0`/`0` lebih baik daripada null untuk nominal.
4. Semua nominal IDR bulat.

---

*File: src/services/advisorService.ts, server/lib/vertexContext.js (buildAdvisorPrompt), tests/unit/advisorService.test.ts.*
