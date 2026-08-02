/**
 * Transaction Note Builder
 *
 * Membuat catatan transaksi yang jelas dan mudah dipahami dari konteks email.
 * Digunakan ketika AI extraction / fallback parser menghasilkan kandidat transaksi.
 *
 * Sumber:
 * - Subject email
 * - Sender/domain
 * - Merchant hasil ekstraksi
 * - Order ID / Booking ID / Invoice number
 * - Product/event name
 * - AI extraction result
 * - Fallback parser result
 */

import { extractOrderIdFromSubject } from './tiketDedupe';
import { extractDomain } from './gmailClassifier';

// ===================== Types =====================

export interface NoteContext {
  subject: string;
  sender: string;
  merchant: string | null;
  category: string | null;
  amount: number | null;
  transactionType: 'income' | 'expense' | 'transfer' | 'refund' | null;
  paymentMethod: string | null;
  aiNote: string | null;
  aiDescription: string | null;
  fallbackNote: string | null;
  body: string;
}

// ===================== Domain-based Merchant Detection =====================

function detectProvider(context: NoteContext): string | null {
  const sender = context.sender.toLowerCase();
  const subject = context.subject.toLowerCase();
  const merchant = (context.merchant || '').toLowerCase();

  if (sender.includes('tiket.com') || merchant.includes('tiket.com')) return 'tiket';
  if (sender.includes('kai.id') || sender.includes('kai.co.id') || merchant.includes('kai') || merchant.includes('kereta')) return 'kai';
  if (sender.includes('shopee.co.id') || merchant.includes('shopee')) return 'shopee';
  if (sender.includes('grab.com') || merchant.includes('grab')) return 'grab';
  if (sender.includes('agoda.com') || sender.includes('agoda.net') || merchant.includes('agoda')) return 'agoda';
  if (sender.includes('blubybcadigital.id') || sender.includes('blu') || merchant === 'blu') return 'blu';
  if (sender.includes('jago.com') || merchant.includes('bank jago') || merchant.includes('jago')) return 'jago';
  if (sender.includes('linebank.co.id') || merchant.includes('line bank')) return 'linebank';
  if (sender.includes('gojek.com') || merchant.includes('gojek')) return 'gojek';
  if (sender.includes('ovo.id') || merchant.includes('ovo')) return 'ovo';
  if (sender.includes('dana.id') || merchant.includes('dana')) return 'dana';
  if (sender.includes('traveloka.com') || merchant.includes('traveloka')) return 'traveloka';
  if (sender.includes('tokopedia.com') || merchant.includes('tokopedia')) return 'tokopedia';
  if (sender.includes('bca.co.id') || merchant.includes('bca')) return 'bca';
  if (sender.includes('mandiri.co.id') || merchant.includes('mandiri')) return 'mandiri';
  if (sender.includes('bni.co.id') || merchant.includes('bni')) return 'bni';
  if (sender.includes('bri.co.id') || merchant.includes('bri')) return 'bri';

  return null;
}

// ===================== Extract Helpers =====================

