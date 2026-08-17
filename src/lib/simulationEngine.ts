/**
 * Financial Simulation Engine (Sprint 1.5 — Phase 4 & 5).
 *
 * What-if analysis DETERMINISTIK MURNI — TANPA AI. Semua perhitungan proyeksi
 * saldo / cashflow / tabungan / budget memakai aritmetika sederhana yang dapat
 * diverifikasi. AI (bila ada) hanya MENJELASKAN hasil, tidak menghitung.
 *
 * Contoh: "Kalau GoFood turun 20%", "Kalau gaji naik 10%", "Kalau menabung
 * 500rb/bulan", "Kalau beli motor bulan depan".
 *
 * Prinsip:
 *  - Deterministik: input sama → output sama persis (unit-testable).
 *  - Tanpa RNG, tanpa tanggal sekarang (semua berbasis "bulan ke-1..N").
 *  - Angka dibulatkan ke rupiah penuh.
 */
import { getMonthName } from './utils';

// ── Tipe input ───────────────────────────────────────────────────────────────

/** Baseline kondisi keuangan user saat ini (bulanan). */
export interface SimulationBaseline {
  /** Pemasukan rata-rata per bulan (Rp). */
  monthlyIncome: number;
  /** Pengeluaran rata-rata per bulan (Rp). */
  monthlyExpense: number;
  /** Saldo total saat ini (Rp). */
  balance: number;
  /** Biaya langganan bulanan (Rp) — ditambahkan ke pengeluaran baseline bila dihitung. */
  subscriptionsMonthly?: number;
}

export type SimulationAdjustment =
  | { type: 'income_pct'; label: string; pct: number }                 // gaji naik 10% → pct 0.10
  | { type: 'expense_pct'; label: string; pct: number }                // GoFood turun 20% → pct -0.20
  | { type: 'fixed_income'; label: string; amount: number }            // sewa masuk 1.5jt/bulan
  | { type: 'fixed_expense'; label: string; amount: number }           // cicilan motor 1jt/bulan
  | { type: 'save_monthly'; label: string; amount: number }            // tabung 500rb/bulan
  | { type: 'one_time_expense'; label: string; amount: number; month?: number } // beli laptop bulan ke-2
  | { type: 'one_time_income'; label: string; amount: number; month?: number }; // bonus bulan ke-1

export interface SimulationOptions {
  /** Jumlah bulan diproyeksikan (default 6). */
  months?: number;
  /** Tahun mulai (untuk label bulan; default 2026). */
  startYear?: number;
  /** Bulan mulai 1-12 (default 1). */
  startMonth?: number;
  /** Jika true, biaya langganan ditambahkan ke pengeluaran baseline. */
  includeSubscriptions?: boolean;
}

// ── Tipe output ──────────────────────────────────────────────────────────────

export interface SimulationMonth {
  /** Urutan bulan (1-based). */
  monthIndex: number;
  /** Label "Jan 2026". */
  label: string;
  income: number;
  expense: number;
  /** income - expense (sebelum tabungan paksa). */
  netCashflow: number;
  /** Tabungan paksa bulan ini (save_monthly). */
  saving: number;
  /** Saldo akhir bulan. */
  balance: number;
  /** Akumulasi tabungan. */
  savingsAccumulated: number;
  /** Rasio pengeluaran terhadap pemasukan (0-1+). */
  expenseRatio: number;
}

export interface SimulationResult {
  baseline: SimulationBaseline;
  adjustments: SimulationAdjustment[];
  months: SimulationMonth[];
  /** Saldo akhir periode. */
  finalBalance: number;
  /** Total tabungan terkumpul selama periode. */
  totalSaved: number;
  /** Rata-rata net cashflow per bulan. */
  avgNetCashflow: number;
  /** Beda saldo akhir vs awal. */
  balanceDelta: number;
  /**
   * Jumlah bulan dengan saldo NEGATIF (defisit) selama proyeksi.
   * Keputusan desain (audit 2026-08-09): proyeksi TIDAK di-clamp ke 0 —
   * angka negatif dijaga JUJUR (pola StatCard/ProfilePage/formatCurrency
   * Math.abs + prefix). Indikator ini dihitung derived dari angka jujur
   * (balance per-bulan TIDAK dimodifikasi). 0 = tidak pernah minus.
   */
  deficitMonths: number;
  /**
   * Bulan ke-1..N (monthIndex) saat saldo PERTAMA KALI negatif; null bila
   * tidak pernah minus. Dipakai UI untuk "Defisit mulai bulan ke-N".
   */
  firstDeficitMonth: number | null;
}

// ── Engine ───────────────────────────────────────────────────────────────────

const round = (v: number): number => Math.round(v);

/** Hitung pct gabungan income & expense dari daftar adjustment. */
function aggregatePct(adjustments: SimulationAdjustment[], kind: 'income_pct' | 'expense_pct'): number {
  return adjustments
    .filter((a): a is Extract<SimulationAdjustment, { type: typeof kind }> => a.type === kind)
    .reduce((sum, a) => sum + a.pct, 0);
}

