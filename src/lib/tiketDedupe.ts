/**
 * tiket.com & Travel Provider Deduplication
 *
 * Mencegah transaksi duplikat untuk tiket.com, KAI, Agoda, dll.
 * Jika dua email (bukti pembayaran + e-ticket) memiliki Order ID yang sama,
 * hanya satu transaksi yang dibuat.
 *
 * Strategi:
 *   - Ekstrak Order ID dari subject/body setiap email
 *   - Jika dua email dari provider travel memiliki Order ID sama:
 *     - Email pertama (biasanya bukti pembayaran) → auto_accepted/needs_review
 *     - Email kedua (biasanya e-ticket/confirmation) → related_document_skipped (bukan duplicate, bukan transaksi baru)
 *   - Dedupe disimpan di metadata sync run untuk sesi yang sama
 *   - Order ID persist di processedIdsRef untuk lintas sesi
 */

// ===================== Extract Order ID =====================

export const TRAVEL_PROVIDER_DOMAINS = [
  /tiket\.com/i,
  /kai\.id/i,
  /agoda\.com/i,
  /traveloka\.com/i,
  /booking\.com/i,
  /pegipegi\.com/i,
  /trip\.com/i,
  /reddoorz\.com/i,
];

/**
 * Extract Order ID from subject text
 * tiket.com format: "Order ID 1351082246" or "Order ID: 1351082246"
 */
export function extractOrderIdFromSubject(subject: string): string | null {
  const patterns = [
    /order\s*(?:id|number|no|#)\s*:?\s*(\d{6,20})/i,
    /orderid[\s:]*(\d{6,20})/i,
    /booking\s*(?:id|number|no|#|code)\s*:?\s*(\w{6,20})/i,
    /invoice\s*(?:id|number|no|#)\s*:?\s*(\w{6,20})/i,
    /reservation\s*(?:id|number|no|#)\s*:?\s*(\w{6,20})/i,
    /reference\s*(?:id|number|no|#)\s*:?\s*(\w{6,20})/i,
  ];

  for (const pattern of patterns) {
    const match = subject.match(pattern);
    if (match) return match[1];
  }

  return null;
}

/**
 * Check if a subject indicates a payment receipt vs. an e-ticket/confirmation
 * Payment receipts (Bukti Pembayaran) should take priority over e-tickets
 */
export function isPaymentReceipt(subject: string, body: string): boolean {
  const lowerSubject = subject.toLowerCase();
  const lowerBody = body.toLowerCase();
  const combined = `${lowerSubject} ${lowerBody}`;

  // Payment receipt indicators
  if (/bukti\s*pembayaran|payment\s*(receipt|confirmation|proof)|pembayaran\s*berhasil|receipt|paid|pembayaranmu\s*berhasil/i.test(combined)) {
    return true;
  }

  // E-ticket/non-payment indicators
  if (/e-?tiket|e-?ticket|ini\s*e-?tiket|tiket\s*(elektronik|pesawat|kereta)?|boarding\s*pass|itinerary/i.test(lowerSubject)) {
    return false;
  }

  // Default: if it has order ID and mentions payment, it's a receipt
  return /total|amount|pembayaran|dibayar|paid\s*rp|rp\s*\d/i.test(combined);
}

/**
 * Determine if this email is a related document (e-ticket when payment receipt already processed)
 */
export function isRelatedDocument(subject: string, body: string): boolean {
  const lowerSubject = subject.toLowerCase();
  const lowerBody = body.toLowerCase();

  // E-ticket without payment info
  if ((/e-?tiket|e-?ticket|ini\s*e-?tiket/i.test(lowerSubject) ||
       /e-?tiket|e-?ticket|tiket\s*elektronik/i.test(lowerBody)) &&
      !/total|amount|pembayaran|dibayar|rp\s*\d/i.test(`${lowerSubject} ${lowerBody}`)) {
    return true;
  }

  // Confirmation / itinerary without payment details
  if ((/itinerary|booking\s*confirmed|reservation\s*confirmed|konfirmasi\s*pemesanan/i.test(lowerSubject)) &&
      !/total|amount|pembayaran|dibayar|paid\s*rp/i.test(`${lowerSubject} ${lowerBody}`)) {
    return true;
  }

  return false;
}

/**
 * Get dedupe key for order ID tracking
 * Format: `order-{provider}-{orderId}`
 */
export function getOrderDedupeKey(provider: string, orderId: string): string {
  const providerKey = provider.toLowerCase().replace(/[^a-z0-9]/g, '');
  const orderKey = orderId.replace(/[^a-zA-Z0-9]/g, '');
  return `order-${providerKey}-${orderKey}`;
}

/**
 * Determine the travel provider from sender/subject
 */
export function detectTravelProvider(sender: string, subject: string): string | null {
  const combined = `${sender} ${subject}`.toLowerCase();

  if (/tiket\.com/i.test(combined)) return 'tiket.com';
  if (/kai\.id|kereta/i.test(combined)) return 'KAI';
  if (/agoda/i.test(combined)) return 'Agoda';
  if (/traveloka/i.test(combined)) return 'Traveloka';
  if (/booking\.com/i.test(combined)) return 'Booking.com';
  if (/trip\.com/i.test(combined)) return 'Trip.com';

  return null;
}

/**
 * Check if a sender is from a travel provider that supports order ID dedupe
 */
export function isTravelProvider(sender: string): boolean {
  return TRAVEL_PROVIDER_DOMAINS.some((pattern) => pattern.test(sender));
}
