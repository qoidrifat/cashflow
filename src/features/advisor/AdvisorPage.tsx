import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  RefreshCw,
  TrendingUp,
  PiggyBank,
  Target,
  Wallet,
  Repeat2,
  ListChecks,
  BrainCircuit,
  ShieldCheck,
} from 'lucide-react';
import { useAuthStore } from '../../store/useAuthStore';
import { listenToTransactions } from '../../services/transactionService';
import { listenToBudgets } from '../../services/budgetService';
import { getWalletAccounts, getSavingGoals, getSubscriptions } from '../../services/professionalSuiteService';
import {
  computeAdvisorMetrics,
  generateAdvisorReport,
  type AdvisorInput,
} from '../../services/advisorService';
import { cn, formatCurrency, getCurrentMonth, getCurrentYear } from '../../lib/utils';
import type { AdvisorReport, Budget, Transaction } from '../../types';
import Header from '../../components/layout/Header';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import EmptyState from '../../components/ui/EmptyState';
import { ChartSkeleton } from '../../components/ui/Skeleton';

/** Bungkus listener berbasis-callback jadi Promise (pola dashboard). */
function fetchOnce<T>(subscribe: (cb: (data: T) => void, errCb?: (e: Error) => void) => () => void): Promise<T> {
  return new Promise((resolve) => {
    const unsub = subscribe(
      (data) => { unsub(); resolve(data); },
      (e) => { console.error('Advisor: gagal memuat data awal, degrade ke kosong', e); unsub(); resolve([] as unknown as T); },
    );
  });
}

const PRIORITY_STYLES: Record<string, string> = {
  high: 'bg-red-500/10 text-red-600 dark:text-red-300',
  medium: 'bg-amber-500/10 text-amber-600 dark:text-amber-300',
  low: 'bg-blue-500/10 text-blue-600 dark:text-blue-300',
};

const PRIORITY_LABELS: Record<string, string> = { high: 'Prioritas', medium: 'Sedang', low: 'Opsional' };

