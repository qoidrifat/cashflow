/**
 * Gemini Fallback Parser — Regex-based fallback when AI produces invalid JSON
 *
 * Digunakan ketika AI menghasilkan JSON tidak valid untuk email dari bank/e-wallet
 * terpercaya seperti LINE Bank dan blu. Ekstrak nominal, tanggal, dan jenis transaksi
 * menggunakan regex pattern matching.
 *
 * Output mengikuti schema yang sama dengan AI parser agar bisa diproses secara seragam.
 */

import type { ExtractedTransaction } from '../types';
import {
  getPromoCashbackMatch,
  isActualCashbackEmail,
  isPromoCashbackEmail,
  PROMO_CASHBACK_ERROR_CODE,
} from './promoCashbackClassifier';
import {
  BLU_NON_TRANSACTION_REASON,
  isBluNonTransactionEmail,
  NON_TRANSACTION_SKIPPED_ERROR_CODE,
} from './gmailClassifier';

// ===================== Types =====================

export interface FallbackParseResult {
  success: boolean;
  data?: ExtractedTransaction;
  reason: string;
  confidence: number;
  finalStatus?: 'pending_review' | 'skipped' | 'rejected' | 'failed';
  errorCode?: string;
  amount?: number | null;
  fallbackUsed?: boolean;
  matchedRule?: string;
  detectedPromoAmount?: number | null;
  amountIgnored?: boolean;
}

// ===================== Amount Extraction =====================

/**
 * Extract nominal uang dari teks email
 * Pattern: Rp 150.000, Rp150.000, IDR 150000, nominal Rp 150.000
 */
export function extractAmountFromText(text: string): number | null {
  if (isPromoCashbackEmail('', text)) return null;

  const amountPatterns: RegExp[] = [
    /(?:grand\s*total|total\s*pembayaran|total\s*bayar|total\s*tagihan|total|nominal|jumlah|sebesar|dibayar|pembayaran|tagihan)\s*:?\s*(?:Rp|IDR)\s?([0-9][0-9.,]*(?:,\d{2})?)/i,
    /(?:amount|total\s*paid|paid\s*amount|payment\s*amount)\s*:?\s*(?:IDR|Rp)\s?([0-9][0-9.,]*)/i,
    /(?:Rp|IDR)\s?([0-9][0-9.,]*(?:,\d{2})?)/i,
  ];

  for (const pattern of amountPatterns) {
    const match = text.match(pattern);
    if (!match) continue;

    const amount = normalizeAmount(match[1]);
    if (amount && amount > 0) return amount;
  }

  return null;
}

function normalizeAmount(raw: string): number | null {
  const trimmed = raw.trim();
  const hasDecimalComma = /,\d{2}$/.test(trimmed);
  const cleaned = hasDecimalComma
    ? trimmed.replace(/\./g, '').replace(/,/g, '.')
    : trimmed.replace(/[.,]/g, '');
  const amount = parseFloat(cleaned);
  return Number.isFinite(amount) ? amount : null;
}

/**
 * Extract date from email text with fallback to email date
 */
