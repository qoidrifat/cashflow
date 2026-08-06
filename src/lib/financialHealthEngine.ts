/**
 * Personal Financial Health Engine (Sprint 1.5 — Phase 6).
 *
 * Bukan sekadar satu angka: 8 komponen terukur, masing-masing dengan reason,
 * recommendation, dan trend. Total 0-100 dengan kategori:
 *   Excellent (≥85) · Good (≥70) · Average (≥55) · Poor (≥40) · Critical (<40)
 *
 * DETERMINISTIK MURNI — tidak memakai AI. Semua aturan berbasis angka &
 * threshold yang dapat diverifikasi (unit-testable).
 */
import { interpretConfidence } from './explainability';

export type HealthCategory = 'Excellent' | 'Good' | 'Average' | 'Poor' | 'Critical';
export type Trend = 'up' | 'down' | 'flat' | 'none';

export interface HealthSubscore {
  key: string;
  label: string;
  score: number; // 0-100
  reason: string;
  recommendation: string;
  trend: Trend;
}

export interface HealthResult {
  score: number;
  category: HealthCategory;
  /** Interpretasi confidence-style (score/100 → label). */
  interpretation: { label: string; percent: number; bucket: 'very_high' | 'high' | 'medium' | 'low' } | null;
  subscores: HealthSubscore[];
  /** Alasan & rekomendasi utama (dari subscore terendah). */
  summary: string;
}

/** Input kondisi keuangan user (bisa dari computeAdvisorMetrics atau manual). */
export interface FinancialHealthInput {
  monthlyIncome: number;
  monthlyExpense: number;
  /** Untuk Income Stability — rata-rata pemasukan 3 bulan terakhir. */
  avgMonthlyIncome3m?: number;
  /** Untuk Emergency Fund — rata-rata pengeluaran 3 bulan terakhir. */
  avgMonthlyExpense3m?: number;
  /** Saldo total semua wallet (Rp). */
  balance: number;
  /** Optional override (default dihitung dari monthlyIncome/Expense). */
  savingsRate?: number;
  expenseRatio?: number;
  /** Rasio pemakaian tiap budget (0-2+, 1 = 100%). */
  budgetUsage?: number[];
  /** Total utang (mis. saldo kartu kredit negatif / pinjaman). */
  debtTotal?: number;
  subscriptionsMonthly?: number;
  /** Jumlah transaksi merchant teratas bulan ini (untuk Expense Discipline). */
  topMerchantCount?: number;
  transactionCount?: number;
}

const clamp = (v: number): number => Math.max(0, Math.min(100, Math.round(v)));

/**
 * Komponen 1 — Saving Score (30% dari total).
 * savingsRate ≥ 30% → 100; 20% → 85; 10% → 60; ≤ 0 → 25.
 */
function savingScore(input: FinancialHealthInput): HealthSubscore {
  const rate = input.savingsRate ?? (input.monthlyIncome > 0
    ? (input.monthlyIncome - input.monthlyExpense) / input.monthlyIncome
    : 0);
  let score = 25;
  if (rate >= 0.3) score = 100;
  else if (rate >= 0.2) score = 85;
  else if (rate >= 0.1) score = 60;
  else if (rate > 0) score = 40;
  const pct = Math.round(rate * 100);
  return {
    key: 'saving', label: 'Tabungan', score,
    reason: rate > 0
      ? `Tingkat tabungan ${pct}% dari pemasukan${rate >= 0.2 ? ' — pola sehat.' : ' — masih bisa ditingkatkan.'}`
      : 'Belum ada surplus — pengeluaran menyentuh seluruh pemasukan.',
    recommendation: rate >= 0.2
      ? 'Pertahankan; alihkan sebagian surplus ke investasi atau goal.'
      : 'Terapkan "pay yourself first": sisihkan minimal 10% sebelum pengeluaran lain.',
    trend: rate >= 0.3 ? 'up' : rate >= 0.1 ? 'flat' : 'down',
  };
}

