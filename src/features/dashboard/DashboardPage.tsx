import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Wallet,
  TrendingUp,
  TrendingDown,
  PiggyBank,
  Plus,
  Mail,
  BarChart3,
  ShieldCheck,
  ShieldAlert,
  Landmark,
  CheckCircle2,
  type LucideIcon,
} from 'lucide-react';
import { useAuthStore } from '../../store/useAuthStore';
import { useAppStore } from '../../store/useAppStore';
import { listenToTransactions, listenToTransactionSummary } from '../../services/transactionService';
import { listenToBudgets } from '../../services/budgetService';
import { triggerBudgetOverNotification, triggerBudgetWarningNotification } from '../../services/notificationTriggers';
import { getFraudSummary, FRAUD_RULE_LABELS, FRAUD_SEVERITY_LABELS } from '../../services/fraudService';
import { cn, formatCurrency, formatDate, formatSigned, getCurrentMonth, getCurrentYear } from '../../lib/utils';
import type { Budget, BudgetStatus, FraudSummary, Transaction, TransactionSummary } from '../../types';
import Header from '../../components/layout/Header';
import StatCard from '../../components/ui/StatCard';
import Card from '../../components/ui/Card';
import TransactionItem from '../../components/ui/TransactionItem';
import Button from '../../components/ui/Button';
import { StatCardSkeleton, TransactionSkeleton, ChartSkeleton } from '../../components/ui/Skeleton';
import EmptyState from '../../components/ui/EmptyState';
import ErrorState from '../../components/ui/ErrorState';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from 'recharts';

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
  const authUser = useAuthStore((s) => s.authUser);
  // Selector per-action (Sprint 1.8 debt) — action reference stabil, jadi
  // komponen tidak lagi re-render saat state lain (toasts/notifications/theme)
  // berubah. Sebelumnya `useAppStore()` tanpa selector = subscribe seluruh store.
  const addToast = useAppStore((s) => s.addToast);
  const navigate = useNavigate();

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  // Ringkasan keuangan WINDOWLESS dari server (GET /api/transactions/summary)
  // — sumber kebenaran tunggal Total Saldo / Pemasukan / Pengeluaran Bulan Ini.
  // Root cause insiden 2026-08-08: sebelumnya dihitung dari 50 baris terbaru.
  const [summary, setSummary] = useState<TransactionSummary | null>(null);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  const [fraudSummary, setFraudSummary] = useState<FraudSummary | null>(null);

  // Gate loading: kartu bersumber dari summary (windowless), jadi halaman tidak
  // boleh render Rp0 sesaat sebelum summary tiba. Watchdog 10s memastikan fetch
  // summary yang menggantung (apiGet tanpa timeout) tidak membuat skeleton abadi.
  const summaryResolvedRef = useRef(false);
  // Tandai error sudah terjadi tanpa memicu re-run effect (hindari loop refetch).
  const hasErrorRef = useRef(false);

  const currentMonth = getCurrentMonth();
  const currentYear = getCurrentYear();

  useEffect(() => {
    if (!authUser) return;
    const ac = new AbortController();
    getFraudSummary({ signal: ac.signal })
      .then(setFraudSummary)
      .catch((err) => {
        if (ac.signal.aborted) return;
        const message = err instanceof Error ? err.message : typeof err === 'string' ? err : 'Gagal memuat ringkasan fraud';
        addToast({ type: 'error', title: 'Gagal memuat data', message });
      });
    return () => ac.abort();
  }, [authUser, addToast]);

  useEffect(() => {
    if (!authUser) return;

    setLoading(true);
    const ac = new AbortController();
    const unsubscribe = listenToTransactions(
      authUser.uid,
      (data) => {
        setTransactions(data);
        setError(null);
        if (summaryResolvedRef.current || hasErrorRef.current) setLoading(false);
      },
      (err) => {
        if (ac.signal.aborted) return;
        hasErrorRef.current = true;
        const message = err instanceof Error ? err.message : typeof err === 'string' ? err : 'Gagal memuat data';
        setError(new Error(message));
        setLoading(false);
        addToast({ type: 'error', title: 'Gagal memuat data', message });
      }
    );

    return () => { ac.abort(); unsubscribe(); };
  }, [authUser, addToast]);

  // Ringkasan windowless: Total Saldo & kartu bulanan TIDAK boleh dihitung dari
  // window 50 baris (listenToTransactions) — insiden 2026-08-08. Error summary
  // ditangani terpisah agar kartu tidak menampilkan angka windowed yang salah.
  useEffect(() => {
    if (!authUser) return;

    // Watchdog: bila summary tidak pernah resolve dalam 10s (fetch menggantung),
    // alihkan ke ErrorState jujur — jangan skeleton abadi.
    const watchdog = setTimeout(() => {
      if (!summaryResolvedRef.current) {
        hasErrorRef.current = true;
        setError(new Error('Ringkasan keuangan tidak merespons.'));
        setLoading(false);
      }
    }, 10_000);

    const unsubscribe = listenToTransactionSummary(
      authUser.uid,
      currentMonth,
      currentYear,
      (data) => {
        summaryResolvedRef.current = true;
        setSummary(data);
        setLoading(false);
        setError(null);
      },
      (err) => {
        // Ringkasan adalah sumber kebenaran kartu — jangan tampilkan angka 0
        // yang menyesatkan; tampilkan error state yang jujur.
        hasErrorRef.current = true;
        setError(err);
        setLoading(false);
        addToast({ type: 'error', title: 'Gagal memuat ringkasan', message: err.message });
      },
    );

    return () => {
      clearTimeout(watchdog);
      unsubscribe();
    };
  }, [authUser, addToast, currentMonth, currentYear]);

  useEffect(() => {
    if (!authUser) return;

    return listenToBudgets(
      authUser.uid,
      setBudgets,
      (err) => addToast({ type: 'error', title: 'Gagal memuat budget', message: err.message }),
    );
  }, [authUser, addToast]);

  // Sumber kebenaran: lifetime & bulan berjalan dari server (windowless).
  // `lifetime.balance` = ARUS KAS BERSIH (net cash flow, Mode B Skr A/B) —
  // BUKAN current balance. P2.5: current balance ada di summary.ledger.
  const balance = summary?.lifetime ?? { totalIncome: 0, totalExpense: 0, balance: 0, count: 0 };
  const monthlyBalance = summary?.monthly ?? { totalIncome: 0, totalExpense: 0, balance: 0, count: 0 };
  const ledger = summary?.ledger ?? null;

  // Status badge Saldo Saat Ini — jujur, bukan angka karangan. P2.5:
  // known/partial/unknown (opening-based). P2.7: verified/stale/mismatch
  // (balance anchor — saldo aktual user, post-anchor roll-forward).
  const ledgerStatus = ledger?.currentBalance.status ?? 'unknown';
  const ledgerBadge = {
    known: 'bg-mint-50 dark:bg-mint-500/12 text-mint-600 dark:text-mint-300',
    partial: 'bg-amber-50 dark:bg-amber-500/12 text-amber-700 dark:text-amber-300',
    unknown: 'bg-slate-100 dark:bg-slate-500/15 text-slate-600 dark:text-slate-300',
    verified: 'bg-mint-50 dark:bg-mint-500/12 text-mint-700 dark:text-mint-300',
    stale: 'bg-amber-50 dark:bg-amber-500/12 text-amber-700 dark:text-amber-300',
    mismatch: 'bg-rose-50 dark:bg-rose-500/12 text-rose-700 dark:text-rose-300',
  }[ledgerStatus];
  const ledgerBadgeLabel = {
    known: 'Diketahui',
    partial: 'Sebagian',
    unknown: 'Belum terverifikasi',
    verified: 'Saldo terverifikasi',
    stale: 'Perlu pembaruan',
    mismatch: 'Perlu pemeriksaan',
  }[ledgerStatus];
  const ledgerAnchorDate = ledger?.currentBalance.anchorDate ?? null;
  const ledgerSubtitle = {
    known: 'Saldo awal + pergerakan per rekening',
    partial: 'Sebagian data rekening belum lengkap',
    unknown: 'Belum ada saldo aktual yang terverifikasi',
    verified: ledgerAnchorDate
      ? `Saldo aktual terverifikasi per ${formatDate(ledgerAnchorDate)}`
      : 'Saldo aktual terverifikasi + pergerakan setelahnya',
    stale: 'Aktivitas setelah verifikasi belum terselesaikan',
    mismatch: 'Saldo aktual berbeda dari perhitungan sistem',
  }[ledgerStatus];

  // P2.6: reconciliation summary (counts + status) — banner status di bawah
  // kartu Saldo Saat Ini. Hanya dirender bila data ada dan belum verified.
  const recon = summary?.reconciliation ?? null;
  const reconUnclassified = recon?.transactions.unclassified ?? 0;
  const reconUnresolvedTransfers = recon?.transfers.unresolved ?? 0;
  const reconIncomplete = recon != null && recon.status !== 'verified';
  const reconMessage = recon == null
    ? null
    : recon.status === 'unknown'
      ? 'Belum ada rekening / saldo awal — buat rekening untuk menghitung saldo.'
      : reconUnclassified > 0 || reconUnresolvedTransfers > 0
        ? `${reconUnclassified} transaksi belum terhubung${reconUnresolvedTransfers > 0 ? ` · ${reconUnresolvedTransfers} transfer belum dipasangkan` : ''}`
        : 'Semua transaksi terhubung — verifikasi saldo nyata untuk menyelesaikan.';

  // Pengeluaran bulanan per kategori (windowless) untuk budget usage.
  const monthlyExpenseByCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of summary?.monthlyByCategory ?? []) {
      map.set(c.categoryId, c.total);
    }
    return map;
  }, [summary]);

  const currentMonthBudgets = useMemo(() => budgets.filter((budget) =>
    budget.month === currentMonth && budget.year === currentYear
  ), [budgets, currentMonth, currentYear]);

  const budgetsWithUsage = useMemo(() => currentMonthBudgets.map((budget) => {
    const usedAmount = monthlyExpenseByCategory.get(budget.categoryId) ?? 0;
    const status: BudgetStatus = usedAmount >= budget.amount
      ? 'overbudget'
      : usedAmount >= budget.amount * 0.8
        ? 'warning'
        : 'safe';

    return { ...budget, usedAmount, status };
  }), [currentMonthBudgets, monthlyExpenseByCategory]);

  const remainingBudget = budgetsWithUsage.reduce(
    (sum, budget) => sum + Math.max(0, budget.amount - budget.usedAmount),
    0,
  );

  // Semantic Sisa Budget (audit finansial 2026-08-10): Rp0 bisa berarti (a)
  // budget HABIS/over atau (b) TIDAK ADA budget dikonfigurasi bulan ini — dua
  // kondisi yang berbeda secara UX. `budgetConfigured` membedakan keduanya;
  // card menampilkan label eksplisit "Belum ada budget" saat (b) sehingga
  // Rp0 tidak disalahartikan sebagai "budget habis".
  const budgetConfigured = currentMonthBudgets.length > 0;

  const notifiedBudgetKeys = useRef(new Set<string>());
  useEffect(() => {
    if (!authUser?.uid || loading) return;

    budgetsWithUsage.forEach((budget) => {
      if (budget.status === 'safe') return;
      const key = `${budget.categoryId}-${currentMonth}-${currentYear}-${budget.status}`;
      if (notifiedBudgetKeys.current.has(key)) return;
      notifiedBudgetKeys.current.add(key);

      const trigger = budget.status === 'overbudget'
        ? triggerBudgetOverNotification
        : triggerBudgetWarningNotification;
      trigger(authUser.uid, budget, currentMonth, currentYear).catch(() => undefined);
    });
  }, [budgetsWithUsage, currentMonth, currentYear, authUser?.uid, loading]);

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
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
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
          <ErrorState
            error={error}
            title="Gagal Memuat Data"
            onRetry={() => window.location.reload()}
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
              Halo, {authUser?.displayName || 'User'}
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

        {/* Saldo Saat Ini — P2.5 account-based ledger. Status jujur: angka
            hanya ditampilkan bila currentBalance.status != 'unknown';
            sebaliknya penjelasan + CTA (JANGAN pernah menampilkan Rp0). */}
        <div role="region" aria-label="Saldo Saat Ini" className="rounded-2xl p-4 sm:p-5 mb-3 app-surface">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-primary-50 dark:bg-primary-500/12 text-primary-600 dark:text-primary-300">
                <Landmark className="w-5 h-5" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-app-text">Saldo Saat Ini</h2>
                <p className="text-xs text-app-muted">{ledgerSubtitle}</p>
              </div>
            </div>
            {ledger && (
              <span className={cn('text-xs font-semibold px-2.5 py-1 rounded-full', ledgerBadge)}>
                {ledgerBadgeLabel}
              </span>
            )}
          </div>

          <div className="mt-3">
            {ledgerStatus === 'verified' && (ledger?.currentBalance.amount ?? null) !== null ? (
              <div>
                <p className="text-2xl sm:text-3xl font-extrabold tabular-nums text-app-text">
                  {formatSigned((ledger?.currentBalance.amount ?? 0))}
                </p>
                <p className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-mint-600 dark:text-mint-300">
                  <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                  Saldo terverifikasi{ledgerAnchorDate ? ` per ${formatDate(ledgerAnchorDate)}` : ''} · {ledger?.accounts.length ?? 0} rekening
                </p>
              </div>
            ) : (ledgerStatus === 'known' || ledgerStatus === 'partial' || ledgerStatus === 'stale' || ledgerStatus === 'mismatch')
              && (ledger?.currentBalance.amount ?? null) !== null ? (
              <div>
                <p className="text-lg font-bold text-app-text">
                  {ledgerStatus === 'mismatch' ? 'Perlu pemeriksaan' : ledgerStatus === 'stale' ? 'Saldo perlu diperbarui' : 'Saldo sebagian'}
                </p>
                <p className="text-2xl sm:text-3xl font-extrabold tabular-nums text-app-text">
                  {formatSigned((ledger?.currentBalance.amount ?? 0))}
                </p>
              </div>
            ) : (
              <div>
                <p className="text-lg font-bold text-app-text">Belum terverifikasi</p>
                <p className="mt-0.5 text-xs text-app-muted">
                  CashFlow belum mengetahui saldo aktual rekening Anda — verifikasi untuk menghitung tanpa menebak.
                </p>
              </div>
            )}
            {ledger && (
              <p className="mt-1 text-xs text-app-muted">{ledger.currentBalance.message}</p>
            )}
          </div>

          {/* Per-akun breakdown — hanya bila ada rekening terkonfigurasi. */}
          {ledger && ledger.accounts.length > 0 && (
            <ul className="mt-3 space-y-1.5 text-sm">
              {ledger.accounts.map((acct) => (
                <li key={acct.id} className="flex items-center justify-between gap-2">
                  <span className="truncate text-app-text">
                    {acct.name}
                    {acct.verificationStatus === 'mismatch' && (
                      <span className="ml-1.5 text-xs font-semibold text-rose-600 dark:text-rose-300">· cek</span>
                    )}
                  </span>
                  {acct.closingBalance !== null ? (
                    <span className="tabular-nums font-semibold text-app-text">
                      {formatSigned(acct.closingBalance)}
                    </span>
                  ) : (
                    <span className="text-xs text-app-muted">Belum dikonfigurasi</span>
                  )}
                </li>
              ))}
            </ul>
          )}

          {/* Transaksi belum ter-link — jangan disembunyikan (mandate P2.5 §34). */}
          {ledger && ledger.unclassified.count > 0 && (
            <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">
              {ledger.unclassified.count} transaksi belum terhubung ke rekening (
              {formatCurrency(ledger.unclassified.amount)}) — saldo belum mencakupnya.
            </p>
          )}

          {/* CTA — arahkan sesuai status: verifikasi anchor, lanjutkan
              rekonsiliasi, atau tinjau aktivitas post-anchor. */}
          <div className="mt-3">
            {(ledgerStatus === 'unknown' || ledgerStatus === 'partial') && (
              <Link
                to="/reconciliation"
                className="inline-flex items-center gap-1.5 rounded-xl bg-primary-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg focus-visible:ring-primary-600"
              >
                {/* P2.8 §27: tanpa rekening → "Aktifkan Saldo" (aktivasi akun);
                    ada rekening tapi belum verified → "Verifikasi Saldo". */}
                {(ledger?.accounts.length ?? 0) === 0 ? 'Aktifkan Saldo' : ledgerStatus === 'unknown' ? 'Verifikasi Saldo' : 'Lanjutkan Rekonsiliasi'}
              </Link>
            )}
            {ledgerStatus === 'stale' && (
              <Link
                to="/reconciliation"
                className="inline-flex items-center gap-1.5 rounded-xl bg-amber-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-amber-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg focus-visible:ring-amber-700"
              >
                Tinjau aktivitas
              </Link>
            )}
            {ledgerStatus === 'mismatch' && (
              <Link
                to="/reconciliation"
                className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg focus-visible:ring-rose-600"
              >
                Lihat Perbedaan
              </Link>
            )}
            {ledgerStatus === 'known' && (
              <Link
                to="/settings"
                className="inline-flex items-center gap-1.5 rounded-xl bg-primary-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg focus-visible:ring-primary-600"
              >
                Atur rekening &amp; saldo awal
              </Link>
            )}
          </div>
        </div>

        {/* Rekonsiliasi — P2.6 assisted reconciliation status (counts + status
            saja, tanpa nominal; CTA menuju halaman rekonsiliasi). */}
        {reconIncomplete && (
          <div
            role="region"
            aria-label="Status rekonsiliasi"
            className="rounded-2xl p-4 sm:p-5 mb-3 border border-amber-200 dark:border-amber-500/25 bg-amber-50/60 dark:bg-amber-500/8"
          >
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-9 h-9 shrink-0 rounded-xl flex items-center justify-center bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300">
                  <ShieldAlert className="w-5 h-5" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-sm font-bold text-app-text">Rekonsiliasi Rekening</h2>
                  <p className="text-xs text-app-muted">{reconMessage}</p>
                </div>
              </div>
              <Link
                to="/reconciliation"
                className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-amber-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-amber-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg focus-visible:ring-amber-700"
              >
                Tinjau &amp; hubungkan
              </Link>
            </div>
          </div>
        )}

        {/* Stat Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard
            // P2.5: kartu ini = ARUS KAS BERSIH lifetime (net cash flow),
            // bukan current balance — label diperbaiki agar tidak ambigu.
            title="Arus Kas Bersih"
            value={balance.balance}
            icon={<Wallet className="w-5 h-5" />}
            // Saldo negatif ditandai merah + minus (pola ProfilePage) —
            // formatCurrency global tidak diubah.
            negative={balance.balance < 0}
            delay={0}
          />
          <StatCard
            title="Pemasukan Bulan Ini"
            value={monthlyBalance.totalIncome}
            icon={<TrendingDown className="w-5 h-5" />}
            variant="income"
            // Prefix '+' — paritas bahasa tanda TransactionItem (income → '+').
            // Murni prefix; warna mint sudah dari variant="income". 'none'
            // saat 0 (hindari "+Rp0").
            sign={monthlyBalance.totalIncome > 0 ? 'plus' : 'none'}
            delay={1}
          />
          <StatCard
            title="Pengeluaran Bulan Ini"
            value={monthlyBalance.totalExpense}
            icon={<TrendingUp className="w-5 h-5" />}
            variant="expense"
            // Prefix '-' — paritas bahasa tanda TransactionItem (expense → '-').
            // Murni prefix; warna merah sudah dari variant="expense". 'none'
            // saat belum ada pengeluaran bulan ini (hindari "-Rp0").
            sign={monthlyBalance.totalExpense > 0 ? 'minus' : 'none'}
            delay={2}
          />
          <StatCard
            title="Sisa Budget"
            value={remainingBudget}
            icon={<PiggyBank className="w-5 h-5" />}
            // No-budget ≠ remaining 0: tampilkan label eksplisit (audit
            // finansial 2026-08-10) — tidak ada budget bulan ini, bukan
            // budget habis.
            changeLabel={budgetConfigured ? undefined : 'Belum ada budget'}
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
          {/* P2.3.4 — ringkasan sr-only untuk screen reader (data chart yang
              sudah ada; tidak ada network call / kalkulasi baru). */}
          <p className="sr-only">
            {`Grafik garis Pemasukan dan Pengeluaran, 7 hari terakhir — total pemasukan ${formatCurrency(last7Days.reduce((s, d) => s + d.income, 0))}, total pengeluaran ${formatCurrency(last7Days.reduce((s, d) => s + d.expense, 0))}.`}
          </p>
          <div className="h-[180px] sm:h-[200px]" role="img" aria-label="Grafik garis Pemasukan dan Pengeluaran, 7 hari terakhir">
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
                <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={8} />
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

        {/* Fraud Protection Widget (Sprint 1) */}
        <Card>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-xl bg-amber-50 dark:bg-amber-500/12 flex items-center justify-center">
                <ShieldAlert className="w-5 h-5 text-amber-600 dark:text-amber-300" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-app-text">
                  Perlindungan Fraud
                </h3>
                <p className="text-xs text-app-subtle">
                  Deteksi otomatis aktivitas mencurigakan
                </p>
              </div>
            </div>
            {fraudSummary && fraudSummary.openCount > 0 && (
              <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-500/15 px-2.5 py-1 rounded-full">
                {fraudSummary.openCount} perlu dicek
              </span>
            )}
          </div>

          {!fraudSummary ? (
            <p className="text-sm text-app-muted">Memuat status keamanan…</p>
          ) : fraudSummary.openCount === 0 ? (
            <div className="flex items-center gap-2.5 text-sm text-mint-600 dark:text-mint-300">
              <ShieldCheck className="w-5 h-5 shrink-0" />
              <span>Tidak ada aktivitas mencurigakan. Ledger kamu aman.</span>
            </div>
          ) : (
            <ul className="divide-y divide-app-border/70">
              {fraudSummary.recent.slice(0, 3).map((flag) => (
                <li key={flag.id} className="py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-app-text truncate">
                      {flag.merchant || 'Transaksi'}
                      {typeof flag.amount === 'number' && ` · ${formatCurrency(flag.amount)}`}
                    </p>
                    <p className="text-xs text-app-subtle mt-0.5">
                      {FRAUD_RULE_LABELS[flag.flagType] || flag.flagType}
                      {' · '}
                      <span className={cn(
                        flag.severity === 'critical' || flag.severity === 'high'
                          ? 'text-red-500 dark:text-red-300'
                          : 'text-amber-600 dark:text-amber-300'
                      )}>
                        {FRAUD_SEVERITY_LABELS[flag.severity] || flag.severity}
                      </span>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => navigate('/fraud')}
                    className="text-xs font-medium text-primary-500 hover:text-primary-600 dark:text-primary-300 shrink-0"
                  >
                    Lihat
                  </button>
                </li>
              ))}
            </ul>
          )}
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