export default function AdvisorPage() {
  const { authUser } = useAuthStore();
  const navigate = useNavigate();
  const [data, setData] = useState<AdvisorInput | null>(null);
  const [report, setReport] = useState<AdvisorReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [aiLoading, setAiLoading] = useState(false);

  const loadData = useCallback(async () => {
    if (!authUser) return;
    setLoading(true);
    const [transactions, budgets, wallets, goals, subscriptions] = await Promise.all([
      fetchOnce<Transaction[]>((cb, errCb) => listenToTransactions(authUser.uid, cb, errCb)),
      fetchOnce<Budget[]>((cb, errCb) => listenToBudgets(authUser.uid, cb, errCb)),
      getWalletAccounts(authUser.uid).catch(() => []),
      getSavingGoals(authUser.uid).catch(() => []),
      getSubscriptions(authUser.uid).catch(() => []),
    ]);
    const input: AdvisorInput = {
      transactions,
      budgets,
      subscriptions,
      wallets,
      goals,
      month: getCurrentMonth(),
      year: getCurrentYear(),
    };
    setData(input);
    if (transactions.length === 0) {
      setReport(null);
      setLoading(false);
      return;
    }
    // generate report SELESAI dulu baru loading=false → hindari flash
    // EmptyState "Belum ada data" saat AI masih menyusun rekomendasi.
    const rep = await generateAdvisorReport(input);
    setReport(rep);
    setLoading(false);
  }, [authUser]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const refresh = async () => {
    if (!data || data.transactions.length === 0) return;
    setAiLoading(true);
    const rep = await generateAdvisorReport(data);
    setReport(rep);
    setAiLoading(false);
  };

  const metrics = useMemo(() => (data ? computeAdvisorMetrics(data) : null), [data]);

  if (loading) {
    return (
      <div>
        <Header title="AI Coach" />
        <div className="p-4 lg:p-6 space-y-4 max-w-5xl mx-auto">
          <ChartSkeleton />
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[1, 2, 3, 4].map((i) => <ChartSkeleton key={i} />)}
          </div>
          <ChartSkeleton />
        </div>
      </div>
    );
  }

  if (!report || !metrics) {
    return (
      <div>
        <Header title="AI Coach" />
        <div className="p-4 lg:p-6 max-w-3xl mx-auto">
          <EmptyState
            icon={<BrainCircuit className="w-8 h-8" />}
            title="Belum ada data untuk coaching"
            description="Catat pemasukan dan pengeluaran terlebih dahulu, lalu AI Coach akan menyusun saran keuangan personal untukmu."
            action={
              <Button variant="primary" onClick={() => navigate('/transactions?add=expense')}>
                Tambah Transaksi Pertama
              </Button>
            }
          />
        </div>
      </div>
    );
  }

  const snapshot = [
    { label: 'Pemasukan', value: formatCurrency(metrics.currentMonthIncome), tone: 'text-mint-600 dark:text-mint-300' },
    { label: 'Pengeluaran', value: formatCurrency(metrics.currentMonthExpense), tone: 'text-red-500 dark:text-red-300' },
    { label: 'Rasio Pengeluaran', value: `${Math.round(metrics.expenseRatio * 100)}%`, tone: metrics.expenseRatio >= 0.85 ? 'text-red-500 dark:text-red-300' : 'text-app-text' },
    { label: 'Tingkat Tabungan', value: `${Math.round(metrics.savingsRate * 100)}%`, tone: 'text-app-text' },
  ];

  return (
    <div>
      <Header title="AI Coach" />

      <div className="p-4 lg:p-6 space-y-5 max-w-5xl mx-auto">
        {/* Hero */}
        <Card className="overflow-hidden border-primary-200/70 bg-gradient-to-br from-primary-50 via-app-card to-mint-50/70 dark:border-primary-400/20 dark:from-primary-500/10 dark:via-app-card dark:to-mint-400/10">
          <div className="flex flex-col gap-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-primary-500 to-soft-purple text-white flex items-center justify-center shadow-lg shadow-primary-500/25">
                  <BrainCircuit className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary-600 dark:text-primary-300">
                    AI Financial Coach
                  </p>
                  <h2 className="text-lg font-bold text-app-text">
                    Rencana keuangan personal kamu
                  </h2>
                </div>
              </div>
              <button
                onClick={refresh}
                disabled={aiLoading}
                className="app-icon-button shrink-0"
                aria-label="Muat ulang rekomendasi coach"
              >
                <RefreshCw className={cn('w-4 h-4', aiLoading && 'animate-spin')} />
              </button>
            </div>

            <p className="text-sm leading-relaxed text-app-text">
              {aiLoading ? 'AI Coach sedang menyusun rekomendasi terbaik...' : report.summary}
            </p>
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-mint-500 dark:text-mint-300" />
              <span className="text-[11px] font-medium text-app-subtle">
                {report.generatedBy === 'gemini' ? 'Didukung Gemini AI' : 'Rekomendasi lokal (AI tidak tersedia)'}
              </span>
            </div>
          </div>
        </Card>

        {/* Snapshot */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {snapshot.map((item) => (
            <Card key={item.label} className="!p-4">
              <p className="text-xs text-app-subtle mb-1">{item.label}</p>
              <p className={cn('text-base sm:text-lg font-bold tabular-nums', item.tone)}>{item.value}</p>
            </Card>
          ))}
        </div>

        {/* Advice grid */}
        <div className="grid gap-3 sm:grid-cols-2">
          <AdviceCard
            icon={<TrendingUp className="w-4 h-4" />}
            tone="bg-amber-50 dark:bg-amber-500/12 text-amber-600 dark:text-amber-300"
            title="Saran Pengeluaran"
            items={report.spendingAdvice}
          />
          <AdviceCard
            icon={<PiggyBank className="w-4 h-4" />}
            tone="bg-mint-50 dark:bg-mint-500/12 text-mint-600 dark:text-mint-300"
            title="Strategi Tabungan"
            items={report.savingStrategy}
          />
          <AdviceCard
            icon={<Wallet className="w-4 h-4" />}
            tone="bg-primary-50 dark:bg-primary-500/12 text-primary-600 dark:text-primary-300"
            title="Strategi Budget"
            items={report.budgetStrategy}
          />
          <AdviceCard
            icon={<Repeat2 className="w-4 h-4" />}
            tone="bg-blue-50 dark:bg-blue-500/12 text-blue-600 dark:text-blue-300"
            title="Optimasi Langganan"
            items={report.subscriptionOptimization}
          />
        </div>

        {/* Emergency fund */}
        <Card>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-xl bg-violet-50 dark:bg-violet-500/12 flex items-center justify-center text-violet-600 dark:text-violet-300">
                <Target className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-app-text">Dana Darurat</h3>
                <p className="text-xs text-app-subtle">
                  Target 6 bulan pengeluaran · terkumpul {formatCurrency(report.emergencyFund.currentAmount)}
                </p>
              </div>
            </div>
            <span className="text-xs font-bold tabular-nums text-violet-600 dark:text-violet-300">
              {report.emergencyFund.monthsCoverage >= 99 ? '99+' : report.emergencyFund.monthsCoverage} bulan
            </span>
          </div>
          <div className="h-2 rounded-full bg-app-hover overflow-hidden mb-3">
            <div
              className="h-full rounded-full bg-gradient-to-r from-violet-500 to-soft-purple transition-all duration-700"
              style={{
                width: `${Math.min(100, report.emergencyFund.targetAmount > 0 ? (report.emergencyFund.currentAmount / report.emergencyFund.targetAmount) * 100 : 0)}%`,
              }}
            />
          </div>
          <p className="text-xs leading-relaxed text-app-muted">
            {report.emergencyFund.suggestion}
          </p>
        </Card>

        {/* Action list */}
        <Card>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-9 h-9 rounded-xl bg-red-50 dark:bg-red-500/12 flex items-center justify-center text-red-500 dark:text-red-300">
              <ListChecks className="w-4 h-4" />
            </div>
            <h3 className="text-sm font-semibold text-app-text">Daftar Aksi Personal</h3>
          </div>
          <ol className="space-y-2.5">
            {report.actionList.map((item, index) => (
              <li key={`${item.action}-${index}`} className="flex items-start gap-3">
                <span className={cn(
                  'w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0',
                  PRIORITY_STYLES[item.priority] || PRIORITY_STYLES.medium,
                )}>
                  {index + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-app-text leading-snug">{item.action}</p>
                  <p className="text-[11px] text-app-subtle mt-0.5">
                    {PRIORITY_LABELS[item.priority] || item.priority}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </div>
  );
}

interface AdviceCardProps {
  icon: React.ReactNode;
  tone: string;
  title: string;
  items: string[];
}

function AdviceCard({ icon, tone, title, items }: AdviceCardProps) {
  return (
    <Card>
      <div className="flex items-center gap-2 mb-3">
        <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center', tone)}>
          {icon}
        </div>
        <h3 className="text-sm font-semibold text-app-text">{title}</h3>
      </div>
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item} className="text-xs leading-relaxed text-app-muted flex gap-1.5">
            <span className="text-app-subtle mt-0.5">•</span>
            {item}
          </li>
        ))}
      </ul>
    </Card>
  );
}