export function extractDateFromText(
  text: string,
  fallbackEmailDate?: string,
): string | null {
  // Pattern 1: ISO format YYYY-MM-DD
  const isoPattern = /\b(\d{4})-(\d{2})-(\d{2})\b/;
  const isoMatch = text.match(isoPattern);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

  // Pattern 2: Indonesian format DD/MM/YYYY or DD-MM-YYYY
  const idPattern = /\b(\d{2})[\/-](\d{2})[\/-](\d{4})\b/;
  const idMatch = text.match(idPattern);
  if (idMatch) return `${idMatch[3]}-${idMatch[2]}-${idMatch[1]}`;

  // Pattern 3: "12 Juni 2026" format
  const months: Record<string, string> = {
    januari: '01', februari: '02', maret: '03', april: '04',
    mei: '05', juni: '06', juli: '07', agustus: '08',
    september: '09', oktober: '10', november: '11', desember: '12',
    january: '01', february: '02', march: '03', april_en: '04',
    may: '05', june: '06', july: '07', august: '08',
    september_en: '09', october: '10', november_en: '11', december: '12',
  };
  const textPattern = /\b(\d{1,2})\s+(Januari|Februari|Maret|April|Mei|Juni|Juli|Agustus|September|Oktober|November|Desember|January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/i;
  const textMatch = text.match(textPattern);
  if (textMatch) {
    const monthKey = textMatch[2].toLowerCase();
    const month = months[monthKey] || months[monthKey.replace(/en$/, '')] || '01';
    const day = textMatch[1].padStart(2, '0');
    return `${textMatch[3]}-${month}-${day}`;
  }

  // Pattern 4: "2026-06-12T..." (ISO datetime)
  const isoDtPattern = /\b(\d{4}-\d{2}-\d{2})T/;
  const isoDtMatch = text.match(isoDtPattern);
  if (isoDtMatch) return isoDtMatch[1];

  // Fallback to email date
  if (fallbackEmailDate) {
    const parsed = new Date(fallbackEmailDate);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString().split('T')[0];
    }
  }

  return null;
}

// ===================== Transaction Type Inference =====================

/**
 * Infer transaction type from sender, subject, and body text
 */
export function inferTransactionType(
  sender: string,
  subject: string,
  text: string,
): 'income' | 'expense' | 'transfer' | 'refund' | null {
  const lowerText = text.toLowerCase();
  const lowerSubject = subject.toLowerCase();
  const combined = `${lowerSubject} ${lowerText}`;

  if (isActualCashbackEmail(subject, text)) return 'income';

  if (/uang\s+telah\s+dikembalikan|refund|pengembalian\s+dana|dana\s+dikembalikan/i.test(combined)) {
    return 'refund';
  }

  if (/top\s*up|e-?wallet|dikenakan\s*biaya|biaya\s+dari\s+kekurangan\s+saldo/i.test(combined)) {
    return 'expense';
  }

  if (/penarikan\s+dana.*kantong\s+investasi|kantong\s+investasi.*berhasil/i.test(combined)) {
    return 'income';
  }

  if (/kamu\s+telah\s+melakukan\s+transfer|melakukan\s+transfer/i.test(combined)) {
    return 'transfer';
  }

  // Refund
  if (
    combined.includes('refund') ||
    combined.includes('pengembalian dana') ||
    combined.includes('dana dikembalikan')
  ) return 'refund';

  // Income (dana masuk)
  if (
    combined.includes('dana masuk') ||
    combined.includes('transaksi masuk') ||
    combined.includes('transfer masuk') ||
    combined.includes('pemasukan') ||
    combined.includes('kredit') ||
    combined.includes('top up berhasil')
  ) {
    // Check if it's actually a top-up (expense from one perspective, but credit)
    if (combined.includes('top up') || combined.includes('isi saldo')) return 'expense';
    return 'income';
  }

  // Transfer
  if (
    combined.includes('transfer') ||
    combined.includes('dana keluar')
  ) return 'transfer';

  // Expense (default for most transactions)
  if (
    combined.includes('pembayaran') ||
    combined.includes('transaksi') ||
    combined.includes('pembelian') ||
    combined.includes('berhasil') ||
    combined.includes('tagihan')
  ) return 'expense';

  return null;
}

// ===================== Merchant Inference =====================

/**
 * Infer merchant name from sender, subject, and body
 */
