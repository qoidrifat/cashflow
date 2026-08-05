import { useEffect, useState, useMemo } from 'react';
import {
  BarChart3,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Download,
  AlertTriangle,
  PiggyBank,
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  PieChart as RePieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';
import { useAuthStore } from '../../store/useAuthStore';
import { getAllTransactions, calculateBalance } from '../../services/transactionService';
import { buildSpendingForecast, generateMonthlyFinancialReport } from '../../services/aiInsightService';
import { exportMonthlyReportPdf } from '../../services/pdfExportService';
import Header from '../../components/layout/Header';
import Card from '../../components/ui/Card';
import { ChartSkeleton } from '../../components/ui/Skeleton';
import EmptyState from '../../components/ui/EmptyState';
import type { Transaction } from '../../types';
import type { MonthlyFinancialReport } from '../../types';
import {
  formatCurrency,
  getCurrentMonth,
  getCurrentYear,
  getMonthName,
  cn,
} from '../../lib/utils';
import { EXPENSE_CATEGORIES } from '../../config/constants';
import CategoryIcon from '../../components/ui/CategoryIcon';

type Period = 'daily' | 'weekly' | 'monthly' | 'yearly';

export default function ReportsPage() {
  const { authUser } = useAuthStore();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [aiReport, setAiReport] = useState<MonthlyFinancialReport | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [period, setPeriod] = useState<Period>('monthly');



  useEffect(() => {
    if (!authUser) return;

    let cancelled = false;
    setLoading(true);

    getAllTransactions(authUser.uid)
      .then((data) => {
        if (cancelled) return;
        setTransactions(data);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [authUser]);

  const forecast = useMemo(
    () => buildSpendingForecast(transactions, getCurrentMonth(), getCurrentYear()),
    [transactions]
  );

  const refreshAiReport = async () => {
    if (transactions.length === 0) {
      setAiReport(null);
      return;
    }

    setAiLoading(true);
    const report = await generateMonthlyFinancialReport({
      transactions,
      month: getCurrentMonth(),
      year: getCurrentYear(),
    });
    setAiReport(report);
    setAiLoading(false);
  };

  const handleExportPdf = () => {
    exportMonthlyReportPdf({
      month: getCurrentMonth(),
      year: getCurrentYear(),
      transactions,
    });
  };

  useEffect(() => {
    if (loading || transactions.length === 0) return;
    refreshAiReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, transactions]);

  const filteredTransactions = useMemo(() => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;

    return transactions.filter((t) => {
      const date = new Date(t.date);
      
      switch (period) {
        case 'daily':
          return date.toDateString() === now.toDateString();
        case 'weekly': {
          const weekAgo = new Date(now);
          weekAgo.setDate(weekAgo.getDate() - 7);
          return date >= weekAgo;
        }
        case 'monthly':
          return date.getMonth() + 1 === currentMonth && date.getFullYear() === currentYear;
        case 'yearly':
          return date.getFullYear() === currentYear;
        default:
          return true;
      }
    });
  }, [transactions, period]);

  const balance = calculateBalance(filteredTransactions);

  // Category breakdown for pie chart
  const categoryBreakdown = useMemo(() => {
    const expenseTransactions = filteredTransactions.filter((t) => t.type === 'expense');
    const totalExpense = expenseTransactions.reduce((sum, t) => sum + t.amount, 0);

    const categories = EXPENSE_CATEGORIES.map((cat) => {
      const total = expenseTransactions
        .filter((t) => t.categoryId === cat.id)
        .reduce((sum, t) => sum + t.amount, 0);

      return {
        name: cat.name,
        value: total,
        color: cat.color,
        percentage: totalExpense > 0 ? (total / totalExpense) * 100 : 0,
      };
    }).filter((c) => c.value > 0);

    return categories;
  }, [filteredTransactions]);

  // Daily cashflow for bar chart
  const dailyCashflow = useMemo(() => {
    const days = period === 'monthly' ? 30 : period === 'weekly' ? 7 : 12;
    const result: { date: string; income: number; expense: number }[] = [];

    for (let i = days - 1; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];

      const dayTx = filteredTransactions.filter((t) => t.date === dateStr);
      const income = dayTx
        .filter((t) => t.type === 'income' || t.type === 'refund')
        .reduce((sum, t) => sum + t.amount, 0);
      const expense = dayTx
        .filter((t) => t.type === 'expense')
        .reduce((sum, t) => sum + t.amount, 0);

      result.push({
        date: date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }),
        income,
        expense,
      });
    }

    return result;
  }, [filteredTransactions, period]);

  const periodLabels: Record<Period, string> = {
    daily: 'Harian',
    weekly: 'Mingguan',
    monthly: 'Bulanan',
    yearly: 'Tahunan',
  };

  return (
    <div>
      <Header title={`Laporan ${periodLabels[period]}`} />

      <div className="p-4 lg:p-6 space-y-5 max-w-4xl mx-auto">
        {/* Period selector */}
        <div className="flex items-center gap-2">
          {(['daily', 'weekly', 'monthly', 'yearly'] as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={cn(
                'px-3 py-1.5 rounded-xl text-xs font-medium transition-all',
                period === p
                  ? 'bg-primary-500 text-white'
                  : 'bg-app-hover/80 text-app-muted hover:bg-app-hover hover:text-app-text'
              )}
            >
              {periodLabels[p]}
            </button>
          ))}
          <button
            onClick={handleExportPdf}
            className="ml-auto inline-flex items-center gap-2 rounded-xl bg-app-hover/80 px-3 py-1.5 text-xs font-medium text-app-muted transition-all hover:bg-app-hover hover:text-app-text"
          >
            <Download className="w-3.5 h-3.5" />
            PDF
          </button>
        </div>

        {loading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => <ChartSkeleton key={i} />)}
          </div>
        ) : filteredTransactions.length === 0 ? (
          <EmptyState
            icon={<BarChart3 className="w-8 h-8" />}
            title="Belum ada data laporan"
            description="Mulai catat transaksi untuk melihat laporan keuangan"
          />
        ) : (
          <>
            {/* Summary */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <Card>
                <p className="text-xs text-app-subtle mb-1">Pemasukan</p>
                <p className="text-base sm:text-lg font-bold text-mint-500 dark:text-mint-300 tabular-nums">
                  {formatCurrency(balance.totalIncome)}
                </p>
              </Card>
              <Card>
                <p className="text-xs text-app-subtle mb-1">Pengeluaran</p>
                <p className="text-base sm:text-lg font-bold text-red-500 dark:text-red-300 tabular-nums">
                  {formatCurrency(balance.totalExpense)}
                </p>
              </Card>
              <Card>
                <p className="text-xs text-app-subtle mb-1">Net Cashflow</p>
                <p className={cn(
                  'text-base sm:text-lg font-bold tabular-nums',
                  balance.balance >= 0 ? 'text-mint-500 dark:text-mint-300' : 'text-red-500 dark:text-red-300'
                )}>
                  {formatCurrency(balance.balance)}
                </p>
              </Card>
            </div>

            {/* Phase 3 AI Intelligence */}
            <div className="grid gap-3 lg:grid-cols-[1.4fr_0.9fr]">
              <Card className="overflow-hidden border-primary-200/70 bg-gradient-to-br from-primary-50 via-app-card to-mint-50/70 dark:border-primary-400/20 dark:from-primary-500/10 dark:via-app-card dark:to-mint-400/10">
                <div className="flex flex-col gap-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-2xl bg-primary-500 text-white flex items-center justify-center shadow-lg shadow-primary-500/20">
                        <Sparkles className="w-5 h-5" />
                      </div>
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary-600 dark:text-primary-300">
                          AI Monthly Report
                        </p>
                        <h3 className="text-base font-bold text-app-text">
                          Insight {getMonthName(getCurrentMonth())} {getCurrentYear()}
                        </h3>
                      </div>
                    </div>
                    <button
                      onClick={refreshAiReport}
                      disabled={aiLoading}
                      className="app-icon-button shrink-0"
                      aria-label="Refresh AI report"
                    >
                      <RefreshCw className={cn('w-4 h-4', aiLoading && 'animate-spin')} />
                    </button>
                  </div>

                  {aiReport ? (
                    <div className="space-y-4">
                      <div className="rounded-2xl border border-app-border/70 bg-app-card/70 p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <ShieldCheck className="w-4 h-4 text-mint-500 dark:text-mint-300" />
                          <span className="text-xs font-semibold text-app-muted">
                            Status cashflow: {aiReport.cashflowHealth}
                          </span>
                          <span className="ml-auto text-[10px] font-medium text-app-subtle">
                            {aiReport.generatedBy === 'gemini' ? 'Gemini AI' : 'Local AI fallback'}
                          </span>
                        </div>
                        <p className="text-sm leading-relaxed text-app-text">{aiReport.summary}</p>
                        {typeof aiReport.financialHealthScore === 'number' && (
                          <div className="flex items-center gap-2 mt-3">
                            <span className="text-[11px] font-semibold text-app-subtle shrink-0">
                              Skor kesehatan
                            </span>
                            <div className="flex-1 h-1.5 rounded-full bg-app-hover overflow-hidden">
                              <div
                                className={cn(
                                  'h-full rounded-full transition-all duration-700',
                                  aiReport.financialHealthScore >= 80
                                    ? 'bg-mint-500'
                                    : aiReport.financialHealthScore >= 60
                                      ? 'bg-amber-500'
                                      : 'bg-red-500'
                                )}
                                style={{ width: `${Math.max(4, aiReport.financialHealthScore)}%` }}
                              />
                            </div>
                            <span className={cn(
                              'text-xs font-bold tabular-nums shrink-0',
                              aiReport.financialHealthScore >= 80
                                ? 'text-mint-600 dark:text-mint-300'
                                : aiReport.financialHealthScore >= 60
                                  ? 'text-amber-600 dark:text-amber-300'
                                  : 'text-red-500 dark:text-red-300'
                            )}>
                              {aiReport.financialHealthScore}/100
                            </span>
                          </div>
                        )}
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <p className="text-xs font-semibold text-app-muted mb-2">Risiko utama</p>
                          <div className="space-y-2">
                            {aiReport.topRisks.slice(0, 3).map((item) => (
                              <p key={item} className="text-xs leading-relaxed text-app-muted">
                                {item}
                              </p>
                            ))}
                          </div>
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-app-muted mb-2">Rekomendasi</p>
                          <div className="space-y-2">
                            {aiReport.recommendations.slice(0, 3).map((item) => (
                              <p key={item} className="text-xs leading-relaxed text-app-muted">
                                {item}
                              </p>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="rounded-2xl border border-app-border/70 bg-mint-500/[0.04] p-3">
                          <p className="text-xs font-semibold text-mint-600 dark:text-mint-300 mb-2 flex items-center gap-1.5">
                            <PiggyBank className="w-3.5 h-3.5" />
                            Peluang hemat
                          </p>
                          <div className="space-y-2">
                            {(aiReport.savingOpportunities ?? []).slice(0, 3).map((item) => (
                              <p key={item} className="text-xs leading-relaxed text-app-muted">
                                {item}
                              </p>
                            ))}
                          </div>
                        </div>
                        <div className="rounded-2xl border border-app-border/70 bg-amber-500/[0.04] p-3">
                          <p className="text-xs font-semibold text-amber-600 dark:text-amber-300 mb-2 flex items-center gap-1.5">
                            <AlertTriangle className="w-3.5 h-3.5" />
                            Perlu diperhatikan
                          </p>
                          <div className="space-y-2">
                            {(aiReport.unusualSpending ?? []).slice(0, 3).map((item) => (
                              <p key={item} className="text-xs leading-relaxed text-app-muted">
                                {item}
                              </p>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-app-muted">
                      {aiLoading ? 'AI sedang membaca pola cashflow bulan ini...' : 'Tambahkan transaksi untuk membuat laporan AI bulanan.'}
                    </p>
                  )}
                </div>
              </Card>

              <Card>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <p className="text-xs text-app-subtle">Forecast sampai akhir bulan</p>
                    <h3 className="text-base font-bold text-app-text">
                      {formatCurrency(forecast.projectedExpense)}
                    </h3>
                  </div>
                  <div className={cn(
                    'px-2.5 py-1 rounded-full text-[11px] font-semibold',
                    forecast.status === 'high-risk'
                      ? 'bg-red-500/10 text-red-500 dark:text-red-300'
                      : forecast.status === 'watch'
                        ? 'bg-amber-500/10 text-amber-600 dark:text-amber-300'
                        : 'bg-mint-500/10 text-mint-600 dark:text-mint-300'
                  )}>
                    {forecast.status === 'high-risk' ? 'High risk' : forecast.status === 'watch' ? 'Watch' : 'Terkontrol'}
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-app-subtle">Saat ini</span>
                    <span className="font-semibold text-app-text">{formatCurrency(forecast.currentExpense)}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-app-subtle">Rata-rata harian</span>
                    <span className="font-semibold text-app-text">{formatCurrency(forecast.averageDailyExpense)}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-app-subtle">Sisa hari</span>
                    <span className="font-semibold text-app-text">{forecast.remainingDays} hari</span>
                  </div>
                  <p className="pt-2 text-xs leading-relaxed text-app-muted border-t border-app-border/70">
                    {forecast.narrative}
                  </p>
                </div>
              </Card>
            </div>

            {/* Bar chart */}
            <Card>
              <h3 className="text-sm font-semibold text-app-text mb-4">
                Cashflow {periodLabels[period]}
              </h3>
              <div className="h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dailyCashflow}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-chart-grid)" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10, fill: 'var(--color-chart-muted)' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: 'var(--color-chart-muted)' }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(value) => `${(value / 1000).toFixed(0)}rb`}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'var(--color-chart-tooltip)',
                        border: '1px solid var(--color-chart-tooltip-border)',
                        borderRadius: '12px',
                        fontSize: '12px',
                        color: 'var(--color-chart-tooltip-text)',
                      }}
                      formatter={(value) => [formatCurrency(Number(value || 0))]}
                    />
                    <Bar dataKey="income" fill="rgb(16 185 129)" radius={[4, 4, 0, 0]} name="Pemasukan" />
                    <Bar dataKey="expense" fill="rgb(239 68 68)" radius={[4, 4, 0, 0]} name="Pengeluaran" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            {/* Pie chart */}
            {categoryBreakdown.length > 0 && (
              <Card>
                <h3 className="text-sm font-semibold text-app-text mb-4">
                  Pengeluaran per Kategori
                </h3>
                <div className="h-[200px] sm:h-[250px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <RePieChart>
                      <Pie
                        data={categoryBreakdown}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={90}
                        paddingAngle={2}
                        dataKey="value"
                      >
                        {categoryBreakdown.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value, name) => [formatCurrency(Number(value || 0)), String(name)]}
                        contentStyle={{
                          backgroundColor: 'var(--color-chart-tooltip)',
                          border: '1px solid var(--color-chart-tooltip-border)',
                          borderRadius: '12px',
                          fontSize: '12px',
                          color: 'var(--color-chart-tooltip-text)',
                        }}
                      />
                      <Legend
                        wrapperStyle={{ fontSize: '11px' }}
                        formatter={(value) => <span className="text-app-muted">{value}</span>}
                      />
                    </RePieChart>
                  </ResponsiveContainer>
                </div>

                {/* List breakdown */}
                <div className="space-y-2 mt-4">
                  {categoryBreakdown.map((cat) => (
                    <div key={cat.name} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <CategoryIcon
                          name={cat.name}
                          type="expense"
                          size="sm"
                          animated
                          animationVariant="soft"
                        />
                        <span className="text-app-muted">{cat.name}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-app-subtle">{cat.percentage.toFixed(1)}%</span>
                        <span className="font-medium text-app-text">
                          {formatCurrency(cat.value)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}
