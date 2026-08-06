import { apiDelete, apiGet, apiPost, apiPut } from '../config/api';
import { onSSE } from '../lib/sse';
import type { PaymentMethod, SortOption, Transaction, TransactionFormData, TransactionSource, TransactionType } from '../types';
import { mapTransaction } from './mappers';
import { triggerTransactionReviewNotification } from './notificationTriggers';

const localKey = (userId: string) => `cashflow-local-transactions-${userId}`;

export class DuplicateTransactionError extends Error {
  duplicate: Transaction;

  constructor(duplicate: Transaction) {
    super(`Transaksi serupa sudah ada: ${duplicate.categoryName} ${duplicate.date}`);
    this.name = 'DuplicateTransactionError';
    this.duplicate = duplicate;
  }
}

function readLocalTransactions(userId: string): Transaction[] {
  try {
    const raw = localStorage.getItem(localKey(userId));
    if (!raw) return [];
    return (JSON.parse(raw) as Transaction[]).map((transaction) => ({
      ...transaction,
      createdAt: new Date(transaction.createdAt),
      updatedAt: new Date(transaction.updatedAt),
    }));
  } catch {
    return [];
  }
}

function writeLocalTransactions(userId: string, transactions: Transaction[]) {
  localStorage.setItem(localKey(userId), JSON.stringify(transactions));
}

function normalizeText(value?: string): string {
  return (value || '').toLowerCase().replace(/[^a-z0-9]/g, '').trim();
}

function isSameTransactionCandidate(
  transaction: Transaction,
  data: TransactionFormData,
  source: TransactionSource,
  gmailMessageId?: string
): boolean {
  if (source === 'gmail' && gmailMessageId && transaction.gmailMessageId === gmailMessageId) return true;
  if (transaction.date !== data.date) return false;
  if (transaction.type !== data.type) return false;
  if (Number(transaction.amount) !== Number(data.amount)) return false;

  const existingMerchant = normalizeText(transaction.merchant);
  const incomingMerchant = normalizeText(data.merchant);
  if (existingMerchant && incomingMerchant) return existingMerchant === incomingMerchant;

  return transaction.categoryId === data.categoryId || transaction.categoryName === data.categoryName;
}

