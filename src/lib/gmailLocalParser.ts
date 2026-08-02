import type { ExtractedTransaction, TransactionType } from '../types';
import { buildFallbackTransactionFromEmail, type FallbackParseResult } from './geminiFallbackParser';
import { getPromoCashbackMatch } from './promoCashbackClassifier';

export type LocalParserDecision = 'auto_accept' | 'auto_skip' | 'auto_reject' | 'send_to_ai';

export interface LocalParserResult {
  decision: LocalParserDecision;
  reason: string;
  confidence: number;
  parserSource: string;
  extracted?: ExtractedTransaction | null;
  errorCode?: string;
  matchedRule?: string;
  fallbackResult?: FallbackParseResult | null;
}

const RULE_VERSION = 'gmail-rules-first-2026-06-21';

const HARD_REJECT_PATTERNS: Array<[RegExp, string]> = [
  [/promo|diskon|newsletter|penawaran|kupon|voucher/i, 'promo_marketing'],
  [/cashback\s*(hingga|s\/d|sampai|up\s*to)/i, 'promo_cashback_limit'],
  [/ajukan\s*(kta|kredit|pinjaman)|buka\s*deposito/i, 'financial_offer'],
  [/survey|survei|lowongan|event\s*marketing/i, 'marketing_non_transaction'],
  [/flash\s*sale|payday\s*sale|harbolnas|big\s*sale|limited\s*time/i, 'sale_campaign'],
];

const HARD_SKIP_PATTERNS: Array<[RegExp, string]> = [
  [/(kartu|card)\s*(telah|sudah)\s*aktif|virtual\s*card\s*berhasil/i, 'card_activation'],
  [/welcome\s*(to|di)|selamat\s*datang/i, 'welcome_email'],
  [/security\s*warning|login\s*dari\s*perangkat\s*baru|perangkat\s*baru/i, 'security_notice'],
  [/status\s*pesanan\s*dikirim|pesanan\s*telah\s*dikirim|sudahkah\s*kamu\s*menerima\s*pesanan/i, 'order_delivery_notice'],
  [/rating|review|ulasan/i, 'rating_review'],
  [/info\s*produk|update\s*(produk|fitur)|pembaruan\s*kebijakan/i, 'product_info'],
  [/request\s*(kartu|card).*berhasil|bluspending.*berhasil\s*dibuat/i, 'account_setup_notice'],
];

const HIGH_CONFIDENCE_PROVIDERS: Array<[RegExp, string]> = [
  [/blubybcadigital\.id|blu/i, 'blu'],
  [/jago\.com|bank\s*jago/i, 'bank_jago'],
  [/linebank\.co\.id|line\s*bank/i, 'line_bank'],
  [/shopee\.co\.id|shopee/i, 'shopee'],
  [/tokopedia\.com|tokopedia/i, 'tokopedia'],
  [/grab\.com|grab/i, 'grab'],
  [/kai\.id|kai\.co\.id|pt\.?\s*kai|kereta/i, 'kai'],
  [/tiket\.com|tiket/i, 'tiket'],
  [/agoda\.com|agoda\.net|agoda/i, 'agoda'],
];

const TRANSACTION_PROOF_PATTERN =
  /(pembayaran\s*berhasil|transaksi\s*berhasil|informasi\s*transaksi|transfer\s*berhasil|bukti\s*pembayaran|receipt|invoice|paid|payment\s*(success|received)|top\s*up\s*berhasil|refund\s*berhasil)/i;