/**
 * Komponen 2 — Cash Flow Score (20%).
 * Rasio pengeluaran terhadap pemasukan.
 */
function cashflowScore(input: FinancialHealthInput): HealthSubscore {
  const ratio = input.expenseRatio ?? (input.monthlyIncome > 0
    ? input.monthlyExpense / input.monthlyIncome
    : input.monthlyExpense > 0 ? 1 : 0);
  let score = 100;
  if (ratio > 1) score = 20;
  else if (ratio >= 0.85) score = 45;
  else if (ratio >= 0.65) score = 70;
  else if (ratio >= 0.5) score = 88;
  const pct = Math.round(ratio * 100);
  return {
    key: 'cashflow', label: 'Cash Flow', score,
    reason: ratio > 1
      ? 'Pengeluaran MELEBIHI pemasukan bulan ini — cashflow negatif.'
      : `Rasio pengeluaran ${pct}% dari pemasukan${ratio >= 0.85 ? ' (mendekati batas berbahaya).' : '.'}`,
    recommendation: ratio >= 0.85
      ? 'Tahan pengeluaran non-esensial sampai rasio di bawah 65-80%.'
      : 'Cashflow sehat — pertahankan ritme pencatatan.',
    trend: ratio >= 0.85 ? 'down' : ratio <= 0.65 ? 'up' : 'flat',
  };
}

/**
 * Komponen 3 — Budget Score (10%).
 * Rata-rata pemakaian budget; 1.0 = 100% terpakai (sehat = di bawah 0.8).
 */
function budgetScore(input: FinancialHealthInput): HealthSubscore {
  const usage = input.budgetUsage ?? [];
  if (usage.length === 0) {
    return {
      key: 'budget', label: 'Budget', score: 60,
      reason: 'Belum ada budget aktif — sulit mengukur disiplin per kategori.',
      recommendation: 'Pasang budget untuk kategori pengeluaran terbesar.',
      trend: 'none',
    };
  }
  const avg = usage.reduce((s, u) => s + u, 0) / usage.length;
  let score = 90;
  if (avg >= 1) score = 30;
  else if (avg >= 0.85) score = 55;
  else if (avg >= 0.65) score = 75;
  const pct = Math.round(avg * 100);
  return {
    key: 'budget', label: 'Budget', score,
    reason: `Rata-rata budget terpakai ${pct}%${avg >= 0.85 ? ' — beberapa mendekati/melampaui batas.' : ' — terkendali.'}`,
    recommendation: avg >= 0.85
      ? 'Review kategori yang melewati 85% dan sesuaikan alokasi.'
      : 'Budget aktif terlihat sehat; review bulanan tetap disarankan.',
    trend: avg >= 0.85 ? 'down' : 'flat',
  };
}

/**
 * Komponen 4 — Debt Score (10%).
 * Utang vs pemasukan bulanan: rasio ≤ 0.2 sehat.
 */
function debtScore(input: FinancialHealthInput): HealthSubscore {
  const debt = Math.max(0, input.debtTotal ?? 0);
  if (debt === 0) {
    return {
      key: 'debt', label: 'Utang', score: 100,
      reason: 'Tidak ada utang tercatat (wallet kredit/negatif kosong).',
      recommendation: 'Pertahankan; hindari utang konsumtif baru.',
      trend: 'none',
    };
  }
  const ratio = input.monthlyIncome > 0 ? debt / input.monthlyIncome : 2;
  let score = 85;
  if (ratio >= 2) score = 20;
  else if (ratio >= 1) score = 45;
  else if (ratio >= 0.5) score = 65;
  const pct = Math.round(ratio * 100);
  return {
    key: 'debt', label: 'Utang', score,
    reason: `Total utang ${debt.toLocaleString('id-ID')} — ${pct}% dari pemasukan bulanan${ratio >= 1 ? ' (beban tinggi).' : '.'}`,
    recommendation: ratio >= 1
      ? 'Prioritaskan pelunasan utang berbunga tinggi sebelum menambah tabungan.'
      : 'Lunasi utang secara bertahap; jangan tambah beban baru.',
    trend: ratio >= 1 ? 'down' : 'flat',
  };
}

