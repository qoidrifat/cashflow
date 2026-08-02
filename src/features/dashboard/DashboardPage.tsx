import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Wallet,
  TrendingUp,
  TrendingDown,
  PiggyBank,
  Plus,
  Mail,
  BarChart3,
  type LucideIcon,
} from 'lucide-react';
import { useAuthStore } from '../../store/useAuthStore';
import { useAppStore } from '../../store/useAppStore';
import { listenToTransactions, calculateBalance } from '../../services/transactionService';
import { listenToBudgets } from '../../services/budgetService';
import { triggerBudgetOverNotification, triggerBudgetWarningNotification } from '../../services/notificationTriggers';
import { cn, formatCurrency, getCurrentMonth, getCurrentYear } from '../../lib/utils';
import type { Budget, BudgetStatus, Transaction } from '../../types';
import Header from '../../components/layout/Header';
import StatCard from '../../components/ui/StatCard';
import Card from '../../components/ui/Card';
import TransactionItem from '../../components/ui/TransactionItem';
import Button from '../../components/ui/Button';
import { StatCardSkeleton, TransactionSkeleton, ChartSkeleton } from '../../components/ui/Skeleton';
import EmptyState from '../../components/ui/EmptyState';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';

function getDashboardErrorMessage(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes('schema cache') || normalized.includes('could not find the table')) {
    return 'Database belum siap. Pastikan server API aktif dan data sudah dimigrasi, lalu klik Coba Lagi.';
  }
  if (normalized.includes('permission denied') || normalized.includes('row-level security')) {
    return 'Data tidak bisa dibaca karena policy RLS belum mengizinkan user saat ini. Pastikan policy memakai auth.uid() = user_id.';
  }
  if (normalized.includes('column') && normalized.includes('not')) {
    return 'Schema database belum sesuai dengan service layer CashFlow. Pastikan migration core terbaru sudah dijalankan.';
  }
  return message;
}

const quickActions: Array<{
  label: string;
  icon: LucideIcon;
  to: string;
  className: string;
}> = [
  {
    label: 'Pemasukan',
    icon: Plus,
    to: '/transactions?add=income',
    className:
      'bg-emerald-700 text-white shadow-emerald-900/20 hover:bg-emerald-800 focus-visible:ring-emerald-600 dark:bg-emerald-500 dark:text-emerald-950 dark:hover:bg-emerald-400 dark:focus-visible:ring-emerald-300',
  },
  {
    label: 'Pengeluaran',
    icon: Plus,
    to: '/transactions?add=expense',
    className:
      'bg-rose-600 text-white shadow-rose-900/20 hover:bg-rose-700 focus-visible:ring-rose-500 dark:bg-rose-400 dark:text-rose-950 dark:hover:bg-rose-300 dark:focus-visible:ring-rose-300',
  },
  {
    label: 'Scan Gmail',
    icon: Mail,
    to: '/gmail-sync',
    className:
      'bg-blue-600 text-white shadow-blue-900/20 hover:bg-blue-700 focus-visible:ring-blue-500 dark:bg-blue-400 dark:text-blue-950 dark:hover:bg-blue-300 dark:focus-visible:ring-blue-300',
  },
  {
    label: 'Laporan',
    icon: BarChart3,
    to: '/reports',
    className:
      'bg-violet-600 text-white shadow-violet-900/20 hover:bg-violet-700 focus-visible:ring-violet-500 dark:bg-violet-400 dark:text-violet-950 dark:hover:bg-violet-300 dark:focus-visible:ring-violet-300',
  },
];

