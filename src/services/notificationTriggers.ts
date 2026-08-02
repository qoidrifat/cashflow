import type { Budget, Transaction } from '../types';
import { formatCurrency } from '../lib/utils';
import {
  adoptNotificationDedupeKey,
  createNotification,
  notificationExistsByDedupeKey,
  upsertNotificationByDedupeKey,
} from './notificationService';
import {
  buildBudgetOverKey,
  buildBudgetOverNotification,
  buildBudgetWarningKey,
  buildBudgetWarningNotification,
  getBudgetUsagePercentage,
} from '../features/notifications/utils/budgetNotificationUtils';

function getLocalDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function buildGmailReviewKey(date = getLocalDateKey()): string {
  return `gmail-review-${date}`;
}

export function buildGmailFailedKey(userId: string, date = getLocalDateKey()): string {
  return `gmail-failed-summary-${userId}-${date}`;
}

export function buildTxReviewKey(transactionId: string): string {
  return `tx-review-${transactionId}`;
}

export async function triggerBudgetWarningNotification(
  userId: string,
  budget: Budget,
  month: number,
  year: number,
): Promise<void> {
  const usage = getBudgetUsagePercentage(budget);
  if (usage < 80 || usage >= 100) return;

  const overKey = buildBudgetOverKey(budget.categoryId, month, year);
  if (await notificationExistsByDedupeKey(userId, overKey)) return;

  const payload = buildBudgetWarningNotification(budget, month, year);
  await createNotification(userId, {
    ...payload,
    metadata: {
      ...payload.metadata,
      suppressIfOverKey: overKey,
    },
    dedupeKey: buildBudgetWarningKey(budget.categoryId, month, year),
  });
}

export async function triggerBudgetOverNotification(
  userId: string,
  budget: Budget,
  month: number,
  year: number,
): Promise<void> {
  const usage = getBudgetUsagePercentage(budget);
  if (usage < 100) return;

  await createNotification(userId, buildBudgetOverNotification(budget, month, year));
}

