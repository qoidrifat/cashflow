/**
 * AI Decision Validator
 *
 * Rule-based validator yang mengecek output AI sebelum diterima.
 * AI hanya memberi kandidat — validator ini yang menentukan keputusan final.
 *
 * Flow:
 *   1. Validator cek semua rule (promo, card activation, amount, dll)
 *   2. Jika rule dilanggar, validator menurunkan status
 *   3. Jika semua rule lolos, auto_accepted
 *
 * Safety:
 *   - Tidak pernah auto_accept untuk promo/cashback promo
 *   - Tidak pernah auto_accept untuk card activation/welcome/newsletter
 *   - Tidak pernah auto_accept jika amount null
 *   - Tidak pernah auto_accept jika confidence < 0.88
 *   - Tidak pernah auto_accept jika duplicate
 *   - Konflik AI/fallback → needs_review (bukan auto_accept)
 */

import type { ExtractedTransaction, ConfidenceBreakdown, RiskFlags, AutoDecision, SyncEmailStatus } from '../types';
import { calculateConfidenceScore, detectRiskFlags } from './confidenceScorer';
import {
  getPromoCashbackMatch,
  isPromoCashbackEmail,
} from './promoCashbackClassifier';
import { isTrustedTransactionDomain, extractDomain } from './gmailClassifier';


// ===================== Constants =====================

const AUTO_ACCEPT_THRESHOLD = 0.88;
const NEEDS_REVIEW_THRESHOLD = 0.60;

// ===================== Validator Result =====================

export interface ValidatorResult {
  /** Final decision setelah validasi */
  finalStatus: AutoDecision;
  /** SyncEmailStatus yang sesuai */
  mappedStatus: SyncEmailStatus;
  /** Final confidence score */
  confidenceScore: number;
  /** Breakdown untuk audit */
  confidenceBreakdown: ConfidenceBreakdown;
  /** Alasan keputusan */
  reason: string;
  /** Error code jika ada */
  errorCode?: string;
  /** Apakah fallback dipakai */
  fallbackUsed: boolean;
  /** Parser source */
  parserSource: 'ai' | 'fallback' | 'hybrid' | 'none';
  /** Risk flags yang terdeteksi */
  riskFlags: RiskFlags;
  /** Apakah review diperlukan */
  requiresReview: boolean;
}

// ===================== Manual Override Rules =====================

/**
 * Cek apakah email harus auto_skip berdasarkan subject/sender.
 * Berjalan SEBELUM AI — prefilter awal yang super ketat.
 */
