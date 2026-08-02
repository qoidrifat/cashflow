import { useEffect, useState, useMemo, useRef } from 'react';
import { motion } from 'framer-motion';
import { Plus, PiggyBank, AlertTriangle, Sparkles, Wand2 } from 'lucide-react';
import CategoryIcon from '../../components/ui/CategoryIcon';
import { useAuthStore } from '../../store/useAuthStore';
import { useAppStore } from '../../store/useAppStore';
import { listenToBudgets, addBudget, deleteBudget, updateBudget } from '../../services/budgetService';
import { getAllTransactions, listenToTransactions } from '../../services/transactionService';
import { triggerBudgetOverNotification, triggerBudgetWarningNotification } from '../../services/notificationTriggers';
import { buildBudgetRecommendations } from '../../services/aiInsightService';
import Header from '../../components/layout/Header';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import EmptyState from '../../components/ui/EmptyState';
import { StatCardSkeleton } from '../../components/ui/Skeleton';
import type { Budget, BudgetFormData, Transaction } from '../../types';
import { EXPENSE_CATEGORIES } from '../../config/constants';
import {
  formatCurrency,
  getCurrentMonth,
  getCurrentYear,
  getMonthName,
  getBudgetStatus,
  getBudgetStatusColor,
  getBudgetStatusBgColor,
  cn,
} from '../../lib/utils';

