import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { z } from 'zod';
import {
  BadgeDollarSign,
  CreditCard,
  Download,
  Landmark,
  Plus,
  Radar,
  ShieldCheck,
  Sparkles,
  Target,
  Trash2,
  WalletCards,
} from 'lucide-react';
import Header from '../../components/layout/Header';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import EmptyState from '../../components/ui/EmptyState';
import { CardSkeleton } from '../../components/ui/Skeleton';
import { useAuthStore } from '../../store/useAuthStore';
import { useAppStore } from '../../store/useAppStore';
import { getAllTransactions } from '../../services/transactionService';
import { listenToBudgets } from '../../services/budgetService';
import {
  calculateCashflowHealthScore,
  deleteSavingGoal,
  deleteSubscription,
  deleteWalletAccount,
  detectSubscriptions,
  getSavingGoals,
  getSubscriptions,
  getWalletAccounts,
  getWalletProviders,
  saveSavingGoal,
  saveSubscription,
  saveWalletAccount,
  walletVerificationState,
  TEST_ONLY_WALLET_PROVIDERS,
  type WalletProvider,
} from '../../services/professionalSuiteService';
import { exportMonthlyReportPdf } from '../../services/pdfExportService';
import { EXPENSE_CATEGORIES } from '../../config/constants';
import { cn, formatCurrency, getCurrentMonth, getCurrentYear, getMonthName } from '../../lib/utils';
import type {
  Budget,
  SavingGoal,
  SavingGoalFormData,
  Subscription,
  SubscriptionFormData,
  Transaction,
  WalletAccount,
  WalletAccountFormData,
} from '../../types';

type ModalType = 'wallet' | 'goal' | 'subscription' | null;

const walletDefaults: WalletAccountFormData = {
  name: '',
  type: 'bank',
  institution: '',
  balance: 0,
  color: '#8b5cf6',
  providerCode: null,
};

// P0.12 — katalog provider di-fetch dari backend GET /api/wallet-providers
// (authority), dengan fallback statis aman saat offline/error. Backend tetap
// menolak kode di luar katalognya (fail-closed).

const goalDefaults: SavingGoalFormData = {
  name: '',
  targetAmount: 0,
  currentAmount: 0,
  targetDate: new Date(new Date().setMonth(new Date().getMonth() + 6)).toISOString().split('T')[0],
  color: '#10b981',
};

const subscriptionDefaults: SubscriptionFormData = {
  name: '',
  amount: 0,
  cycle: 'monthly',
  categoryId: 'langganan',
  categoryName: 'Langganan',
  nextBillingDate: new Date().toISOString().split('T')[0],
  status: 'active',
};

const walletSchema = z.object({
  name: z.string().min(2, 'Nama wallet minimal 2 karakter.'),
  type: z.enum(['cash', 'bank', 'e-wallet', 'credit', 'investment', 'other']),
  institution: z.string(),
  balance: z.number().min(0, 'Saldo tidak boleh negatif.'),
  color: z.string().min(1),
  providerCode: z.string().nullable().optional(),
});

const goalSchema = z.object({
  name: z.string().min(2, 'Nama target minimal 2 karakter.'),
  targetAmount: z.number().positive('Target nominal wajib lebih dari 0.'),
  currentAmount: z.number().min(0, 'Nominal terkumpul tidak boleh negatif.'),
  targetDate: z.string().min(1, 'Target tanggal wajib diisi.'),
  color: z.string().min(1),
}).refine((data) => data.currentAmount <= data.targetAmount, {
  message: 'Nominal terkumpul tidak boleh melebihi target.',
  path: ['currentAmount'],
});

const subscriptionSchema = z.object({
  name: z.string().min(2, 'Nama subscription minimal 2 karakter.'),
  amount: z.number().positive('Nominal wajib lebih dari 0.'),
  cycle: z.enum(['weekly', 'monthly', 'quarterly', 'yearly']),
  categoryId: z.string().min(1),
  categoryName: z.string().min(1),
  nextBillingDate: z.string().min(1, 'Tanggal billing wajib diisi.'),
  status: z.enum(['active', 'paused', 'cancelled']),
});