/**
 * Komponen 5 — Emergency Fund Score (10%).
 * Coverage bulan = saldo / pengeluaran bulanan; target 6 bulan.
 */
function emergencyFundScore(input: FinancialHealthInput): HealthSubscore {
  const avgExpense = input.avgMonthlyExpense3m ?? input.monthlyExpense;
  if (avgExpense <= 0) {
    return {
      key: 'emergency', label: 'Dana Darurat', score: 50,
      reason: 'Belum ada data pengeluaran untuk menilai dana darurat.',
      recommendation: 'Catat transaksi rutin agar target dana darurat bisa dihitung.',
      trend: 'none',
    };
  }
  const coverage = input.balance / avgExpense;
  let score = 20;
  if (coverage >= 6) score = 100;
  else if (coverage >= 3) score = 80;
  else if (coverage >= 1) score = 55;
  else if (coverage > 0) score = 35;
  return {
    key: 'emergency', label: 'Dana Darurat', score,
    reason: `Saldo ${input.balance.toLocaleString('id-ID')} setara ${coverage.toFixed(1)} bulan pengeluaran (target 6 bulan).`,
    recommendation: coverage >= 6
      ? 'Dana darurat aman — alihkan surplus ke investasi/goal.'
      : 'Bangun dana darurat bertahap hingga 3-6 bulan pengeluaran.',
    trend: coverage >= 3 ? 'up' : 'down',
  };
}

/**
 * Komponen 6 — Income Stability (10%).
 * Pemasukan bulan ini vs rata-rata 3 bulan: deviasi ≤ 10% stabil.
 */
function incomeStabilityScore(input: FinancialHealthInput): HealthSubscore {
  const avg = input.avgMonthlyIncome3m;
  if (avg === undefined || avg <= 0) {
    return {
      key: 'income_stability', label: 'Stabilitas Pemasukan', score: 60,
      reason: 'Data pemasukan 3 bulan belum lengkap.',
      recommendation: 'Data akan makin akurat seiring riwayat transaksi bertambah.',
      trend: 'none',
    };
  }
  const dev = Math.abs(input.monthlyIncome - avg) / avg;
  let score = 90;
  if (dev >= 0.5) score = 30;
  else if (dev >= 0.25) score = 55;
  else if (dev >= 0.1) score = 75;
  const pct = Math.round(dev * 100);
  return {
    key: 'income_stability', label: 'Stabilitas Pemasukan', score,
    reason: dev <= 0.1
      ? 'Pemasukan konsisten dengan rata-rata 3 bulan (deviasi < 10%).'
      : `Pemasukan berfluktuasi ${pct}% dari rata-rata 3 bulan.`,
    recommendation: dev > 0.25
      ? 'Pertimbangkan dana penyangga untuk bulan dengan pemasukan tidak menentu.'
      : 'Stabilitas baik — cocok untuk komitmen tabungan otomatis.',
    trend: dev <= 0.1 ? 'up' : 'down',
  };
}

/**
 * Komponen 7 — Expense Discipline (5%).
 * Disiplin: ketergantungan merchant tunggal & banyaknya transaksi.
 */
