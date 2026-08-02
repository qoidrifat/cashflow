/**
 * Confidence Scorer — Composite scoring for Gmail Sync auto-decision
 *
 * Menghitung confidence score final berdasarkan gabungan sinyal dari:
 * - Prefilter (gmailClassifier)
 * - AI extraction (geminiService)
 * - Fallback parser (geminiFallbackParser)
 * - Rule-based checks
 *
 * Threshold:
 *   >= 0.88  → auto_accept (jika validator juga lulus)
 *   0.60-0.87 → needs_review
 *   < 0.60   → auto_skip / auto_rejected tergantung konteks
 */

import type { ExtractedTransaction, RiskFlags, ConfidenceBreakdown } from '../types';
import { getPromoCashbackMatch } from './promoCashbackClassifier';
import { isTrustedTransactionDomain, extractDomain } from './gmailClassifier';

// ===================== Scoring Constants =====================

const SCORE = {
  // Positive signals
  TRUSTED_SENDER: 0.20,
  STRONG_TRANSACTION_KEYWORD: 0.20,
  AMOUNT_CLEAR: 0.20,
  DATE_CLEAR: 0.10,
  MERCHANT_AND_PAYMENT: 0.10,
  AI_VALID_JSON: 0.10,
  FALLBACK_KNOWN_PATTERN: 0.10,

  // Negative penalties
  PROMO_KEYWORD: -0.40,
  CASHBACK_MAX_PENALTY: -0.50,
  MULTIPLE_AMOUNTS: -0.20,
  UNKNOWN_SENDER: -0.15,
  NO_AMOUNT: -0.50,
  CONFLICTING_AI_FALLBACK: -0.20,
  ONLY_FALLBACK_NO_AI: -0.10,
} as const;

// ===================== Risk Detection =====================

export function detectRiskFlags(
  sender: string,
  subject: string,
  body: string,
  extracted?: ExtractedTransaction | null,
  fallbackAmount?: number | null,
): RiskFlags {
  const lowerSubject = subject.toLowerCase();
  const lowerBody = body.toLowerCase();
  const promoCashback = getPromoCashbackMatch(subject, body);

  // Count how many Rp/IDR amounts appear in the body
  const amountMatches = body.match(/Rp\s?[\d.,]+|IDR\s?[\d.,]+/gi);
  const multipleAmounts = (amountMatches?.length || 0) > 1;

  // Unknown sender check
  const domain = extractDomain(sender);
  const isTrusted = isTrustedTransactionDomain(sender);

  // Conflicting AI vs fallback
  const conflictingAIandFallback = extracted?.amount !== undefined
    && fallbackAmount !== null
    && fallbackAmount !== undefined
    && Math.abs((extracted.amount || 0) - fallbackAmount) > 1000;

  // Amount too high (above 100 million IDR)
  const amountTooHigh = (extracted?.amount || 0) > 100_000_000;

  // Only fallback, no AI
  const onlyFallback = extracted === null || extracted === undefined;

  return {
    promoDetected: !!promoCashback.isPromo,
    cashbackPromo: promoCashback.isPromo,
    cardActivation: /kartu\s*(telah|sudah)\s*aktif|request\s*(kartu|card)\s*berhasil|bluspending.*berhasil dibuat/i.test(`${lowerSubject} ${lowerBody}`),
    welcomeEmail: /welcome|selamat\s*datang/i.test(lowerSubject),
    newsletter: /newsletter|buletin|artikel|digest/i.test(`${lowerSubject} ${lowerBody}`),
    multipleAmounts,
    conflictingAIandFallback,
    unknownSender: !isTrusted,
    amountTooHigh,
    noAmount: !extracted?.amount && !fallbackAmount,
    onlyFallbackLowConfidence: onlyFallback && !!fallbackAmount,
  };
}

// ===================== Composite Scoring =====================