export default function ProfessionalSuitePage() {
  const authUser = useAuthStore((s) => s.authUser);
  const addToast = useAppStore((s) => s.addToast);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [loading, setLoading] = useState(true); // Sprint 1.8: cegah flash EmptyState
  const [wallets, setWallets] = useState<WalletAccount[]>([]);
  const [goals, setGoals] = useState<SavingGoal[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [modal, setModal] = useState<ModalType>(null);
  const [walletForm, setWalletForm] = useState(walletDefaults);
  const [walletProviders, setWalletProviders] = useState<WalletProvider[]>([]);
  const [providersLoaded, setProvidersLoaded] = useState(false);
  const [providersError, setProvidersError] = useState(false);
  const [goalForm, setGoalForm] = useState(goalDefaults);
  const [subscriptionForm, setSubscriptionForm] = useState(subscriptionDefaults);

  const currentMonth = getCurrentMonth();
  const currentYear = getCurrentYear();

  const reloadProfessionalData = async () => {
    if (!authUser) return;
    const [walletData, goalData, subscriptionData] = await Promise.all([
      getWalletAccounts(authUser.uid),
      getSavingGoals(authUser.uid),
      getSubscriptions(authUser.uid),
    ]);
    setWallets(walletData);
    setGoals(goalData);
    setSubscriptions(subscriptionData);
  };

  useEffect(() => {
    if (!authUser || providersLoaded) return;
    getWalletProviders().then((res) => {
      if (res.ok) {
        setWalletProviders(res.providers);
        setProvidersError(false);
      } else {
        // Degraded-mode EKSPLISIT (P0.13 §8): API gagal → TIDAK pakai katalog
        // silent mirror. Hanya di lingkungan dev/tailwind-test kita turunkan ke
        // fallback TEST_ONLY; produksi menampilkan error (providersError).
        if (import.meta.env.DEV) {
          setWalletProviders(TEST_ONLY_WALLET_PROVIDERS);
        } else {
          setWalletProviders([]);
          setProvidersError(true);
        }
      }
      setProvidersLoaded(true);
    }).catch(() => setProvidersLoaded(true));
  }, [authUser, providersLoaded]);

  useEffect(() => {
    if (!authUser) return;
    // Reviewer Sprint 1.8: .finally menjamin loading selalu dilepas (sukses/gagal)
    reloadProfessionalData()
      .catch(() => {
        setWallets([]);
        setGoals([]);
        setSubscriptions([]);
      })
      .finally(() => setLoading(false));
    getAllTransactions(authUser.uid).then(setTransactions).catch(() => setTransactions([]));
    const unsubscribe = listenToBudgets(authUser.uid, setBudgets, () => setBudgets([]));
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser]);

  const [detectedSubscriptions, setDetectedSubscriptions] = useState<Partial<SubscriptionFormData>[]>([]);

  useEffect(() => {
    detectSubscriptions(transactions).then(setDetectedSubscriptions).catch(() => setDetectedSubscriptions([]));
  }, [transactions]);

  const healthScore = useMemo(
    () => calculateCashflowHealthScore(transactions, budgets, subscriptions, goals),
    [transactions, budgets, subscriptions, goals]
  );

  const totalWalletBalance = wallets.filter((wallet) => !wallet.archived).reduce((sum, wallet) => sum + wallet.balance, 0);
  const totalGoalProgress = goals.reduce((sum, goal) => sum + goal.currentAmount, 0);
  const totalGoalTarget = goals.reduce((sum, goal) => sum + goal.targetAmount, 0);
  const monthlySubscriptionCost = subscriptions
    .filter((subscription) => subscription.status === 'active')
    .reduce((sum, subscription) => sum + subscription.amount, 0);

  const handleSaveWallet = async () => {
    if (!authUser) return;
    const parsed = walletSchema.safeParse(walletForm);
    if (!parsed.success) {
      addToast({ type: 'warning', title: 'Data belum valid', message: parsed.error.issues[0]?.message });
      return;
    }
    try {
      await saveWalletAccount(authUser.uid, walletForm);
      setWalletForm(walletDefaults);
      setModal(null);
      await reloadProfessionalData();
      addToast({ type: 'success', title: 'Wallet ditambahkan' });
    } catch (error) {
      addToast({ type: 'error', title: 'Gagal menyimpan wallet', message: error instanceof Error ? error.message : undefined });
    }
  };

  const handleSaveGoal = async () => {
    if (!authUser) return;
    const parsed = goalSchema.safeParse(goalForm);
    if (!parsed.success) {
      addToast({ type: 'warning', title: 'Data belum valid', message: parsed.error.issues[0]?.message });
      return;
    }
    try {
      await saveSavingGoal(authUser.uid, goalForm);
      setGoalForm(goalDefaults);
      setModal(null);
      await reloadProfessionalData();
      addToast({ type: 'success', title: 'Saving target ditambahkan' });
    } catch (error) {
      addToast({ type: 'error', title: 'Gagal menyimpan saving target', message: error instanceof Error ? error.message : undefined });
    }
  };

  const handleSaveSubscription = async () => {
    if (!authUser) return;
    const parsed = subscriptionSchema.safeParse(subscriptionForm);
    if (!parsed.success) {
      addToast({ type: 'warning', title: 'Data belum valid', message: parsed.error.issues[0]?.message });
      return;
    }
    try {
      await saveSubscription(authUser.uid, subscriptionForm);
      setSubscriptionForm(subscriptionDefaults);
      setModal(null);
      await reloadProfessionalData();
      addToast({ type: 'success', title: 'Subscription ditambahkan' });
    } catch (error) {
      addToast({ type: 'error', title: 'Gagal menyimpan subscription', message: error instanceof Error ? error.message : undefined });
    }
  };

  const applyDetectedSubscription = (subscription: Partial<SubscriptionFormData>) => {
    setSubscriptionForm({
      name: subscription.name || '',
      amount: subscription.amount || 0,
      cycle: subscription.cycle || 'monthly',
      categoryId: subscription.categoryId || 'sub',
      categoryName: subscription.categoryName || 'Langganan',
      nextBillingDate: subscription.nextBillingDate || new Date().toISOString().split('T')[0],
      status: 'active',
    });
    setModal('subscription');
  };

  const handleExportPdf = () => {
    try {
      exportMonthlyReportPdf({ month: currentMonth, year: currentYear, transactions, healthScore });
    } catch (error) {
      addToast({ type: 'error', title: 'Export gagal', message: error instanceof Error ? error.message : 'Tidak dapat membuka print dialog.' });
    }
  };

  return (
    <div>
      <Header title="Professional Suite" />

      <div className="p-4 lg:p-6 space-y-5 max-w-7xl mx-auto">
        <section className="grid gap-3 lg:grid-cols-[1.2fr_0.8fr]">
          <Card className="overflow-hidden border-primary-200/70 bg-gradient-to-br from-slate-950 via-primary-950 to-emerald-950 text-white dark:border-primary-400/20">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-mint-200">Cashflow Health Score</p>
                <div className="mt-3 flex items-end gap-3">
                  <span className="text-6xl font-black tabular-nums">{healthScore.score}</span>
                  <span className="mb-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-mint-100">
                    {healthScore.grade}
                  </span>
                </div>
                <p className="mt-3 max-w-xl text-sm leading-relaxed text-slate-200">{healthScore.summary}</p>
              </div>
              <Button variant="secondary" size="sm" icon={<Download className="w-4 h-4" />} onClick={handleExportPdf}>
                Export PDF
              </Button>
            </div>
            <div className="mt-5 grid gap-2 sm:grid-cols-4">
              {[
                ['Saving rate', healthScore.savingsRate],
                ['Expense ratio', healthScore.expenseRatio],
                ['Budget discipline', healthScore.budgetDiscipline],
                ['Goal progress', healthScore.goalProgress],
              ].map(([label, value]) => (
                <div key={label} className="rounded-2xl border border-white/10 bg-white/8 p-3">
                  <p className="text-[11px] text-slate-300">{label}</p>
                  <p className="mt-1 text-lg font-bold tabular-nums">{Number(value).toFixed(0)}%</p>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <div className="flex items-center gap-3 mb-3">
              <ShieldCheck className="w-5 h-5 text-mint-500 dark:text-mint-300" />
              <h3 className="text-sm font-bold text-app-text">Next best actions</h3>
            </div>
            <div className="space-y-2">
              {healthScore.actions.map((action) => (
                <p key={action} className="rounded-xl bg-app-hover/70 p-3 text-xs leading-relaxed text-app-muted">
                  {action}
                </p>
              ))}
            </div>
          </Card>
        </section>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Metric title="Total wallet" value={formatCurrency(totalWalletBalance)} icon={<WalletCards />} />
          <Metric title="Goal terkumpul" value={formatCurrency(totalGoalProgress)} icon={<Target />} />
          <Metric title="Target goal" value={formatCurrency(totalGoalTarget)} icon={<BadgeDollarSign />} />
          <Metric title="Subscription/bln" value={formatCurrency(monthlySubscriptionCost)} icon={<CreditCard />} />
        </div>

        <Link
          to="/suite/ai-search"
          className="flex flex-col gap-3 rounded-2xl border border-primary-200/70 bg-primary-50/70 p-4 transition-all hover:-translate-y-0.5 hover:shadow-lg dark:border-primary-400/20 dark:bg-primary-500/8 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary-600 text-white shadow-sm shadow-primary-500/20">
              <Sparkles className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-app-text">AI Search</p>
              <p className="mt-1 text-xs leading-relaxed text-app-muted">Cari transaksi, insight, panduan, Gmail Sync, dan bukti dengan bahasa natural.</p>
            </div>
          </div>
          <span className="text-sm font-bold text-primary-600 dark:text-primary-200">Buka AI Search</span>
        </Link>

        <section className="grid gap-4 lg:grid-cols-3">
          <Panel
            title="Multi-Wallet"
            icon={<Landmark className="w-5 h-5" />}
            action={() => setModal('wallet')}
          >
            {loading ? (
              <CardSkeleton />
            ) : wallets.length === 0 ? (
              <MiniEmpty title="Belum ada wallet" />
            ) : wallets.map((wallet) => {
              const provider = wallet.providerCode ? walletProviders.find((p) => p.code === wallet.providerCode) : null;
              const vs = walletVerificationState(wallet);
              const balanceState = vs.balance === 'verified'
                ? '✓ Saldo terverifikasi'
                : vs.balance === 'mismatch'
                  ? '⚠ Saldo tidak cocok'
                  : 'Saldo belum terverifikasi';
              return (
                <ListRow
                  key={wallet.id}
                  title={wallet.name}
                  meta={`${provider ? provider.name : wallet.type} • ${provider ? 'Integrasi manual' : wallet.institution || 'Tanpa institusi'}`}
                  sub={`${balanceState}`}
                  value={formatCurrency(wallet.balance)}
                  color={wallet.color}
                  onDelete={() => {
                    if (!authUser) return;
                    deleteWalletAccount(authUser.uid, wallet.id)
                      .then(reloadProfessionalData)
                      .catch((error) => addToast({ type: 'error', title: 'Gagal menghapus wallet', message: error instanceof Error ? error.message : undefined }));
                  }}
                />
              );
            })}
          </Panel>

          <Panel
            title="Saving Target"
            icon={<Target className="w-5 h-5" />}
            action={() => setModal('goal')}
          >
            {loading ? (
              <CardSkeleton />
            ) : goals.length === 0 ? (
              <MiniEmpty title="Belum ada target" />
            ) : goals.map((goal) => {
              const progress = Math.min(100, (goal.currentAmount / goal.targetAmount) * 100);
              return (
                <div key={goal.id} className="rounded-2xl border border-app-border/70 bg-app-card/70 p-3">
                  <ListRow
                    title={goal.name}
                    meta={`Deadline ${goal.targetDate} • ${goal.status}`}
                    value={`${progress.toFixed(0)}%`}
                    color={goal.color}
                    onDelete={() => {
                      if (!authUser) return;
                      deleteSavingGoal(authUser.uid, goal.id)
                        .then(reloadProfessionalData)
                        .catch((error) => addToast({ type: 'error', title: 'Gagal menghapus saving target', message: error instanceof Error ? error.message : undefined }));
                    }}
                  />
                  <div className="mt-3 h-2 rounded-full bg-app-hover overflow-hidden">
                    <div className="h-full rounded-full bg-mint-500" style={{ width: `${progress}%` }} />
                  </div>
                </div>
              );
            })}
          </Panel>

          <Panel
            title="Subscription"
            icon={<CreditCard className="w-5 h-5" />}
            action={() => setModal('subscription')}
          >
            {loading ? (
              <CardSkeleton />
            ) : subscriptions.length === 0 ? (
              <MiniEmpty title="Belum ada subscription" />
            ) : subscriptions.map((subscription) => (
              <ListRow
                key={subscription.id}
                title={subscription.name}
                meta={`${subscription.cycle} • billing ${subscription.nextBillingDate}`}
                value={formatCurrency(subscription.amount)}
                color="#06b6d4"
                onDelete={() => {
                  if (!authUser) return;
                  deleteSubscription(authUser.uid, subscription.id)
                    .then(reloadProfessionalData)
                    .catch((error) => addToast({ type: 'error', title: 'Gagal menghapus subscription', message: error instanceof Error ? error.message : undefined }));
                }}
              />
            ))}
          </Panel>
        </section>

        <Card>
          <div className="flex items-center gap-3 mb-4">
            <Radar className="w-5 h-5 text-primary-500 dark:text-primary-300" />
            <div>
              <h3 className="text-sm font-bold text-app-text">Detected subscription</h3>
              <p className="text-xs text-app-subtle">Rule-based dari pola merchant dan nominal berulang.</p>
            </div>
          </div>
          {detectedSubscriptions.length === 0 ? (
            <EmptyState title="Belum ada pola subscription" description="Sistem akan mendeteksi transaksi berulang bulanan atau tahunan dari histori transaksi." />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {detectedSubscriptions.map((subscription, idx) => (
                <div key={subscription.name || idx} className="rounded-2xl border border-app-border bg-app-card p-3">
                  <p className="text-sm font-semibold text-app-text">{subscription.name}</p>
                  <p className="mt-1 text-xs text-app-muted">{formatCurrency(subscription.amount || 0)} • next {subscription.nextBillingDate}</p>
                  <Button className="mt-3" size="sm" variant="outline" onClick={() => applyDetectedSubscription(subscription)}>
                    Tambahkan
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Modal isOpen={modal === 'wallet'} onClose={() => setModal(null)} title="Tambah Wallet" maxWidth="sm">
        <FormShell onSubmit={handleSaveWallet}>
          <Input label="Nama wallet" value={walletForm.name} onChange={(value) => setWalletForm({ ...walletForm, name: value })} />
          <label className="block text-xs text-app-subtle mb-1" htmlFor="wallet-provider">Provider</label>
          <select
            id="wallet-provider"
            aria-label="Provider"
            value={walletForm.providerCode ?? ''}
            onChange={(event) => {
              const p = event.target.selectedOptions[0];
              setWalletForm({
                ...walletForm,
                providerCode: event.target.value || null,
                institution: event.target.value ? (p?.text || '') : walletForm.institution,
              });
            }}
            className="w-full px-3 py-2.5 rounded-xl app-field text-sm"
          >
            <option value="">Tanpa provider</option>
            <optgroup label="Bank">
              {walletProviders.filter((p) => p.type === 'bank').map((p) => (
                <option key={p.code} value={p.code}>{p.name}</option>
              ))}
            </optgroup>
            <optgroup label="E-Wallet">
              {walletProviders.filter((p) => p.type === 'e_wallet').map((p) => (
                <option key={p.code} value={p.code}>{p.name}</option>
              ))}
            </optgroup>
          </select>
          {providersError ? (
            <p className="text-xs text-warning">
              Katalog provider tidak tersedia. Muat ulang untuk mencoba lagi.
            </p>
          ) : null}
          {(() => {
            const selected = walletProviders.find((p) => p.code === walletForm.providerCode);
            if (!selected) return null;
            return (
              <p className="text-xs text-app-muted">
                {selected.name} — Integrasi otomatis belum tersedia. Akun ditambahkan secara manual.
              </p>
            );
          })()}
          <Input label="Institusi" value={walletForm.institution} onChange={(value) => setWalletForm({ ...walletForm, institution: value })} />
          <Input label="Saldo" type="number" value={walletForm.balance || ''} onChange={(value) => setWalletForm({ ...walletForm, balance: Number(value) })} />
        </FormShell>
      </Modal>

      <Modal isOpen={modal === 'goal'} onClose={() => setModal(null)} title="Tambah Saving Target" maxWidth="sm">
        <FormShell onSubmit={handleSaveGoal}>
          <Input label="Nama target" value={goalForm.name} onChange={(value) => setGoalForm({ ...goalForm, name: value })} />
          <Input label="Target nominal" type="number" value={goalForm.targetAmount || ''} onChange={(value) => setGoalForm({ ...goalForm, targetAmount: Number(value) })} />
          <Input label="Sudah terkumpul" type="number" value={goalForm.currentAmount || ''} onChange={(value) => setGoalForm({ ...goalForm, currentAmount: Number(value) })} />
          <Input label="Target tanggal" type="date" value={goalForm.targetDate} onChange={(value) => setGoalForm({ ...goalForm, targetDate: value })} />
        </FormShell>
      </Modal>

      <Modal isOpen={modal === 'subscription'} onClose={() => setModal(null)} title="Tambah Subscription" maxWidth="sm">
        <FormShell onSubmit={handleSaveSubscription}>
          <Input label="Nama subscription" value={subscriptionForm.name} onChange={(value) => setSubscriptionForm({ ...subscriptionForm, name: value })} />
          <Input label="Nominal" type="number" value={subscriptionForm.amount || ''} onChange={(value) => setSubscriptionForm({ ...subscriptionForm, amount: Number(value) })} />
          <Input label="Billing berikutnya" type="date" value={subscriptionForm.nextBillingDate} onChange={(value) => setSubscriptionForm({ ...subscriptionForm, nextBillingDate: value })} />
          <select
            value={subscriptionForm.categoryId}
            onChange={(event) => {
              const selected = event.target.selectedOptions[0];
              setSubscriptionForm({ ...subscriptionForm, categoryId: event.target.value, categoryName: selected?.text || 'Langganan' });
            }}
            className="w-full px-3 py-2.5 rounded-xl app-field text-sm"
          >
            {EXPENSE_CATEGORIES.map((category) => (
              <option key={category.id} value={category.id}>{category.name}</option>
            ))}
          </select>
        </FormShell>
      </Modal>
    </div>
  );
}

function Metric({ title, value, icon }: { title: string; value: string; icon: React.ReactElement }) {
  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs text-app-subtle">{title}</p>
          <p className="mt-1 text-base font-bold text-app-text tabular-nums">{value}</p>
        </div>
        <div className="w-9 h-9 rounded-2xl bg-primary-500/10 text-primary-500 dark:text-primary-300 flex items-center justify-center">
          {icon}
        </div>
      </div>
    </Card>
  );
}

function Panel({ title, icon, action, children }: { title: string; icon: React.ReactElement; action: () => void; children: React.ReactNode }) {
  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2 text-app-text">
          {icon}
          <h3 className="text-sm font-bold">{title}</h3>
        </div>
        <button onClick={action} className="app-icon-button p-2" aria-label={`Tambah ${title}`}>
          <Plus className="w-4 h-4" />
        </button>
      </div>
      <div className="space-y-3">{children}</div>
    </Card>
  );
}

function MiniEmpty({ title }: { title: string }) {
  return <div className="rounded-2xl border border-dashed border-app-border p-5 text-center text-sm text-app-muted">{title}</div>;
}

function ListRow({ title, meta, sub, value, color, onDelete }: { title: string; meta: string; sub?: string; value: string; color: string; onDelete: () => void }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-3">
      <span className="h-10 w-1.5 rounded-full" style={{ backgroundColor: color }} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-app-text">{title}</p>
        <p className="truncate text-xs text-app-subtle">{meta}</p>
        {sub ? <p className="truncate text-xs text-app-muted">{sub}</p> : null}
      </div>
      <p className="text-xs font-bold text-app-text tabular-nums">{value}</p>
      <button onClick={onDelete} className="app-icon-button p-1.5 text-app-subtle hover:text-red-500" aria-label={`Hapus ${title}`}>
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </motion.div>
  );
}

function FormShell({ children, onSubmit }: { children: React.ReactNode; onSubmit: () => void }) {
  return (
    <div className="space-y-4">
      {children}
      <div className="flex gap-2 pt-2">
        <Button variant="primary" size="sm" fullWidth onClick={onSubmit}>Simpan</Button>
      </div>
    </div>
  );
}

function Input({ label, value, onChange, type = 'text' }: { label: string; value: string | number; onChange: (value: string) => void; type?: string }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-app-muted mb-1.5">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={cn('w-full px-3 py-2.5 rounded-xl app-field text-sm')}
      />
    </label>
  );
}
