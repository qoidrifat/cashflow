/**
 * Receipt Scan Service
 *
 * Handles image preprocessing, AI vision extraction via server proxy,
 * validation of extraction results, and saving scanned transactions.
 */

import type { ReceiptScanResult, TransactionFormData, PaymentMethod, TransactionType } from '../types';
import { addTransaction } from './transactionService';

// ===================== Configuration =====================

import { getApiBaseUrl } from '../config/api';

const MAX_INPUT_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_AI_IMAGE_BYTES = 2 * 1024 * 1024; // 2 MB hard send limit
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// Confidence thresholds
const CONFIDENCE_AUTO_ACCEPT = 0.88;
const CONFIDENCE_NEEDS_REVIEW_MIN = 0.60;


function normalizePaymentMethod(value?: string | null): PaymentMethod {
  const normalized = (value || '').toLowerCase().replace(/[_\s]/g, '-');
  if (normalized === 'cash' || normalized === 'tunai') return 'cash';
  if (normalized === 'qris' || normalized === 'qr') return 'qris';
  if (normalized === 'e-wallet' || normalized === 'ewallet' || normalized === 'wallet') return 'e-wallet';
  if (normalized === 'transfer' || normalized === 'bank-transfer' || normalized === 'transfer-bank') return 'transfer-bank';
  if (normalized === 'debit' || normalized === 'kartu-debit' || normalized === 'debit-card') return 'kartu-debit';
  if (normalized === 'credit' || normalized === 'kredit' || normalized === 'kartu-kredit' || normalized === 'credit-card') return 'kartu-kredit';
  return 'cash';
}

function normalizeTransactionType(value?: string | null): TransactionType {
  if (value === 'income' || value === 'expense' || value === 'transfer' || value === 'refund') return value;
  return 'expense';
}

// ===================== Image Processing =====================

export function validateImageFile(file: File): string | null {
  if (!file) return 'File tidak boleh kosong.';

  if (!ALLOWED_MIME_TYPES.includes(file.type)) {
    return 'Format file tidak didukung. Gunakan JPG, PNG, atau WebP.';
  }

  if (file.size > MAX_INPUT_FILE_SIZE_BYTES) {
    return 'Ukuran gambar terlalu besar. Maksimal 10 MB.';
  }

  return null;
}

// ===================== AI Extraction =====================

/**
 * Extract transaction data from receipt image using Gemini Vision API via server proxy.
 */
export async function extractFromImage(
  imageFile: File,
  userHint?: {
    paymentMethod?: string;
    category?: string;
    date?: string;
  },
): Promise<ReceiptScanResult> {
  if (imageFile.size > MAX_AI_IMAGE_BYTES) {
    throw new Error('Gambar masih terlalu besar. Coba upload gambar maksimal 2 MB atau ambil foto ulang dengan jarak lebih dekat.');
  }

  const endpoint = `${getApiBaseUrl()}/api/ai/extract-receipt-image`;
  const formData = new FormData();
  formData.append('image', imageFile);
  formData.append('mimeType', imageFile.type || 'image/jpeg');
  formData.append('userHint', JSON.stringify(userHint || {}));

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      body: formData,
      credentials: 'include',
    });

  } catch (fetchError: any) {
    // Network error: server down, no connection, DNS failure
    throw new Error(
      'Gagal terhubung ke server AI. Pastikan server sudah berjalan (npm run dev:server).'
    );
  }

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const errorCode = errorData.errorCode || '';

    // Map specific error codes to user-friendly messages
    const errorMessages: Record<string, string> = {
      'IMAGE_TOO_LARGE': 'Gambar terlalu besar untuk diproses. Coba upload gambar maksimal 2 MB atau foto ulang lebih dekat.',
      'GEMINI_API_KEY_MISSING': 'Server AI belum dikonfigurasi. Periksa GEMINI_API_KEY di server/.env.',
      'GEMINI_TIMEOUT': 'AI membutuhkan waktu terlalu lama membaca gambar. Coba lagi dengan gambar yang lebih jelas atau lebih kecil.',
      'GEMINI_RATE_LIMITED': 'Terlalu banyak request. Tunggu beberapa saat, lalu coba lagi.',
      'GEMINI_NETWORK_ERROR': 'Server gagal terhubung ke Gemini API. Periksa koneksi internet server.',
      'GEMINI_REFERER_BLOCKED': 'Konfigurasi API key bermasalah. Hubungi developer.',
      'GEMINI_PERMISSION_DENIED': 'Akses Gemini API ditolak. Periksa konfigurasi.',
      'GEMINI_API_DISABLED': 'Gemini API belum diaktifkan di Google Cloud Console.',
      'GEMINI_MODEL_UNAVAILABLE': 'Model AI tidak tersedia saat ini. Coba lagi nanti.',
      'GEMINI_EMPTY_RESPONSE': 'AI mengembalikan response kosong. Coba foto yang lebih jelas.',
      'GEMINI_INVALID_JSON': 'AI gagal membaca gambar ini. Coba foto lebih jelas atau dari sudut yang berbeda.',
    };

    let message: string;
    if (response.status === 413) {
      message = errorMessages['IMAGE_TOO_LARGE'];
    } else if (errorCode && errorMessages[errorCode]) {
      message = errorMessages[errorCode];
    } else {
      message = errorData.userMessage || errorData.message || errorData.error || `Server AI mengembalikan HTTP ${response.status}`;
    }

    const error = new Error(message);
    (error as any).errorCode = errorCode;
    (error as any).httpStatus = response.status;
    throw error;
  }

  const data = await response.json();

  if (!data.success || !data.parsed) {
    throw new Error(data.userMessage || 'AI gagal membaca gambar.');
  }

  return data.parsed as ReceiptScanResult;
}

