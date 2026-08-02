import type {
  Budget,
  BudgetRecommendation,
  FinancialHealth,
  MonthlyFinancialReport,
  SpendingForecast,
  Transaction,
} from '../types';
import { getMonthName } from '../lib/utils';

interface MonthlyReportInput {
  transactions: Transaction[];
  month: number;
  year: number;
}

interface MonthlyMetrics {
  totalIncome: number;
  totalExpense: number;
  netCashflow: number;
  expenseRatio: number;
  topCategory: { categoryId: string; categoryName: string; total: number } | null;
  topMerchant: { merchant: string; total: number; count: number } | null;
  transactionCount: number;
}

const MIN_RECOMMENDATION_DELTA = 50_000;

function toDate(value: string): Date {
  return new Date(`${value}T00:00:00`);
}

function getMonthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function getTransactionMonthKey(transaction: Transaction): string {
  const date = toDate(transaction.date);
  return getMonthKey(date.getFullYear(), date.getMonth() + 1);
}

function getPreviousMonthKeys(month: number, year: number, count = 3): string[] {
  const keys: string[] = [];
  const cursor = new Date(year, month - 1, 1);

  for (let i = 0; i < count; i++) {
    cursor.setMonth(cursor.getMonth() - 1);
    keys.push(getMonthKey(cursor.getFullYear(), cursor.getMonth() + 1));
  }

  return keys;
}

function roundBudget(value: number): number {
  if (value <= 0) return 0;
  const step = value >= 500_000 ? 50_000 : 10_000;
  return Math.max(step, Math.ceil(value / step) * step);
}

function clampList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .slice(0, 4);
}

function calculateMonthlyMetrics(transactions: Transaction[], month: number, year: number): MonthlyMetrics {
  const monthlyTransactions = transactions.filter((transaction) => {
    const date = toDate(transaction.date);
    return date.getMonth() + 1 === month && date.getFullYear() === year;
  });

  const incomeTransactions = monthlyTransactions.filter((transaction) =>
    transaction.type === 'income' || transaction.type === 'refund'
  );
  const expenseTransactions = monthlyTransactions.filter((transaction) =>
    transaction.type === 'expense' || transaction.type === 'transfer'
  );

  const totalIncome = incomeTransactions.reduce((sum, transaction) => sum + transaction.amount, 0);
  const totalExpense = expenseTransactions.reduce((sum, transaction) => sum + transaction.amount, 0);
  const categoryMap = new Map<string, { categoryId: string; categoryName: string; total: number }>();
  const merchantMap = new Map<string, { merchant: string; total: number; count: number }>();

  expenseTransactions.forEach((transaction) => {
    const categoryKey = transaction.categoryId || transaction.categoryName;
    const currentCategory = categoryMap.get(categoryKey) || {
      categoryId: transaction.categoryId,
      categoryName: transaction.categoryName || 'Lainnya',
      total: 0,
    };
    currentCategory.total += transaction.amount;
    categoryMap.set(categoryKey, currentCategory);

    const merchant = transaction.merchant || 'Tanpa merchant';
    const currentMerchant = merchantMap.get(merchant) || { merchant, total: 0, count: 0 };
    currentMerchant.total += transaction.amount;
    currentMerchant.count += 1;
    merchantMap.set(merchant, currentMerchant);
  });

  return {
    totalIncome,
    totalExpense,
    netCashflow: totalIncome - totalExpense,
    expenseRatio: totalIncome > 0 ? totalExpense / totalIncome : totalExpense > 0 ? 1 : 0,
    topCategory: [...categoryMap.values()].sort((a, b) => b.total - a.total)[0] || null,
    topMerchant: [...merchantMap.values()].sort((a, b) => b.total - a.total)[0] || null,
    transactionCount: monthlyTransactions.length,
  };
}

function getFinancialHealth(metrics: MonthlyMetrics): FinancialHealth {
  if (metrics.totalExpense === 0 && metrics.totalIncome === 0) return 'stabil';
  if (metrics.netCashflow < 0) return 'kritis';
  if (metrics.expenseRatio >= 0.85) return 'waspada';
  if (metrics.expenseRatio >= 0.65) return 'stabil';
  return 'sehat';
}

