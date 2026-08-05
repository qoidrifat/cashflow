/**
 * Financial Advisor Service (Sprint 1.3 — AI Personal Financial Coach).
 *
 * 1. computeAdvisorMetrics — ringkas data app (transactions/budgets/subscriptions/
 *    wallets/goals) menjadi metrics terstruktur (tanpa PII mentah) untuk prompt AI.
 * 2. buildFallbackAdvisorReport — laporan coaching DETERMINISTIK (rule-based)
 *    agar halaman selalu render walau AI tidak tersedia/gagal.
 * 3. generateAdvisorReport — panggil POST /api/gemini/advisor, normalisasi hasil
 *    AI dengan fallback bila payload tak valid (pola monthly report).
 */
import type {
  AdvisorMetricsInput,
  AdvisorReport,
  AdvisorActionItem,
  Budget,
  SavingGoal,
  Subscription,
  Transaction,
  WalletAccount,
} from '../types';
import { getMonthName } from '../lib/utils';

export interface AdvisorInput {
  transactions: Transaction[];
  budgets: Budget[];
  subscriptions: Subscription[];
  wallets: WalletAccount[];
  goals: SavingGoal[];
  month: number;
  year: number;
}

function toDate(value: string): Date {
  return new Date(`${value}T00:00:00`);
}

function getMonthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function getTxMonthKey(tx: Transaction): string {
  const d = toDate(tx.date);
  return getMonthKey(d.getFullYear(), d.getMonth() + 1);
}

function previousMonthKeys(month: number, year: number, count: number): string[] {
  const keys: string[] = [];
  const cursor = new Date(year, month - 1, 1);
  for (let i = 0; i < count; i++) {
    cursor.setMonth(cursor.getMonth() - 1);
    keys.push(getMonthKey(cursor.getFullYear(), cursor.getMonth() + 1));
  }
  return keys;
}

const round = (v: number): number => Math.round(v * 100) / 100;
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const formatRupiah = (v: number): string => `Rp ${Math.round(v).toLocaleString('id-ID')}`;

/** Konversi cycle langganan → biaya bulanan (approximasi). */
function monthlyCost(sub: Subscription): number {
  const amount = Number(sub.amount) || 0;
  switch (sub.cycle) {
    case 'weekly': return round(amount * 4.33);
    case 'quarterly': return round(amount / 3);
    case 'yearly': return round(amount / 12);
    default: return amount;
  }
}

/**
 * Ringkas seluruh data aplikasi menjadi metrics untuk AI coach.
 * Deterministik — tidak ada nilai acak; semua angka dibulatkan aman.
 */
