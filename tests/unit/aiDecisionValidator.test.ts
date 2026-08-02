/**
 * Unit test: src/lib/aiDecisionValidator.ts
 *
 * Validator rule-based yang menentukan keputusan final email Gmail sync:
 *   - checkPreSkipRules: prefilter ketat (promo cashback, aktivasi kartu, welcome, newsletter)
 *   - hasAmountConflict: deteksi konflik nominal AI vs fallback
 *   - validateAndFinalize: keputusan final (auto_accept / needs_review / auto_skip / auto_reject / duplicate)
 *
 * Hanya pure logic — tidak ada mock service eksternal.
 */
import { describe, it, expect } from 'vitest';
import type { ExtractedTransaction } from '../../src/types';
import {
  checkPreSkipRules,
  hasAmountConflict,
  validateAndFinalize,
} from '../../src/lib/aiDecisionValidator';

/** Builder minimal ExtractedTransaction untuk test (field yang dipakai validator). */
function makeExtracted(overrides: Partial<ExtractedTransaction> = {}): ExtractedTransaction {
  return {
    is_transaction: true,
    transaction_type: 'expense',
    amount: 250000,
    currency: 'IDR',
    date: '2026-07-01',
    merchant: 'Indomaret',
    category: 'Belanja',
    payment_method: 'qris',
    description: 'Pembayaran QRIS',
    confidence_score: 0.95,
    reason: null,
    ...overrides,
  } as unknown as ExtractedTransaction;
}

describe('checkPreSkipRules — prefilter', () => {
  it('promo cashback → auto_rejected + PROMO_CASHBACK_SKIPPED', () => {
    const r = checkPreSkipRules('promo@bank.id', 'Cashback hingga Rp 100.000', 'Dapatkan cashback 20%');
    expect(r).not.toBeNull();
    expect(r!.skip).toBe(true);
    expect(r!.status).toBe('auto_rejected');
    expect(r!.reasonCode).toBe('PROMO_CASHBACK_SKIPPED');
  });

  it('aktivasi kartu → auto_skipped + CARD_ACTIVATION_SKIPPED', () => {
    const r = checkPreSkipRules('blu@bca.id', 'Kartu telah aktif', 'bluVirtual Card kamu telah aktif');
    expect(r!.status).toBe('auto_skipped');
    expect(r!.reasonCode).toBe('CARD_ACTIVATION_SKIPPED');
  });

  it('welcome email → auto_skipped + WELCOME_EMAIL_SKIPPED', () => {
    const r = checkPreSkipRules('hello@bank.id', 'Welcome to blu', 'Selamat datang di blu');
    expect(r!.status).toBe('auto_skipped');
    expect(r!.reasonCode).toBe('WELCOME_EMAIL_SKIPPED');
  });

  it('newsletter/promo → auto_rejected + PROMO_MARKETING_REJECTED', () => {
    const r = checkPreSkipRules('marketing@shop.id', 'Promo Spesial Akhir Tahun', 'Dapatkan diskon 50%');
    expect(r!.status).toBe('auto_rejected');
    expect(r!.reasonCode).toBe('PROMO_MARKETING_REJECTED');
  });

  it('email transaksi normal → null (lanjut ke AI)', () => {
    const r = checkPreSkipRules(
      'no-reply@bca.co.id',
      'Pembayaran Berhasil',
      'Total pembayaran Rp 250.000 melalui QRIS',
    );
    expect(r).toBeNull();
  });

  it('promo dengan bukti transaksi aktual → null (dilempar ke AI)', () => {
    const r = checkPreSkipRules(
      'no-reply@shop.id',
      'Promo spesial untukmu',
      'Total pembayaran Rp 1.250.000 — pembayaran berhasil diterima',
    );
    expect(r).toBeNull();
  });
});