export function inferMerchant(
  sender: string,
  subject: string,
  text: string,
): string | null {
  // From sender domain
  const domainMatch = sender.match(/@([^\s>]+)/);
  const domain = domainMatch ? domainMatch[1].toLowerCase() : '';

  // Known merchant mapping
  const merchantMap: Record<string, string> = {
    'linebank.co.id': 'LINE Bank',
    'blubybcadigital.id': 'blu',
    'bca.co.id': 'BCA',
    'mandiri.co.id': 'Bank Mandiri',
    'bni.co.id': 'BNI',
    'bri.co.id': 'BRI',
    'jago.com': 'Bank Jago',
    'jenius.com': 'Jenius',
    'shopee.co.id': 'Shopee',
    'tokopedia.com': 'Tokopedia',
    'gojek.com': 'Gojek',
    'grab.com': 'Grab',
    'ovo.id': 'OVO',
    'dana.id': 'DANA',
    'gopay.co.id': 'GoPay',
    'traveloka.com': 'Traveloka',
    'kai.id': 'KAI',
    'kai.co.id': 'KAI',
    'tiket.com': 'Tiket.com',
    'agoda.com': 'Agoda',
    'agoda.net': 'Agoda',
  };

  for (const [key, name] of Object.entries(merchantMap)) {
    if (domain.includes(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) || sender.toLowerCase().includes(key)) {
      return name;
    }
  }

  // Try to extract merchant from sender name
  const nameMatch = sender.match(/^"?([^"<]+)"?\s*</);
  if (nameMatch) {
    const name = nameMatch[1].trim();
    if (name && !name.toLowerCase().includes('noreply') && !name.toLowerCase().includes('no-reply')) {
      return name;
    }
  }

  return null;
}

// ===================== Payment Method Inference =====================

/**
 * Infer payment method from sender domain
 */
export function inferPaymentMethod(sender: string): string | null {
  const domainMatch = sender.match(/@([^\s>]+)/);
  const domain = domainMatch ? domainMatch[1].toLowerCase() : '';

  if (domain.includes('linebank')) return 'LINE Bank';
  if (domain.includes('blubybcadigital') || domain.includes('blu')) return 'blu';
  if (domain.includes('bca')) return 'BCA';
  if (domain.includes('mandiri')) return 'Bank Mandiri';
  if (domain.includes('bni')) return 'BNI';
  if (domain.includes('bri')) return 'BRI';
  if (domain.includes('jago')) return 'Bank Jago';
  if (domain.includes('jenius')) return 'Jenius';
  if (domain.includes('gopay') || domain.includes('gojek')) return 'GoPay';
  if (domain.includes('ovo')) return 'OVO';
  if (domain.includes('dana')) return 'DANA';
  if (domain.includes('shopee')) return 'Shopee';
  if (domain.includes('kai')) return 'KAI';
  if (domain.includes('tiket')) return 'tiket.com';
  if (domain.includes('agoda')) return 'Agoda';
  if (domain.includes('tokopedia')) return 'Tokopedia';
  if (domain.includes('linkaja')) return 'LinkAja';
  if (domain.includes('flip')) return 'Transfer Bank';
  if (domain.includes('grab')) return 'E-wallet';
  if (domain.includes('traveloka')) return 'Kartu / Payment Gateway';

  return null;
}

// ===================== Category Inference =====================