function buildFallbackMonthlyReport(input: MonthlyReportInput): MonthlyFinancialReport {
  const metrics = calculateMonthlyMetrics(input.transactions, input.month, input.year);
  const health = getFinancialHealth(metrics);
  const monthLabel = `${getMonthName(input.month)} ${input.year}`;
  const topCategoryText = metrics.topCategory
    ? `Pengeluaran terbesar ada di ${metrics.topCategory.categoryName}.`
    : 'Belum ada kategori pengeluaran dominan.';

  const topRisks: string[] = [];
  if (metrics.netCashflow < 0) topRisks.push('Cashflow bulan ini negatif, pengeluaran lebih besar dari pemasukan.');
  if (metrics.expenseRatio >= 0.85) topRisks.push('Rasio pengeluaran sudah tinggi terhadap pemasukan bulan ini.');
  if (metrics.topMerchant && metrics.topMerchant.count >= 3) {
    topRisks.push(`Transaksi berulang di ${metrics.topMerchant.merchant} perlu dicek agar tidak bocor halus.`);
  }
  if (topRisks.length === 0) topRisks.push('Tidak ada risiko besar yang menonjol dari pola bulan ini.');

  const recommendations = [
    metrics.topCategory
      ? `Pasang batas budget khusus untuk ${metrics.topCategory.categoryName} dan review setiap akhir minggu.`
      : 'Mulai kelompokkan transaksi agar insight bulan depan lebih tajam.',
    metrics.expenseRatio > 0.7
      ? 'Prioritaskan pengeluaran wajib, lalu tahan pembelian impulsif sampai cashflow kembali longgar.'
      : 'Pertahankan ritme pengeluaran dan alihkan surplus ke tabungan atau investasi.',
    'Cek transaksi kecil berulang karena biasanya paling mudah lolos dari perhatian.',
  ];

  const positiveNotes = [
    metrics.netCashflow >= 0
      ? 'Cashflow masih positif sehingga ruang kontrol keuangan tetap aman.'
      : 'Masalah utama sudah terlihat jelas, jadi tindakan korektif bisa lebih cepat.',
    topCategoryText,
  ];

  return {
    summary: `Laporan ${monthLabel}: cashflow ${health}, dengan ${metrics.transactionCount} transaksi tercatat. ${topCategoryText}`,
    cashflowHealth: health,
    topRisks,
    recommendations,
    positiveNotes,
    generatedBy: 'rule-based',
    generatedAt: new Date().toISOString(),
  };
}

function normalizeReportPayload(payload: Record<string, unknown>, fallback: MonthlyFinancialReport): MonthlyFinancialReport {
  const health = typeof payload.cashflowHealth === 'string'
    && ['sehat', 'stabil', 'waspada', 'kritis'].includes(payload.cashflowHealth)
    ? payload.cashflowHealth as FinancialHealth
    : fallback.cashflowHealth;

  return {
    summary: typeof payload.summary === 'string' && payload.summary.trim() ? payload.summary : fallback.summary,
    cashflowHealth: health,
    topRisks: clampList(payload.topRisks, fallback.topRisks),
    recommendations: clampList(payload.recommendations, fallback.recommendations),
    positiveNotes: clampList(payload.positiveNotes, fallback.positiveNotes),
    generatedBy: 'gemini',
    generatedAt: new Date().toISOString(),
  };
}

export async function generateMonthlyFinancialReport(input: MonthlyReportInput): Promise<MonthlyFinancialReport> {
  const fallback = buildFallbackMonthlyReport(input);

  try {
    const metrics = calculateMonthlyMetrics(input.transactions, input.month, input.year);
    const response = await fetch('/api/gemini/monthly-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        month: input.month,
        year: input.year,
        metrics,
        sampleTransactions: input.transactions
          .filter((transaction) => {
            const date = toDate(transaction.date);
            return date.getMonth() + 1 === input.month && date.getFullYear() === input.year;
          })
          .slice(0, 30)
          .map((transaction) => ({
            type: transaction.type,
            amount: transaction.amount,
            categoryName: transaction.categoryName,
            merchant: transaction.merchant,
            date: transaction.date,
            source: transaction.source,
          })),
      }),
    });

    if (!response.ok) return fallback;
    const result = await response.json();
    if (!result?.success || !result?.report) return fallback;
    return normalizeReportPayload(result.report, fallback);
  } catch {
    return fallback;
  }
}