export default function BudgetsPage() {
  const { firebaseUser } = useAuthStore();
  const { addToast } = useAppStore();

  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [historicalTransactions, setHistoricalTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [formData, setFormData] = useState<BudgetFormData>({
    categoryId: '',
    categoryName: '',
    amount: 0,
    month: getCurrentMonth(),
    year: getCurrentYear(),
  });

  const currentMonth = getCurrentMonth();
  const currentYear = getCurrentYear();



  useEffect(() => {
    if (!firebaseUser) return;

    const unsubscribeBudgets = listenToBudgets(
      firebaseUser.uid,
      (data) => {
        setBudgets(data);
        setLoading(false);
      },
      () => setLoading(false)
    );

    const unsubscribeTransactions = listenToTransactions(firebaseUser.uid, (data) => {
      setTransactions(data);
    });

    getAllTransactions(firebaseUser.uid)
      .then(setHistoricalTransactions)
      .catch(() => setHistoricalTransactions([]));

    return () => {
      unsubscribeBudgets();
      unsubscribeTransactions();
    };
  }, [firebaseUser]);

  // Track notified budget statuses to avoid duplicates
  const notifiedKeys = useRef(new Set<string>());

  // Calculate budget usage
  const budgetsWithUsage = useMemo(() => {
    const monthlyExpenses = transactions.filter((t) => {
      const date = new Date(t.date);
      return (
        date.getMonth() + 1 === currentMonth &&
        date.getFullYear() === currentYear &&
        t.type === 'expense'
      );
    });

    return budgets.map((budget) => {
      const usedAmount = monthlyExpenses
        .filter((t) => t.categoryId === budget.categoryId)
        .reduce((sum, t) => sum + t.amount, 0);

      return {
        ...budget,
        usedAmount,
        status: getBudgetStatus(usedAmount, budget.amount),
      };
    });
  }, [budgets, transactions, currentMonth, currentYear]);

  // Trigger notifications when budget status changes (warning/overbudget)
  useEffect(() => {
    budgetsWithUsage.forEach((budget) => {
      if (budget.status === 'safe') return;
      const dedupeKey = `budget-${budget.categoryId}-${currentMonth}-${currentYear}-${budget.status}`;
      if (notifiedKeys.current.has(dedupeKey)) return;
      notifiedKeys.current.add(dedupeKey);
      if (!firebaseUser?.uid) return;
      const trigger = budget.status === 'overbudget'
        ? triggerBudgetOverNotification
        : triggerBudgetWarningNotification;
      trigger(firebaseUser.uid, budget, currentMonth, currentYear).catch(() => undefined);
    });
  }, [budgetsWithUsage, firebaseUser?.uid, currentMonth, currentYear]);

  const totalBudget = budgetsWithUsage.reduce((sum, b) => sum + b.amount, 0);
  const totalUsed = budgetsWithUsage.reduce((sum, b) => sum + b.usedAmount, 0);
  const remaining = totalBudget - totalUsed;
  const recommendations = useMemo(
    () => buildBudgetRecommendations(
      historicalTransactions.length > 0 ? historicalTransactions : transactions,
      budgetsWithUsage,
      currentMonth,
      currentYear
    ),
    [historicalTransactions, transactions, budgetsWithUsage, currentMonth, currentYear]
  );

  const handleAddBudget = async () => {
    if (!firebaseUser) return;
    if (!formData.categoryId || !formData.amount) {
      addToast({ type: 'warning', title: 'Lengkapi data', message: 'Pilih kategori dan isi nominal budget' });
      return;
    }

    try {
      await addBudget(firebaseUser.uid, formData);
      addToast({ type: 'success', title: 'Budget berhasil ditambahkan' });
      setShowAddModal(false);
      setFormData({ categoryId: '', categoryName: '', amount: 0, month: currentMonth, year: currentYear });
    } catch {
      addToast({ type: 'error', title: 'Gagal menambahkan budget' });
    }
  };

  const handleDeleteBudget = async (budgetId: string) => {
    if (!firebaseUser) return;
    try {
      await deleteBudget(firebaseUser.uid, budgetId);
      addToast({ type: 'success', title: 'Budget berhasil dihapus' });
      setShowDeleteConfirm(null);
    } catch {
      addToast({ type: 'error', title: 'Gagal menghapus budget' });
    }
  };

  const handleApplyRecommendation = async (recommendationId: string) => {
    if (!firebaseUser) return;
    const recommendation = recommendations.find((item) => item.categoryId === recommendationId);
    if (!recommendation) return;

    if (recommendation.existingBudgetId) {
      try {
        await updateBudget(firebaseUser.uid, recommendation.existingBudgetId, {
          amount: recommendation.suggestedBudget,
          month: currentMonth,
          year: currentYear,
        });
        addToast({ type: 'success', title: 'Budget diperbarui', message: 'Nominal sudah mengikuti rekomendasi AI.' });
      } catch {
        addToast({ type: 'error', title: 'Gagal memperbarui budget' });
      }
      return;
    }

    setFormData({
      categoryId: recommendation.categoryId,
      categoryName: recommendation.categoryName,
      amount: recommendation.suggestedBudget,
      month: currentMonth,
      year: currentYear,
    });
    setShowAddModal(true);
  };

  return (
    <div>
      <Header title={`Budget ${getMonthName(currentMonth)} ${currentYear}`} />

      <div className="p-4 lg:p-6 space-y-5 max-w-4xl mx-auto">
        {/* Summary */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Card>
            <p className="text-xs text-app-subtle mb-1">Total Budget</p>
            <p className="text-base sm:text-lg font-bold text-app-text tabular-nums">
              {formatCurrency(totalBudget)}
            </p>
          </Card>
          <Card>
            <p className="text-xs text-app-subtle mb-1">Terpakai</p>
            <p className="text-base sm:text-lg font-bold text-red-500 dark:text-red-300 tabular-nums">
              {formatCurrency(totalUsed)}
            </p>
          </Card>
          <Card>
            <p className="text-xs text-app-subtle mb-1">Sisa</p>
            <p className={cn(
              'text-base sm:text-lg font-bold tabular-nums',
              remaining >= 0 ? 'text-mint-500 dark:text-mint-300' : 'text-red-500 dark:text-red-300'
            )}>
              {formatCurrency(remaining)}
            </p>
          </Card>
        </div>

        {/* Add button */}
        <Button
          variant="primary"
          size="sm"
          fullWidth
          icon={<Plus className="w-4 h-4" />}
          onClick={() => setShowAddModal(true)}
        >
          Tambah Budget
        </Button>

        {/* Smart budget recommendations */}
        <Card className="border-primary-200/70 bg-gradient-to-br from-primary-50 via-app-card to-mint-50/70 dark:border-primary-400/20 dark:from-primary-500/10 dark:via-app-card dark:to-mint-400/10">
          <div className="flex items-start gap-3 mb-4">
            <div className="w-10 h-10 rounded-2xl bg-primary-500 text-white flex items-center justify-center shadow-lg shadow-primary-500/20">
              <Wand2 className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary-600 dark:text-primary-300">
                Smart Budget Recommendation
              </p>
              <h3 className="text-base font-bold text-app-text">Saran budget dari histori 3 bulan</h3>
            </div>
          </div>

          {recommendations.length > 0 ? (
            <div className="space-y-3">
              {recommendations.map((recommendation) => (
                <div
                  key={recommendation.categoryId}
                  className="rounded-2xl border border-app-border/70 bg-app-card/75 p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <CategoryIcon
                        name={recommendation.categoryName}
                        type="expense"
                        size="sm"
                        animated
                        animationVariant="soft"
                      />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold text-app-text">{recommendation.categoryName}</p>
                          <span className="rounded-full bg-app-hover px-2 py-0.5 text-[10px] font-semibold text-app-muted">
                            {recommendation.confidence === 'high' ? 'Confidence tinggi' : recommendation.confidence === 'medium' ? 'Confidence sedang' : 'Data terbatas'}
                          </span>
                        </div>
                        <p className="mt-1 text-xs leading-relaxed text-app-muted">
                          {recommendation.reason}
                        </p>
                      </div>
                    </div>
                    <Button
                      variant={recommendation.action === 'keep' ? 'ghost' : 'primary'}
                      size="sm"
                      onClick={() => handleApplyRecommendation(recommendation.categoryId)}
                      disabled={recommendation.action === 'keep'}
                    >
                      {recommendation.action === 'create' ? 'Buat' : recommendation.action === 'keep' ? 'Aman' : 'Terapkan'}
                    </Button>
                  </div>

                  <div className="grid grid-cols-3 gap-2 mt-3 text-xs">
                    <div className="rounded-xl bg-app-hover/70 p-2">
                      <p className="text-app-subtle">Rata-rata</p>
                      <p className="font-semibold text-app-text tabular-nums">
                        {formatCurrency(recommendation.averageLastThreeMonths)}
                      </p>
                    </div>
                    <div className="rounded-xl bg-app-hover/70 p-2">
                      <p className="text-app-subtle">Saat ini</p>
                      <p className="font-semibold text-app-text tabular-nums">
                        {formatCurrency(recommendation.currentBudget)}
                      </p>
                    </div>
                    <div className="rounded-xl bg-app-hover/70 p-2">
                      <p className="text-app-subtle">Saran</p>
                      <p className="font-semibold text-mint-600 dark:text-mint-300 tabular-nums">
                        {formatCurrency(recommendation.suggestedBudget)}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-app-border bg-app-card/60 p-4 text-center">
              <Sparkles className="w-5 h-5 mx-auto mb-2 text-primary-500 dark:text-primary-300" />
              <p className="text-sm font-semibold text-app-text">Belum cukup histori</p>
              <p className="mt-1 text-xs leading-relaxed text-app-muted">
                Rekomendasi akan muncul setelah ada transaksi pengeluaran pada 3 bulan sebelumnya.
              </p>
            </div>
          )}
        </Card>

        {/* Budget list */}
        <div className="space-y-3">
          {loading ? (
            [1, 2, 3].map((i) => <StatCardSkeleton key={i} />)
          ) : budgetsWithUsage.length === 0 ? (
            <EmptyState
              icon={<PiggyBank className="w-8 h-8" />}
              title="Belum ada budget"
              description="Buat budget bulanan untuk kategori pengeluaran"
              action={
                <Button variant="primary" size="sm" onClick={() => setShowAddModal(true)}>
                  Buat Budget
                </Button>
              }
            />
          ) : (
            budgetsWithUsage.map((budget, i) => {
              const percentage = budget.amount > 0
                ? Math.min((budget.usedAmount / budget.amount) * 100, 100)
                : 0;
              const statusColor = getBudgetStatusColor(budget.status);
              const statusBg = getBudgetStatusBgColor(budget.status);

              return (
                <motion.div
                  key={budget.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                >
                  <Card className="relative overflow-hidden">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <CategoryIcon
                          name={budget.categoryName}
                          type="expense"
                          size="sm"
                          animated
                          animationVariant={budget.status !== 'safe' ? 'warning' : 'soft'}
                        />
                        <div>
                          <h3 className="text-sm font-semibold text-app-text">
                            {budget.categoryName}
                          </h3>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-xs text-app-subtle">
                            {formatCurrency(budget.usedAmount)} / {formatCurrency(budget.amount)}
                          </span>
                          {budget.status === 'overbudget' && (
                            <AlertTriangle className="w-3 h-3 text-red-500" />
                          )}
                        </div>
                      </div>
                      <span className={cn('text-xs font-medium', statusColor)}>
                        {budget.status === 'safe' ? 'Aman' : budget.status === 'warning' ? 'Waspada' : 'Overbudget'}
                      </span>
                      </div>
                    </div>

                    {/* Progress bar */}
                    <div className="h-2 bg-app-hover/80 rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${percentage}%` }}
                        transition={{ duration: 0.5, delay: i * 0.1 }}
                        className={cn('h-full rounded-full transition-all', statusBg)}
                      />
                    </div>

                    <button
                      onClick={() => setShowDeleteConfirm(budget.id)}
                      className="absolute top-3 right-3 p-1 app-icon-button hover:text-red-500 dark:hover:text-red-300 opacity-0 group-hover:opacity-100"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </Card>
                </motion.div>
              );
            })
          )}
        </div>
      </div>

      {/* Add budget modal */}
      <Modal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        title="Tambah Budget"
        maxWidth="sm"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-app-muted mb-1.5">
              Kategori
            </label>
            <select
              value={formData.categoryId}
              onChange={(e) => {
                const selected = e.target.selectedOptions[0];
                setFormData({
                  ...formData,
                  categoryId: e.target.value,
                  categoryName: selected?.text || '',
                });
              }}
              className="w-full px-3 py-2.5 rounded-xl app-field text-sm"
            >
              <option value="">Pilih kategori</option>
              {[ 
                ...EXPENSE_CATEGORIES,
              ].map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-app-muted mb-1.5">
              Nominal Budget
            </label>
            <input
              type="number"
              value={formData.amount || ''}
              onChange={(e) => setFormData({ ...formData, amount: Number(e.target.value) })}
              placeholder="Rp 1.000.000"
              className="w-full px-3 py-2.5 rounded-xl app-field text-sm"
            />
          </div>

          <div className="flex gap-2 pt-2">
            <Button variant="ghost" size="sm" fullWidth onClick={() => setShowAddModal(false)}>
              Batal
            </Button>
            <Button variant="primary" size="sm" fullWidth onClick={handleAddBudget}>
              Simpan
            </Button>
          </div>
        </div>
      </Modal>

      {/* Delete confirmation */}
      <Modal
        isOpen={!!showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(null)}
        title="Hapus Budget"
        maxWidth="sm"
      >
        <div className="space-y-4 text-center">
          <p className="text-sm text-app-muted">
            Apakah kamu yakin ingin menghapus budget ini?
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" fullWidth onClick={() => setShowDeleteConfirm(null)}>
              Batal
            </Button>
            <Button
              variant="danger"
              size="sm"
              fullWidth
              onClick={() => showDeleteConfirm && handleDeleteBudget(showDeleteConfirm)}
            >
              Hapus
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