// ===================== Validation =====================

/**
 * Validate the AI extraction result before presenting to user.
 * Returns a validated result with adjusted decision if needed.
 */
export function validateExtractionResult(result: ReceiptScanResult): {
  validated: ReceiptScanResult;
  warnings: string[];
} {
  const warnings: string[] = [];
  const validated: ReceiptScanResult = {
    ...result,
    decision: result.decision || 'needs_review',
    is_transaction: result.is_transaction !== false,
    transaction_type: normalizeTransactionType(result.transaction_type),
    amount: typeof result.amount === 'number' && Number.isFinite(result.amount) ? result.amount : null,
    currency: result.currency || 'IDR',
    payment_method: normalizePaymentMethod(result.payment_method),
    confidence_score: typeof result.confidence_score === 'number' && Number.isFinite(result.confidence_score)
      ? Math.max(0, Math.min(1, result.confidence_score))
      : 0,
    risk_flags: Array.isArray(result.risk_flags) ? result.risk_flags : [],
  };

  // If not a transaction, skip
  if (!validated.is_transaction) {
    validated.decision = 'auto_skip';
    warnings.push('Gambar belum terdeteksi sebagai bukti transaksi. Kamu tetap bisa isi manual dari gambar ini.');
    return { validated, warnings };
  }

  // Amount must be positive
  if (!validated.amount || validated.amount <= 0) {
    validated.decision = 'needs_review';
    warnings.push('Nominal tidak ditemukan atau tidak valid.');
    if (!validated.risk_flags.includes('amount_unclear')) {
      validated.risk_flags = [...validated.risk_flags, 'amount_unclear'];
    }
  }

  // Confidence-based decision override
  if (validated.confidence_score >= CONFIDENCE_AUTO_ACCEPT && validated.amount && validated.amount > 0) {
    validated.decision = 'auto_accept';
  } else if (validated.confidence_score >= CONFIDENCE_NEEDS_REVIEW_MIN) {
    validated.decision = 'needs_review';
  } else {
    validated.decision = 'needs_review';
    warnings.push('AI kurang yakin dengan hasil bacaan. Periksa kembali.');
  }

  // Merchant not found
  if (!validated.merchant && validated.amount && validated.amount > 0) {
    if (!validated.risk_flags.includes('merchant_not_found')) {
      validated.risk_flags = [...validated.risk_flags, 'merchant_not_found'];
    }
    warnings.push('Nama merchant tidak terbaca. Isi manual jika diperlukan.');
  }

  // Date not found - use today
  if (!result.date) {
    validated.date = new Date().toISOString().split('T')[0];
    if (!validated.risk_flags.includes('date_inferred_from_today')) {
      validated.risk_flags = [...validated.risk_flags, 'date_inferred_from_today'];
    }
    warnings.push('Tanggal tidak ditemukan. Gunakan tanggal hari ini.');
  }

  return { validated, warnings };
}

// ===================== Save Transaction =====================

/**
 * Map ReceiptScanResult to TransactionFormData for saving.
 */
export function scanResultToFormData(
  result: ReceiptScanResult,
  scanSource: 'camera' | 'upload',
): Partial<TransactionFormData> {
  const defaultDate = new Date().toISOString().split('T')[0];

  return {
    type: result.transaction_type || 'expense',
    amount: result.amount || 0,
    categoryId: '',
    categoryName: result.category || 'Lainnya',
    merchant: result.merchant || '',
    paymentMethod: normalizePaymentMethod(result.payment_method),
    note: result.note || `Pembayaran di ${result.merchant || 'merchant'}`,
    date: result.date || defaultDate,
  };
}

/**
 * Save a scanned transaction.
 */
export async function saveScanTransaction(
  userId: string,
  data: TransactionFormData,
  scanResult: ReceiptScanResult,
  scanSource: 'camera' | 'upload',
): Promise<string> {
  const metadata = {
    ...(data.metadata || {}),
    inputSource: 'receipt_scan',
    scanSource,
    extractionSource: 'ai_vision',
    decision: scanResult.decision,
    reason: scanResult.reason,
    riskFlags: scanResult.risk_flags || [],
    imageStored: false,
  };

  return addTransaction(
    userId,
    {
      ...data,
      paymentMethod: normalizePaymentMethod(data.paymentMethod),
      metadata,
    },
    'manual',
    undefined,
    scanResult.confidence_score ?? undefined,
    metadata,
  );
}