function inferCategory(sender: string, subject: string, text: string): string | null {
  const lowerText = text.toLowerCase();
  const lowerSubject = subject.toLowerCase();
  const combined = `${lowerSubject} ${lowerText}`;

  const categoryMap: Array<[RegExp, string]> = [
    [/(makan|food|restoran|restaurant|kopi|coffee|cafe|warung)/i, 'Makanan & Minuman'],
    [/(transport|grab|gojek|go-car|taxi|parkir|tol|bensin|bbm|kai|kereta|pt\.?\s*kai|railway|train)/i, 'Transportasi'],
    [/(belanja|shopee|tokopedia|lazada|blibli|purchase)/i, 'Belanja'],
    [/(tagihan|pln|listrik|pdam|internet|pulsa|token)/i, 'Tagihan'],
    [/(langganan|subscription|netflix|spotify|youtube premium)/i, 'Langganan'],
    [/(gaji|salary|payroll|honor)/i, 'Gaji'],
    [/(investasi|saham|reksadana|emas|crypto)/i, 'Investasi'],
    [/(cashback|refund|pengembalian)/i, isRefundPattern(subject) ? 'Refund' : 'Cashback'],
    [/(transfer bank|antar bank|sesama bank)/i, 'Transfer'],
    [/(travel|hotel|pesawat|tiket|booking|agoda)/i, 'Travel'],
    [/(sekolah|kuliah|kursus|les|bimbel)/i, 'Pendidikan'],
    [/(rumah sakit|dokter|klinik|obat|apotek)/i, 'Kesehatan'],
    [/(hiburan|film|game|nonton|konser)/i, 'Hiburan'],
  ];

  for (const [pattern, category] of categoryMap) {
    if (pattern.test(combined)) return category;
  }

  return 'Lainnya';
}

function isRefundPattern(subject: string): boolean {
  return /refund|pengembalian dana/i.test(subject);
}

// ===================== LINE Bank Specific Parser =====================

/**
 * Parse LINE Bank email untuk ekstrak transaksi
 * Subject: [LINE Bank] Informasi Transaksi or [LINEBANK] Informasi Transaksi
 */
function parseLineBankEmail(
  sender: string,
  subject: string,
  body: string,
  emailDate: string,
): FallbackParseResult | null {
  const promoCashback = getPromoCashbackMatch(subject, body);
  if (promoCashback.isPromo) {
    return buildPromoCashbackSkipResult(promoCashback);
  }

  const lowerBody = body.toLowerCase();
  const lowerSubject = subject.toLowerCase();

  // Cek apakah ada indikasi transaksi aktual
  const hasTransactionKeywords = /(?:transaksi|transfer|pembayaran|pembelian|top up|tarik tunai|dana masuk|dana keluar|berhasil|rp|nominal)/i.test(
    `${lowerSubject} ${lowerBody}`
  );

  if (!hasTransactionKeywords) {
    return {
      success: false,
      reason: 'Tidak ditemukan indikasi transaksi pada email LINE Bank',
      confidence: 0,
    };
  }

  // Extract nominal
  const combined = `${subject}\n${body}`;
  const amount = extractAmountFromText(combined);

  if (!amount) {
    return {
      success: false,
      reason: 'Tidak ditemukan nominal transaksi pada email LINE Bank',
      confidence: 0,
    };
  }

  // Extract date
  const date = extractDateFromText(combined, emailDate);

  // Infer transaction type
  const transactionType = inferTransactionType(sender, subject, combined);

  return {
    success: true,
    data: {
      is_transaction: true,
      transaction_type: transactionType || 'expense',
      amount,
      currency: 'IDR',
      date: date || undefined,
      merchant: 'LINE Bank',
      category: 'Bank',
      payment_method: 'LINE Bank',
      description: subject.substring(0, 200),
      confidence_score: 0.65,
      reason: `Diparse menggunakan fallback parser lokal setelah AI gagal`,
    },
    reason: 'LINE Bank fallback regex berhasil',
    confidence: 0.65,
  };
}

// ===================== blu Specific Parser =====================

/**
 * Parse blu by BCA Digital email untuk ekstrak transaksi
 * Subject: Transaksimu Pakai blu Berhasil / Info Transaksi Masuk ke blu Kamu / Pengembalian Dana Berhasil
 */