export function buildBudgetRecommendations(
  transactions: Transaction[],
  budgets: Budget[],
  month: number,
  year: number
): BudgetRecommendation[] {
  const previousKeys = getPreviousMonthKeys(month, year, 3);
  const monthlyCategoryTotals = new Map<string, Map<string, number>>();
  const categoryNames = new Map<string, string>();

  transactions
    .filter((transaction) => transaction.type === 'expense')
    .filter((transaction) => previousKeys.includes(getTransactionMonthKey(transaction)))
    .forEach((transaction) => {
      const categoryId = transaction.categoryId || transaction.categoryName;
      categoryNames.set(categoryId, transaction.categoryName || 'Lainnya');
      const monthKey = getTransactionMonthKey(transaction);
      const categoryMonths = monthlyCategoryTotals.get(categoryId) || new Map<string, number>();
      categoryMonths.set(monthKey, (categoryMonths.get(monthKey) || 0) + transaction.amount);
      monthlyCategoryTotals.set(categoryId, categoryMonths);
    });

  return [...monthlyCategoryTotals.entries()]
    .map(([categoryId, monthTotals]) => {
      const totals = previousKeys.map((key) => monthTotals.get(key) || 0);
      const average = totals.reduce((sum, value) => sum + value, 0) / previousKeys.length;
      const activeMonths = totals.filter((value) => value > 0).length;
      const existingBudget = budgets.find((budget) =>
        budget.categoryId === categoryId && budget.month === month && budget.year === year
      );
      const suggestedBudget = roundBudget(average * 1.1);
      const currentBudget = existingBudget?.amount || 0;
      const difference = suggestedBudget - currentBudget;
      const deltaRatio = currentBudget > 0 ? Math.abs(difference) / currentBudget : 1;
      const confidence: BudgetRecommendation['confidence'] = activeMonths === 3
        ? 'high'
        : activeMonths === 2
          ? 'medium'
          : 'low';
      const action: BudgetRecommendation['action'] = !existingBudget
        ? 'create'
        : deltaRatio < 0.08
          ? 'keep'
          : difference > 0
            ? 'increase'
            : 'decrease';

      return {
        categoryId,
        categoryName: categoryNames.get(categoryId) || 'Lainnya',
        averageLastThreeMonths: average,
        currentBudget,
        suggestedBudget,
        difference,
        confidence,
        action,
        existingBudgetId: existingBudget?.id,
        reason: activeMonths > 1
          ? `Rata-rata 3 bulan terakhir menunjukkan pola konsisten di kategori ini.`
          : `Data kategori ini masih terbatas, gunakan sebagai baseline awal dan review minggu depan.`,
      };
    })
    .filter((recommendation) =>
      recommendation.suggestedBudget > 0
      && (recommendation.action !== 'keep' || Math.abs(recommendation.difference) >= MIN_RECOMMENDATION_DELTA)
    )
    .sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference))
    .slice(0, 5);
}

export function buildSpendingForecast(
  transactions: Transaction[],
  month: number,
  year: number
): SpendingForecast {
  const now = new Date();
  const daysInMonth = new Date(year, month, 0).getDate();
  const isCurrentMonth = now.getFullYear() === year && now.getMonth() + 1 === month;
  const elapsedDays = isCurrentMonth ? Math.min(now.getDate(), daysInMonth) : daysInMonth;
  const remainingDays = Math.max(daysInMonth - elapsedDays, 0);
  const currentMonthKey = getMonthKey(year, month);
  const previousMonthKey = getPreviousMonthKeys(month, year, 1)[0];

  const currentExpense = transactions
    .filter((transaction) => transaction.type === 'expense' && getTransactionMonthKey(transaction) === currentMonthKey)
    .reduce((sum, transaction) => sum + transaction.amount, 0);
  const previousExpense = transactions
    .filter((transaction) => transaction.type === 'expense' && getTransactionMonthKey(transaction) === previousMonthKey)
    .reduce((sum, transaction) => sum + transaction.amount, 0);

  const averageDailyExpense = elapsedDays > 0 ? currentExpense / elapsedDays : 0;
  const projectedExpense = Math.round(averageDailyExpense * daysInMonth);
  const trendPercentage = previousExpense > 0
    ? ((projectedExpense - previousExpense) / previousExpense) * 100
    : projectedExpense > 0 ? 100 : 0;
  const status: SpendingForecast['status'] = trendPercentage >= 25
    ? 'high-risk'
    : trendPercentage >= 10
      ? 'watch'
      : 'under-control';

  return {
    month,
    year,
    currentExpense,
    projectedExpense,
    averageDailyExpense,
    remainingDays,
    trendPercentage,
    status,
    narrative: status === 'high-risk'
      ? 'Forecast menunjukkan pengeluaran akhir bulan berpotensi naik tajam. Kurangi transaksi non-esensial mulai sekarang.'
      : status === 'watch'
        ? 'Pengeluaran masih perlu diawasi karena proyeksi mulai lebih tinggi dari bulan sebelumnya.'
        : 'Pengeluaran terlihat terkendali terhadap pola bulan sebelumnya.',
  };
}
