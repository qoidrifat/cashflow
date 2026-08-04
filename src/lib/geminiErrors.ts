/**
 * Gemini Error Classification
 *
 * Struktur error terstandarisasi untuk semua error Gemini API.
 * Setiap error memiliki properti:
 * - fallbackAllowed: jika true, sistem HARUS menjalankan fallback parser setelah error ini
 * - isRetryable: jika true, sistem boleh retry request Gemini
 * - isConfigError: jika true, hentikan batch processing
 */

export const GEMINI_ERROR_CODES = {
  API_DISABLED: 'GEMINI_API_DISABLED',
  REFERER_BLOCKED: 'GEMINI_REFERER_BLOCKED',
  API_KEY_MISSING: 'GEMINI_API_KEY_MISSING',
  AUTH_ERROR: 'GEMINI_AUTH_ERROR',
  PERMISSION_DENIED: 'GEMINI_PERMISSION_DENIED',
  BILLING_DISABLED: 'GEMINI_BILLING_DISABLED',
  QUOTA_EXCEEDED: 'GEMINI_QUOTA_EXCEEDED',
  CREDITS_DEPLETED: 'GEMINI_CREDITS_DEPLETED',
  RATE_LIMITED: 'GEMINI_RATE_LIMITED',
  MODEL_UNAVAILABLE: 'GEMINI_MODEL_UNAVAILABLE',
  INVALID_JSON: 'GEMINI_INVALID_JSON',
  EMPTY_RESPONSE: 'GEMINI_EMPTY_RESPONSE',
  BLOCKED: 'GEMINI_BLOCKED',
  NETWORK_ERROR: 'GEMINI_NETWORK_ERROR',
  TIMEOUT: 'GEMINI_TIMEOUT',
  UNAUTHORIZED: 'GEMINI_UNAUTHORIZED',
  UNKNOWN: 'GEMINI_UNKNOWN_ERROR',
  FALLBACK_USED: 'GEMINI_FALLBACK_USED',
  TEMPORARY_ERROR: 'GEMINI_TEMPORARY_ERROR',
} as const;

export type GeminiErrorCode = (typeof GEMINI_ERROR_CODES)[keyof typeof GEMINI_ERROR_CODES];

export interface GeminiErrorInfo {
  code: GeminiErrorCode;
  userMessage: string;
  isConfigError: boolean;
  isRetryable: boolean;
  fallbackAllowed: boolean;
}