export function checkPreSkipRules(
  sender: string,
  subject: string,
  body: string,
): { skip: boolean; status: SyncEmailStatus; reason: string; reasonCode: string } | null {
  const lowerSubject = subject.toLowerCase();
  const lowerBody = body.toLowerCase();
  const combined = `${lowerSubject} ${lowerBody}`;

  // ===== Promo cashback (REJECT) =====
  const promoCashback = getPromoCashbackMatch(subject, body);
  if (promoCashback.isPromo) {
    return {
      skip: true,
      status: 'auto_rejected',
      reason: 'Email promo cashback — nominal bukan transaksi aktual',
      reasonCode: 'PROMO_CASHBACK_SKIPPED',
    };
  }

  // ===== Card activation (SKIP) =====
  if (/(kartu|card)\s*(telah|sudah)\s*aktif|request.*(kartu|card).*berhasil/i.test(combined)) {
    return {
      skip: true,
      status: 'auto_skipped',
      reason: 'Notifikasi aktivasi/pengaturan kartu, bukan transaksi aktual',
      reasonCode: 'CARD_ACTIVATION_SKIPPED',
    };
  }

  // ===== Welcome email (SKIP) =====
  if (/welcome\s*(to|di)|selamat\s*datang\s*(di|ke)/i.test(lowerSubject)) {
    return {
      skip: true,
      status: 'auto_skipped',
      reason: 'Email selamat datang, bukan transaksi aktual',
      reasonCode: 'WELCOME_EMAIL_SKIPPED',
    };
  }

  // ===== blu spending created (SKIP) =====
  if (/bluspending.*berhasil\s*dibuat/i.test(combined)) {
    return {
      skip: true,
      status: 'auto_skipped',
      reason: 'Notifikasi pengaturan bluSpending, bukan transaksi aktual',
      reasonCode: 'BLU_SPENDING_SKIPPED',
    };
  }

  // ===== Newsletter/promo (REJECT) =====
  const promoPatterns = [
    /promo|newsletter|diskon|kupon|voucher|penawaran|save\s*up\s*to|special\s*offer|exclusive\s*(deal|offer)/i,
    /cashback\s*(hingga|s\/d|sampai|up\s*to)/i,
    /dapatkan\s*(cashback|diskon|promo)/i,
    /ajukan\s*(kta|kredit|pinjaman)/i,
    /buka\s*deposito.*cashback|buka\s*deposito/i,
    /harbolnas|big\s*sale|flash\s*sale|payday\s*sale|mid\s*mouth\s*sale/i,
    /tips\s*keuangan|panduan|tutorial|artikel|digest|event\s*marketing|survey|survei|lowongan/i,
  ];

  for (const pattern of promoPatterns) {
    if (pattern.test(lowerSubject) || pattern.test(combined)) {
      // Exception: if body has actual transaction proof, send to AI instead
      if (hasActualTransactionProof(combined)) return null;
      return {
        skip: true,
        status: 'auto_rejected',
        reason: `Email promo/marketing — bukan transaksi keuangan`,
        reasonCode: 'PROMO_MARKETING_REJECTED',
      };
    }
  }

  const nonTransactionPatterns = [
    /virtual\s*card\s*berhasil|request\s*card\s*berhasil/i,
    /security\s*warning|login\s*dari\s*perangkat\s*baru/i,
    /status\s*pesanan\s*dikirim|pesanan\s*telah\s*dikirim|sudahkah\s*kamu\s*menerima\s*pesanan/i,
    /rating|review|ulasan|info\s*produk|update\s*(produk|fitur)/i,
  ];

  for (const pattern of nonTransactionPatterns) {
    if (pattern.test(lowerSubject) || pattern.test(combined)) {
      if (hasActualTransactionProof(combined)) return null;
      return {
        skip: true,
        status: 'auto_skipped',
        reason: 'Email notifikasi non-transaksi — bukan bukti transaksi aktual',
        reasonCode: 'NON_TRANSACTION_SKIPPED',
      };
    }
  }

  return null;
}

/**
 * Cek apakah ada bukti transaksi aktual di teks
 */
function hasActualTransactionProof(text: string): boolean {
  return /(?:total|amount|nominal|sebesar|senilai|dibayar|pembayaran)\s*rp\s*[\d.,]+/i.test(text) &&
    /(?:pembayaran|transaksi|pembelian|transfer|tagihan|invoice|receipt|order)/i.test(text);
}

// ===================== Post-AI Validator =====================

/**
 * Validasi hasil AI extraction + fallback sebelum auto_accept.
 * Jika validator menolak, status diturunkan ke needs_review atau auto_skipped/auto_rejected.
 */