export function computeAdvisorMetrics(input: AdvisorInput): AdvisorMetricsInput {
  const { transactions, budgets, subscriptions, wallets, goals, month, year } = input;
  const currentKey = getMonthKey(year, month);
  const last3 = previousMonthKeys(month, year, 3);

  const current = transactions.filter((t) => getTxMonthKey(t) === currentKey);
  const currentIncome = current
    .filter((t) => t.type === 'income' || t.type === 'refund')
    .reduce((s, t) => s + t.amount, 0);
  const currentExpense = current
    .filter((t) => t.type === 'expense' || t.type === 'transfer')
    .reduce((s, t) => s + t.amount, 0);

  let sumIncome3m = 0;
  let sumExpense3m = 0;
  for (const key of last3) {
    const monthTx = transactions.filter((t) => getTxMonthKey(t) === key);
    sumIncome3m += monthTx
      .filter((t) => t.type === 'income' || t.type === 'refund')
      .reduce((s, t) => s + t.amount, 0);
    sumExpense3m += monthTx
      .filter((t) => t.type === 'expense' || t.type === 'transfer')
      .reduce((s, t) => s + t.amount, 0);
  }

  const expenseTx = current.filter((t) => t.type === 'expense');
  const categoryMap = new Map<string, { categoryId: string; categoryName: string; total: number }>();
  const merchantMap = new Map<string, { merchant: string; total: number; count: number }>();
  expenseTx.forEach((t) => {
    const ck = t.categoryId || t.categoryName;
    const c = categoryMap.get(ck) || { categoryId: t.categoryId, categoryName: t.categoryName || 'Lainnya', total: 0 };
    c.total += t.amount;
    categoryMap.set(ck, c);
    const m = t.merchant || 'Tanpa merchant';
    const mm = merchantMap.get(m) || { merchant: m, total: 0, count: 0 };
    mm.total += t.amount;
    mm.count += 1;
    merchantMap.set(m, mm);
  });

  const budgetUsage = budgets
    .filter((b) => b.month === month && b.year === year)
    .map((b) => {
      const used = expenseTx
        .filter((t) => t.categoryId === b.categoryId)
        .reduce((s, t) => s + t.amount, 0);
      return {
        categoryId: b.categoryId,
        categoryName: b.categoryName,
        amount: round(b.amount),
        usedAmount: round(used),
        usage: b.amount > 0 ? round(Math.min(2, used / b.amount)) : 0,
      };
    });

  const totalBalance = wallets.reduce((s, w) => s + (Number(w.balance) || 0), 0);
  const expenseRatio = currentIncome > 0 ? round(currentExpense / currentIncome) : (currentExpense > 0 ? 1 : 0);
  const savingsRate = currentIncome > 0 ? clamp01(round((currentIncome - currentExpense) / currentIncome)) : 0;

  return {
    month,
    year,
    currentMonthIncome: round(currentIncome),
    currentMonthExpense: round(currentExpense),
    avgMonthlyIncome3m: round(sumIncome3m / 3),
    avgMonthlyExpense3m: round(sumExpense3m / 3),
    expenseRatio,
    savingsRate,
    totalBalance: round(totalBalance),
    transactionCount: current.length,
    topCategory: [...categoryMap.values()].sort((a, b) => b.total - a.total)[0] || null,
    topMerchant: [...merchantMap.values()].sort((a, b) => b.total - a.total)[0] || null,
    budgetUsage: budgetUsage.sort((a, b) => b.usage - a.usage),
    subscriptions: subscriptions.map((s) => ({ name: s.name, monthlyCost: monthlyCost(s), cycle: s.cycle })),
    goals: {
      totalTarget: round(goals.reduce((s, g) => s + (Number(g.targetAmount) || 0), 0)),
      totalCurrent: round(goals.reduce((s, g) => s + (Number(g.currentAmount) || 0), 0)),
    },
    forecastProjectedExpense: round(currentExpense),
  };
}

/** Target dana darurat: 6× rata-rata pengeluaran bulanan (min 1 bulan agar > 0). */
function emergencyFundTarget(avgMonthlyExpense: number): number {
  return Math.max(round(avgMonthlyExpense * 6), round(avgMonthlyExpense) > 0 ? round(avgMonthlyExpense) : 0);
}