function expenseDisciplineScore(input: FinancialHealthInput): HealthSubscore {
  const merchantCount = input.topMerchantCount ?? 0;
  let score = 85;
  if (merchantCount >= 8) score = 30;
  else if (merchantCount >= 5) score = 55;
  else if (merchantCount >= 3) score = 70;
  return {
    key: 'expense_discipline', label: 'Disiplin Pengeluaran', score,
    reason: merchantCount >= 5
      ? `Ketergantungan tinggi ke satu merchant (${merchantCount}× bulan ini).`
      : merchantCount >= 3
        ? `Transaksi berulang ke merchant yang sama (${merchantCount}×) — awasi.`
        : 'Pola pengeluaran tersebar sehat tanpa dominasi satu merchant.',
    recommendation: merchantCount >= 3
      ? 'Audit transaksi berulang (langganan tersembunyi, promo berulang).'
      : 'Pertahankan variasi merchant dan tetap catat transaksi kecil.',
    trend: merchantCount >= 5 ? 'down' : 'flat',
  };
}

/**
 * Komponen 8 — Financial Growth (5%).
 * Proyeksi pertumbuhan dari surplus bulanan & langganan.
 */
function growthScore(input: FinancialHealthInput): HealthSubscore {
  const surplus = input.monthlyIncome - input.monthlyExpense;
  const subs = input.subscriptionsMonthly ?? 0;
  const growthRate = input.monthlyIncome > 0 ? surplus / input.monthlyIncome : 0;
  let score = 50;
  if (growthRate >= 0.3) score = 100;
  else if (growthRate >= 0.15) score = 80;
  else if (growthRate >= 0) score = 60;
  else if (growthRate > -0.1) score = 40;
  const subPct = input.monthlyIncome > 0 ? Math.round((subs / input.monthlyIncome) * 100) : 0;
  return {
    key: 'growth', label: 'Pertumbuhan', score,
    reason: surplus > 0
      ? `Surplus bulanan ${surplus.toLocaleString('id-ID')} (${Math.round(growthRate * 100)}% pemasukan)${subs > 0 ? `; langganan ${subPct}%` : ''}.`
      : 'Belum ada surplus — pertumbuhan menunggu perbaikan cashflow.',
    recommendation: growthRate > 0
      ? 'Arahkan surplus ke tabungan/goal untuk pertumbuhan majemuk.'
      : 'Kecilkan pengeluaran tetap sebelum mengharapkan pertumbuhan.',
    trend: growthRate > 0 ? 'up' : 'down',
  };
}

const WEIGHTS: Record<string, number> = {
  saving: 0.3, cashflow: 0.2, budget: 0.1, debt: 0.1,
  emergency: 0.1, income_stability: 0.1, expense_discipline: 0.05, growth: 0.05,
};

export function categoryForScore(score: number): HealthCategory {
  if (score >= 85) return 'Excellent';
  if (score >= 70) return 'Good';
  if (score >= 55) return 'Average';
  if (score >= 40) return 'Poor';
  return 'Critical';
}

export function financialHealthCategoryLabel(cat: HealthCategory): string {
  const map: Record<HealthCategory, string> = {
    Excellent: 'Sangat baik', Good: 'Baik', Average: 'Cukup', Poor: 'Perlu perhatian', Critical: 'Kritis',
  };
  return map[cat];
}

/**
 * Hitung skor kesehatan finansial 0-100 dari 8 komponen.
 * Pure & deterministik — aman di-import di mana saja (frontend & test).
 */
export function computeFinancialHealth(input: FinancialHealthInput): HealthResult {
  const subscores: HealthSubscore[] = [
    savingScore(input),
    cashflowScore(input),
    budgetScore(input),
    debtScore(input),
    emergencyFundScore(input),
    incomeStabilityScore(input),
    expenseDisciplineScore(input),
    growthScore(input),
  ];

  const score = clamp(subscores.reduce((sum, s) => sum + s.score * (WEIGHTS[s.key] ?? 0), 0));
  const category = categoryForScore(score);
  const interpretation = interpretConfidence(score / 100);

  const worst = [...subscores].sort((a, b) => a.score - b.score)[0];
  const summary = `Skor kesehatan ${score} (${category}). Fokus perbaikan: ${worst.label} — ${worst.recommendation}`;

  return { score, category, interpretation, subscores, summary };
}
