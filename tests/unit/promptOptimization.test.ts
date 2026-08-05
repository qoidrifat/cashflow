/**
 * Prompt Optimization regression guard (Sprint 2).
 *
 * Melindungi dua hal setelah optimasi token:
 * 1. Output schema & aturan SEMANTIK wajib tetap ada (parser frontend
 *    bergantung pada key: is_transaction, amount, decision, dll).
 * 2. Ukuran static prompt tidak boleh membengkak lagi (guard token).
 *
 * Baseline terukur (estimator chars/4):
 *   extraction static : 792 → 552 token (−30.3%)
 *   receipt           : 556 → 448 token (−19.4%)
 */
import { describe, it, expect } from 'vitest';
import {
  buildExtractionPrompt,
  buildReceiptExtractionPrompt,
} from '../../server/lib/vertexContext.js';
import { estimateTokensFromText } from '../../src/utils/aiTokenEstimator';

// Baseline AFTER optimasi (estimator chars/4). Kalibrasi: ukur ulang dengan
// estimator yang sama (chars/4) saat prompt SAH perlu diperluas — perbarui
// konstanta ini dengan sengaja, bukan sekadar menaikkan guard diam-diam.
// Guard hanya menutup path STATIC (tanpa email/gambar) karena input dinamis
// mendominasi dan bervariasi — melindungi bagian prompt yang kita kendalikan.
const EXTRACTION_STATIC_TOKENS = 552;
const RECEIPT_TOKENS = 448;

const EXTRACTION_KEYS = [
  'is_transaction',
  'transaction_type',
  'amount',
  'currency',
  'date',
  'merchant',
  'category',
  'payment_method',
  'description',
  'confidence_score',
  'reason',
  'decision',
];

const RECEIPT_KEYS = [
  'decision',
  'is_transaction',
  'transaction_type',
  'amount',
  'currency',
  'date',
  'merchant',
  'category',
  'payment_method',
  'note',
  'confidence_score',
  'reason',
  'risk_flags',
];

describe('promptOptimization: schema & rules terjaga', () => {
  it('extraction — semua output key schema ada', () => {
    const prompt = buildExtractionPrompt('', 'Subjek', 'no-reply@x.com', '2026-07-12');
    for (const key of EXTRACTION_KEYS) {
      expect(prompt).toContain(key);
    }
  });

  it('extraction — aturan decision & promo cashback terjaga', () => {
    const prompt = buildExtractionPrompt('', 'Subjek', 'no-reply@x.com', '2026-07-12');
    for (const decision of ['auto_accept', 'auto_skip', 'auto_reject', 'needs_review']) {
      expect(prompt).toContain(decision);
    }
    // Aturan anti-false-positive cashback promo (core classifier rule)
    expect(prompt).toMatch(/cashback.*belum|Cashback promo/i);
    expect(prompt).toContain('"decision":"auto_reject"');
  });

  it('extraction — emailDate default tetap di-interpolasi', () => {
    const prompt = buildExtractionPrompt('', 'Subjek', 'no-reply@x.com', '2026-08-05');
    expect(prompt).toContain('2026-08-05');
  });

  it('receipt — semua output key schema ada + aturan needs_review/multiple_amounts', () => {
    const prompt = buildReceiptExtractionPrompt({});
    for (const key of RECEIPT_KEYS) {
      expect(prompt).toContain(key);
    }
    expect(prompt).toContain('multiple_amounts_found');
    expect(prompt).toContain('date_inferred');
    expect(prompt).toContain('kartu-kredit');
  });

  it('receipt — userHint tetap di-interpolasi', () => {
    const prompt = buildReceiptExtractionPrompt({ paymentMethod: 'qris', category: 'Makanan', date: '2026-08-01' });
    expect(prompt).toContain('qris');
    expect(prompt).toContain('Makanan');
    expect(prompt).toContain('2026-08-01');
  });
});

describe('promptOptimization: size guard (anti-regresi token)', () => {
  it('extraction static ≤ baseline + 12%', () => {
    const prompt = buildExtractionPrompt('', 'Subjek', 'no-reply@x.com', '2026-07-12');
    const tokens = estimateTokensFromText(prompt);
    expect(tokens).toBeLessThanOrEqual(Math.ceil(EXTRACTION_STATIC_TOKENS * 1.12));
  });

  it('receipt ≤ baseline + 12%', () => {
    const prompt = buildReceiptExtractionPrompt({});
    const tokens = estimateTokensFromText(prompt);
    expect(tokens).toBeLessThanOrEqual(Math.ceil(RECEIPT_TOKENS * 1.12));
  });
});
