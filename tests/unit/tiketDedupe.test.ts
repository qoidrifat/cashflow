/**
 * Unit test: src/lib/tiketDedupe.ts
 *
 * Dedupe transaksi travel (tiket.com, KAI, Agoda, dst) berdasarkan Order ID.
 */
import { describe, it, expect } from 'vitest';
import {
  extractOrderIdFromSubject,
  isPaymentReceipt,
  isRelatedDocument,
  getOrderDedupeKey,
  detectTravelProvider,
  isTravelProvider,
} from '../../src/lib/tiketDedupe';

describe('extractOrderIdFromSubject', () => {
  it('Order ID tiket.com (numeric)', () => {
    expect(extractOrderIdFromSubject('Order ID 1351082246')).toBe('1351082246');
    expect(extractOrderIdFromSubject('Order ID: 1351082246')).toBe('1351082246');
  });

  it('booking/reference code', () => {
    expect(extractOrderIdFromSubject('Booking Code ABC123XYZ')).toBe('ABC123XYZ');
    expect(extractOrderIdFromSubject('Reference No: 88445566')).toBe('88445566');
  });

  it('null bila tidak ada pola', () => {
    expect(extractOrderIdFromSubject('Selamat datang di tiket.com')).toBeNull();
  });
});

describe('isPaymentReceipt', () => {
  it('bukti pembayaran → true', () => {
    expect(
      isPaymentReceipt('Bukti Pembayaran tiket.com', 'Pembayaran berhasil sebesar Rp 1.250.000'),
    ).toBe(true);
  });

  it('e-ticket tanpa payment info → false', () => {
    expect(isPaymentReceipt('Ini E-Tiket Anda', 'Silakan tunjukkan e-tiket di stasiun')).toBe(false);
  });
});

describe('isRelatedDocument', () => {
  it('e-tiket tanpa nominal → true (related document)', () => {
    expect(isRelatedDocument('E-Tiket Kereta Anda', 'Tunjukkan e-tiket ini di stasiun')).toBe(true);
  });

  it('e-tiket dengan nominal → false (mungkin transaksi sendiri)', () => {
    expect(isRelatedDocument('E-Tiket Anda', 'Total dibayar Rp 300.000')).toBe(false);
  });

  it('konfirmasi pemesanan tanpa payment → true', () => {
    expect(isRelatedDocument('Booking Confirmed', 'Reservation confirmed — terima kasih')).toBe(true);
  });
});

describe('getOrderDedupeKey', () => {
  it('normalisasi provider + order id (case order id dipertahankan)', () => {
    expect(getOrderDedupeKey('tiket.com', '1351082246')).toBe('order-tiketcom-1351082246');
    expect(getOrderDedupeKey('KAI Access', 'A-123!')).toBe('order-kaiaccess-A123');
  });
});

describe('detectTravelProvider / isTravelProvider', () => {
  it('deteksi provider dari sender', () => {
    expect(detectTravelProvider('noreply@tiket.com', 'Order')).toBe('tiket.com');
    expect(detectTravelProvider('info@kai.id', 'E-Tiket')).toBe('KAI');
    expect(detectTravelProvider('noreply@agoda.com', 'Booking')).toBe('Agoda');
    expect(detectTravelProvider('no-reply@bca.co.id', 'Pembayaran')).toBeNull();
  });

  it('isTravelProvider untuk domain travel', () => {
    expect(isTravelProvider('noreply@tiket.com')).toBe(true);
    expect(isTravelProvider('noreply@traveloka.com')).toBe(true);
    expect(isTravelProvider('no-reply@bca.co.id')).toBe(false);
  });
});