function extractOrderId(subject: string, body: string): string | null {
  // Try tiketDedupe extractor first
  const deduped = extractOrderIdFromSubject(subject);
  if (deduped) return deduped;

  // Generic order ID / booking patterns
  const patterns = [
    /order\s*(?:id|number|no|#)?[:\s]*([A-Z0-9]{5,20})/i,
    /booking\s*(?:id|number|no|#|code)?[:\s]*([A-Z0-9]{5,10})/i,
    /invoice\s*(?:id|number|no|#)?[:\s]*([A-Z0-9]{6,20})/i,
    /(?:ref|reference|no\.|#)\s*([A-Z0-9]{6,20})/i,
    /kode\s*(?:booking|pesanan|pemesanan)[:\s]*([A-Z0-9]{4,10})/i,
    /\b(INV|ORD|BK|TKT)[-]?[A-Z0-9]{6,15}\b/i,
  ];

  const combined = `${subject} ${body}`;
  for (const pattern of patterns) {
    const match = combined.match(pattern);
    if (match) return match[1];
  }

  return null;
}

function extractEventName(subject: string, body: string): string | null {
  // Pattern for event names in ticket emails
  const patterns = [
    /tiket\s+(?:untuk\s+)?(.{5,60}?)(?:\s*-\s*order|\s*-\s*booking|\s*$)/i,
    /(?:pembayaran|pesanan)\s+(.{5,60}?)(?:\s*-\s*order|\s*-\s*booking|\s*$)/i,
  ];

  for (const pattern of patterns) {
    const match = subject.match(pattern);
    if (match) return match[1].trim();
  }

  return null;
}

function extractBookingCode(subject: string, body: string): string | null {
  const patterns = [
    /kode\s*(?:booking|pesanan|pemesanan)[:\s]*([A-Z0-9]{4,10})/i,
    /booking\s*(?:id|code|number|no)[:\s]*([A-Z0-9]{4,10})/i,
    /\b(?:EYB|KAI|TKT)[A-Z0-9]{3,7}\b/i,
  ];

  const combined = `${subject} ${body}`;
  for (const pattern of patterns) {
    const match = combined.match(pattern);
    if (match) return match[0]; // Return the full match (e.g., EYB9TGN)
  }

  return null;
}

function extractServiceType(subject: string, body: string): string | null {
  const lower = `${subject} ${body}`.toLowerCase();
  const services = [
    ['grabcar', 'GrabCar'],
    ['grabbike', 'GrabBike'],
    ['grabfood', 'GrabFood'],
    ['grabexpress', 'GrabExpress'],
    ['gofood', 'GoFood'],
    ['gocar', 'GoCar'],
    ['goride', 'GoRide'],
    ['gosend', 'GoSend'],
  ];

  for (const [key, label] of services) {
    if (lower.includes(key)) return label;
  }

  return null;
}

// ===================== Provider-Specific Note Builders =====================

function buildTiketNote(context: NoteContext): string {
  const eventName = extractEventName(context.subject, context.body);
  const orderId = extractOrderId(context.subject, context.body);
  const lower = context.subject.toLowerCase();

  if (lower.includes('e-tiket') || lower.includes('e-ticket')) {
    return eventName
      ? `E-tiket ${eventName}${orderId ? ` - Order ID ${orderId}` : ''}`
      : `E-tiket${orderId ? ` - Order ID ${orderId}` : ''}`;
  }

  if (lower.includes('bukti pembayaran') || lower.includes('pembayaran')) {
    return eventName
      ? `Pembayaran tiket ${eventName}${orderId ? ` - Order ID ${orderId}` : ''}`
      : `Pembayaran tiket${orderId ? ` - Order ID ${orderId}` : ''}`;
  }

  return eventName
    ? `Pembayaran tiket ${eventName}${orderId ? ` - Order ID ${orderId}` : ''}`
    : `Pembayaran tiket${orderId ? ` - Order ID ${orderId}` : ''}`;
}

function buildKaiNote(context: NoteContext): string {
  const bookingCode = extractBookingCode(context.subject, context.body);
  const routeMatch = context.subject.match(/KA\s*(\d+)|(?:rute|tujuan)\s*([A-Za-z\s-]+)/i);

  const route = routeMatch
    ? routeMatch[1] || routeMatch[2]
    : null;

  const parts = ['Pembayaran tiket KAI'];
  if (route) parts.push(`- ${route.trim()}`);
  if (bookingCode) parts.push(`- Kode Booking ${bookingCode}`);

  return parts.join(' ');
}

function buildShopeeNote(context: NoteContext): string {
  const orderId = extractOrderId(context.subject, context.body);
  return orderId
    ? `Pembayaran Shopee - Order ${orderId}`
    : 'Pembayaran belanja Shopee';
}

function buildGrabNote(context: NoteContext): string {
  const service = extractServiceType(context.subject, context.body);
  return service
    ? `Pembayaran ${service}`
    : 'Pembayaran Grab E-Receipt';
}

function buildGojekNote(context: NoteContext): string {
  const service = extractServiceType(context.subject, context.body);
  return service
    ? `Pembayaran ${service}`
    : 'Pembayaran Gojek';
}

function buildAgodaNote(context: NoteContext): string {
  const bookingId = extractOrderId(context.subject, context.body);
  return bookingId
    ? `Pembayaran hotel Agoda - Booking ID ${bookingId}`
    : 'Pembayaran hotel Agoda';
}

function buildBluNote(context: NoteContext): string {
  const lowerSubject = context.subject.toLowerCase();
  const merchant = context.merchant;

  if (lowerSubject.includes('transaksi masuk') || lowerSubject.includes('dana masuk')) {
    return 'Transaksi masuk blu';
  }
  if (lowerSubject.includes('pengembalian dana') || lowerSubject.includes('refund')) {
    return 'Pengembalian dana blu';
  }

  if (merchant && merchant.toLowerCase() !== 'blu') {
    return `Transaksi blu ke ${merchant}`;
  }

  // Default: determine from type
  if (context.transactionType === 'income') return 'Transaksi masuk blu';
  if (context.transactionType === 'refund') return 'Pengembalian dana blu';
  return 'Transaksi keluar blu';
}

function buildJagoNote(context: NoteContext): string {
  const lowerSubject = context.subject.toLowerCase();
  const lowerBody = context.body.toLowerCase();
  const combined = `${lowerSubject} ${lowerBody}`;

  if (combined.includes('top up') || combined.includes('topup') || combined.includes('isi saldo')) {
    return 'Top up e-Wallet dari Bank Jago';
  }
  if (combined.includes('uang telah dikembalikan') || combined.includes('refund') || combined.includes('pengembalian dana')) {
    return 'Pengembalian dana ke Bank Jago';
  }
  if (combined.includes('transfer') || combined.includes('dana keluar')) {
    return 'Transfer dari Bank Jago';
  }
  if (combined.includes('dikenakan biaya') || combined.includes('kekurangan saldo')) {
    return 'Biaya kekurangan saldo Bank Jago';
  }
  if (combined.includes('dana masuk') || combined.includes('transaksi masuk')) {
    return 'Dana masuk ke Bank Jago';
  }

  if (context.transactionType === 'expense') return 'Pembayaran dari Bank Jago';
  if (context.transactionType === 'income') return 'Dana masuk ke Bank Jago';
  return 'Transaksi Bank Jago';
}

function buildLineBankNote(context: NoteContext): string {
  if (context.transactionType === 'income' || context.transactionType === 'refund') {
    return 'Cashback diterima dari LINE Bank';
  }
  return 'Transaksi LINE Bank';
}

function buildTravelokaNote(context: NoteContext): string {
  const orderId = extractOrderId(context.subject, context.body);
  return orderId
    ? `Pembayaran Traveloka${orderId ? ` - Order ID ${orderId}` : ''}`
    : 'Pembayaran Traveloka';
}

function buildBCANote(context: NoteContext): string {
  const lower = `${context.subject.toLowerCase()} ${context.body.toLowerCase()}`;
  if (lower.includes('transfer')) return 'Transfer BCA';
  if (lower.includes('pembayaran') || lower.includes('belanja')) return 'Pembayaran via BCA';
  if (lower.includes('mutasi') || lower.includes('debet')) return 'Mutasi rekening BCA';
  return 'Transaksi BCA';
}

function buildGenericNote(context: NoteContext): string {
  const merchant = context.merchant;
  const type = context.transactionType;
  const senderDomain = extractDomain(context.sender);
  const senderName = senderDomain || merchant || 'Unknown';

  // Use AI note if available
  if (context.aiNote && context.aiNote.trim()) {
    return context.aiNote.trim();
  }

  // Use AI description if available
  if (context.aiDescription && context.aiDescription.trim()) {
    return context.aiDescription.trim();
  }

  // Use subject as fallback (sanitized)
  const sanitizedSubject = sanitizeTransactionNote(context.subject);
  if (sanitizedSubject && sanitizedSubject.length > 10) {
    if (merchant) return `${sanitizedSubject} - ${merchant}`;
    return sanitizedSubject;
  }

  // Last resort: type + merchant/sender
  if (merchant) {
    switch (type) {
      case 'income': return `Pemasukan dari ${merchant}`;
      case 'expense': return `Pengeluaran untuk ${merchant}`;
      case 'transfer': return `Transfer ${merchant}`;
      case 'refund': return `Pengembalian dana dari ${merchant}`;
      default: return `Transaksi dari ${merchant}`;
    }
  }

  if (senderName && senderName !== 'Unknown') {
    switch (type) {
      case 'income': return `Pemasukan dari ${senderName}`;
      case 'expense': return `Pembayaran ke ${senderName}`;
      case 'transfer': return `Transfer ${senderName}`;
      case 'refund': return `Pengembalian dana dari ${senderName}`;
      default: return `Transaksi ${senderName}`;
    }
  }

  return 'Transaksi';
}

// ===================== Main Builder =====================

/**
 * Build transaction note from email context
 * Prioritizes: AI note > provider template > subject > type+sender
 */
export function buildTransactionNote(context: NoteContext): string {
  // Step 1: If AI produced a valid note, use it after sanitization
  if (context.aiNote && context.aiNote.trim().length > 5) {
    const sanitized = sanitizeTransactionNote(context.aiNote);
    if (sanitized) return sanitized;
  }

  // Step 2: Detect provider and build provider-specific note
  const provider = detectProvider(context);
  if (provider) {
    let note: string | null = null;
    switch (provider) {
      case 'tiket': note = buildTiketNote(context); break;
      case 'kai': note = buildKaiNote(context); break;
      case 'shopee': note = buildShopeeNote(context); break;
      case 'grab': note = buildGrabNote(context); break;
      case 'gojek': note = buildGojekNote(context); break;
      case 'agoda': note = buildAgodaNote(context); break;
      case 'blu': note = buildBluNote(context); break;
      case 'jago': note = buildJagoNote(context); break;
      case 'linebank': note = buildLineBankNote(context); break;
      case 'traveloka': note = buildTravelokaNote(context); break;
      case 'bca': case 'mandiri': case 'bni': case 'bri':
        note = buildBCANote(context);
        break;
      case 'ovo': case 'dana':
        return context.transactionType === 'income'
          ? `Dana masuk dari ${provider.toUpperCase()}`
          : `Pembayaran via ${provider.toUpperCase()}`;
      case 'tokopedia':
        return 'Pembayaran belanja Tokopedia';
    }
    if (note) return sanitizeTransactionNote(note);
  }

  // Step 3: Use AI description if available
  if (context.aiDescription && context.aiDescription.trim().length > 5) {
    return sanitizeTransactionNote(context.aiDescription);
  }

  // Step 4: Build from subject + merchant
  return sanitizeTransactionNote(buildGenericNote(context));
}

// ===================== Sanitization =====================

/**
 * Sanitize transaction note:
 * - Trim whitespace
 * - Remove excessive newlines
 * - Strip HTML tags
 * - Decode HTML entities
 * - Cap at 160 characters
 * - Fallback if empty
 */
export function sanitizeTransactionNote(note: string | null | undefined, merchant?: string): string {
  if (!note) {
    return merchant ? `Transaksi dari ${merchant}` : 'Transaksi';
  }

  let cleaned = note
    .trim()
    // Remove HTML tags
    .replace(/<[^>]*>/g, '')
    // Decode HTML entities
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // Replace multiple spaces/newlines with single space
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  // Max 160 characters
  if (cleaned.length > 160) {
    cleaned = cleaned.substring(0, 157).trim() + '...';
  }

  if (!cleaned) {
    return merchant ? `Transaksi dari ${merchant}` : 'Transaksi';
  }

  return cleaned;
}
