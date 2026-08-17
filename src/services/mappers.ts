import type {
  Budget,
  Category,
  GmailSyncLog,
  RecurringTransaction,
  Subscription,
  AppNotification,
  Transaction,
  WalletAccount,
  SavingGoal,
} from '../types';
import { parseMetadata } from '../features/gmail/gmailLogMapper';

export function toDate(value: unknown): Date {
  return value ? new Date(String(value)) : new Date();
}

export function mapTransaction(row: any): Transaction {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    amount: Number(row.amount || 0),
    categoryId: row.category_id,
    categoryName: row.category_name,
    merchant: row.merchant || '',
    paymentMethod: row.payment_method || 'cash',
    note: row.note || '',
    date: row.transaction_date || row.date,
    source: row.source || 'manual',
    gmailMessageId: row.gmail_message_id || undefined,
    confidenceScore: row.confidence_score === null ? undefined : Number(row.confidence_score),
    fraudFlag: row.fraud_flag || null,
    fraudScore: row.fraud_score === null || row.fraud_score === undefined ? null : Number(row.fraud_score),
    metadata: row.metadata || {},
    // P2.6+: akun ledger (NULL = belum ditautkan) — untuk badge "Belum ditautkan".
    accountId: row.account_id === null || row.account_id === undefined ? null : String(row.account_id),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

export function mapCategory(row: any): Category {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    type: row.type,
    icon: row.icon,
    color: row.color,
    isDefault: !!row.is_default,
    createdAt: toDate(row.created_at),
  };
}

export function mapBudget(row: any): Budget {
  return {
    id: row.id,
    userId: row.user_id,
    categoryId: row.category_id,
    categoryName: row.category_name,
    amount: Number(row.amount || 0),
    usedAmount: Number(row.used_amount || 0),
    month: Number(row.month),
    year: Number(row.year),
    status: row.status || 'safe',
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

export function mapRecurring(row: any): RecurringTransaction {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    amount: Number(row.amount || 0),
    categoryId: row.category_id,
    categoryName: row.category_name,
    merchant: row.merchant || '',
    paymentMethod: row.payment_method || 'cash',
    note: row.note || '',
    interval: row.interval,
    intervalDay: Number(row.interval_day),
    startDate: row.start_date,
    endDate: row.end_date || undefined,
    active: row.active !== false,
    lastProcessedDate: row.last_processed_date || undefined,
    nextDueDate: row.next_due_date,
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

export function mapGmailSyncLog(row: any): GmailSyncLog {
  const metadata = parseMetadata(row.metadata);
  return {
    id: row.id,
    userId: row.user_id,
    messageId: row.gmail_message_id || row.message_id,
    subject: row.subject || 'No Subject',
    sender: row.sender || '',
    senderDomain: row.sender_domain || undefined,
    emailDate: row.email_date || undefined,
    prefilterStatus: row.prefilter_status || undefined,
    aiCalled: row.ai_called ?? undefined,
    aiParsed: row.ai_parsed ?? undefined,
    finalStatus: row.final_status || row.status,
    errorMessage: row.error_message || undefined,
    extractedTransactionId: row.extracted_transaction_id || undefined,
    status: row.final_status || row.status,
    confidenceScore: row.confidence_score === null ? undefined : Number(row.confidence_score),
    syncRunId: row.sync_run_id || undefined,
    errorCode: row.error_code || metadata.errorCode || undefined,
    fallbackUsed: row.fallback_used ?? metadata.fallbackUsed ?? undefined,
    extractedNote: row.extracted_note || metadata.extractedNote || metadata.candidateNote || metadata.note || undefined,
    metadata,
    scannedAt: toDate(row.scanned_at),
  };
}

export function mapNotification(row: any): AppNotification {
  return {
    id: row.id,
    type: row.type,
    priority: row.priority || 'normal',
    title: row.title,
    message: row.message,
    read: !!row.read,
    actionLabel: row.action_label || undefined,
    actionHref: row.action_href || undefined,
    dedupeKey: row.dedupe_key || undefined,
    metadata: row.metadata || {},
    createdAt: row.created_at,
  };
}

export function mapWallet(row: any): WalletAccount {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    type: row.type,
    institution: row.institution || '',
    balance: Number(row.balance || 0),
    color: row.color || '#8b5cf6',
    archived: !!row.archived,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    // P2.5: saldo awal (nullable — tidak menebak 0).
    openingBalance: row.opening_balance === null || row.opening_balance === undefined ? null : Number(row.opening_balance),
    openingBalanceDate: row.opening_balance_date || null,
    currency: row.currency || 'IDR',
    // P2.7: verified balance anchor (dari GET /api/wallets SELECT *).
    realBalance: row.real_balance === null || row.real_balance === undefined ? null : Number(row.real_balance),
    realBalanceDate: row.real_balance_date || null,
    realBalanceVerifiedAt: row.real_balance_verified_at || null,
    balanceAnchorStatus: row.balance_anchor_status || null,
    // P0.11/P0.12 — kode provider (server-derived di GET /api/wallets; null bila belum ada).
    providerCode: row.provider_code || null,
  };
}

export function mapSavingGoal(row: any): SavingGoal {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    targetAmount: Number(row.target_amount || 0),
    currentAmount: Number(row.current_amount || 0),
    targetDate: row.target_date,
    color: row.color || '#10b981',
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapSubscription(row: any): Subscription {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    amount: Number(row.amount || 0),
    cycle: row.cycle,
    categoryId: row.category_id,
    categoryName: row.category_name,
    nextBillingDate: row.next_billing_date,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
