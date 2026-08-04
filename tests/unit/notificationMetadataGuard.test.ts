/**
 * Unit test: server/lib/notificationGuard.js — P1-4 Notification Metadata Guard.
 *
 * Menutup temuan audit (Medium): POST /api/notifications dengan
 * metadata.source='gmail_review' forjaan bisa memicu webhook/email operator
 * berisi konten pilihan penyerang. Guard diuji di sini sebagai fungsi MURNI:
 *   - sanitizeNotificationMetadata: validasi bentuk/ukuran/key berbahaya.
 *   - corroborateGmailReviewResult: keputusan korelasi log server + derivasi
 *     konten dari data server (bukan body client).
 *
 * Perilaku API end-to-end (webhook sink) diuji terpisah di
 * e2e/notification-metadata-guard.spec.ts.
 */
import { describe, it, expect } from 'vitest';
import {
  sanitizeNotificationMetadata,
  corroborateGmailReviewResult,
  GMAIL_REVIEW_RESULTS,
  METADATA_MAX_BYTES,
  METADATA_MAX_KEYS,
} from '../../server/lib/notificationGuard.js';

describe('sanitizeNotificationMetadata', () => {
  it('null/undefined diterima sebagai objek kosong (backwards-compatible)', () => {
    expect(sanitizeNotificationMetadata(undefined)).toEqual({ ok: true, metadata: {} });
    expect(sanitizeNotificationMetadata(null)).toEqual({ ok: true, metadata: {} });
  });

  it('objek JSON biasa lolos apa adanya', () => {
    const input = { pendingCount: 3, source: 'gmail_sync', nested: { a: [1, 2] } };
    expect(sanitizeNotificationMetadata(input)).toEqual({ ok: true, metadata: input });
  });

  it('bukan objek (string/angka/boolean/array) ditolak', () => {
    for (const raw of ['metadata', 42, true, ['a'], false]) {
      const res = sanitizeNotificationMetadata(raw);
      expect(res.ok, String(raw)).toBe(false);
      if (!res.ok) expect(res.error).toBeTruthy();
    }
  });

  it('metadata melebihi batas ukuran ditolak', () => {
    const big = { blob: 'x'.repeat(METADATA_MAX_BYTES) };
    const res = sanitizeNotificationMetadata(big);
    expect(res.ok).toBe(false);
  });

  it('metadata melebihi batas jumlah key ditolak', () => {
    const manyKeys: Record<string, number> = {};
    for (let i = 0; i <= METADATA_MAX_KEYS; i++) manyKeys[`k${i}`] = i;
    const res = sanitizeNotificationMetadata(manyKeys);
    expect(res.ok).toBe(false);
  });

  it('key prototype-pollution di-strip rekursif, key lain utuh', () => {
    // JSON.parse dipakai agar __proto__ menjadi own-property (meniru body parser).
    const raw = JSON.parse('{"__proto__":{"admin":true},"constructor":{"x":1},"source":"a","nested":{"prototype":{"y":2},"ok":1}}');
    const res = sanitizeNotificationMetadata(raw);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.metadata).toEqual({ source: 'a', nested: { ok: 1 } });
      expect(Object.prototype.hasOwnProperty.call(res.metadata, '__proto__')).toBe(false);
      expect((res.metadata as any).admin).toBeUndefined();
    }
  });
});

