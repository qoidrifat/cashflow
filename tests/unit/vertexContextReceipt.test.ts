/**
 * Unit test — server/lib/vertexContext.js normalizeReceiptResult / normalizeReceiptPaymentMethod.
 *
 * REGRESSION GUARD untuk bug yang ditemukan AI Quality Benchmark (Sprint 1 · P1.6):
 * regex date & payment_method di file pernah double-escaped (\\d / [_\\s] dengan
 * 2 backslash) → date SELALU null & payment_method 'qris'/'kartu kredit'/'transfer-bank'
 * jatuh ke 'cash' (huruf 's' ikut di-replace). Benchmark menangkapnya (receiptField
 * accuracy 0.74). Test ini memaku perilaku yang benar.
 */
import { describe, expect, it } from 'vitest';
import { normalizeReceiptPaymentMethod, normalizeReceiptResult } from '../../server/lib/vertexContext.js';

describe('normalizeReceiptPaymentMethod (bug double-escape P1.6)', () => {
  it('qris → qris (huruf s TIDAK boleh di-replace)', () => {
    expect(normalizeReceiptPaymentMethod('qris')).toBe('qris');
  });
  it('kartu kredit → kartu-kredit', () => {
    expect(normalizeReceiptPaymentMethod('kartu kredit')).toBe('kartu-kredit');
  });
  it('kartu debit → kartu-debit', () => {
    expect(normalizeReceiptPaymentMethod('kartu debit')).toBe('kartu-debit');
  });
  it('transfer bank → transfer-bank', () => {
    expect(normalizeReceiptPaymentMethod('transfer bank')).toBe('transfer-bank');
  });
  it('e-wallet → e-wallet', () => {
    expect(normalizeReceiptPaymentMethod('e-wallet')).toBe('e-wallet');
  });
});

describe('normalizeReceiptResult — tanggal & amount', () => {
  it('date valid YYYY-MM-DD dipertahankan (bug: dulu selalu null)', () => {
    const res = normalizeReceiptResult({ decision: 'auto_accept', is_transaction: true, transaction_type: 'expense', amount: 150000, date: '2026-08-01', payment_method: 'qris' });
    expect(res.date).toBe('2026-08-01');
    expect(res.payment_method).toBe('qris');
  });
  it('date invalid → null; amount string numerik → number; Rp-prefix → null', () => {
    expect(normalizeReceiptResult({ amount: 50000, date: '12/08/2026' }).date).toBeNull();
    expect(normalizeReceiptResult({ amount: '250000', date: '2026-08-02' }).amount).toBe(250000);
    expect(normalizeReceiptResult({ amount: 'Rp 12.000', date: '2026-08-02' }).amount).toBeNull();
  });
});