const ERROR_INFO: Record<GeminiErrorCode, GeminiErrorInfo> = {
  [GEMINI_ERROR_CODES.API_DISABLED]: {
    code: GEMINI_ERROR_CODES.API_DISABLED,
    userMessage:
      'Gemini API belum aktif. Aktifkan Generative Language API di Google Cloud Console.',
    isConfigError: true,
    isRetryable: false,
    fallbackAllowed: false,
  },
  [GEMINI_ERROR_CODES.REFERER_BLOCKED]: {
    code: GEMINI_ERROR_CODES.REFERER_BLOCKED,
    userMessage:
      'Request Gemini diblokir oleh API key restriction. Periksa konfigurasi API key.',
    isConfigError: true,
    isRetryable: false,
    fallbackAllowed: false,
  },
  [GEMINI_ERROR_CODES.API_KEY_MISSING]: {
    code: GEMINI_ERROR_CODES.API_KEY_MISSING,
    userMessage:
      'GEMINI_API_KEY belum dikonfigurasi di server. Buat file .env di folder server/.',
    isConfigError: true,
    isRetryable: false,
    fallbackAllowed: false,
  },
  [GEMINI_ERROR_CODES.AUTH_ERROR]: {
    code: GEMINI_ERROR_CODES.AUTH_ERROR,
    userMessage: 'API Key Gemini tidak valid. Periksa GEMINI_API_KEY di server/.env.',
    isConfigError: true,
    isRetryable: false,
    fallbackAllowed: false,
  },
  [GEMINI_ERROR_CODES.PERMISSION_DENIED]: {
    code: GEMINI_ERROR_CODES.PERMISSION_DENIED,
    userMessage: 'Akses Gemini API ditolak. Periksa izin API key di Google Cloud Console.',
    isConfigError: true,
    isRetryable: false,
    fallbackAllowed: false,
  },
  [GEMINI_ERROR_CODES.BILLING_DISABLED]: {
    code: GEMINI_ERROR_CODES.BILLING_DISABLED,
    userMessage: 'Gemini API: billing tidak aktif atau kuota habis.',
    isConfigError: true,
    isRetryable: false,
    fallbackAllowed: false,
  },
  [GEMINI_ERROR_CODES.QUOTA_EXCEEDED]: {
    code: GEMINI_ERROR_CODES.QUOTA_EXCEEDED,
    userMessage:
      'Limit Gemini API tercapai. CashFlow tetap memproses email dengan fallback parser. Email ambigu ditandai Coba Lagi Nanti.',
    isConfigError: false,
    isRetryable: false,
    fallbackAllowed: true,
  },
  [GEMINI_ERROR_CODES.CREDITS_DEPLETED]: {
    code: GEMINI_ERROR_CODES.CREDITS_DEPLETED,
    userMessage:
      'Credit Gemini API habis. CashFlow tetap memproses email dengan fallback parser. Tambahkan credit di AI Studio untuk menggunakan AI penuh.',
    isConfigError: false,
    isRetryable: false,
    fallbackAllowed: true,
  },
  [GEMINI_ERROR_CODES.RATE_LIMITED]: {
    code: GEMINI_ERROR_CODES.RATE_LIMITED,
    userMessage:
      'Terlalu banyak request ke Gemini. Tunggu beberapa saat, lalu coba ulang.',
    isConfigError: false,
    isRetryable: true,
    fallbackAllowed: true,
  },
  [GEMINI_ERROR_CODES.MODEL_UNAVAILABLE]: {
    code: GEMINI_ERROR_CODES.MODEL_UNAVAILABLE,
    userMessage:
      'Model Gemini tidak tersedia. Parser lokal mencoba membaca email ini.',
    isConfigError: false,
    isRetryable: true,
    fallbackAllowed: true,
  },
  [GEMINI_ERROR_CODES.INVALID_JSON]: {
    code: GEMINI_ERROR_CODES.INVALID_JSON,
    userMessage:
      'AI menghasilkan response tidak valid. Parser lokal mencoba membaca email ini.',
    isConfigError: false,
    isRetryable: true,
    fallbackAllowed: true,
  },
  [GEMINI_ERROR_CODES.EMPTY_RESPONSE]: {
    code: GEMINI_ERROR_CODES.EMPTY_RESPONSE,
    userMessage: 'Gemini mengembalikan response kosong. Parser lokal mencoba membaca email ini.',
    isConfigError: false,
    isRetryable: true,
    fallbackAllowed: true,
  },
  [GEMINI_ERROR_CODES.BLOCKED]: {
    code: GEMINI_ERROR_CODES.BLOCKED,
    userMessage:
      'AI response diblokir safety filter. Parser lokal akan mencoba membaca email ini.',
    isConfigError: false,
    isRetryable: false,
    fallbackAllowed: true,
  },
  [GEMINI_ERROR_CODES.NETWORK_ERROR]: {
    code: GEMINI_ERROR_CODES.NETWORK_ERROR,
    userMessage:
      'Gagal terhubung ke server AI. Periksa koneksi internet Anda. Parser lokal akan mencoba membaca email ini.',
    isConfigError: false,
    isRetryable: true,
    fallbackAllowed: true,
  },
  [GEMINI_ERROR_CODES.TIMEOUT]: {
    code: GEMINI_ERROR_CODES.TIMEOUT,
    userMessage:
      'Request ke AI timeout. Parser lokal akan mencoba membaca email ini.',
    isConfigError: false,
    isRetryable: true,
    fallbackAllowed: true,
  },
  [GEMINI_ERROR_CODES.UNAUTHORIZED]: {
    code: GEMINI_ERROR_CODES.UNAUTHORIZED,
    userMessage:
      'Sesi Anda tidak valid untuk AI proxy. Muat ulang halaman lalu masuk kembali. Parser lokal membaca email ini.',
    isConfigError: false,
    isRetryable: false,
    fallbackAllowed: true,
  },
  [GEMINI_ERROR_CODES.UNKNOWN]: {
    code: GEMINI_ERROR_CODES.UNKNOWN,
    userMessage: 'AI gagal sementara. Parser lokal membaca email ini.',
    isConfigError: false,
    isRetryable: true,
    fallbackAllowed: true,
  },
  [GEMINI_ERROR_CODES.FALLBACK_USED]: {
    code: GEMINI_ERROR_CODES.FALLBACK_USED,
    userMessage: 'Gemini gagal, fallback parser berhasil membuat kandidat transaksi',
    isConfigError: false,
    isRetryable: false,
    fallbackAllowed: true,
  },
  [GEMINI_ERROR_CODES.TEMPORARY_ERROR]: {
    code: GEMINI_ERROR_CODES.TEMPORARY_ERROR,
    userMessage: 'AI gagal sementara. Parser lokal tidak menemukan transaksi yang cukup jelas. Email ini akan dicoba ulang nanti.',
    isConfigError: false,
    isRetryable: true,
    fallbackAllowed: true,
  },
};