describe('corroborateGmailReviewResult', () => {
  const logRow = (overrides: Record<string, unknown> = {}) => ({
    status: 'approved',
    final_status: 'approved',
    sender: 'merchant@example.com',
    error_message: null,
    metadata: JSON.stringify({ candidate: { amount: 125000, merchant: 'E2E Test Merchant' } }),
    ...overrides,
  });

  it('hasil sah + log kompatibel → konten DISARINKAN dari log server', () => {
    const res = corroborateGmailReviewResult({ logRow: logRow(), emailId: 'msg-1', claimedResult: 'approved' });
    expect(res).toEqual({
      status: 'approved',
      emailId: 'msg-1',
      merchant: 'E2E Test Merchant',
      amount: 125000,
      message: null,
    });
  });

  it('tanpa baris log (forgery emailId) → null (side effect diblokir)', () => {
    expect(corroborateGmailReviewResult({ logRow: null, emailId: 'msg-x', claimedResult: 'approved' })).toBeNull();
    expect(corroborateGmailReviewResult({ logRow: undefined, emailId: 'msg-x', claimedResult: 'failed' })).toBeNull();
  });

  it('status log tidak kompatibel dengan klaim → null', () => {
    // Klaim approved tapi log masih needs_review
    expect(corroborateGmailReviewResult({ logRow: logRow({ status: 'needs_review', final_status: 'needs_review' }), emailId: 'msg-1', claimedResult: 'approved' })).toBeNull();
    // Klaim rejected tapi log approved
    expect(corroborateGmailReviewResult({ logRow: logRow(), emailId: 'msg-1', claimedResult: 'rejected' })).toBeNull();
  });

  it('failed kompatibel dengan status longgar (needs_review/pending_review/failed)', () => {
    for (const st of ['needs_review', 'pending_review', 'failed', 'retry_later', 'config_error']) {
      const res = corroborateGmailReviewResult({ logRow: logRow({ status: st, final_status: st }), emailId: 'msg-1', claimedResult: 'failed' });
      expect(res?.status, st).toBe('failed');
    }
  });

  it('klaim hasil di luar whitelist → null', () => {
    expect(corroborateGmailReviewResult({ logRow: logRow(), emailId: 'msg-1', claimedResult: 'hacked' })).toBeNull();
    expect(GMAIL_REVIEW_RESULTS.size).toBe(4);
  });

  it('emailId bukan string/kosong/terlalu panjang → null', () => {
    expect(corroborateGmailReviewResult({ logRow: logRow(), emailId: '', claimedResult: 'approved' })).toBeNull();
    expect(corroborateGmailReviewResult({ logRow: logRow(), emailId: 123 as unknown as string, claimedResult: 'approved' })).toBeNull();
    expect(corroborateGmailReviewResult({ logRow: logRow(), emailId: 'a'.repeat(192), claimedResult: 'approved' })).toBeNull();
  });

  it('fallback merchant ke sender saat candidate kosong; amount non-number → null', () => {
    const res = corroborateGmailReviewResult({
      logRow: logRow({ metadata: JSON.stringify({ candidate: { amount: '125000' } }) }),
      emailId: 'msg-1',
      claimedResult: 'approved',
    });
    expect(res?.merchant).toBe('merchant@example.com');
    expect(res?.amount).toBeNull();
  });

  it('metadata log rusak (JSON invalid) → tetap terkirim dengan fallback sender', () => {
    const res = corroborateGmailReviewResult({
      logRow: logRow({ metadata: '{bukan-json', status: 'rejected', final_status: 'rejected' }),
      emailId: 'msg-1',
      claimedResult: 'rejected',
    });
    expect(res).not.toBeNull();
    expect(res?.merchant).toBe('merchant@example.com');
  });

  it('message hanya diambil dari error_message log untuk status failed', () => {
    const res = corroborateGmailReviewResult({
      logRow: logRow({ status: 'failed', final_status: 'failed', error_message: 'Nominal tidak ditemukan' }),
      emailId: 'msg-1',
      claimedResult: 'failed',
    });
    expect(res?.message).toBe('Nominal tidak ditemukan');

    // Non-failed tidak membawa message
    const approved = corroborateGmailReviewResult({
      logRow: logRow({ error_message: 'should-not-leak' }),
      emailId: 'msg-1',
      claimedResult: 'approved',
    });
    expect(approved?.message).toBeNull();
  });

  it('merchant & message dibatasi panjangnya (anti payload raksasa)', () => {
    const res = corroborateGmailReviewResult({
      logRow: logRow({
        status: 'failed',
        final_status: 'failed',
        error_message: 'x'.repeat(5000),
        metadata: JSON.stringify({ candidate: { merchant: 'y'.repeat(5000), amount: 1 } }),
      }),
      emailId: 'msg-1',
      claimedResult: 'failed',
    });
    expect(res?.merchant?.length).toBeLessThanOrEqual(200);
    expect(res?.message?.length).toBeLessThanOrEqual(500);
  });
});
