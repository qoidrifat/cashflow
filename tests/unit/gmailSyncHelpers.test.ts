/**
 * Unit tests — helper murni Gmail Sync (src/features/gmail/gmailSyncHelpers.ts).
 * Diekstrak dari GmailSyncPage (Sprint 1.9) agar logika bisa diuji tanpa DOM.
 */
import { describe, expect, it } from 'vitest';
import {
  calculateStats,
  inferCategoryFromSender,
  inferMerchantFromSender,
  inferPaymentMethodFromSender,
  isTemporaryGeminiError,
  normalizeDate,
  normalizePaymentMethod,
  normalizeTransactionType,
  slugify,
  STATUS_CONFIG,
} from '../../src/features/gmail/gmailSyncHelpers';

/** Minimal SyncEmail yang cukup untuk calculateStats (status adalah satu-satunya yang dibaca). */
const email = (status: string) => ({ id: status, status }) as any;

describe('STATUS_CONFIG', () => {
  it('mencakup semua status yang dipakai EmailCard + halaman', () => {
    for (const s of ['auto_accepted', 'needs_review', 'pending_review', 'approved', 'rejected', 'duplicate', 'failed', 'retry_later', 'config_error']) {
      expect(STATUS_CONFIG[s as keyof typeof STATUS_CONFIG], `status ${s}`).toBeDefined();
    }
  });
});

describe('calculateStats', () => {
  it('kosong → semua 0', () => {
    const s = calculateStats([]);
    expect(s.total).toBe(0);
    expect(s.pendingReview).toBe(0);
    expect(s.failed).toBe(0);
  });

  it('menghitung per status dengan benar', () => {
    const s = calculateStats([
      email('auto_accepted'),
      email('auto_accepted'),
      email('needs_review'),
      email('pending_review'),
      email('approved'),
      email('rejected'),
      email('auto_rejected'),
      email('auto_skipped'),
      email('skipped'),
      email('duplicate'),
      email('failed'),
      email('retry_later'),
      email('config_error'),
      email('gmail_permission_required'),
    ]);
    expect(s.total).toBe(14);
    expect(s.autoAcceptedCount).toBe(2);
    expect(s.pendingReview).toBe(2);
    expect(s.approved).toBe(1);
    expect(s.rejected).toBe(1);
    expect(s.autoRejected).toBe(1);
    expect(s.skipped).toBe(2);
    expect(s.duplicate).toBe(1);
    expect(s.failed).toBe(1);
    expect(s.retryLater).toBe(1);
    expect(s.configError).toBe(2); // config_error + gmail_permission_required
  });
});

describe('normalizeTransactionType', () => {
  it('mempertahankan nilai valid, fallback expense', () => {
    expect(normalizeTransactionType('income')).toBe('income');
    expect(normalizeTransactionType('expense')).toBe('expense');
    expect(normalizeTransactionType('transfer')).toBe('transfer');
    expect(normalizeTransactionType('refund')).toBe('refund');
    expect(normalizeTransactionType(undefined)).toBe('expense');
    expect(normalizeTransactionType('xyz' as any)).toBe('expense');
  });
});

describe('normalizePaymentMethod', () => {
  it('memetakan keyword umum', () => {
    expect(normalizePaymentMethod('qris')).toBe('qris');
    expect(normalizePaymentMethod('GoPay')).toBe('e-wallet');
    expect(normalizePaymentMethod('OVO Wallet')).toBe('e-wallet');
    expect(normalizePaymentMethod('debit bca')).toBe('kartu-debit');
    expect(normalizePaymentMethod('kredit')).toBe('kartu-kredit');
    expect(normalizePaymentMethod('transfer bank')).toBe('transfer-bank');
    expect(normalizePaymentMethod('cash')).toBe('cash');
    expect(normalizePaymentMethod(undefined)).toBe('lainnya-payment');
  });
});

describe('infer* dari sender', () => {
  it('merchant', () => {
    expect(inferMerchantFromSender('no-reply@tiket.com')).toBe('tiket.com');
    expect(inferMerchantFromSender('info@shopee.co.id')).toBe('Shopee');
    expect(inferMerchantFromSender('unknown@x.com')).toBe('Unknown');
  });

  it('kategori', () => {
    expect(inferCategoryFromSender('booking@traveloka.com')).toBe('Travel');
    expect(inferCategoryFromSender('cs@kai.id')).toBe('Transportasi');
    expect(inferCategoryFromSender('order@tokopedia.com')).toBe('Belanja');
    expect(inferCategoryFromSender('random@x.com')).toBe('Lainnya');
  });

  it('payment method', () => {
    expect(inferPaymentMethodFromSender('booking@agoda.com')).toBe('transfer-bank');
    expect(inferPaymentMethodFromSender('order@tokopedia.com')).toBe('e-wallet');
    expect(inferPaymentMethodFromSender('random@x.com')).toBe('transfer-bank');
  });
});

describe('slugify & normalizeDate', () => {
  it('slugify: lowercase, & → dan, strip non-alnum, fallback lainnya', () => {
    expect(slugify('Pembayaran & Tagihan')).toBe('pembayaran-dan-tagihan');
    expect(slugify('  Hello World!  ')).toBe('hello-world');
    expect(slugify('!!!')).toBe('lainnya');
  });

  it('normalizeDate: valid → YYYY-MM-DD, invalid → tanggal hari ini', () => {
    expect(normalizeDate('2026-08-01T10:00:00Z')).toBe('2026-08-01');
    expect(normalizeDate('invalid-date')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('isTemporaryGeminiError', () => {
  it('error sementara → true, selain itu false', () => {
    expect(isTemporaryGeminiError('GEMINI_RATE_LIMITED')).toBe(true);
    expect(isTemporaryGeminiError('GEMINI_NETWORK_ERROR')).toBe(true);
    expect(isTemporaryGeminiError('GEMINI_MODEL_UNAVAILABLE')).toBe(true);
    expect(isTemporaryGeminiError('GEMINI_UNAUTHORIZED')).toBe(false);
    expect(isTemporaryGeminiError(undefined)).toBe(false);
  });
});
