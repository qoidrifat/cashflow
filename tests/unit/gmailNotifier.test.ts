/**
 * Unit test: server/services/gmailNotifier.js — channel eksternal hasil review
 * Gmail (webhook + email). Menguji bagian MURNI (tanpa DB/jaringan):
 * shape payload webhook `buildReviewWebhookPayload` + konten email
 * `buildReviewEmailContent` (subject/text/html per status).
 *
 * Pengiriman aktual (fetch webhook + SMTP) tidak diuji di sini (butuh jaringan);
 * logika keputusan & format payload dijamin di sini — pola sama dengan
 * tests/unit/alertNotifier.test.ts.
 */
import { describe, it, expect } from 'vitest';
import {
  buildReviewWebhookPayload,
  buildReviewEmailContent,
} from '../../server/services/gmailNotifier.js';

const USER = { userId: 'user-123', userEmail: 'user@example.com' };

describe('buildReviewWebhookPayload', () => {
  it('shape stabil: event + app + timestamp + user + result lengkap (approved)', () => {
    const payload = buildReviewWebhookPayload({
      ...USER,
      result: { status: 'approved', emailId: 'msg-1', merchant: 'Gojek', amount: 25000, message: null },
    });
    expect(payload.event).toBe('gmail.review.result');
    expect(payload.app).toBe('cashflow');
    expect(typeof payload.timestamp).toBe('string');
    expect(new Date(payload.timestamp).getTime()).not.toBeNaN();
    expect(payload.user).toEqual({ id: 'user-123', email: 'user@example.com' });
    expect(payload.result).toEqual({
      status: 'approved',
      emailId: 'msg-1',
      merchant: 'Gojek',
      amount: 25000,
      message: null,
    });
  });

  it('tidak membawa field sensitif (hanya data aksi review)', () => {
    const payload = buildReviewWebhookPayload({
      ...USER,
      result: { status: 'failed', emailId: 'msg-2', merchant: null, amount: null, message: 'DB down' },
    });
    expect(Object.keys(payload.result).sort()).toEqual([
      'amount', 'emailId', 'merchant', 'message', 'status',
    ]);
    expect(JSON.stringify(payload)).not.toMatch(/token|secret|key|password|authorization/i);
  });

  it('menormalisasi amount non-number → null, email/user kosong tetap aman', () => {
    const payload = buildReviewWebhookPayload({
      userId: null,
      userEmail: '',
      result: { status: 'rejected', emailId: 'msg-3', merchant: 'Telkomsel', amount: '25000' },
    });
    expect(payload.user).toEqual({ id: null, email: null });
    expect(payload.result.amount).toBeNull();
  });
});

describe('buildReviewEmailContent', () => {
  it('approved: subject + body sesuai + tidak sensitif', () => {
    const c = buildReviewEmailContent({
      status: 'approved', emailId: 'msg-1', merchant: 'Gojek', amount: 25000, message: null,
    });
    expect(c.subject).toContain('Transaksi Gmail diterima');
    expect(c.subject).toContain('Gojek');
    expect(c.text).toContain('berhasil disimpan ke daftar transaksi');
    expect(c.text).toContain('Rp 25.000');
    expect(c.html).toContain('Gojek');
    expect(c.html).toContain('Dikirim otomatis oleh CashFlow');
  });

  it('failed: memuat pesan error sistem', () => {
    const c = buildReviewEmailContent({
      status: 'failed', emailId: 'msg-2', merchant: 'Alfamart', amount: 5000, message: 'Gagal terhubung ke database',
    });
    expect(c.subject).toContain('Gagal menerima transaksi Gmail');
    expect(c.text).toContain('Gagal terhubung ke database');
    expect(c.text).toContain('Rp 5.000');
  });

  it('duplicate & rejected: body yang sesuai', () => {
    const dup = buildReviewEmailContent({ status: 'duplicate', emailId: 'm', merchant: 'X', amount: 100, message: null });
    expect(dup.text).toContain('transaksi serupa sudah ada');

    const rej = buildReviewEmailContent({ status: 'rejected', emailId: 'm', merchant: 'Y', amount: null, message: null });
    expect(rej.text).toContain('ditandai ditolak dan tidak disimpan');
  });

  it('status tak dikenal → fallback failed, merchant default "Transaksi"', () => {
    const c = buildReviewEmailContent({ status: 'unknown', emailId: 'm', merchant: null, amount: null, message: null });
    expect(c.subject).toContain('Gagal menerima transaksi Gmail');
    expect(c.text).toContain('Transaksi');
  });
});