function parseBluEmail(
  sender: string,
  subject: string,
  body: string,
  emailDate: string,
): FallbackParseResult | null {
  const promoCashback = getPromoCashbackMatch(subject, body);
  if (promoCashback.isPromo) {
    return buildPromoCashbackSkipResult(promoCashback);
  }

  const lowerSubject = subject.toLowerCase();
  const lowerBody = body.toLowerCase();

  // Extract nominal
  const amount = extractAmountFromText(body);

  if (!amount) {
    return {
      success: false,
      reason: 'Tidak ditemukan nominal transaksi pada email blu',
      confidence: 0,
    };
  }

  // Extract date
  const date = extractDateFromText(body, emailDate);

  // Infer transaction type from subject
  let transactionType: 'income' | 'expense' | 'transfer' | 'refund' | null = null;
  if (lowerSubject.includes('pengembalian dana') || lowerSubject.includes('refund')) {
    transactionType = 'refund';
  } else if (lowerSubject.includes('transaksi masuk') || lowerSubject.includes('dana masuk')) {
    transactionType = 'income';
  } else if (lowerSubject.includes('berhasil')) {
    // Check if it's a top-up
    if (lowerBody.includes('top up') || lowerBody.includes('isi saldo')) {
      transactionType = 'income';
    } else {
      transactionType = inferTransactionType(sender, subject, body) || 'expense';
    }
  } else {
    transactionType = inferTransactionType(sender, subject, body) || 'expense';
  }

  return {
    success: true,
    data: {
      is_transaction: true,
      transaction_type: transactionType,
      amount,
      currency: 'IDR',
      date: date || undefined,
      merchant: 'blu',
      category: 'Bank',
      payment_method: 'blu',
      description: subject.substring(0, 200),
      confidence_score: 0.65,
      reason: `Diparse menggunakan fallback parser lokal setelah AI gagal`,
    },
    reason: 'blu fallback regex berhasil',
    confidence: 0.65,
  };
}

function buildProviderFallbackResult(
  sender: string,
  subject: string,
  body: string,
  emailDate: string,
  options: {
    merchant: string;
    category: string;
    paymentMethod: string;
    defaultType?: 'income' | 'expense' | 'transfer' | 'refund';
    confidence?: number;
    reason: string;
  },
): FallbackParseResult {
  const combined = `${subject}\n${body}`;
  const amount = extractAmountFromText(combined);

  if (!amount) {
    return {
      success: false,
      reason: `Tidak ditemukan nominal transaksi pada email ${options.merchant}`,
      confidence: 0,
      finalStatus: 'skipped',
      errorCode: NON_TRANSACTION_SKIPPED_ERROR_CODE,
      amount: null,
      fallbackUsed: false,
    };
  }

  const date = extractDateFromText(combined, emailDate);
  const transactionType = inferTransactionType(sender, subject, combined) || options.defaultType || 'expense';
  const confidence = options.confidence ?? 0.68;

  return {
    success: true,
    data: {
      is_transaction: true,
      transaction_type: transactionType,
      amount,
      currency: 'IDR',
      date: date || undefined,
      merchant: options.merchant,
      category: options.category,
      payment_method: options.paymentMethod,
      description: subject.substring(0, 200),
      confidence_score: confidence,
      reason: options.reason,
    },
    reason: options.reason,
    confidence,
    finalStatus: 'pending_review',
    errorCode: 'GEMINI_FALLBACK_USED',
    amount,
    fallbackUsed: true,
  };
}

function parseShopeeEmail(sender: string, subject: string, body: string, emailDate: string): FallbackParseResult | null {
  if (!/shopee\.co\.id|shopee/i.test(sender) && !/shopee/i.test(subject)) return null;
  if (!/pembayaran.*berhasil|berhasil.*dikonfirmasi|pesanan.*dikonfirmasi|payment/i.test(`${subject}\n${body}`)) return null;
  return buildProviderFallbackResult(sender, subject, body, emailDate, {
    merchant: 'Shopee',
    category: 'Belanja',
    paymentMethod: 'Shopee',
    defaultType: 'expense',
    confidence: 0.7,
    reason: 'Shopee fallback parser berhasil membuat kandidat transaksi',
  });
}

