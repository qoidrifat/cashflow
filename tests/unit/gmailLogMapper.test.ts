/**
 * Unit test: src/features/gmail/gmailLogMapper.ts — helper MURNI mapping
 * GmailSyncLog (server) → SyncEmail (UI).
 *
 * BUG yang di-guard (regresi 2026-08): metadata kolom `metadata` di Turso adalah
 * TEXT JSON, tapi dulu dibiarkan string → field `candidate` (amount/merchant/
 * category) tidak pernah terbaca dari data server → tombol "Setujui" di tab
 * "Perlu Review" gagal diam-diam. Test ini memastikan:
 *   1. parseMetadata mengubah string JSON → object (dan handle kasus korup).
 *   2. mapLogToSyncEmail mengisi amount/merchant/category/paymentMethod/dll dari
 *      metadata.candidate — baik metadata berupa OBJECT maupun STRING JSON
 *      (persis bentuk yang dikirim server SELECT *).
 */
import { describe, it, expect } from 'vitest';
import { parseMetadata, mapLogToSyncEmail, type SyncEmail } from '../../src/features/gmail/gmailLogMapper';
import type { GmailSyncLog } from '../../src/types';

const BASE_LOG: GmailSyncLog = {
  id: 'log-1',
  userId: 'u1',
  messageId: 'msg-1',
  subject: 'Pembayaran Gojek',
  sender: 'noreply@gojek.com',
  status: 'needs_review',
  scannedAt: new Date('2026-08-01T10:00:00Z'),
};

const CANDIDATE = {
  amount: 25000,
  merchant: 'Gojek',
  category: 'Transportasi',
  paymentMethod: 'e-wallet',
  transactionType: 'expense',
  note: 'Perjalanan ke kantor',
  date: '2026-08-01',
  confidence: 0.87,
};

describe('parseMetadata', () => {
  it('string JSON valid → object (akar bug: candidate tidak terbaca)', () => {
    const meta = parseMetadata(JSON.stringify({ candidate: CANDIDATE, skipReason: 'x' }));
    expect(meta).toEqual({ candidate: CANDIDATE, skipReason: 'x' });
    expect((meta.candidate as Record<string, unknown>).amount).toBe(25000);
  });

  it('object → dikembalikan apa adanya', () => {
    const obj = { candidate: CANDIDATE };
    expect(parseMetadata(obj)).toBe(obj);
  });

  it('string JSON tidak valid → {} (tidak throw)', () => {
    expect(parseMetadata('{invalid json')).toEqual({});
  });

  it('null / undefined / number / boolean → {}', () => {
    expect(parseMetadata(null)).toEqual({});
    expect(parseMetadata(undefined)).toEqual({});
    expect(parseMetadata(42)).toEqual({});
    expect(parseMetadata(false)).toEqual({});
  });

  it('string JSON kosong / "null" → {}', () => {
    expect(parseMetadata('')).toEqual({});
    expect(parseMetadata('null')).toEqual({});
  });
});

describe('mapLogToSyncEmail', () => {
  it('candidate lengkap (metadata OBJECT) → SyncEmail lengkap terisi', () => {
    const email = mapLogToSyncEmail({
      ...BASE_LOG,
      metadata: { candidate: CANDIDATE },
    });
    expect(email.id).toBe('msg-1');
    expect(email.subject).toBe('Pembayaran Gojek');
    expect(email.from).toBe('noreply@gojek.com');
    expect(email.amount).toBe(25000);
    expect(email.merchant).toBe('Gojek');
    expect(email.category).toBe('Transportasi');
    expect(email.paymentMethod).toBe('e-wallet');
    expect(email.transactionType).toBe('expense');
    expect(email.note).toBe('Perjalanan ke kantor');
    expect(email.confidence).toBe(0.87);
    expect(email.status).toBe('needs_review');
  });

  it('candidate sebagai STRING JSON (bentuk server SELECT *) → tetap terbaca (regresi guard)', () => {
    const email = mapLogToSyncEmail({
      ...BASE_LOG,
      metadata: JSON.stringify({ candidate: CANDIDATE }),
    });
    expect(email.amount).toBe(25000);
    expect(email.merchant).toBe('Gojek');
    expect(email.category).toBe('Transportasi');
    expect(email.paymentMethod).toBe('e-wallet');
  });

  it('tanpa metadata/candidate → amount/merchant null, bukan undefined-gagal', () => {
    const email = mapLogToSyncEmail(BASE_LOG);
    expect(email.amount).toBeNull();
    expect(email.merchant).toBeNull();
    expect(email.category).toBeNull();
    expect(email.paymentMethod).toBeNull();
    expect(email.transactionType).toBeUndefined();
    expect(email.note).toBeNull();
  });

  it('confidenceScore dari kolom log dipakai, bukan candidate', () => {
    const email = mapLogToSyncEmail({
      ...BASE_LOG,
      confidenceScore: 0.55,
      metadata: { candidate: { ...CANDIDATE, confidence: 0.99 } },
    });
    expect(email.confidence).toBe(0.55);
  });

  it('extractedNote dari kolom log menang atas candidate.note', () => {
    const email = mapLogToSyncEmail({
      ...BASE_LOG,
      extractedNote: 'catatan dari server',
      metadata: { candidate: CANDIDATE },
    });
    expect(email.note).toBe('catatan dari server');
  });

  it('errorMessage → reason (kondisi needs_review/gagal)', () => {
    const email = mapLogToSyncEmail({
      ...BASE_LOG,
      status: 'failed',
      errorMessage: 'Gemini gagal, fallback parser berhasil',
    });
    expect(email.reason).toBe('Gemini gagal, fallback parser berhasil');
  });

  it('status auto_skipped + metadata.skipReason → reason terisi', () => {
    const email = mapLogToSyncEmail({
      ...BASE_LOG,
      status: 'auto_skipped',
      metadata: { skipReason: 'promo_cashback', candidate: null },
    });
    expect(email.reason).toBe('promo_cashback');
  });

  it('status selain skipped/rejected → reason undefined tanpa errorMessage', () => {
    const email = mapLogToSyncEmail({ ...BASE_LOG, status: 'approved' });
    expect(email.reason).toBeUndefined();
  });

  it('candidate.amount non-number (string/null) → amount null (bukan string bocor)', () => {
    const email = mapLogToSyncEmail({
      ...BASE_LOG,
      metadata: { candidate: { ...CANDIDATE, amount: '25000' } },
    });
    expect(email.amount).toBeNull();
  });

  it('tanggal: emailDate dipakai; fallback ke scannedAt ISO', () => {
    expect(mapLogToSyncEmail({ ...BASE_LOG, emailDate: '2026-07-20' }).date).toBe('2026-07-20');
    expect(mapLogToSyncEmail(BASE_LOG).date).toBe('2026-08-01T10:00:00.000Z');
  });

  it('hasil selalu berbentuk SyncEmail valid (type guard ekstra)', () => {
    const email: SyncEmail = mapLogToSyncEmail({
      ...BASE_LOG,
      metadata: { candidate: CANDIDATE },
    });
    expect(typeof email.id).toBe('string');
    expect(typeof email.subject).toBe('string');
    expect(typeof email.from).toBe('string');
    expect(typeof email.date).toBe('string');
  });
});