export function calculateConfidenceScore(
  sender: string,
  subject: string,
  body: string,
  prefilterDecision: string,
  extracted?: ExtractedTransaction | null,
  fallbackResult?: {
    success: boolean;
    confidence: number;
    amount?: number | null;
  } | null,
): ConfidenceBreakdown {
  const domain = extractDomain(sender);
  const isTrusted = isTrustedTransactionDomain(sender);
  const lowerSubject = subject.toLowerCase();
  const lowerBody = body.toLowerCase();
  const combined = `${lowerSubject} ${lowerBody}`;
  const promoCashback = getPromoCashbackMatch(subject, body);
  const riskFlags = detectRiskFlags(sender, subject, body, extracted, fallbackResult?.amount);

  // ===== Start scoring =====
  let trustedSender = 0;
  let transactionKeyword = 0;
  let amountPresent = 0;
  let datePresent = 0;
  let merchantPaymentMethod = 0;
  let aiValidJson = 0;
  let fallbackKnownPattern = 0;
  let promoPenalty = 0;
  let cashbackMaxPenalty = 0;
  let noAmountPenalty = 0;
  let unknownSenderPenalty = 0;

  // 1. Trusted sender (+0.20)
  if (isTrusted || prefilterDecision === 'send_to_ai') {
    trustedSender = SCORE.TRUSTED_SENDER;
  }

  // 2. Transaction keywords (+0.20)
  const strongTxPattern = /pembayaran|transfer|transaksi|receipt|invoice|refund|tagihan|top\s*up|berhasil|e-?tiket|e-?receipt|booking|order|paid|payment|purchase|struk|dana\s*masuk/i;
  if (strongTxPattern.test(subject)) {
    transactionKeyword = SCORE.STRONG_TRANSACTION_KEYWORD;
  } else if (strongTxPattern.test(combined)) {
    transactionKeyword = SCORE.STRONG_TRANSACTION_KEYWORD * 0.7;
  }

  // 3. Amount present (+0.20)
  const hasAmount = extracted?.amount && extracted.amount >= 1000;
  const fallbackHasAmount = fallbackResult?.success && (fallbackResult.amount || 0) >= 1000;
  if (hasAmount || fallbackHasAmount) {
    amountPresent = SCORE.AMOUNT_CLEAR;
  }

  // 4. Date present (+0.10)
  const hasDate = extracted?.date && /^\d{4}-\d{2}-\d{2}$/.test(extracted.date);
  if (hasDate) {
    datePresent = SCORE.DATE_CLEAR;
  }

  // 5. Merchant & payment method (+0.10)
  if (extracted?.merchant || extracted?.payment_method) {
    merchantPaymentMethod = SCORE.MERCHANT_AND_PAYMENT;
  }

  // 6. AI valid JSON (+0.10)
  if (extracted?.is_transaction !== undefined) {
    aiValidJson = SCORE.AI_VALID_JSON;
  }

  // 7. Fallback known pattern (+0.10)
  if (fallbackResult?.success && fallbackResult.confidence >= 0.60) {
    fallbackKnownPattern = SCORE.FALLBACK_KNOWN_PATTERN;
  }

  // 8. Penalties

  // Promo keyword (-0.40)
  if (promoCashback.isPromo) {
    promoPenalty = SCORE.PROMO_KEYWORD;
  }

  // Cashback maximum promo (-0.50)
  if (riskFlags.cashbackPromo) {
    cashbackMaxPenalty = SCORE.CASHBACK_MAX_PENALTY;
  }

  // No amount (-0.50)
  if (riskFlags.noAmount) {
    noAmountPenalty = SCORE.NO_AMOUNT;
  }

  // Unknown sender (-0.15)
  if (riskFlags.unknownSender) {
    unknownSenderPenalty = SCORE.UNKNOWN_SENDER;
  }

  // Conflicting AI/fallback: -0.20 (applied as a global deduction later)
  let conflictPenalty = 0;
  if (riskFlags.conflictingAIandFallback) {
    conflictPenalty = SCORE.CONFLICTING_AI_FALLBACK;
  }

  // ===== Calculate total =====
  const baseScore = trustedSender + transactionKeyword + amountPresent
    + datePresent + merchantPaymentMethod + aiValidJson + fallbackKnownPattern;

  const totalPenalty = promoPenalty + cashbackMaxPenalty + noAmountPenalty
    + unknownSenderPenalty + conflictPenalty;

  const total = Math.max(0, Math.min(1, baseScore + totalPenalty));

  return {
    total: Math.round(total * 100) / 100,
    components: {
      trustedSender,
      transactionKeyword,
      amountPresent,
      datePresent,
      merchantPaymentMethod,
      aiValidJson,
      fallbackKnownPattern,
      promoPenalty,
      cashbackMaxPenalty,
      noAmountPenalty,
      unknownSenderPenalty,
    },
    riskFlags,
  };
}

// ===================== Decision Helpers =====================

/**
 * Tentukan keputusan awal berdasarkan confidence score saja.
 * Ini adalah REKOMENDASI — keputusan final tetap dari validator.
 */
export function suggestDecision(
  confidence: number,
  isPromo: boolean,
  isCardActivation: boolean,
  isWelcomeEmail: boolean,
  isNewsletter: boolean,
  hasAmount: boolean,
): 'auto_accept' | 'auto_skip' | 'auto_reject' | 'needs_review' {
  // Non-transaction signals override
  if (isPromo) return 'auto_reject';
  if (isCardActivation) return 'auto_skip';
  if (isWelcomeEmail) return 'auto_skip';
  if (isNewsletter) return 'auto_reject';

  // No amount — definitely not a valid transaction
  if (!hasAmount) return 'auto_skip';

  // Confidence-based
  if (confidence >= 0.88) return 'auto_accept';
  if (confidence >= 0.60) return 'needs_review';

  return 'auto_skip';
}