export interface PaginatedTransactionsResult {
  data: Transaction[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface GetTransactionsPaginatedOptions {
  userId: string;
  page?: number;
  pageSize?: number;
  search?: string;
  type?: TransactionType | 'all';
  categoryId?: string;
  paymentMethod?: PaymentMethod | 'all';
  source?: TransactionSource | 'all';
  dateFrom?: string;
  dateTo?: string;
  minAmount?: number | null;
  maxAmount?: number | null;
  sortBy?: SortOption;
  /**
   * Sprint 1.5: false → error API dibiarkan menyebar (tidak fallback ke
   * localStorage) agar UI bisa menampilkan ErrorState yang jujur.
   * Default true = perilaku lama (offline-first: tampilkan cache lokal).
   */
  fallbackToLocal?: boolean;
}

export function listenToTransactions(
  userId: string,
  callback: (transactions: Transaction[]) => void,
  errorCallback?: (error: Error) => void
): () => void {
  const fetchRecent = () => {
    getRecentTransactions(userId, 50).then(callback).catch(errorCallback);
  };

  fetchRecent();

  const unsub1 = onSSE('transaction:created', fetchRecent);
  const unsub2 = onSSE('transaction:updated', fetchRecent);
  const unsub3 = onSSE('transaction:deleted', fetchRecent);

  return () => {
    unsub1();
    unsub2();
    unsub3();
  };
}

export function listenToTransactionChanges(
  _userId: string,
  callback: () => void,
): () => void {
  const unsub1 = onSSE('transaction:created', callback);
  const unsub2 = onSSE('transaction:updated', callback);
  const unsub3 = onSSE('transaction:deleted', callback);

  return () => {
    unsub1();
    unsub2();
    unsub3();
  };
}

async function getRecentTransactions(userId: string, maxResults = 50): Promise<Transaction[]> {
  try {
    const rows = await apiGet<any[]>(`/api/transactions?limit=${maxResults}`);
    return (rows || []).map(mapTransaction);
  } catch {
    return readLocalTransactions(userId);
  }
}

export async function getTransactionsPaginated(
  options: GetTransactionsPaginatedOptions,
): Promise<PaginatedTransactionsResult> {
  const query = new URLSearchParams();
  if (options.page) query.set('page', String(options.page));
  if (options.pageSize) query.set('pageSize', String(options.pageSize));
  if (options.search) query.set('search', options.search);
  if (options.type) query.set('type', options.type);
  if (options.categoryId) query.set('categoryId', options.categoryId);
  if (options.paymentMethod) query.set('paymentMethod', options.paymentMethod);
  if (options.source) query.set('source', options.source);
  if (options.dateFrom) query.set('dateFrom', options.dateFrom);
  if (options.dateTo) query.set('dateTo', options.dateTo);
  if (typeof options.minAmount === 'number') query.set('minAmount', String(options.minAmount));
  if (typeof options.maxAmount === 'number') query.set('maxAmount', String(options.maxAmount));
  if (options.sortBy) query.set('sortBy', options.sortBy);

  try {
    const res = await apiGet<any>(`/api/transactions/paginated?${query.toString()}`);
    return {
      ...res,
      data: (res.data || []).map(mapTransaction),
    };
  } catch (err) {
    // Sprint 1.5: panggil dengan fallbackToLocal:false bila error harus
    // sampai ke UI (mis. ringkasan profil) — jangan menelan error jadi
    // "Belum ada transaksi" yang menyesatkan saat backend down.
    if (options.fallbackToLocal === false) throw err;
    const rows = readLocalTransactions(options.userId);
    return {
      data: rows,
      page: 1,
      pageSize: 50,
      total: rows.length,
      totalPages: 1,
      hasNextPage: false,
      hasPreviousPage: false,
    };
  }
}

export async function findDuplicateTransaction(
  userId: string,
  data: TransactionFormData,
  source: TransactionSource = 'manual',
  gmailMessageId?: string
): Promise<Transaction | null> {
  const recent = await getRecentTransactions(userId, 100);
  return recent.find((t) => isSameTransactionCandidate(t, data, source, gmailMessageId)) || null;
}

export async function addTransaction(
  userId: string,
  data: TransactionFormData,
  source: TransactionSource = 'manual',
  gmailMessageId?: string,
  confidenceScore?: number,
  metadata?: Record<string, unknown>,
): Promise<string> {
  const duplicate = await findDuplicateTransaction(userId, data, source, gmailMessageId);
  if (duplicate) throw new DuplicateTransactionError(duplicate);

  try {
    const res = await apiPost<{ id: string }>('/api/transactions', {
      ...data,
      source,
      gmailMessageId,
      confidenceScore,
      metadata: metadata || data.metadata || {},
    });

    if (source === 'gmail' && confidenceScore !== undefined && confidenceScore < 0.7) {
      void triggerTransactionReviewNotification(userId, {
        id: res.id,
        userId,
        ...data,
        merchant: data.merchant || '',
        paymentMethod: data.paymentMethod || 'cash',
        note: data.note || '',
        source,
        gmailMessageId,
        confidenceScore,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    return res.id;
  } catch {
    const transactions = readLocalTransactions(userId);
    const id = `local-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const now = new Date();
    const transaction: Transaction = {
      id,
      userId,
      ...data,
      merchant: data.merchant || '',
      paymentMethod: data.paymentMethod || 'cash',
      note: data.note || '',
      source,
      gmailMessageId,
      confidenceScore,
      metadata: metadata || data.metadata || {},
      createdAt: now,
      updatedAt: now,
    };
    writeLocalTransactions(userId, [transaction, ...transactions]);
    return id;
  }
}

export async function updateTransaction(
  userId: string,
  transactionId: string,
  data: Partial<TransactionFormData>
): Promise<void> {
  try {
    await apiPut(`/api/transactions/${transactionId}`, data);
  } catch {
    writeLocalTransactions(
      userId,
      readLocalTransactions(userId).map((t) => (t.id === transactionId ? { ...t, ...data, updatedAt: new Date() } : t))
    );
  }
}

export async function deleteTransaction(userId: string, transactionId: string): Promise<void> {
  try {
    await apiDelete(`/api/transactions/${transactionId}`);
  } catch {
    writeLocalTransactions(
      userId,
      readLocalTransactions(userId).filter((t) => t.id !== transactionId)
    );
  }
}

export async function getTransaction(userId: string, transactionId: string): Promise<Transaction | null> {
  const transactions = await getRecentTransactions(userId, 500);
  return transactions.find((t) => t.id === transactionId) || null;
}

export async function getTransactionsByDateRange(userId: string, startDate: string, endDate: string): Promise<Transaction[]> {
  const transactions = await getRecentTransactions(userId, 1000);
  return transactions.filter((t) => t.date >= startDate && t.date <= endDate);
}

export async function getAllTransactions(userId: string): Promise<Transaction[]> {
  return getRecentTransactions(userId, 2000);
}

export function downloadTransactionsCSV(transactions: Transaction[]): void {
  const headers = ['id', 'date', 'type', 'amount', 'category', 'merchant', 'paymentMethod', 'source', 'confidenceScore', 'note'];
  const rows = transactions.map((transaction) => [
    transaction.id,
    transaction.date,
    transaction.type,
    transaction.amount,
    transaction.categoryName,
    transaction.merchant,
    transaction.paymentMethod,
    transaction.source,
    transaction.confidenceScore ?? '',
    transaction.note,
  ]);
  const escapeCell = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;
  const csv = [headers, ...rows].map((row) => row.map(escapeCell).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `cashflow-transactions-${new Date().toISOString().split('T')[0]}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function calculateBalance(transactions: Transaction[]): {
  totalIncome: number;
  totalExpense: number;
  balance: number;
} {
  const totalIncome = transactions
    .filter((t) => t.type === 'income' || t.type === 'refund')
    .reduce((sum, t) => sum + t.amount, 0);
  const totalExpense = transactions
    .filter((t) => t.type === 'expense' || t.type === 'transfer')
    .reduce((sum, t) => sum + t.amount, 0);
  return { totalIncome, totalExpense, balance: totalIncome - totalExpense };
}
