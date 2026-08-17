# AI Simulation & Scenario Analysis

> **Sprint 1.5 Phase 4 + 5** — What-if analysis DETERMINISTIK MURNI (tanpa AI). AI hanya menjelaskan hasil, tidak menghitung.

## 1. Prinsip

- **Deterministik**: input sama → output identik (unit-testable).
- **Tanpa RNG / tanpa "sekarang"** — proyeksi berbasis bulan ke-1..N.
- Angka dibulatkan ke rupiah penuh.
- AI **tidak dipanggil** untuk perhitungan — bebas biaya, cepat, dapat diverifikasi.

## 2. Engine (`src/lib/simulationEngine.ts`)

### Baseline

```ts
interface SimulationBaseline {
  monthlyIncome: number;    // pemasukan bulanan
  monthlyExpense: number;   // pengeluaran bulanan
  balance: number;          // saldo total
  subscriptionsMonthly?: number; // biaya langganan (opsional)
}
```

### Adjustment (what-if)

| Tipe | Contoh | Arti |
|---|---|---|
| `income_pct` | Gaji naik 10% (`pct: 0.1`) | pemasukan × (1+pct) |
| `expense_pct` | GoFood turun 20% (`pct: -0.2`) | pengeluaran × (1+pct) |
| `fixed_income` | Sewa masuk 1.5jt/bln | tambah pemasukan tetap |
| `fixed_expense` | Cicilan 1jt/bln (`+`) / cicilan selesai (`-1jt`) | tambah/kurang pengeluaran tetap |
| `save_monthly` | Tabung 500rb/bln | pisahkan ke tabungan |
| `one_time_expense` | Beli laptop bulan 2 | pengeluaran sekali (default bln 1) |
| `one_time_income` | Bonus 5jt | pemasukan sekali |

### Output per bulan

`income, expense, netCashflow, saving, balance, savingsAccumulated, expenseRatio` + ringkasan `finalBalance, totalSaved, avgNetCashflow, balanceDelta, deficitMonths, firstDeficitMonth`.

### Skor dampak

`scenarioImpactScore(result)` → 0-100 (balance 30% + cashflow 40% + saving 30%) untuk perbandingan skenario.

### Keputusan desain defisit (audit 2026-08-09)

**Angka proyeksi TIDAK di-clamp ke 0 — saldo negatif dijaga JUJUR.** Alasan:

1. Konsisten dengan konvensi seluruh app (StatCard `negative`, ProfilePage merah, `formatCurrency` Math.abs + prefix eksplisit, dokumen FINANCIAL_CALCULATION_INTEGRITY) — clamp menyembunyikan *severity* defisit (saldo −50jt vs −1jt terlihat sama).
2. `balanceDelta` & `avgNetCashflow` tetap bermakna (delta dihitung dari saldo awal **sesungguhnya** — saldo awal tidak lagi diam-diam di-`Math.max(0, ...)` ke 0; defensif-jujur, konsisten dengan konvensi negatif di seluruh app).
3. `scenarioImpactScore` tetap membedakan skenario buruk (clamp01 pada delta negatif → skor 0) — tidak perlu mengubah angka.

**Indikator defisit dipisah dari angka**: `deficitMonths` (jumlah bulan negatif) + `firstDeficitMonth` (bulan ke-N pertama kali minus, null bila tidak pernah). UI memakai ini untuk banner peringatan (`⚠ Defisit proyeksi — mulai bulan ke-N`) — banner muncul walau `finalBalance` kebetulan pulih positif (deficitMonths > 0, bukan finalBalance < 0).

Kasus pulih: `balance 2jt + one_time 12jt bln1` → bln1 −6jt, bln2 −2jt, bln3 +2jt → `deficitMonths 2`, `firstDeficitMonth 1`, `finalBalance +6jt` — indikator tetap muncul, angka jujur.

## 3. UI

**Simulasi** (AiHubPage): preset cepat (GoFood -20%, Gaji +10%, Tabung 500rb, Beli Laptop, Cicilan Selesai) + slider 3-12 bulan + tabel proyeksi + ringkasan 3 stat.

**Perbandingan Skenario**: simpan beberapa simulasi → tabel side-by-side (Saldo Akhir, Total Tabungan, Rata-rata Cashflow, Δ Saldo, badge Dampak).

## 4. Contoh

Baseline `{income: 10jt, expense: 6jt, balance: 20jt}` + *GoFood -20%* selama 6 bulan:
- Pengeluaran turun ke 4.8jt → surplus 5.2jt/bulan
- Saldo akhir = 20jt + 6×5.2jt = **51.2jt** (vs baseline 44jt)
- Skor dampak lebih tinggi dari baseline — terlihat di perbandingan.

## 5. Batas (dokumentasi)

- Proyeksi linier bulanan — tidak memodelkan bunga majemuk investasi, inflasi, atau musiman.
- `one_time` default di bulan 1 bila `month` tidak diberikan.
- Tidak membaca DB langsung — memakai data yang sudah dimuat halaman.
- Saldo negatif di proyeksi adalah **proyeksi defisit** (bukan saldo bank negatif aktual) — selalu tampil dengan indikator & tone merah (lihat §keputusan desain di atas).