/** Fallback deterministik (rule-based) — dipakai saat AI tak tersedia/gagal. */
export function buildFallbackAdvisorReport(metrics: AdvisorMetricsInput): AdvisorReport {
  const monthLabel = `${getMonthName(metrics.month)} ${metrics.year}`;
  const target = emergencyFundTarget(metrics.avgMonthlyExpense3m);
  const monthsCoverage = metrics.avgMonthlyExpense3m > 0
    ? round(Math.min(99, metrics.totalBalance / metrics.avgMonthlyExpense3m))
    : 0;
  const surplus = metrics.currentMonthIncome - metrics.currentMonthExpense;
  const totalSubMonthly = metrics.subscriptions.reduce((s, sub) => s + sub.monthlyCost, 0);

  // ── summary
  const summary = `Laporan ${monthLabel}: pemasukan ${formatRupiah(metrics.currentMonthIncome)} dan pengeluaran ${formatRupiah(metrics.currentMonthExpense)} (rasio ${Math.round(metrics.expenseRatio * 100)}%). ${metrics.expenseRatio >= 0.85 ? 'Fokus utama: kendalikan pengeluaran sebelum cashflow negatif.' : metrics.savingsRate >= 0.2 ? 'Cashflow sehat — saatnya menambah tabungan dan investasi.' : 'Ruang perbaikan masih terbuka di sisi tabungan.'}`;

  // ── spending advice
  const spendingAdvice: string[] = [];
  if (metrics.expenseRatio >= 0.85) {
    spendingAdvice.push(`Pengeluaran sudah ${Math.round(metrics.expenseRatio * 100)}% dari pemasukan — tahan pembelian non-esensial sampai rasio di bawah 80%.`);
  }
  if (metrics.topMerchant && metrics.topMerchant.count >= 3) {
    spendingAdvice.push(`Transaksi berulang di ${metrics.topMerchant.merchant} (${metrics.topMerchant.count}× bulan ini) — audit apakah bisa diganti/dihemat.`);
  }
  if (spendingAdvice.length === 0) {
    spendingAdvice.push('Pola pengeluaran terkendali — pertahankan dan tetap catat setiap transaksi.');
  }

  // ── saving strategy
  const savingStrategy: string[] = [];
  if (metrics.savingsRate >= 0.3) {
    savingStrategy.push(`Surplus ${formatRupiah(surplus)} — aktifkan auto-transfer minimal 20% ke tabungan terpisah di hari gajian.`);
  } else if (metrics.savingsRate >= 0.1) {
    savingStrategy.push(`Sisihkan minimal 10% dari pemasukan setiap bulan sebelum pengeluaran lain (pay yourself first).`);
  } else {
    savingStrategy.push('Belum ada surplus bulan ini — kurangi pengeluaran dulu, lalu bangun tabungan secara bertahap.');
  }
  if (metrics.goals.totalTarget > 0 && metrics.goals.totalCurrent < metrics.goals.totalTarget) {
    savingStrategy.push(`Progress goal ${Math.round((metrics.goals.totalCurrent / metrics.goals.totalTarget) * 100)}% — jaga konsistensi agar target tercapai tepat waktu.`);
  }

  // ── budget strategy
  const budgetStrategy: string[] = [];
  const overBudget = metrics.budgetUsage.filter((b) => b.usage >= 0.8);
  overBudget.forEach((b) => {
    budgetStrategy.push(`Budget ${b.categoryName} sudah terpakai ${Math.round(b.usage * 100)}% — review sisa bulan sebelum melebihi batas.`);
  });
  if (metrics.topCategory && !metrics.budgetUsage.some((b) => b.categoryId === metrics.topCategory?.categoryId)) {
    budgetStrategy.push(`Pasang budget untuk kategori terbesar (${metrics.topCategory.categoryName}) agar pengeluarannya terkontrol.`);
  }
  if (budgetStrategy.length === 0) {
    budgetStrategy.push('Budget aktif terlihat sehat — review bulanan tetap disarankan.');
  }

  // ── emergency fund
  let emergencySuggestion: string;
  if (monthsCoverage >= 6) {
    emergencySuggestion = `Dana darurat sudah aman (${monthsCoverage} bulan pengeluaran) — alihkan surplus ke investasi atau goal jangka panjang.`;
  } else if (monthsCoverage >= 3) {
    emergencySuggestion = `Dana darurat cukup baik (${monthsCoverage} bulan) — lanjutkan sampai target 6 bulan (${formatRupiah(target)}).`;
  } else if (monthsCoverage > 0) {
    emergencySuggestion = `Dana darurat baru ${monthsCoverage} bulan pengeluaran — target minimal 3–6 bulan (${formatRupiah(target)}). Prioritaskan ini sebelum investasi.`;
  } else {
    emergencySuggestion = `Saldo terkumpul ${formatRupiah(metrics.totalBalance)} — bangun dana darurat 3–6 bulan pengeluaran (target ${formatRupiah(target)}).`;
  }

  // ── subscription optimization
  const subscriptionOptimization: string[] = [];
  if (metrics.subscriptions.length > 0) {
    const topSubs = [...metrics.subscriptions].sort((a, b) => b.monthlyCost - a.monthlyCost).slice(0, 3);
    if (metrics.currentMonthIncome > 0 && totalSubMonthly / metrics.currentMonthIncome >= 0.2) {
      subscriptionOptimization.push(`Total langganan ${formatRupiah(totalSubMonthly)}/bulan (${Math.round((totalSubMonthly / metrics.currentMonthIncome) * 100)}% pemasukan) — sudah tinggi; audit kebutuhan tiap layanan.`);
    }
    topSubs.forEach((sub) => {
      subscriptionOptimization.push(`${sub.name} (±${formatRupiah(sub.monthlyCost)}/bulan) — cek pemakaian nyata; pertimbangkan paket tahunan bila rutin dipakai.`);
    });
  } else {
    subscriptionOptimization.push('Belum ada langganan terdeteksi — pantau transaksi bulanan berulang untuk menemukan langganan tersembunyi.');
  }

  // ── action list (dari sinyal di atas, prioritas high dulu)
  const actionList: AdvisorActionItem[] = [];
  if (metrics.expenseRatio >= 0.85) {
    actionList.push({ priority: 'high', action: 'Kendalikan pengeluaran di atas 85% pemasukan bulan ini.' });
  }
  if (monthsCoverage < 3) {
    actionList.push({ priority: 'high', action: `Bangun dana darurat menuju ${formatRupiah(target)} (3–6 bulan pengeluaran).` });
  }
  overBudget.slice(0, 2).forEach((b) => {
    actionList.push({ priority: 'medium', action: `Review budget ${b.categoryName} yang sudah terpakai ${Math.round(b.usage * 100)}%.` });
  });
  if (metrics.topMerchant && metrics.topMerchant.count >= 3) {
    actionList.push({ priority: 'medium', action: `Audit transaksi berulang di ${metrics.topMerchant.merchant}.` });
  }
  if (metrics.savingsRate >= 0.1) {
    actionList.push({ priority: 'low', action: 'Aktifkan auto-transfer surplus bulanan ke tabungan.' });
  }
  if (actionList.length < 3) {
    actionList.push({ priority: 'low', action: 'Catat semua transaksi secara konsisten agar coaching makin akurat.' });
  }

  return {
    summary,
    spendingAdvice: spendingAdvice.slice(0, 3),
    savingStrategy: savingStrategy.slice(0, 3),
    budgetStrategy: budgetStrategy.slice(0, 3),
    emergencyFund: {
      suggestion: emergencySuggestion,
      monthsCoverage,
      targetAmount: target,
      currentAmount: metrics.totalBalance,
    },
    subscriptionOptimization: subscriptionOptimization.slice(0, 3),
    actionList: actionList.slice(0, 5),
    generatedBy: 'rule-based',
    generatedAt: new Date().toISOString(),
  };
}