/**
 * Proyeksikan kondisi keuangan selama N bulan setelah menerapkan adjustment.
 * Pure function — tidak membaca store, tidak ada efek samping.
 */
export function runSimulation(
  baseline: SimulationBaseline,
  adjustments: SimulationAdjustment[],
  options: SimulationOptions = {},
): SimulationResult {
  const months = Math.max(1, Math.min(24, options.months ?? 6));
  const startYear = options.startYear ?? new Date().getFullYear();
  const startMonth = options.startMonth ?? new Date().getMonth() + 1;

  const incomePct = aggregatePct(adjustments, 'income_pct');
  const expensePct = aggregatePct(adjustments, 'expense_pct');

  const baseIncome = Math.max(0, baseline.monthlyIncome);
  const baseExpense = Math.max(0, baseline.monthlyExpense)
    + (options.includeSubscriptions ? (baseline.subscriptionsMonthly ?? 0) : 0);

  const fixedIncome = adjustments
    .filter((a): a is Extract<SimulationAdjustment, { type: 'fixed_income' }> => a.type === 'fixed_income')
    .reduce((s, a) => s + a.amount, 0);
  const fixedExpense = adjustments
    .filter((a): a is Extract<SimulationAdjustment, { type: 'fixed_expense' }> => a.type === 'fixed_expense')
    .reduce((s, a) => s + a.amount, 0);
  const saveMonthly = adjustments
    .filter((a): a is Extract<SimulationAdjustment, { type: 'save_monthly' }> => a.type === 'save_monthly')
    .reduce((s, a) => s + a.amount, 0);

  const projected: SimulationMonth[] = [];
  // Saldo awal JUJUR — tidak di-clamp ke 0 (audit 2026-08-09): bila baseline
  // negatif (mis. utang kartu kredit > saldo), proyeksi dimulai dari angka
  // sesungguhnya; meng-clamp diam-diam ke 0 menyembunyikan defisit awal.
  let balance = baseline.balance;
  let savingsAccumulated = 0;

  for (let i = 1; i <= months; i++) {
    const income = round(baseIncome * (1 + incomePct)) + fixedIncome
      + adjustments
        .filter((a): a is Extract<SimulationAdjustment, { type: 'one_time_income' }> => a.type === 'one_time_income')
        .filter((a) => (a.month ?? 1) === i)
        .reduce((s, a) => s + a.amount, 0);

    const expense = round(baseExpense * (1 + expensePct)) + fixedExpense
      + adjustments
        .filter((a): a is Extract<SimulationAdjustment, { type: 'one_time_expense' }> => a.type === 'one_time_expense')
        .filter((a) => (a.month ?? 1) === i)
        .reduce((s, a) => s + a.amount, 0);

    const saving = round(saveMonthly);
    const netCashflow = income - expense;
    balance = balance + netCashflow - saving;
    savingsAccumulated += saving;

    projected.push({
      monthIndex: i,
      label: `${getMonthName(((startMonth - 1 + i - 1) % 12) + 1)} ${startYear + Math.floor((startMonth - 1 + i - 1) / 12)}`,
      income,
      expense,
      netCashflow: round(netCashflow),
      saving,
      balance: round(balance),
      savingsAccumulated: round(savingsAccumulated),
      expenseRatio: income > 0 ? expense / income : 0,
    });
  }

  const finalBalance = projected.length > 0 ? projected[projected.length - 1].balance : balance;
  const avgNetCashflow = projected.reduce((s, m) => s + m.netCashflow, 0) / projected.length;

  // Indikator defisit (angka proyeksi TETAP jujur/negatif — hanya dihitung
  // derived, bukan di-clamp; lihat komentar interface).
  const deficitMonths = projected.filter((m) => m.balance < 0).length;
  const firstDeficitMonth = projected.find((m) => m.balance < 0)?.monthIndex ?? null;

  return {
    baseline,
    adjustments,
    months: projected,
    finalBalance: round(finalBalance),
    totalSaved: round(savingsAccumulated),
    avgNetCashflow: round(avgNetCashflow),
    balanceDelta: round(finalBalance - baseline.balance),
    deficitMonths,
    firstDeficitMonth,
  };
}

/**
 * Hitung "skor dampak" sederhana untuk perbandingan skenario:
 * seberapa baik skenario terhadap baseline (semakin tinggi semakin baik).
 *  - Pertumbuhan saldo (30%)
 *  - Rata-rata net cashflow (40%)
 *  - Tabungan terkumpul (30%)
 * Dinormalisasi relatif terhadap nilai absolut untuk skor 0-100.
 */
export function scenarioImpactScore(result: SimulationResult): number {
  const balanceScore = clamp01(result.balanceDelta / (Math.abs(result.baseline.balance || 1) + 1));
  const cashflowScore = clamp01(result.avgNetCashflow / (Math.abs(result.baseline.monthlyIncome || 1) + 1));
  const savingScore = clamp01(result.totalSaved / (Math.abs(result.baseline.monthlyIncome || 1) * 3 + 1));
  return Math.round(balanceScore * 30 + cashflowScore * 40 + savingScore * 30);
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