export default function DashboardPage() {
  const { firebaseUser } = useAuthStore();
  const { addToast } = useAppStore();
  const navigate = useNavigate();

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);



  useEffect(() => {
    if (!firebaseUser) return;

    setLoading(true);
    const unsubscribe = listenToTransactions(
      firebaseUser.uid,
      (data) => {
        setTransactions(data);
        setLoading(false);
        setError(null);
      },
      (err) => {
        const message = getDashboardErrorMessage(err.message);
        setError(message);
        setLoading(false);
        addToast({ type: 'error', title: 'Gagal memuat data', message });
      }
    );

    return unsubscribe;
  }, [firebaseUser, addToast]);

  useEffect(() => {
    if (!firebaseUser) return;

    return listenToBudgets(
      firebaseUser.uid,
      setBudgets,
      (err) => addToast({ type: 'error', title: 'Gagal memuat budget', message: err.message }),
    );
  }, [firebaseUser, addToast]);

  const balance = calculateBalance(transactions);
  const currentMonth = getCurrentMonth();
  const currentYear = getCurrentYear();

  const monthlyTransactions = transactions.filter((t) => {
    const date = new Date(t.date);
    return date.getMonth() + 1 === currentMonth && date.getFullYear() === currentYear;
  });

  const monthlyBalance = calculateBalance(monthlyTransactions);

  const currentMonthBudgets = useMemo(() => budgets.filter((budget) =>
    budget.month === currentMonth && budget.year === currentYear
  ), [budgets, currentMonth, currentYear]);

  const budgetsWithUsage = useMemo(() => currentMonthBudgets.map((budget) => {
    const usedAmount = monthlyTransactions
      .filter((transaction) => transaction.type === 'expense' && transaction.categoryId === budget.categoryId)
      .reduce((sum, transaction) => sum + transaction.amount, 0);
    const status: BudgetStatus = usedAmount >= budget.amount
      ? 'overbudget'
      : usedAmount >= budget.amount * 0.8
        ? 'warning'
        : 'safe';

    return { ...budget, usedAmount, status };
  }), [currentMonthBudgets, monthlyTransactions]);

  const remainingBudget = budgetsWithUsage.reduce(
    (sum, budget) => sum + Math.max(0, budget.amount - budget.usedAmount),
    0,
  );

  const notifiedBudgetKeys = useRef(new Set<string>());
  useEffect(() => {
    if (!firebaseUser?.uid || loading) return;

    budgetsWithUsage.forEach((budget) => {
      if (budget.status === 'safe') return;
      const key = `${budget.categoryId}-${currentMonth}-${currentYear}-${budget.status}`;
      if (notifiedBudgetKeys.current.has(key)) return;
      notifiedBudgetKeys.current.add(key);

      const trigger = budget.status === 'overbudget'
        ? triggerBudgetOverNotification
        : triggerBudgetWarningNotification;
      trigger(firebaseUser.uid, budget, currentMonth, currentYear).catch(() => undefined);
    });
  }, [budgetsWithUsage, currentMonth, currentYear, firebaseUser?.uid, loading]);

  // Prepare chart data
  const last7Days = Array.from({ length: 7 }, (_, i) => {
    const date = new Date();
    date.setDate(date.getDate() - (6 - i));
    const dateStr = date.toISOString().split('T')[0];
    const dayTransactions = transactions.filter((t) => t.date === dateStr);
    const dayIncome = dayTransactions
      .filter((t) => t.type === 'income' || t.type === 'refund')
      .reduce((sum, t) => sum + t.amount, 0);
    const dayExpense = dayTransactions
      .filter((t) => t.type === 'expense')
      .reduce((sum, t) => sum + t.amount, 0);

    return {
      date: date.toLocaleDateString('id-ID', { weekday: 'short' }),
      income: dayIncome,
      expense: dayExpense,
    };
  });

  const recentTransactions = transactions.slice(0, 5);

  if (loading) {
    return (
      <div>
        <Header title="Beranda" />
        <div className="p-4 lg:p-6 space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[1, 2, 3, 4].map((i) => (
              <StatCardSkeleton key={i} />
            ))}
          </div>
          <ChartSkeleton />
          <Card>
            {[1, 2, 3, 4, 5].map((i) => (
              <TransactionSkeleton key={i} />
            ))}
          </Card>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <Header title="Beranda" />
        <div className="p-4 lg:p-6">
          <EmptyState
            icon={<TrendingUp className="w-8 h-8 text-red-400" />}
            title="Gagal Memuat Data"
            description={error}
            action={
              <Button variant="primary" onClick={() => window.location.reload()}>
                Coba Lagi
              </Button>
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div>
      <Header
        title="Beranda"
        showSearch
        onSearchChange={() => {}}
      />

      <div className="p-4 lg:p-6 space-y-5 max-w-7xl mx-auto">
        {/* Welcome */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-between"
        >
          <div>
            <p className="text-sm text-app-subtle">
              Halo, {firebaseUser?.displayName || 'User'}
            </p>
            <h2 className="text-lg sm:text-xl font-bold text-app-text">
              Ringkasan Keuangan
            </h2>
          </div>
        </motion.div>

        {/* Quick Actions */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="grid grid-cols-2 gap-3 sm:grid-cols-4"
        >
          {quickActions.map((action) => {
            const Icon = action.icon;
            return (
              <button
                key={action.label}
                type="button"
                onClick={() => navigate(action.to)}
                aria-label={action.label}
                className={cn(
                  'flex min-h-[52px] flex-col items-center justify-center gap-1.5 rounded-2xl px-3 py-3 text-center',
                  'text-sm font-semibold leading-tight shadow-sm transition-all duration-200',
                  'hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 active:scale-[0.98]',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg',
                  'disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-[64px] sm:px-4 sm:py-4',
                  action.className,
                )}
              >
                <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                <span className="max-w-full whitespace-normal break-words text-xs sm:text-sm">
                  {action.label}
                </span>
              </button>
            );
          })}
        </motion.div>

        {/* Stat Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard
            title="Total Saldo"
            value={balance.balance}
            icon={<Wallet className="w-5 h-5" />}
            delay={0}
          />
          <StatCard
            title="Pemasukan Bulan Ini"
            value={monthlyBalance.totalIncome}
            icon={<TrendingDown className="w-5 h-5" />}
            variant="income"
            delay={1}
          />
          <StatCard
            title="Pengeluaran Bulan Ini"
            value={monthlyBalance.totalExpense}
            icon={<TrendingUp className="w-5 h-5" />}
            variant="expense"
            delay={2}
          />
          <StatCard
            title="Sisa Budget"
            value={remainingBudget}
            icon={<PiggyBank className="w-5 h-5" />}
            delay={3}
          />
        </div>

        {/* Chart */}
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-app-text">
              Cashflow 7 Hari Terakhir
            </h3>
          </div>
          <div className="h-[180px] sm:h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={last7Days}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-chart-grid)" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11, fill: 'var(--color-chart-muted)' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: 'var(--color-chart-muted)' }}
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
                    boxShadow: 'var(--shadow-surface)',
                  }}
                  formatter={(value) => [formatCurrency(Number(value || 0))]}
                />
                <Line
                  type="monotone"
                  dataKey="income"
                  stroke="rgb(16 185 129)"
                  strokeWidth={2}
                  dot={false}
                  name="Pemasukan"
                />
                <Line
                  type="monotone"
                  dataKey="expense"
                  stroke="rgb(239 68 68)"
                  strokeWidth={2}
                  dot={false}
                  name="Pengeluaran"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Recent Transactions */}
        <Card>
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-sm font-semibold text-app-text">
              Transaksi Terbaru
            </h3>
            <button
              onClick={() => navigate('/transactions')}
              className="text-xs text-primary-500 hover:text-primary-600 font-medium"
            >
              Lihat Semua
            </button>
          </div>

          {recentTransactions.length === 0 ? (
            <EmptyState
              title="Belum ada transaksi"
              description="Mulai catat pemasukan atau pengeluaran pertama kamu"
              action={
                <Button variant="primary" size="sm" onClick={() => navigate('/transactions?add=expense')}>
                  Tambah Transaksi
                </Button>
              }
            />
          ) : (
            <div className="divide-y divide-app-border/70">
              {recentTransactions.map((tx, i) => (
                <TransactionItem
                  key={tx.id}
                  transaction={tx}
                  delay={i}
                  onClick={setSelectedTransaction}
                />
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
