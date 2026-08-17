import { apiDelete, apiGet, apiPost, apiPut } from '../config/api';
import { generateId, getBudgetStatus } from '../lib/utils';
import type {
  Budget,
  CashflowHealthScore,
  SavingGoal,
  SavingGoalFormData,
  Subscription,
  SubscriptionFormData,
  Transaction,
  WalletAccount,
  WalletAccountFormData,
} from '../types';
import { mapSavingGoal, mapSubscription, mapWallet } from './mappers';

type CollectionKey = 'wallets' | 'goals' | 'subscriptions';

export type WalletProvider = { code: string; name: string; type: string; icon: string; enabled: boolean; integration: string };

/**
 * P0.13 — hasil pengambilan katalog provider (single source of truth = backend).
 * `providers` berisi katalog backend ATAU [] (kosong) saat API gagal — TIDAK
 * fallback diam-diam ke mirror production. `ok:false` → UI wajib menampilkan
 * state error/retry, bukan katalog stale.
 */
export type WalletProvidersResult = { ok: boolean; providers: WalletProvider[]; error?: string };

// P0.13 — katalog provider direname jelas: fallback INI hanya untuk test/offline
// development, BUKAN production source of truth. Frontend produksi memakai
// GET /api/wallet-providers (backend). Label eksplisit agar tidak dikira
// catalog produksi kedua.
export const TEST_ONLY_WALLET_PROVIDERS: WalletProvider[] = [
  { code: 'line_bank',  name: 'LINE Bank', type: 'bank',    icon: 'line_bank',  enabled: true, integration: 'manual' },
  { code: 'blu',        name: 'blu',        type: 'bank',    icon: 'blu',        enabled: true, integration: 'manual' },
  { code: 'bank_jago',  name: 'Bank Jago',  type: 'bank',    icon: 'bank_jago',  enabled: true, integration: 'manual' },
  { code: 'shopeepay',  name: 'ShopeePay',  type: 'e_wallet', icon: 'shopeepay', enabled: true, integration: 'manual' },
  { code: 'dana',       name: 'DANA',       type: 'e_wallet', icon: 'dana',      enabled: true, integration: 'manual' },
];

// P0.13 — ambil katalog dari backend (source of truth). Gagal → return ok:false
// + providers:[]. UI menyajikan error/retry. Fallback test TIDAK dipakai di
// produksi (lihat ProfessionalSuitePage — gating DEV_ONLY).
export async function getWalletProviders(): Promise<WalletProvidersResult> {
  try {
    const rows = await apiGet<WalletProvider[]>('/api/wallet-providers');
    if (Array.isArray(rows) && rows.length > 0) return { ok: true, providers: rows };
    return { ok: false, providers: [], error: 'Katalog provider kosong.' };
  } catch (err) {
    return { ok: false, providers: [], error: err instanceof Error ? err.message : 'Katalog provider tidak tersedia.' };
  }
}

/**
 * P0.13 — mapper SEMANTIK deterministic (pure, unit-testable). Memisahkan
 * concern balance-anchor dari domain lain; tidak menyebar `if balance_anchor_status`
 * ke banyak komponen. Kontrak status (jangan digabung):
 *   - registration   : wallet existence (di-handle caller)
 *   - balance        : unverified | verified | mismatch (anchor saja)
 *   - integration    : manual (belum ada integrasi API)
 *   - identity       : not_implemented (tidak dipalsukan)
 *   - ownership      : not_implemented (tidak dipalsukan)
 */
export function walletVerificationState(wallet?: Pick<WalletAccount, 'balanceAnchorStatus'> | null) {
  return {
    balance: wallet?.balanceAnchorStatus === 'verified'
      ? 'verified'
      : wallet?.balanceAnchorStatus === 'mismatch'
        ? 'mismatch'
        : 'unverified',
    integration: 'manual',
    identity: 'not_implemented',
    ownership: 'not_implemented',
  } as const;
}


const keyFor = (userId: string, collection: CollectionKey) => `cashflow-professional-${collection}-${userId}`;

function readCollection<T>(userId: string, collection: CollectionKey): T[] {
  try {
    const raw = localStorage.getItem(keyFor(userId, collection));
    return raw ? JSON.parse(raw) as T[] : [];
  } catch {
    return [];
  }
}

function writeCollection<T>(userId: string, collection: CollectionKey, items: T[]) {
  localStorage.setItem(keyFor(userId, collection), JSON.stringify(items));
}

// ================= WALLET ACCOUNTS =================
export async function getWalletAccounts(userId: string): Promise<WalletAccount[]> {
  try {
    const rows = await apiGet<any[]>('/api/wallets');
    return (rows || []).map(mapWallet);
  } catch {
    return readCollection<WalletAccount>(userId, 'wallets');
  }
}

