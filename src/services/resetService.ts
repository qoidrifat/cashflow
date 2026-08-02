import { clearGmailAccessToken } from './authService';

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
}

function clearLocalUserData(userId: string): void {
  LOCAL_DATA_PREFIXES.forEach((prefix) => {
    localStorage.removeItem(`${prefix}${userId}`);
  });
}