function parseKaiEmail(sender: string, subject: string, body: string, emailDate: string): FallbackParseResult | null {
  if (!/kai\.id|pt\.?\s*kai|kereta/i.test(`${sender} ${subject}`)) return null;
  if (!/bukti\s*pembayaran|transaksi|pembayaran/i.test(`${subject}\n${body}`)) return null;
  return buildProviderFallbackResult(sender, subject, body, emailDate, {
    merchant: 'PT. KAI',
    category: 'Transportasi',
    paymentMethod: 'KAI',
    defaultType: 'expense',
    confidence: 0.7,
    reason: 'KAI fallback parser berhasil membuat kandidat transaksi',
  });
}

function parseTiketEmail(sender: string, subject: string, body: string, emailDate: string): FallbackParseResult | null {
  if (!/tiket\.com|tiket/i.test(`${sender} ${subject}`)) return null;
  if (!/bukti\s*pembayaran|e-?tiket|order\s*id|paid|payment|pembayaran|transaksi/i.test(`${subject}\n${body}`)) return null;

  // Try to extract amount from full body first (longer body = better chance)
  const combined = `${subject}\n${body}`;

  // Use more comprehensive amount extraction for tiket.com specifically
  // tiket.com formats: "Total Pembayaran: Rp 150.000", "Total: Rp150000"
  const tiketAmountPatterns = [
    /total\s*pembayaran\s*:?\s*rp\s?([0-9][0-9.,]*(?:,\d{2})?)/i,
    /total\s*(?:rp|idr)\s?([0-9][0-9.,]*(?:,\d{2})?)/i,
    /harga\s*total\s*:?\s*rp\s?([0-9][0-9.,]*(?:,\d{2})?)/i,
    /jumlah\s*(?:pembayaran|bayar|dibayar)\s*:?\s*rp\s?([0-9][0-9.,]*(?:,\d{2})?)/i,
    /(?:rp|idr)\s?([0-9][0-9.,]*(?:,\d{2})?)/i,
  ];

  let amount: number | null = null;
  for (const pattern of tiketAmountPatterns) {
    const match = combined.match(pattern);
    if (match) {
      const parsed = normalizeAmount(match[1]);
      if (parsed && parsed > 0) {
        amount = parsed;
        break;
      }
    }
  }

  // E-ticket without payment amount → skipped, not failed
  if (!amount && /e-?tiket|e-?ticket|ini\s*e-?tiket/i.test(subject)) {
    return {
      success: false,
      reason: 'E-tiket tiket.com — tidak mengandung nominal pembayaran (nominal ada di email Bukti Pembayaran terpisah)',
      confidence: 0,
      finalStatus: 'skipped',
      errorCode: 'RELATED_DOCUMENT_SKIPPED',
      amount: null,
      fallbackUsed: false,
    };
  }

  if (!amount) {
    return {
      success: false,
      reason: 'Tidak ditemukan nominal transaksi pada email tiket.com',
      confidence: 0,
      finalStatus: 'skipped',
      errorCode: NON_TRANSACTION_SKIPPED_ERROR_CODE,
      amount: null,
      fallbackUsed: false,
    };
  }

  const date = extractDateFromText(combined, emailDate);
  const transactionType = inferTransactionType(sender, subject, combined) || 'expense';

  return buildProviderFallbackResult(sender, subject, body, emailDate, {
    merchant: 'tiket.com',
    category: 'Travel',
    paymentMethod: 'tiket.com',
    defaultType: 'expense',
    confidence: 0.68,
    reason: 'tiket.com fallback parser berhasil membuat kandidat transaksi',
  });
}

function parseAgodaEmail(sender: string, subject: string, body: string, emailDate: string): FallbackParseResult | null {
  if (!/agoda\.com|agoda/i.test(`${sender} ${subject}`)) return null;
  if (!/customer\s*receipt|booking\s*id|receipt|paid|payment/i.test(`${subject}\n${body}`)) return null;
  return buildProviderFallbackResult(sender, subject, body, emailDate, {
    merchant: 'Agoda',
    category: 'Travel',
    paymentMethod: 'Agoda',
    defaultType: 'expense',
    confidence: 0.66,
    reason: 'Agoda fallback parser berhasil membuat kandidat transaksi',
  });
}

