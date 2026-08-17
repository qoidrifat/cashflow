/**
 * Gmail Sync — helper murni (tanpa React) yang diekstrak dari GmailSyncPage
 * (Sprint 1.9 refactor). Dipindah agar file halaman lebih ramping, status
 * config reusable, dan logika bisa di-unit-test tanpa DOM.
 */
import { GEMINI_ERROR_CODES } from '../../lib/geminiErrors';
import { extractDomain } from '../../lib/gmailClassifier';
import type { LocalParserResult } from '../../lib/gmailLocalParser';
import { buildTransactionNote, type NoteContext } from '../../lib/transactionNoteBuilder';
import { getCombinedTextForAI } from '../../lib/gmailDocumentExtractor';
import type { SyncEmail } from './gmailLogMapper';
import type {
  PaymentMethod,
  SyncEmailDebug,
  SyncEmailStatus,
  TransactionType,
} from '../../types';

/** Konfigurasi badge status email — dipakai halaman & EmailCard. */
export const STATUS_CONFIG: Record<SyncEmailStatus, { label: string; color: string; bg: string }> = {
  // Kontras light-mode: badge 10px normal-wt butuh 4.5:1 → teks -700 pada bg
  // -50 (pola app: GmailSyncPage run-status pakai text-amber-700 bg-amber-50).
  // -500 (2.x:1) & -600 (3.x:1) GAGAL untuk teks kecil (P2.1 blocking, ter-expose
  // P3.0 saat determinisme scan memuat kartu email sebelum axe).
  auto_accepted: { label: 'Diterima Otomatis', color: 'text-mint-700 dark:text-mint-300', bg: 'bg-mint-50 dark:bg-mint-500/12' },
  auto_skipped: { label: 'Dilewati Otomatis', color: 'text-app-subtle', bg: 'bg-app-hover/60' },
  auto_rejected: { label: 'Ditolak Otomatis', color: 'text-amber-700 dark:text-amber-300', bg: 'bg-amber-50 dark:bg-amber-500/12' },
  needs_review: { label: 'Perlu Review', color: 'text-amber-700 dark:text-amber-300', bg: 'bg-amber-50 dark:bg-amber-500/12' },
  pending_review: { label: 'Pending Review', color: 'text-amber-700 dark:text-amber-300', bg: 'bg-amber-50 dark:bg-amber-500/12' },
  approved: { label: 'Disetujui', color: 'text-mint-700 dark:text-mint-300', bg: 'bg-mint-50 dark:bg-mint-500/12' },
  rejected: { label: 'Ditolak', color: 'text-red-700 dark:text-red-300', bg: 'bg-red-50 dark:bg-red-500/12' },
  skipped: { label: 'Dilewati', color: 'text-app-subtle', bg: 'bg-app-hover/80' },
  duplicate: { label: 'Duplikat', color: 'text-purple-700 dark:text-purple-300', bg: 'bg-purple-50 dark:bg-purple-500/12' },
  failed: { label: 'Gagal Teknis', color: 'text-red-700 dark:text-red-300', bg: 'bg-red-50 dark:bg-red-500/12' },
  retry_later: { label: 'Coba Lagi Nanti', color: 'text-blue-700 dark:text-blue-300', bg: 'bg-blue-50 dark:bg-blue-500/12' },
  config_error: { label: 'Config Error', color: 'text-rose-700 dark:text-rose-300', bg: 'bg-rose-50 dark:bg-rose-500/12' },
  gmail_permission_required: { label: 'Butuh Izin Gmail', color: 'text-blue-700 dark:text-blue-300', bg: 'bg-blue-50 dark:bg-blue-500/12' },
  paused_config_error: { label: 'Config Error', color: 'text-rose-700 dark:text-rose-300', bg: 'bg-rose-50 dark:bg-rose-500/12' },
};

export interface ProcessingStats {
  total: number;
  processed: number;
  pendingReview: number;
  approved: number;
  rejected: number;
  autoAcceptedCount: number;
  autoRejected: number;
  skipped: number;
  duplicate: number;
  failed: number;
  retryLater: number;
  configError: number;
}

export function inferMerchantFromSender(sender: string): string {
  const s = sender.toLowerCase();
  if (s.includes('tiket.com')) return 'tiket.com';
  if (s.includes('kai')) return 'PT. KAI';
  if (s.includes('agoda')) return 'Agoda';
  if (s.includes('traveloka')) return 'Traveloka';
  if (s.includes('grab')) return 'Grab';
  if (s.includes('shopee')) return 'Shopee';
  if (s.includes('tokopedia')) return 'Tokopedia';
  if (s.includes('blibli')) return 'Blibli';
  return 'Unknown';
}