function clampStrings(value: unknown, fallback: string[], max: number): string[] {
  if (!Array.isArray(value)) return fallback;
  const items = value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((s) => s.trim())
    .slice(0, max);
  return items.length > 0 ? items : fallback;
}

function clampNumber(value: unknown, fallback: number): number {
  const num = Number(value);
  return Number.isFinite(num) ? Math.max(0, Math.round(num * 100) / 100) : fallback;
}

/** Normalisasi payload AI → AdvisorReport aman (fallback bila field tak valid). */
export function normalizeAdvisorReport(payload: Record<string, unknown>, fallback: AdvisorReport): AdvisorReport {
  const rawActions = Array.isArray(payload.actionList) ? payload.actionList : [];
  const actionList: AdvisorActionItem[] = rawActions
    .filter((a): a is Record<string, unknown> => Boolean(a) && typeof a === 'object')
    .map((a) => ({
      priority: ['high', 'medium', 'low'].includes(String(a.priority)) ? String(a.priority) as AdvisorActionItem['priority'] : 'medium',
      action: typeof a.action === 'string' && a.action.trim() ? a.action.trim().slice(0, 240) : '',
    }))
    .filter((a) => a.action.length > 0)
    .slice(0, 5);
  const efRaw = (payload.emergencyFund && typeof payload.emergencyFund === 'object') ? payload.emergencyFund as Record<string, unknown> : {};

  return {
    summary: typeof payload.summary === 'string' && payload.summary.trim() ? payload.summary.trim() : fallback.summary,
    spendingAdvice: clampStrings(payload.spendingAdvice, fallback.spendingAdvice, 3),
    savingStrategy: clampStrings(payload.savingStrategy, fallback.savingStrategy, 3),
    budgetStrategy: clampStrings(payload.budgetStrategy, fallback.budgetStrategy, 3),
    emergencyFund: {
      suggestion: typeof efRaw.suggestion === 'string' && efRaw.suggestion.trim() ? efRaw.suggestion.trim() : fallback.emergencyFund.suggestion,
      monthsCoverage: clampNumber(efRaw.monthsCoverage, fallback.emergencyFund.monthsCoverage),
      targetAmount: clampNumber(efRaw.targetAmount, fallback.emergencyFund.targetAmount),
      currentAmount: clampNumber(efRaw.currentAmount, fallback.emergencyFund.currentAmount),
    },
    subscriptionOptimization: clampStrings(payload.subscriptionOptimization, fallback.subscriptionOptimization, 3),
    actionList: actionList.length > 0 ? actionList : fallback.actionList,
    generatedBy: 'gemini',
    generatedAt: new Date().toISOString(),
  };
}

/** Generate laporan coach: AI via /api/gemini/advisor, fallback deterministik bila gagal. */
export async function generateAdvisorReport(input: AdvisorInput): Promise<AdvisorReport> {
  const metrics = computeAdvisorMetrics(input);
  const fallback = buildFallbackAdvisorReport(metrics);

  try {
    const response = await fetch('/api/gemini/advisor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ metrics, subscriptions: metrics.subscriptions }),
    });
    if (!response.ok) return fallback;
    const result = await response.json();
    if (!result?.success || !result?.report) return fallback;
    return normalizeAdvisorReport(result.report, fallback);
  } catch {
    return fallback;
  }
}