/**
 * Dapatkan info error berdasarkan error code
 */
export function getGeminiErrorInfo(code: GeminiErrorCode): GeminiErrorInfo {
  return ERROR_INFO[code] || ERROR_INFO[GEMINI_ERROR_CODES.UNKNOWN];
}

/**
 * Check if error code indicates quota/credits exhaustion.
 * These errors should stop AI calls for the current session but allow fallback processing.
 */
export function isQuotaOrCreditsError(errorCode: string): boolean {
  return errorCode === GEMINI_ERROR_CODES.QUOTA_EXCEEDED
    || errorCode === GEMINI_ERROR_CODES.CREDITS_DEPLETED
    || errorCode === GEMINI_ERROR_CODES.RATE_LIMITED;
}

/**
 * Klasifikasikan error message mentah menjadi GeminiErrorCode
 * Digunakan ketika server mengembalikan error tanpa errorCode
 */
export function classifyRawGeminiError(errorMessage: string): GeminiErrorInfo {
  const lower = errorMessage.toLowerCase();

  if (lower.includes('has not been used') || lower.includes('is disabled') || lower.includes('not enabled')) {
    return ERROR_INFO[GEMINI_ERROR_CODES.API_DISABLED];
  }
  if (lower.includes('referer') || lower.includes('blocked')) {
    return ERROR_INFO[GEMINI_ERROR_CODES.REFERER_BLOCKED];
  }
  if (lower.includes('api key') || lower.includes('api_key')) {
    return ERROR_INFO[GEMINI_ERROR_CODES.API_KEY_MISSING];
  }
  if (lower.includes('permission_denied') || lower.includes('permission denied')) {
    return ERROR_INFO[GEMINI_ERROR_CODES.PERMISSION_DENIED];
  }
  if (lower.includes('billing')) {
    return ERROR_INFO[GEMINI_ERROR_CODES.BILLING_DISABLED];
  }
  if (lower.includes('prepayment credits') || lower.includes('credits are depleted') || lower.includes('manage your project and billing')) {
    return ERROR_INFO[GEMINI_ERROR_CODES.CREDITS_DEPLETED];
  }
  if (lower.includes('quota exceeded') || lower.includes('generate_content_free_tier') || lower.includes('resource_exhausted')) {
    return ERROR_INFO[GEMINI_ERROR_CODES.QUOTA_EXCEEDED];
  }
  if (lower.includes('rate') || lower.includes('429') || lower.includes('too many requests')) {
    return ERROR_INFO[GEMINI_ERROR_CODES.RATE_LIMITED];
  }
  if (lower.includes('timeout') || lower.includes('timed out') || lower.includes('408') || lower.includes('deadline_exceeded')) {
    return ERROR_INFO[GEMINI_ERROR_CODES.TIMEOUT];
  }
  if (lower.includes('model') || lower.includes('not found') || lower.includes('404')) {
    return ERROR_INFO[GEMINI_ERROR_CODES.MODEL_UNAVAILABLE];
  }
  if (lower.includes('network') || lower.includes('fetch') || lower.includes('econnrefused')) {
    return ERROR_INFO[GEMINI_ERROR_CODES.NETWORK_ERROR];
  }
  if (lower.includes('blocked') || lower.includes('safety')) {
    return ERROR_INFO[GEMINI_ERROR_CODES.BLOCKED];
  }
  if (lower.includes('json') || lower.includes('parse') || lower.includes('invalid')) {
    return ERROR_INFO[GEMINI_ERROR_CODES.INVALID_JSON];
  }

  return ERROR_INFO[GEMINI_ERROR_CODES.UNKNOWN];
}