export function validateAndFinalize(
  sender: string,
  subject: string,
  body: string,
  emailDate: string,
  extracted: ExtractedTransaction | null,
  aiErrorCode?: string,
  fallbackResult?: {
    success: boolean;
    amount?: number | null;
    confidence: number;
    finalStatus?: string;
    data?: ExtractedTransaction;
  } | null,
  isDuplicate?: boolean,
): ValidatorResult {
  const lowerSubject = subject.toLowerCase();
  const lowerBody = body.toLowerCase();

  // ===== Check pre-skip rules first =====
  const preSkip = checkPreSkipRules(sender, subject, body);
  if (preSkip) {
    return {
      finalStatus: preSkip.status === 'auto_skipped' ? 'auto_skip' : 'auto_reject',
      mappedStatus: preSkip.status,
      confidenceScore: 0,
      confidenceBreakdown: calculateConfidenceScore(sender, subject, body, 'skipped', extracted, fallbackResult),
      reason: preSkip.reason,
      errorCode: preSkip.reasonCode,
      fallbackUsed: false,
      parserSource: 'none',
      riskFlags: detectRiskFlags(sender, subject, body, extracted, fallbackResult?.amount),
      requiresReview: false,
    };
  }

  // ===== Calculate confidence score =====
  const confidenceBreakdown = calculateConfidenceScore(
    sender, subject, body,
    extracted?.is_transaction ? 'send_to_ai' : 'skipped',
    extracted, fallbackResult,
  );
  const confidence = confidenceBreakdown.total;
  const riskFlags = confidenceBreakdown.riskFlags as RiskFlags;

  // ===== Duplicate check =====
  if (isDuplicate) {
    return {
      finalStatus: 'auto_skip',
      mappedStatus: 'duplicate',
      confidenceScore: 0,
      confidenceBreakdown,
      reason: 'Email sudah pernah diproses sebelumnya',
      errorCode: 'DUPLICATE_GMAIL_MESSAGE',
      fallbackUsed: false,
      parserSource: 'none',
      riskFlags,
      requiresReview: false,
    };
  }

  // ===== AI menghasilkan is_transaction = false =====
  if (extracted && extracted.is_transaction === false) {
    const reason = extracted.reason || 'AI menyatakan email bukan transaksi';
    // Check if AI says promo
    if (/promo|cashback|diskon/i.test(reason)) {
      return {
        finalStatus: 'auto_reject',
        mappedStatus: 'auto_rejected',
        confidenceScore: Math.min(confidence, 0.3),
        confidenceBreakdown,
        reason: `Ditolak AI: ${reason}`,
        errorCode: 'AI_REJECTED_PROMO',
        fallbackUsed: false,
        parserSource: 'ai',
        riskFlags,
        requiresReview: false,
      };
    }
    return {
      finalStatus: 'auto_skip',
      mappedStatus: 'auto_skipped',
      confidenceScore: Math.min(confidence, 0.4),
      confidenceBreakdown,
      reason: `Dilewati AI: ${reason}`,
      errorCode: 'AI_REJECTED_NON_TRANSACTION',
      fallbackUsed: false,
      parserSource: 'ai',
      riskFlags,
      requiresReview: false,
    };
  }

  // ===== No valid extraction from either AI or fallback =====
  const hasAIAmount = !!(extracted?.amount && extracted.amount >= 1000);
  const hasFallbackAmount = !!(fallbackResult?.success && (fallbackResult.amount || 0) >= 1000);

  if (!hasAIAmount && !hasFallbackAmount) {
    if (aiErrorCode) {
      return {
        finalStatus: 'needs_review',
        mappedStatus: 'needs_review',
        confidenceScore: Math.min(confidence, 0.4),
        confidenceBreakdown,
        reason: `AI gagal (${aiErrorCode}), fallback tidak menemukan nominal. Perlu dicek manual.`,
        errorCode: aiErrorCode,
        fallbackUsed: !!fallbackResult?.success,
        parserSource: 'none',
        riskFlags,
        requiresReview: true,
      };
    }
    return {
      finalStatus: 'auto_skip',
      mappedStatus: 'auto_skipped',
      confidenceScore: Math.min(confidence, 0.3),
      confidenceBreakdown,
      reason: 'Tidak ditemukan nominal transaksi yang valid',
      errorCode: 'NO_AMOUNT_FOUND',
      fallbackUsed: false,
      parserSource: 'none',
      riskFlags,
      requiresReview: false,
    };
  }

  // ===== We have at least one amount — determine source =====
  const useAI = hasAIAmount;
  const useFallback = hasFallbackAmount;
  const parserSource = useAI && useFallback ? 'hybrid' : useAI ? 'ai' : 'fallback';
  const finalAmount = useAI ? extracted!.amount! : fallbackResult!.amount!;
  const finalData = useAI ? extracted : fallbackResult?.data || extracted;

  // ===== Conflicting amounts between AI and fallback =====
  if (useAI && useFallback) {
    const aiAmount = extracted!.amount!;
    const fbAmount = fallbackResult!.amount!;
    const diff = Math.abs(aiAmount - fbAmount);

    if (diff > 1000) {
      return {
        finalStatus: 'needs_review',
        mappedStatus: 'needs_review',
        confidenceScore: Math.min(confidence + 0.1, 0.95), // Slight boost for having some data
        confidenceBreakdown,
        reason: `AI dan fallback berbeda nominal (AI: Rp${aiAmount.toLocaleString('id-ID')}, Fallback: Rp${fbAmount.toLocaleString('id-ID')}). Perlu dicek manual.`,
        errorCode: 'AI_FALLBACK_CONFLICT',
        fallbackUsed: true,
        parserSource: 'hybrid',
        riskFlags: { ...(riskFlags as RiskFlags), conflictingAIandFallback: true },
        requiresReview: true,
      };
    }
  }

  // ===== Card activation/welcome caught by deeper check =====
  if (riskFlags.cardActivation) {
    return {
      finalStatus: 'auto_skip',
      mappedStatus: 'auto_skipped',
      confidenceScore: 0,
      confidenceBreakdown,
      reason: 'Notifikasi aktivasi kartu bukan transaksi aktual (walau nominal terdeteksi)',
      errorCode: 'CARD_ACTIVATION_SKIPPED',
      fallbackUsed: false,
      parserSource: 'none',
      riskFlags,
      requiresReview: false,
    };
  }

  // ===== Confidence threshold check =====
  if (confidence >= AUTO_ACCEPT_THRESHOLD) {
    // Auto-accept! Only if no conflicting risks
    if (riskFlags.conflictingAIandFallback) {
      return {
        finalStatus: 'needs_review',
        mappedStatus: 'needs_review',
        confidenceScore: confidence,
        confidenceBreakdown,
        reason: 'Konflik AI/fallback walaupun confidence tinggi. Perlu dicek manual.',
        errorCode: 'AI_FALLBACK_CONFLICT_HIGH_CONF',
        fallbackUsed: true,
        parserSource,
        riskFlags,
        requiresReview: true,
      };
    }

    return {
      finalStatus: 'auto_accept',
      mappedStatus: 'auto_accepted',
      confidenceScore: confidence,
      confidenceBreakdown,
      reason: `Transaksi diterima otomatis (confidence ${Math.round(confidence * 100)}%). ${useFallback ? 'Fallback parser.' : 'AI extraction.'}`,
      errorCode: useFallback ? 'GEMINI_FALLBACK_USED' : 'AI_AUTO_ACCEPTED',
      fallbackUsed: useFallback,
      parserSource,
      riskFlags,
      requiresReview: false,
    };
  }

  if (confidence >= NEEDS_REVIEW_THRESHOLD) {
    return {
      finalStatus: 'needs_review',
      mappedStatus: 'needs_review',
      confidenceScore: confidence,
      confidenceBreakdown,
      reason: `Confidence ${Math.round(confidence * 100)}% — perlu review manual`,
      errorCode: 'NEEDS_REVIEW_MEDIUM_CONF',
      fallbackUsed: useFallback,
      parserSource,
      riskFlags,
      requiresReview: true,
    };
  }

  // ===== Low confidence, no valid transaction =====
  if (useAI || useFallback) {
    // We have amount but confidence too low — likely ambiguous
    return {
      finalStatus: 'needs_review',
      mappedStatus: 'needs_review',
      confidenceScore: confidence,
      confidenceBreakdown,
      reason: `Confidence rendah (${Math.round(confidence * 100)}%) tapi nominal ditemukan. Perlu dicek manual.`,
      errorCode: 'NEEDS_REVIEW_LOW_CONF',
      fallbackUsed: useFallback,
      parserSource,
      riskFlags,
      requiresReview: true,
    };
  }

  return {
    finalStatus: 'auto_skip',
    mappedStatus: 'auto_skipped',
    confidenceScore: confidence,
    confidenceBreakdown,
    reason: 'Confidence terlalu rendah dan tidak cukup bukti transaksi',
    errorCode: 'LOW_CONFIDENCE_SKIPPED',
    fallbackUsed: false,
    parserSource: 'none',
    riskFlags,
    requiresReview: false,
  };
}

/**
 * Check if AI and fallback results conflict on amount
 */
export function hasAmountConflict(
  aiAmount: number | undefined,
  fallbackAmount: number | null | undefined,
  threshold: number = 1000,
): boolean {
  if (aiAmount === undefined && (fallbackAmount === null || fallbackAmount === undefined)) return false;
  if (aiAmount === undefined || fallbackAmount === null || fallbackAmount === undefined) return false;
  return Math.abs(aiAmount - fallbackAmount) > threshold;
}