export async function saveWalletAccount(userId: string, data: WalletAccountFormData): Promise<WalletAccount> {
  const toWallet = (id: string, now: string): WalletAccount => ({
    id,
    userId,
    name: data.name,
    type: data.type,
    institution: data.institution,
    balance: data.balance,
    color: data.color,
    archived: false,
    createdAt: now,
    updatedAt: now,
    // P2.5: saldo awal nullable — tidak menebak 0.
    openingBalance: data.openingBalance ?? null,
    openingBalanceDate: data.openingBalanceDate ?? null,
    currency: data.currency || 'IDR',
  });
  try {
    const res = await apiPost<{ id: string }>('/api/wallets', data);
    const now = new Date().toISOString();
    return toWallet(res.id, now);
  } catch {
    const now = new Date().toISOString();
    const wallet: WalletAccount = toWallet(generateId(), now);
    writeCollection(userId, 'wallets', [wallet, ...readCollection<WalletAccount>(userId, 'wallets')]);
    return wallet;
  }
}

export async function updateWalletAccount(userId: string, walletId: string, data: Partial<WalletAccountFormData>): Promise<void> {
  try {
    await apiPut(`/api/wallets/${walletId}`, data);
  } catch {
    writeCollection(userId, 'wallets', readCollection<WalletAccount>(userId, 'wallets').map((wallet) =>
      wallet.id === walletId ? { ...wallet, ...data, updatedAt: new Date().toISOString() } : wallet
    ));
  }
}

export async function deleteWalletAccount(userId: string, walletId: string): Promise<void> {
  try {
    await apiDelete(`/api/wallets/${walletId}`);
  } catch {
    writeCollection(userId, 'wallets', readCollection<WalletAccount>(userId, 'wallets').filter((wallet) => wallet.id !== walletId));
  }
}

// ================= SAVING GOALS =================
export async function getSavingGoals(userId: string): Promise<SavingGoal[]> {
  try {
    const rows = await apiGet<any[]>('/api/goals');
    return (rows || []).map(mapSavingGoal);
  } catch {
    return readCollection<SavingGoal>(userId, 'goals');
  }
}

export async function saveSavingGoal(userId: string, data: SavingGoalFormData): Promise<SavingGoal> {
  try {
    const res = await apiPost<{ id: string }>('/api/goals', data);
    const now = new Date().toISOString();
    let status: 'on-track' | 'completed' = 'on-track';
    if (data.currentAmount >= data.targetAmount) status = 'completed';
    return { id: res.id, userId, ...data, status, createdAt: now, updatedAt: now };
  } catch {
    const now = new Date().toISOString();
    let status: 'on-track' | 'completed' = 'on-track';
    if (data.currentAmount >= data.targetAmount) status = 'completed';
    const goal: SavingGoal = { id: generateId(), userId, ...data, status, createdAt: now, updatedAt: now };
    writeCollection(userId, 'goals', [goal, ...readCollection<SavingGoal>(userId, 'goals')]);
    return goal;
  }
}

export async function updateSavingGoal(userId: string, goalId: string, data: Partial<SavingGoalFormData>): Promise<void> {
  try {
    await apiPut(`/api/goals/${goalId}`, data);
  } catch {
    writeCollection(userId, 'goals', readCollection<SavingGoal>(userId, 'goals').map((goal) =>
      goal.id === goalId ? { ...goal, ...data, updatedAt: new Date().toISOString() } : goal
    ));
  }
}

export async function deleteSavingGoal(userId: string, goalId: string): Promise<void> {
  try {
    await apiDelete(`/api/goals/${goalId}`);
  } catch {
    writeCollection(userId, 'goals', readCollection<SavingGoal>(userId, 'goals').filter((goal) => goal.id !== goalId));
  }
}

// ================= SUBSCRIPTIONS =================
export async function getSubscriptions(userId: string): Promise<Subscription[]> {
  try {
    const rows = await apiGet<any[]>('/api/subscriptions');
    return (rows || []).map(mapSubscription);
  } catch {
    return readCollection<Subscription>(userId, 'subscriptions');
  }
}

export async function saveSubscription(userId: string, data: SubscriptionFormData): Promise<Subscription> {
  try {
    const res = await apiPost<{ id: string }>('/api/subscriptions', data);
    const now = new Date().toISOString();
    return { id: res.id, userId, ...data, createdAt: now, updatedAt: now };
  } catch {
    const now = new Date().toISOString();
    const item: Subscription = { id: generateId(), userId, ...data, createdAt: now, updatedAt: now };
    writeCollection(userId, 'subscriptions', [item, ...readCollection<Subscription>(userId, 'subscriptions')]);
    return item;
  }
}