export function evaluateLocalGmailParser(
  email: {
    subject: string;
    from: string;
    body: string;
    date: string;
  },
): LocalParserResult {
  const combined = `${email.subject}\n${email.from}\n${email.body}`;
  const promoCashback = getPromoCashbackMatch(email.subject, email.body);
  if (promoCashback.isPromo) {
    return {
      decision: 'auto_reject',
      reason: 'Email promo cashback ditolak sebelum AI',
      confidence: 0.99,
      parserSource: RULE_VERSION,
      errorCode: 'PROMO_CASHBACK_SKIPPED',
      matchedRule: promoCashback.matchedRule,
    };
  }

  for (const [pattern, rule] of HARD_REJECT_PATTERNS) {
    if (pattern.test(combined) && !hasStrongTransactionProof(combined)) {
      return {
        decision: 'auto_reject',
        reason: 'Email promo/marketing ditolak sebelum AI',
        confidence: 0.96,
        parserSource: RULE_VERSION,
        errorCode: 'PROMO_MARKETING_REJECTED',
        matchedRule: rule,
      };
    }
  }

  for (const [pattern, rule] of HARD_SKIP_PATTERNS) {
    if (pattern.test(combined) && !hasStrongTransactionProof(combined)) {
      return {
        decision: 'auto_skip',
        reason: 'Email notifikasi non-transaksi dilewati sebelum AI',
        confidence: 0.95,
        parserSource: RULE_VERSION,
        errorCode: 'NON_TRANSACTION_SKIPPED',
        matchedRule: rule,
      };
    }
  }

  const fallbackResult = buildFallbackTransactionFromEmail(email.from, email.subject, email.body, email.date);
  if (fallbackResult.finalStatus === 'skipped' && !hasStrongTransactionProof(combined)) {
    return {
      decision: 'auto_skip',
      reason: fallbackResult.reason,
      confidence: Math.max(fallbackResult.confidence, 0.9),
      parserSource: RULE_VERSION,
      errorCode: fallbackResult.errorCode,
      matchedRule: fallbackResult.matchedRule,
      fallbackResult,
    };
  }

  if (fallbackResult.success && fallbackResult.data && (fallbackResult.amount || fallbackResult.data.amount || 0) >= 1000) {
    const provider = getHighConfidenceProvider(combined);
    const confidence = getLocalConfidence(provider, combined, fallbackResult);
    return {
      decision: confidence >= 0.88 ? 'auto_accept' : 'send_to_ai',
      reason:
        confidence >= 0.88
          ? `Parser lokal ${provider || 'generic'} menemukan transaksi jelas`
          : 'Parser lokal menemukan nominal tetapi masih ambigu',
      confidence,
      parserSource: provider ? `${RULE_VERSION}:${provider}` : `${RULE_VERSION}:generic`,
      extracted: normalizeLocalExtracted(fallbackResult.data, confidence),
      fallbackResult,
    };
  }

  if (!hasAnyAmount(combined) && !hasStrongTransactionProof(combined)) {
    return {
      decision: 'auto_skip',
      reason: 'Tidak ada nominal atau bukti transaksi kuat',
      confidence: 0.9,
      parserSource: RULE_VERSION,
      errorCode: 'NO_AMOUNT_NON_TRANSACTION_SKIPPED',
    };
  }

  return {
    decision: 'send_to_ai',
    reason: 'Email masih ambigu setelah rules dan parser lokal',
    confidence: Math.max(fallbackResult.confidence || 0, 0.6),
    parserSource: RULE_VERSION,
    fallbackResult,
  };
}

export function shouldSendToAi(localResult: LocalParserResult): boolean {
  return localResult.decision === 'send_to_ai' && localResult.confidence < 0.88;
}

function getHighConfidenceProvider(text: string): string | null {
  const matched = HIGH_CONFIDENCE_PROVIDERS.find(([pattern]) => pattern.test(text));
  return matched?.[1] || null;
}

function getLocalConfidence(provider: string | null, text: string, fallbackResult: FallbackParseResult): number {
  let confidence = fallbackResult.confidence || 0.6;
  if (provider) confidence += 0.18;
  if (TRANSACTION_PROOF_PATTERN.test(text)) confidence += 0.12;
  if (/(total|nominal|jumlah|sebesar|dibayar|pembayaran)\s*:?\s*(rp|idr)/i.test(text)) confidence += 0.08;
  if (/(promo|diskon|cashback\s*(hingga|s\/d|sampai|up\s*to)|newsletter)/i.test(text)) confidence -= 0.2;
  return Math.max(0, Math.min(0.95, confidence));
}

function normalizeLocalExtracted(extracted: ExtractedTransaction, confidence: number): ExtractedTransaction {
  return {
    ...extracted,
    is_transaction: true,
    transaction_type: (extracted.transaction_type || 'expense') as TransactionType,
    confidence_score: Math.max(extracted.confidence_score || 0, confidence),
    reason: extracted.reason || 'Diproses oleh parser lokal sebelum AI',
  };
}

function hasStrongTransactionProof(text: string): boolean {
  return hasAnyAmount(text) && TRANSACTION_PROOF_PATTERN.test(text);
}

function hasAnyAmount(text: string): boolean {
  return /(?:rp|idr)\s*[\d.,]+/i.test(text) ||
    /(?:total|amount|nominal|sebesar|senilai|dibayar)\s*:?\s*[\d.,]+/i.test(text);
}
