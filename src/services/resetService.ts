import { clearGmailAccessToken } from './authService';
import { invalidateAllTransactionsCache } from './transactionService';

const LOCAL_DATA_PREFIXES = [
  'cashflow-local-transactions-',
  'cashflow-local-categories-',
  'cashflow-local-budgets-',
  'cashflow-local-recurring-',
  'cashflow-professional-wallets-',
  'cashflow-professional-goals-',
  'cashflow-professional-subscriptions-',
];

export async function resetUserData(userId: string): Promise<void> {
  clearLocalUserData(userId);
  clearGmailAccessToken();
  // Cache in-memory getAllTransactions ikut dihapus — data user sudah direset,
  // tanpa ini halaman berikutnya menyajikan dataset basi dari cache.
  invalidateAllTransactionsCache(userId);
}

function clearLocalUserData(userId: string): void {
  LOCAL_DATA_PREFIXES.forEach((prefix) => {
    localStorage.removeItem(`${prefix}${userId}`);
  });
}