export function inferCategoryFromSender(sender: string): string {
  const s = sender.toLowerCase();
  if (s.includes('tiket') || s.includes('traveloka') || s.includes('agoda')) return 'Travel';
  if (s.includes('kai')) return 'Transportasi';
  if (s.includes('grab') || s.includes('gojek')) return 'Transportasi';
  if (s.includes('shopee') || s.includes('tokopedia')) return 'Belanja';
  return 'Lainnya';
}

export function inferPaymentMethodFromSender(sender: string): string {
  const s = sender.toLowerCase();
  if (s.includes('tiket') || s.includes('agoda') || s.includes('traveloka')) return 'transfer-bank';
  if (s.includes('shopee') || s.includes('tokopedia')) return 'e-wallet';
  return 'transfer-bank';
}

export function isTemporaryGeminiError(errorCode?: string): boolean {
  return (
    errorCode === GEMINI_ERROR_CODES.UNKNOWN ||
    errorCode === GEMINI_ERROR_CODES.TEMPORARY_ERROR ||
    errorCode === GEMINI_ERROR_CODES.NETWORK_ERROR ||
    errorCode === GEMINI_ERROR_CODES.MODEL_UNAVAILABLE ||
    errorCode === GEMINI_ERROR_CODES.EMPTY_RESPONSE ||
    errorCode === GEMINI_ERROR_CODES.TIMEOUT ||
    errorCode === GEMINI_ERROR_CODES.RATE_LIMITED
  );
}

export function buildDebugInfo(
  email: { id: string; subject: string; from: string },
  prefilterDecision: string,
  aiCalled: boolean,
  aiParsedSuccessful: boolean,
  extractedAmount: number | null,
  finalStatus: string,
  errorDetail: string | null,
  aiErrorCode?: string,
  rawResponse?: string,
  cleanedResponse?: string,
  fallbackUsed?: boolean,
  modelUsed?: string,
  extra?: Pick<SyncEmailDebug, 'skipReason' | 'matchedRule' | 'detectedPromoAmount' | 'amountIgnored'>,
): SyncEmailDebug {
  return {
    gmailMessageId: email.id,
    senderDomain: extractDomain(email.from),
    subjectClassification: email.subject.substring(0, 80),
    prefilterDecision,
    aiCalled,
    aiParsedSuccessful,
    extractedAmount,
    extractedMerchant: null,
    confidenceScore: null,
    finalStatus,
    errorDetail,
    aiErrorCode,
    rawResponse: rawResponse?.substring(0, 500),
    cleanedResponse: cleanedResponse?.substring(0, 500),
    fallbackUsed,
    modelUsed,
    skipReason: extra?.skipReason,
    matchedRule: extra?.matchedRule,
    detectedPromoAmount: extra?.detectedPromoAmount,
    amountIgnored: extra?.amountIgnored,
  };
}

export function buildSyncEmailFromLocalParser(
  email: {
    id: string;
    subject: string;
    from: string;
    date: string;
    body: string;
  },
  localResult: LocalParserResult,
): SyncEmail {
  const extracted = localResult.extracted || null;
  const amount = extracted?.amount || localResult.fallbackResult?.amount || null;
  const status: SyncEmailStatus =
    localResult.decision === 'auto_accept'
      ? 'auto_accepted'
      : localResult.decision === 'auto_reject'
        ? 'auto_rejected'
        : 'auto_skipped';

  const noteContext: NoteContext = {
    subject: email.subject,
    sender: email.from,
    merchant: extracted?.merchant || null,
    category: extracted?.category || null,
    amount: amount || null,
    transactionType: normalizeTransactionType(extracted?.transaction_type) || null,
    paymentMethod: extracted?.payment_method || null,
    aiNote: null,
    aiDescription: null,
    fallbackNote: extracted?.description || localResult.reason,
    body: email.body,
  };

  return {
    id: email.id,
    subject: email.subject,
    from: email.from,
    date: email.date,
    body: email.body,
    status,
    amount: status === 'auto_accepted' ? amount : null,
    confidence: localResult.confidence,
    merchant: status === 'auto_accepted' ? extracted?.merchant || email.from : null,
    category: status === 'auto_accepted' ? extracted?.category || 'Lainnya' : null,
    paymentMethod: status === 'auto_accepted' ? extracted?.payment_method || 'Lainnya' : null,
    transactionType: normalizeTransactionType(extracted?.transaction_type),
    description: extracted?.description || localResult.reason,
    note: status === 'auto_accepted' ? buildTransactionNote(noteContext) : null,
    extracted,
    reason: localResult.reason,
    debug: buildDebugInfo(
      email,
      `local_${localResult.decision}`,
      false,
      false,
      typeof amount === 'number' ? amount : null,
      status,
      localResult.reason,
      localResult.errorCode,
      undefined,
      undefined,
      Boolean(localResult.fallbackResult?.fallbackUsed || localResult.extracted),
      localResult.parserSource,
      {
        matchedRule: localResult.matchedRule,
        skipReason: localResult.errorCode,
      },
    ),
  };
}