function parseJagoEmail(sender: string, subject: string, body: string, emailDate: string): FallbackParseResult | null {
  if (!/jago\.com|bank\s*jago|jago/i.test(`${sender} ${subject}`)) return null;
  if (!/transfer|top\s*up|e-?wallet|uang\s+telah\s+dikembalikan|penarikan\s+dana|kekurangan\s+saldo|dikenakan\s+biaya/i.test(`${subject}\n${body}`)) return null;
  return buildProviderFallbackResult(sender, subject, body, emailDate, {
    merchant: 'Bank Jago',
    category: inferCategory(sender, subject, body) || 'Bank',
    paymentMethod: 'Bank Jago',
    defaultType: inferTransactionType(sender, subject, body) || 'expense',
    confidence: 0.7,
    reason: 'Jago fallback parser berhasil membuat kandidat transaksi',
  });
}

// ===================== Generic Email Parser =====================

/**
 * Generic fallback parser untuk email dari sender terpercaya
 * Ketika AI gagal parse, coba ekstrak nominal dari body
 */
function parseGenericEmail(
  sender: string,
  subject: string,
  body: string,
  emailDate: string,
): FallbackParseResult | null {
  const promoCashback = getPromoCashbackMatch(subject, body);
  if (promoCashback.isPromo) {
    return buildPromoCashbackSkipResult(promoCashback);
  }

  const combined = `${subject}\n${body}`;
  const amount = extractAmountFromText(combined);

  if (!amount) {
    return {
      success: false,
      reason: 'Tidak ditemukan nominal transaksi pada email',
      confidence: 0,
      finalStatus: 'skipped',
      errorCode: NON_TRANSACTION_SKIPPED_ERROR_CODE,
      amount: null,
      fallbackUsed: false,
    };
  }

  const date = extractDateFromText(combined, emailDate);
  const transactionType = inferTransactionType(sender, subject, combined) || 'expense';
  const merchant = inferMerchant(sender, subject, combined) || sender.split('@')[0] || 'Unknown';
  const category = inferCategory(sender, subject, combined);
  const paymentMethod = inferPaymentMethod(sender) || 'Lainnya';

  return {
    success: true,
    data: {
      is_transaction: true,
      transaction_type: transactionType,
      amount,
      currency: 'IDR',
      date: date || undefined,
      merchant: merchant ?? undefined,
      category: category ?? undefined,
      payment_method: paymentMethod ?? undefined,
      description: subject.substring(0, 200),
      confidence_score: 0.60,
      reason: `Diparse menggunakan fallback parser lokal setelah AI gagal`,
    },
    reason: 'Generic fallback regex berhasil',
    confidence: 0.60,
    finalStatus: 'pending_review',
    errorCode: 'GEMINI_FALLBACK_USED',
    amount,
    fallbackUsed: true,
  };
}

// ===================== Main Entry Point =====================

/**
 * Build fallback transaction from email when AI produces invalid JSON
 *
 * Tries specific parsers first (LINE Bank, blu), then fallsback to generic
 */
