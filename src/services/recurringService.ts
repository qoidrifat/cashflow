import { apiDelete, apiGet, apiPost, apiPut } from '../config/api';
import { onSSE } from '../lib/sse';
import type { RecurringFormData, RecurringTransaction } from '../types';
import { mapRecurring } from './supabaseMappers';
import { addTransaction, DuplicateTransactionError } from './transactionService';

const localKey = (userId: string) => `cashflow-local-recurring-${userId}`;

function readLocalRecurring(userId: string): RecurringTransaction[] {
  try {
    const raw = localStorage.getItem(localKey(userId));
    if (!raw) return [];
    return (JSON.parse(raw) as RecurringTransaction[]).map((rt) => ({
      ...rt,
      createdAt: new Date(rt.createdAt),
      updatedAt: new Date(rt.updatedAt),
    }));
  } catch {
    return [];
  }
}

function writeLocalRecurring(userId: string, recurring: RecurringTransaction[]) {
  localStorage.setItem(localKey(userId), JSON.stringify(recurring));
}

export function computeNextDueDate(
  interval: 'daily' | 'weekly' | 'monthly' | 'yearly',
  intervalDay: number,
  fromDate: string
): string {
  const date = new Date(fromDate);
  switch (interval) {
    case 'daily':
      date.setDate(date.getDate() + 1);
      break;
    case 'weekly': {
      const currentDay = date.getDay();
      let daysUntil = intervalDay - currentDay;
      if (daysUntil <= 0) daysUntil += 7;
      date.setDate(date.getDate() + daysUntil);
      break;
    }
    case 'monthly': {
      date.setMonth(date.getMonth() + 1);
      const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
      date.setDate(Math.min(intervalDay, lastDay));
      break;
    }
    case 'yearly':
      date.setFullYear(date.getFullYear() + 1);
      break;
  }
  return date.toISOString().split('T')[0];
}

async function fetchRecurring(userId: string): Promise<RecurringTransaction[]> {
  try {
    const rows = await apiGet<any[]>('/api/recurring');
    return (rows || []).map(mapRecurring);
  } catch {
    return readLocalRecurring(userId);
  }
}

export function listenToRecurringTransactions(
  userId: string,
  callback: (recurring: RecurringTransaction[]) => void,
  errorCallback?: (error: Error) => void
): () => void {
  fetchRecurring(userId).then(callback).catch(errorCallback);

  const unsub = onSSE('recurring:changed', () => {
    fetchRecurring(userId).then(callback).catch(errorCallback);
  });

  return unsub;
}

export async function addRecurringTransaction(userId: string, data: RecurringFormData): Promise<string> {
  const nextDueDate = data.startDate;

  try {
    const res = await apiPost<{ id: string }>('/api/recurring', {
      ...data,
      nextDueDate,
    });
    return res.id;
  } catch {
    const list = readLocalRecurring(userId);
    const id = `local-rec-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const now = new Date();
    const item: RecurringTransaction = {
      id,
      userId,
      type: data.type,
      amount: data.amount,
      categoryId: data.categoryId,
      categoryName: data.categoryName,
      merchant: data.merchant || '',
      paymentMethod: data.paymentMethod || 'cash',
      note: data.note || '',
      interval: data.interval,
      intervalDay: data.intervalDay,
      startDate: data.startDate,
      endDate: data.endDate,
      active: true,
      lastProcessedDate: undefined,
      nextDueDate,
      createdAt: now,
      updatedAt: now,
    };
    writeLocalRecurring(userId, [item, ...list]);
    return id;
  }
}

export async function updateRecurringTransaction(
  userId: string,
  recurringId: string,
  data: Partial<RecurringFormData & { active: boolean; lastProcessedDate: string; nextDueDate: string }>
): Promise<void> {
  try {
    await apiPut(`/api/recurring/${recurringId}`, data);
  } catch {
    writeLocalRecurring(userId, readLocalRecurring(userId).map((rt) =>
      rt.id === recurringId ? { ...rt, ...data, updatedAt: new Date() } : rt
    ));
  }
}

export async function deleteRecurringTransaction(userId: string, recurringId: string): Promise<void> {
  try {
    await apiDelete(`/api/recurring/${recurringId}`);
  } catch {
    writeLocalRecurring(userId, readLocalRecurring(userId).filter((rt) => rt.id !== recurringId));
  }
}

export async function processDueRecurringTransactions(userId: string, todayStr?: string): Promise<number> {
  const dateStr = todayStr || new Date().toISOString().split('T')[0];
  const list = await fetchRecurring(userId).then((items) => items.filter((item) => item.active));

  let created = 0;
  const updatedLocal: RecurringTransaction[] = [];

  for (const rt of list) {
    if (!rt.active) {
      updatedLocal.push(rt);
      continue;
    }
    if (rt.endDate && dateStr > rt.endDate) {
      await updateRecurringTransaction(userId, rt.id, { active: false });
      updatedLocal.push({ ...rt, active: false, updatedAt: new Date() });
      continue;
    }
    if (dateStr < rt.nextDueDate || (rt.lastProcessedDate && dateStr <= rt.lastProcessedDate)) {
      updatedLocal.push(rt);
      continue;
    }

    try {
      await addTransaction(userId, {
        type: rt.type,
        amount: rt.amount,
        categoryId: rt.categoryId,
        categoryName: rt.categoryName,
        merchant: rt.merchant || '',
        paymentMethod: rt.paymentMethod || 'cash',
        note: `[Rutin] ${rt.note || rt.merchant || rt.categoryName}`,
        date: dateStr,
      }, 'manual');
      created++;
    } catch (error) {
      if (!(error instanceof DuplicateTransactionError)) throw error;
    }

    const newNextDue = computeNextDueDate(rt.interval, rt.intervalDay, dateStr);
    await updateRecurringTransaction(userId, rt.id, {
      lastProcessedDate: dateStr,
      nextDueDate: newNextDue,
    });
    updatedLocal.push({ ...rt, lastProcessedDate: dateStr, nextDueDate: newNextDue, updatedAt: new Date() });
  }

  return created;
}

export async function getAllRecurringTransactions(userId: string): Promise<RecurringTransaction[]> {
  return fetchRecurring(userId);
}