export function didUseAttachmentExtraction(email: SyncEmail): boolean {
  return (
    email.debug?.aiErrorCode === 'ATTACHMENT_AMOUNT_FOUND' ||
    email.reason?.toLowerCase().includes('dokumen lampiran') === true ||
    email.description?.toLowerCase().includes('dokumen email') === true
  );
}

export function buildAiInputForEmail(
  email: {
    subject: string;
    from: string;
    date: string;
    body: string;
    fullContent?: string;
    attachments?: Array<{ extractedText?: string }>;
  },
  localResult?: LocalParserResult | null,
): string {
  const combined = getCombinedTextForAI(email.body, email.fullContent, email.attachments);
  const cleaned = combined
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 6000);

  return [
    `Subject: ${email.subject}`,
    `Sender: ${email.from}`,
    `Tanggal email: ${email.date}`,
    `Alasan butuh AI: ${localResult?.reason || 'Email ambigu setelah rules lokal'}`,
    localResult?.fallbackResult?.amount ? `Nominal kandidat parser lokal: ${localResult.fallbackResult.amount}` : '',
    '',
    'Isi email ringkas:',
    cleaned,
  ].filter(Boolean).join('\n');
}

export function calculateStats(emails: SyncEmail[]): ProcessingStats {
  const stats: ProcessingStats = {
    total: emails.length,
    processed: emails.length,
    pendingReview: 0,
    autoAcceptedCount: 0,
    approved: 0,
    rejected: 0,
    autoRejected: 0,
    skipped: 0,
    duplicate: 0,
    failed: 0,
    retryLater: 0,
    configError: 0,
  };

  for (const email of emails) {
    switch (email.status) {
      case 'auto_accepted': stats.autoAcceptedCount++; break;
      case 'needs_review':
      case 'pending_review': stats.pendingReview++; break;
      case 'approved': stats.approved++; break;
      case 'rejected': stats.rejected++; break;
      case 'auto_skipped':
      case 'skipped': stats.skipped++; break;
      case 'auto_rejected': stats.autoRejected++; break;
      case 'duplicate': stats.duplicate++; break;
      case 'failed': stats.failed++; break;
      case 'retry_later': stats.retryLater++; break;
      case 'config_error': stats.configError++; break;
      case 'gmail_permission_required': stats.configError++; break;
      case 'paused_config_error': stats.configError++; break;
    }
  }

  return stats;
}

export function normalizeTransactionType(type?: TransactionType): TransactionType {
  if (type === 'income' || type === 'expense' || type === 'transfer' || type === 'refund') return type;
  return 'expense';
}

export function normalizePaymentMethod(method?: string): PaymentMethod {
  const normalized = (method || '').toLowerCase();
  if (normalized.includes('qris')) return 'qris';
  if (normalized.includes('wallet') || normalized.includes('gopay') || normalized.includes('ovo') || normalized.includes('dana')) return 'e-wallet';
  if (normalized.includes('debit')) return 'kartu-debit';
  if (normalized.includes('kredit') || normalized.includes('credit')) return 'kartu-kredit';
  if (normalized.includes('transfer') || normalized.includes('bank')) return 'transfer-bank';
  if (normalized.includes('cash')) return 'cash';
  return 'lainnya-payment';
}

export function normalizeDate(date: string): string {
  const parsedDate = new Date(date);
  if (Number.isNaN(parsedDate.getTime())) return new Date().toISOString().split('T')[0];
  return parsedDate.toISOString().split('T')[0];
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, 'dan')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'lainnya';
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