export function buildFallbackTransactionFromEmail(
  sender: string,
  subject: string,
  body: string,
  emailDate: string,
): FallbackParseResult {
  const lowerSender = sender.toLowerCase();
  const lowerSubject = subject.toLowerCase();
  const promoCashback = getPromoCashbackMatch(subject, body);

  if (promoCashback.isPromo) {
    return buildPromoCashbackSkipResult(promoCashback);
  }

  if (isBluNonTransactionEmail(subject, body, sender)) {
    return buildNonTransactionBluSkipResult();
  }

  const providerParsers = [
    parseShopeeEmail,
    parseKaiEmail,
    parseTiketEmail,
    parseAgodaEmail,
    parseJagoEmail,
  ];

  for (const parser of providerParsers) {
    const result = parser(sender, subject, body, emailDate);
    if (result) return result;
  }

  // 1. Try LINE Bank specific parser
  if (
    lowerSender.includes('linebank.co.id') ||
    lowerSender.includes('line bank')
  ) {
    // Only if subject contains Informasi Transaksi
    if (
      lowerSubject.includes('informasi transaksi') ||
      lowerSubject.includes('[line bank]') ||
      lowerSubject.includes('[linebank]')
    ) {
      const result = parseLineBankEmail(sender, subject, body, emailDate);
      if (result?.success) return result;
      // If LINE Bank parser failed (no amount), return as fail not skip
      // The caller will handle the status based on this result
    }
  }

  // 2. Try blu specific parser
  if (
    lowerSender.includes('blubybcadigital.id') ||
    lowerSender.includes('blu')
  ) {
    if (
      lowerSubject.includes('berhasil') ||
      lowerSubject.includes('transaksi masuk') ||
      lowerSubject.includes('pengembalian dana') ||
      lowerSubject.includes('info transaksi')
    ) {
      const result = parseBluEmail(sender, subject, body, emailDate);
      if (result?.success) return result;
    }
  }

  // 3. Try generic parser for any trusted sender
  const genericResult = parseGenericEmail(sender, subject, body, emailDate);
  if (genericResult?.success) return genericResult;

  // 4. All fallbacks failed — tentukan finalStatus berdasarkan error yang paling mungkin
  // Jika tidak ada match provider dan generic juga gagal, ini berarti email mungkin
  // bukan transaksi atau format tidak dikenal
  return {
    success: false,
    reason: 'Semua fallback parser gagal mengekstrak transaksi: tidak ada nominal atau pola yang cocok',
    confidence: 0,
    finalStatus: 'skipped',
    errorCode: NON_TRANSACTION_SKIPPED_ERROR_CODE,
    amount: null,
    fallbackUsed: false,
  };
}

function buildPromoCashbackSkipResult(match: ReturnType<typeof getPromoCashbackMatch>): FallbackParseResult {
  return {
    success: false,
    reason: 'Email promo cashback, nominal yang ditemukan adalah nilai promo maksimum, bukan transaksi aktual',
    confidence: 0,
    finalStatus: 'skipped',
    errorCode: PROMO_CASHBACK_ERROR_CODE,
    amount: null,
    fallbackUsed: false,
    matchedRule: match.matchedRule,
    detectedPromoAmount: match.detectedPromoAmount,
    amountIgnored: true,
  };
}

function buildNonTransactionBluSkipResult(): FallbackParseResult {
  return {
    success: false,
    reason: BLU_NON_TRANSACTION_REASON,
    confidence: 0,
    finalStatus: 'skipped',
    errorCode: NON_TRANSACTION_SKIPPED_ERROR_CODE,
    amount: null,
    fallbackUsed: false,
    matchedRule: 'blu_non_transaction',
  };
}

// ===================== Utilities =====================

/**
 * Check if email is from LINE Bank
 */
export function isLineBankEmail(sender: string, subject: string): boolean {
  return (
    sender.toLowerCase().includes('linebank.co.id') &&
    (subject.toLowerCase().includes('informasi transaksi') ||
     subject.toLowerCase().includes('[line bank]') ||
     subject.toLowerCase().includes('[linebank]'))
  );
}

/**
 * Check if email is from blu
 */
export function isBluEmail(sender: string, subject: string): boolean {
  return (
    sender.toLowerCase().includes('blubybcadigital.id') &&
    (subject.toLowerCase().includes('berhasil') ||
     subject.toLowerCase().includes('transaksi masuk') ||
     subject.toLowerCase().includes('pengembalian dana'))
  );
}
