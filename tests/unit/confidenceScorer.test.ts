/**
 * Unit test: src/lib/confidenceScorer.ts
 *
 * Composite scoring untuk keputusan Gmail sync:
 *   - detectRiskFlags: promo, cashback, multiple amounts, unknown sender, dst
 *   - calculateConfidenceScore: skor 0..1 dari sinyal sender/keyword/amount/date
 *   - suggestDecision: rekomendasi dari skor
 */
import { describe, it, expect } from 'vitest';
import type { ExtractedTransaction } from '../../src/types';
import {
  calculateConfidenceScore,
  detectRiskFlags,
  suggestDecision,
} from '../../src/lib/confidenceScorer';

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

describe('detectRiskFlags', () => {
  it('promo cashback terdeteksi', () => {
    const flags = detectRiskFlags('promo@bank.id', 'Cashback hingga Rp 100.000', 'Dapatkan cashback');
    expect(flags.promoDetected).toBe(true);
    expect(flags.cashbackPromo).toBe(true);
  });

  it('card activation terdeteksi', () => {
    const flags = detectRiskFlags('blu@bca.id', 'Kartu telah aktif', 'bluVirtual Card kamu telah aktif');
    expect(flags.cardActivation).toBe(true);
  });

  it('multiple amounts terdeteksi bila body punya >1 nominal', () => {
    const flags = detectRiskFlags('x@y.id', 'Pembayaran', 'Rp 10.000 dan Rp 20.000 dan Rp 30.000');
    expect(flags.multipleAmounts).toBe(true);
  });

  it('unknown sender untuk domain tak dikenal', () => {
    const flags = detectRiskFlags('nobody@unknown-domain-xyz.id', 'Pembayaran', 'Rp 10.000');
    expect(flags.unknownSender).toBe(true);
  });

  it('noAmount bila tidak ada nominal', () => {
    const flags = detectRiskFlags('no-reply@bca.co.id', 'Pembayaran', 'Halo', makeExtracted({ amount: null }));
    expect(flags.noAmount).toBe(true);
  });
});

describe('calculateConfidenceScore', () => {
  it('trusted sender + amount + date → skor >= 0.88 (auto-accept eligible)', () => {
    const breakdown = calculateConfidenceScore(
      'no-reply@bca.co.id',
      'Pembayaran Berhasil',
      'Total pembayaran Rp 250.000 melalui QRIS di Indomaret',
      'send_to_ai',
      makeExtracted(),
      null,
    );
    expect(breakdown.total).toBeGreaterThanOrEqual(0.88);
    expect(breakdown.components.trustedSender).toBe(0.2);
    expect(breakdown.components.amountPresent).toBe(0.2);
  });

  it('promo cashback → skor rendah (penalty besar)', () => {
    const breakdown = calculateConfidenceScore(
      'promo@bank.id',
      'Cashback hingga Rp 100.000',
      'Dapatkan cashback 20%',
      'skipped',
      null,
      null,
    );
    expect(breakdown.total).toBeLessThan(0.5);
    expect(breakdown.components.promoPenalty).toBeLessThan(0);
  });

  it('tanpa amount → skor tidak pernah 0.88+', () => {
    const breakdown = calculateConfidenceScore(
      'no-reply@bca.co.id',
      'Pembayaran',
      'Tidak ada nominal di body',
      'skipped',
      makeExtracted({ amount: null }),
      null,
    );
    expect(breakdown.total).toBeLessThan(0.88);
  });

  it('skor di-clamp 0..1', () => {
    // Semua sinyal negatif sekaligus — harus tidak negatif
    const breakdown = calculateConfidenceScore(
      'promo@bank.id',
      'Cashback hingga Rp 999.999',
      'Dapatkan cashback 20% sekarang juga',
      'skipped',
      null,
      null,
    );
    expect(breakdown.total).toBeGreaterThanOrEqual(0);
  });
});

describe('suggestDecision', () => {
  it('promo → auto_reject (override skor)', () => {
    expect(suggestDecision(0.95, true, false, false, false, true)).toBe('auto_reject');
  });

  it('card activation → auto_skip', () => {
    expect(suggestDecision(0.95, false, true, false, false, true)).toBe('auto_skip');
  });

  it('newsletter → auto_reject', () => {
    expect(suggestDecision(0.95, false, false, false, true, true)).toBe('auto_reject');
  });

  it('tanpa amount → auto_skip', () => {
    expect(suggestDecision(0.95, false, false, false, false, false)).toBe('auto_skip');
  });

  it('skor tinggi + amount → auto_accept', () => {
    expect(suggestDecision(0.9, false, false, false, false, true)).toBe('auto_accept');
  });

  it('skor menengah → needs_review', () => {
    expect(suggestDecision(0.7, false, false, false, false, true)).toBe('needs_review');
  });

  it('skor rendah → auto_skip', () => {
    expect(suggestDecision(0.4, false, false, false, false, true)).toBe('auto_skip');
  });
});
