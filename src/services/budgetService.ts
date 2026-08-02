import { apiDelete, apiGet, apiPost, apiPut } from '../config/api';
import { onSSE } from '../lib/sse';
import type { Budget, BudgetFormData, Transaction } from '../types';
import { getBudgetStatus } from '../lib/utils';
import { mapBudget } from './mappers';

const localKey = (userId: string) => `cashflow-local-budgets-${userId}`;

function readLocalBudgets(userId: string): Budget[] {
  try {
    const raw = localStorage.getItem(localKey(userId));
    if (!raw) return [];
    return (JSON.parse(raw) as Budget[]).map((budget) => ({
      ...budget,
      createdAt: new Date(budget.createdAt),
      updatedAt: new Date(budget.updatedAt),
    }));
  } catch {
    return [];
  }
}

function writeLocalBudgets(userId: string, budgets: Budget[]) {
  localStorage.setItem(localKey(userId), JSON.stringify(budgets));
}

async function fetchBudgets(userId: string): Promise<Budget[]> {
  try {
    const rows = await apiGet<any[]>('/api/budgets');
    return (rows || []).map(mapBudget);
  } catch {
    return readLocalBudgets(userId);
  }
}

export function listenToBudgets(
  userId: string,
  callback: (budgets: Budget[]) => void,
  errorCallback?: (error: Error) => void
): () => void {
  fetchBudgets(userId).then(callback).catch(errorCallback);

  const unsub = onSSE('budget:changed', () => {
    fetchBudgets(userId).then(callback).catch(errorCallback);
  });

  return unsub;
}

export async function addBudget(userId: string, data: BudgetFormData): Promise<string> {
  try {
    const res = await apiPost<{ id: string }>('/api/budgets', data);
    return res.id;
  } catch {
    const budgets = readLocalBudgets(userId);
    const id = `local-budget-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const now = new Date();
    writeLocalBudgets(userId, [{
      id,
      userId,
      categoryId: data.categoryId,
      categoryName: data.categoryName,
      amount: data.amount,
      usedAmount: 0,
      month: data.month,
      year: data.year,
      status: 'safe',
      createdAt: now,
      updatedAt: now,
    }, ...budgets]);
    return id;
  }
}

export async function updateBudget(userId: string, budgetId: string, data: Partial<BudgetFormData>): Promise<void> {
  try {
    await apiPut(`/api/budgets/${budgetId}`, data);
  } catch {
    writeLocalBudgets(userId, readLocalBudgets(userId).map((budget) =>
      budget.id === budgetId ? { ...budget, ...data, updatedAt: new Date() } : budget
    ));
  }
}

export async function deleteBudget(userId: string, budgetId: string): Promise<void> {
  try {
    await apiDelete(`/api/budgets/${budgetId}`);
  } catch {
    writeLocalBudgets(userId, readLocalBudgets(userId).filter((budget) => budget.id !== budgetId));
  }
}

export async function updateBudgetUsage(
  userId: string,
  month: number,
  year: number,
  transactions: Transaction[]
): Promise<void> {
  try {
    await apiPost('/api/budgets/update-usage', { month, year, transactions });
  } catch {
    const expenseTransactions = transactions.filter((t) => t.type === 'expense');
    const budgets = readLocalBudgets(userId).map((budget) => {
      if (budget.month !== month || budget.year !== year) return budget;
      const usedAmount = expenseTransactions
        .filter((t) => t.categoryId === budget.categoryId)
        .reduce((sum, t) => sum + t.amount, 0);
      return {
        ...budget,
        usedAmount,
        status: getBudgetStatus(usedAmount, budget.amount),
        updatedAt: new Date(),
      };
    });
    writeLocalBudgets(userId, budgets);
  }
}