export async function updateSubscription(userId: string, subId: string, data: Partial<SubscriptionFormData>): Promise<void> {
  try {
    await apiPut(`/api/subscriptions/${subId}`, data);
  } catch {
    writeCollection(userId, 'subscriptions', readCollection<Subscription>(userId, 'subscriptions').map((sub) =>
      sub.id === subId ? { ...sub, ...data, updatedAt: new Date().toISOString() } : sub
    ));
  }
}

export async function deleteSubscription(userId: string, subId: string): Promise<void> {
  try {
    await apiDelete(`/api/subscriptions/${subId}`);
  } catch {
    writeCollection(userId, 'subscriptions', readCollection<Subscription>(userId, 'subscriptions').filter((sub) => sub.id !== subId));
  }
}

export async function detectSubscriptions(transactions: Transaction[]): Promise<Partial<SubscriptionFormData>[]> {
  const recurringMap = new Map<string, number>();
  for (const t of transactions) {
    if (t.merchant) {
      const key = `${t.merchant.toLowerCase()}:${t.amount}`;
      recurringMap.set(key, (recurringMap.get(key) || 0) + 1);
    }
  }
  const detected: Partial<SubscriptionFormData>[] = [];
  for (const [key, count] of recurringMap.entries()) {
    if (count >= 2) {
      const [merchant, amountStr] = key.split(':');
      detected.push({
        name: merchant.toUpperCase(),
        amount: Number(amountStr),
        cycle: 'monthly',
        categoryName: 'Langganan',
        status: 'active',
      });
    }
  }
  return detected;
}

// ================= HEALTH SCORE =================
export function calculateCashflowHealthScore(
  transactions: Transaction[],
  budgets: Budget[],
  subscriptions: Subscription[],
  goals: SavingGoal[]
): CashflowHealthScore {
  const totalIncome = transactions.filter((t) => t.type === 'income' || t.type === 'refund').reduce((s, t) => s + t.amount, 0);
  const totalExpense = transactions.filter((t) => t.type === 'expense' || t.type === 'transfer').reduce((s, t) => s + t.amount, 0);

  const savingsRate = totalIncome > 0 ? Math.max(0, Math.min(100, ((totalIncome - totalExpense) / totalIncome) * 100)) : 0;
  const expenseRatio = totalIncome > 0 ? Math.min(100, (totalExpense / totalIncome) * 100) : totalExpense > 0 ? 100 : 0;

  const budgetDiscipline = budgets.length === 0
    ? 80
    : Math.round(
      (budgets.filter((b) => getBudgetStatus(b.usedAmount, b.amount) === 'safe').length / budgets.length) * 100
    );

  const totalSubAmount = subscriptions.filter((s) => s.status === 'active').reduce((s, item) => s + item.amount, 0);
  const subscriptionLoad = totalIncome > 0 ? Math.min(100, (totalSubAmount / totalIncome) * 100) : 0;

  const goalProgress = goals.length === 0
    ? 70
    : Math.round(
      (goals.reduce((sum, g) => sum + Math.min(1, g.currentAmount / Math.max(1, g.targetAmount)), 0) / goals.length) * 100
    );

  const rawScore = (savingsRate * 0.35) + (budgetDiscipline * 0.25) + ((100 - subscriptionLoad) * 0.15) + (goalProgress * 0.25);
  const score = Math.round(Math.max(0, Math.min(100, rawScore)));

  let grade: 'excellent' | 'good' | 'fair' | 'critical' = 'fair';
  if (score >= 85) grade = 'excellent';
  else if (score >= 70) grade = 'good';
  else if (score >= 50) grade = 'fair';
  else grade = 'critical';

  const actions: string[] = [];
  if (savingsRate < 20) actions.push('Tingkatkan alokasi tabungan hingga minimal 20% dari total pemasukan.');
  if (budgetDiscipline < 70) actions.push('Beberapa anggaran melebihi batas. Evaluasi kategori pengeluaran terbesar.');
  if (subscriptionLoad > 15) actions.push('Beban langganan cukup tinggi. Batalkan langganan yang jarang digunakan.');
  if (actions.length === 0) actions.push('Kesehatan keuangan stabil. Pertahankan ritme alokasi anggaran dan tabungan.');

  return {
    score,
    grade,
    savingsRate: Math.round(savingsRate),
    expenseRatio: Math.round(expenseRatio),
    budgetDiscipline,
    subscriptionLoad: Math.round(subscriptionLoad),
    goalProgress,
    summary: `Skor Kesehatan Keuangan Anda: ${score}/100 (${grade.toUpperCase()}).`,
    actions,
  };
}