describe('hasAmountConflict', () => {
  it('false bila salah satu amount tidak ada', () => {
    expect(hasAmountConflict(undefined, null)).toBe(false);
    expect(hasAmountConflict(undefined, 5000)).toBe(false);
    expect(hasAmountConflict(5000, undefined)).toBe(false);
  });

  it('false bila selisih <= threshold', () => {
    expect(hasAmountConflict(10000, 9000, 1000)).toBe(false);
    expect(hasAmountConflict(10000, 10000)).toBe(false);
  });

  it('true bila selisih > threshold', () => {
    expect(hasAmountConflict(10000, 8500, 1000)).toBe(true);
    expect(hasAmountConflict(50000, 10000)).toBe(true);
  });
});

describe('validateAndFinalize — keputusan final', () => {
  it('pre-skip promo cashback → auto_reject (bukan auto_accept)', () => {
    const r = validateAndFinalize(
      'promo@bank.id', 'Cashback hingga Rp 100.000', 'Dapatkan cashback', '2026-07-01',
      null, undefined, null, false,
    );
    expect(r.finalStatus).toBe('auto_reject');
    expect(r.requiresReview).toBe(false);
  });

  it('duplicate → auto_skip + DUPLICATE_GMAIL_MESSAGE', () => {
    const r = validateAndFinalize(
      'no-reply@bca.co.id', 'Pembayaran Berhasil', 'Total pembayaran Rp 250.000', '2026-07-01',
      makeExtracted(), undefined, null, true,
    );
    expect(r.finalStatus).toBe('auto_skip');
    expect(r.mappedStatus).toBe('duplicate');
    expect(r.errorCode).toBe('DUPLICATE_GMAIL_MESSAGE');
  });

  it('AI is_transaction=false → auto_skip (bukan transaksi)', () => {
    // Body harus BEBAS dari pola promo/artikel/tips agar pre-skip tidak
    // mendahului pemeriksaan hasil AI (pre-skip berjalan lebih dulu).
    const r = validateAndFinalize(
      'no-reply@bank.id', 'Halo', 'Tidak ada transaksi keuangan di email ini', '2026-07-01',
      makeExtracted({ is_transaction: false, amount: null, reason: 'Bukan transaksi' }),
      undefined, null, false,
    );
    expect(r.finalStatus).toBe('auto_skip');
    expect(r.mappedStatus).toBe('auto_skipped');
  });

  it('tanpa nominal valid (AI gagal, fallback kosong) → needs_review bila ada aiErrorCode', () => {
    const r = validateAndFinalize(
      'no-reply@bca.co.id', 'Pembayaran', 'Tidak ada nominal', '2026-07-01',
      null, 'VERTEX_TIMEOUT', { success: false, confidence: 0 }, false,
    );
    expect(r.finalStatus).toBe('needs_review');
    expect(r.requiresReview).toBe(true);
    expect(r.errorCode).toBe('VERTEX_TIMEOUT');
  });

  it('konflik nominal AI vs fallback (>1000) → needs_review + AI_FALLBACK_CONFLICT', () => {
    const r = validateAndFinalize(
      'no-reply@bca.co.id', 'Pembayaran Berhasil', 'Total pembayaran Rp 250.000', '2026-07-01',
      makeExtracted({ amount: 250000 }),
      undefined,
      { success: true, amount: 10000, confidence: 0.9 },
      false,
    );
    expect(r.finalStatus).toBe('needs_review');
    expect(r.errorCode).toBe('AI_FALLBACK_CONFLICT');
    expect(r.riskFlags.conflictingAIandFallback).toBe(true);
  });

  it('transaksi trusted sender + nominal + confidence tinggi → auto_accept', () => {
    const r = validateAndFinalize(
      'no-reply@bca.co.id',
      'Pembayaran Berhasil',
      'Total pembayaran Rp 250.000 melalui QRIS di Indomaret',
      '2026-07-01',
      makeExtracted(),
      undefined,
      null,
      false,
    );
    expect(r.finalStatus).toBe('auto_accept');
    expect(r.mappedStatus).toBe('auto_accepted');
    expect(r.confidenceScore).toBeGreaterThanOrEqual(0.88);
    expect(r.requiresReview).toBe(false);
  });
});
