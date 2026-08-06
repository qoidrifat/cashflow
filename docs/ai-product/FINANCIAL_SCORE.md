# Personal Financial Health Score

> **Sprint 1.5 Phase 6** — Financial Health Engine: bukan sekadar angka. 8 komponen terukur, masing-masing dengan reason, recommendation, dan trend.

## 1. Hasil

- **Skor total 0-100** dengan kategori:

| Skor | Kategori | Label ID |
|---|---|---|
| ≥ 85 | **Excellent** | Sangat baik |
| ≥ 70 | **Good** | Baik |
| ≥ 55 | **Average** | Cukup |
| ≥ 40 | **Poor** | Perlu perhatian |
| < 40 | **Critical** | Kritis |

- Interpretasi confidence-style: `interpretConfidence(score/100)` → label ("Yakin", dll).
- `summary` menunjuk subscore terendah (fokus perbaikan utama).

## 2. 8 Komponen (bobot)

| Key | Komponen | Bobot | Basis penilaian |
|---|---|---|---|
| `saving` | Tabungan | 30% | savingsRate (≥30% = 100) |
| `cashflow` | Cash Flow | 20% | rasio expense/income (≤50% = 88) |
| `budget` | Budget | 10% | rata-rata pemakaian budget (≤65% = 75) |
| `debt` | Utang | 10% | utang vs income bulanan (0 = 100) |
| `emergency` | Dana Darurat | 10% | coverage bulan (≥6 = 100) |
| `income_stability` | Stabilitas Pemasukan | 10% | deviasi vs rata-rata 3 bulan |
| `expense_discipline` | Disiplin Pengeluaran | 5% | ketergantungan merchant tunggal |
| `growth` | Pertumbuhan | 5% | surplus bulanan & beban langganan |

Setiap subscore memiliki: `score`, `reason` (mengapa), `recommendation` (apa yang dilakukan), `trend` (`up/down/flat/none`).

## 3. Implementasi

`computeFinancialHealth(input)` di `src/lib/financialHealthEngine.ts` — **deterministik murni, tanpa AI**. Input dari `computeAdvisorMetrics` + data wallet (debt dari wallet tipe `credit`).

## 4. UI (AiHubPage → Health Score Card)

- Skor besar + badge kategori.
- Grid 8 subscore: label, skor + ikon trend, progress bar (mint/amber/red), reason.
- `summary` + tombol feedback.

## 5. Catatan

- Data kosong → score netral (tidak crash, semua komponen 0-100).
- Debt dihitung dari wallet `credit` (balance positif dianggap nominal utang) — dokumentasi perilaku, bukan kebenaran universal.
- Determinisme dijamin: unit test `financialHealthEngine.test.ts` (profil sehat > kritis, kategori, dsb).