export async function triggerGmailSyncNotification(
  userId: string,
  summaryOrPendingCount: number | {
    pendingCount: number;
    autoAcceptedCount?: number;
    autoSkippedCount?: number;
    autoRejectedCount?: number;
    failedCount: number;
    retryLaterCount?: number;
    configErrorCount?: number;
    scanDate?: string;
    lastBatchId?: string;
  },
  legacyFailedCount?: number,
): Promise<void> {
  const date = typeof summaryOrPendingCount === 'number'
    ? getLocalDateKey()
    : summaryOrPendingCount.scanDate || getLocalDateKey();
  const pendingCount = typeof summaryOrPendingCount === 'number'
    ? summaryOrPendingCount
    : summaryOrPendingCount.pendingCount;
  const autoAcceptedCount = typeof summaryOrPendingCount === 'number'
    ? 0
    : summaryOrPendingCount.autoAcceptedCount || 0;
  const autoSkippedCount = typeof summaryOrPendingCount === 'number'
    ? 0
    : summaryOrPendingCount.autoSkippedCount || 0;
  const autoRejectedCount = typeof summaryOrPendingCount === 'number'
    ? 0
    : summaryOrPendingCount.autoRejectedCount || 0;
  const failedCount = typeof summaryOrPendingCount === 'number'
    ? legacyFailedCount || 0
    : summaryOrPendingCount.failedCount;
  const retryLaterCount = typeof summaryOrPendingCount === 'number'
    ? 0
    : summaryOrPendingCount.retryLaterCount || 0;
  const configErrorCount = typeof summaryOrPendingCount === 'number'
    ? 0
    : summaryOrPendingCount.configErrorCount || 0;
  const lastBatchId = typeof summaryOrPendingCount === 'number'
    ? undefined
    : summaryOrPendingCount.lastBatchId;
  const failedDedupeKey = buildGmailFailedKey(userId, date);
  const previousDate = getLocalDateKey(new Date(Date.now() - 24 * 60 * 60 * 1000));
  await adoptNotificationDedupeKey(userId, `gmail-failed-${date}`, failedDedupeKey);
  await adoptNotificationDedupeKey(userId, `gmail-failed-${previousDate}`, failedDedupeKey);

  // Build summary parts
  const summaryParts: string[] = [];
  if (autoAcceptedCount > 0) summaryParts.push(`${autoAcceptedCount} diterima otomatis`);
  if (pendingCount > 0) summaryParts.push(`${pendingCount} perlu review`);
  if (autoSkippedCount > 0) summaryParts.push(`${autoSkippedCount} dilewati`);
  if (autoRejectedCount > 0) summaryParts.push(`${autoRejectedCount} ditolak`);

  if (pendingCount > 0) {
    await createNotification(userId, {
      type: 'gmail',
      priority: 'normal',
      title: 'Transaksi Gmail menunggu review',
      message: `${pendingCount} transaksi dari Gmail perlu dicek dan disetujui.` + (autoAcceptedCount > 0 ? ` ${autoAcceptedCount} lainnya diterima otomatis.` : ''),
      actionHref: '/gmail-sync',
      actionLabel: 'Lihat Review',
      dedupeKey: buildGmailReviewKey(date),
      metadata: { pendingCount, autoAcceptedCount },
    });
  } else if (autoAcceptedCount > 0 && failedCount === 0 && retryLaterCount === 0 && configErrorCount === 0) {
    // All accepted, no issues — create a success summary notification
    await createNotification(userId, {
      type: 'success',
      priority: 'low',
      title: 'Sinkronisasi Gmail selesai',
      message: `${autoAcceptedCount} transaksi diterima otomatis.` + (autoSkippedCount > 0 ? ` ${autoSkippedCount} email dilewati.` : '') + (autoRejectedCount > 0 ? ` ${autoRejectedCount} email ditolak.` : ''),
      actionHref: '/gmail-sync',
      actionLabel: 'Lihat Ringkasan',
      dedupeKey: buildGmailReviewKey(date),
      metadata: { autoAcceptedCount, autoSkippedCount, autoRejectedCount },
    });
  }

  const actionableCount = failedCount + retryLaterCount + configErrorCount;

  if (actionableCount > 0) {
    const message = failedCount > 0
      ? `${failedCount} email gagal diekstrak. Coba retry atau gunakan fallback parser.`
      : retryLaterCount > 0
        ? `${retryLaterCount} email perlu dicoba ulang nanti.`
        : `${configErrorCount} email tertahan karena konfigurasi.`;

    await upsertNotificationByDedupeKey(userId, {
      type: 'gmail',
      priority: 'high',
      title: 'Beberapa email gagal diproses',
      message,
      actionHref: '/gmail-sync',
      actionLabel: 'Lihat Gmail Sync',
      dedupeKey: failedDedupeKey,
      metadata: {
        failedCount,
        retryLaterCount,
        configErrorCount,
        actionableCount,
        scanDate: date,
        source: 'gmail_sync',
        lastBatchId,
        updatedAt: new Date().toISOString(),
      },
    });
    return;
  }

  if (await notificationExistsByDedupeKey(userId, failedDedupeKey)) {
    await upsertNotificationByDedupeKey(userId, {
      type: 'success',
      priority: 'normal',
      title: 'Gmail Sync berhasil dipulihkan',
      message: 'Semua email gagal sudah diproses ulang.',
      actionHref: '/gmail-sync',
      actionLabel: 'Lihat Gmail Sync',
      dedupeKey: failedDedupeKey,
      metadata: {
        failedCount: 0,
        retryLaterCount: 0,
        configErrorCount: 0,
        actionableCount: 0,
        scanDate: date,
        source: 'gmail_sync',
        resolved: true,
        resolvedAt: new Date().toISOString(),
      },
    });
  }
}

export async function triggerTransactionReviewNotification(
  userId: string,
  transaction: Transaction,
): Promise<void> {
  if (transaction.source !== 'gmail') return;
  if ((transaction.confidenceScore ?? 1) >= 0.7) return;

  await createNotification(userId, {
    type: 'transaction',
    priority: 'normal',
    title: 'Transaksi perlu ditinjau',
    message: `${transaction.merchant || 'Tidak diketahui'} - ${formatCurrency(transaction.amount)} - ${transaction.categoryName || 'Tidak diketahui'}.`,
    actionHref: '/transactions',
    actionLabel: 'Lihat Transaksi',
    dedupeKey: buildTxReviewKey(transaction.id),
    metadata: {
      transactionId: transaction.id,
      confidenceScore: transaction.confidenceScore,
    },
  });
}
