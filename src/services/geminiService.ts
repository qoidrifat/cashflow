/**
 * Gemini AI Extraction Service
 *
 * AMAN — Tidak memanggil Gemini API langsung dari frontend.
 * Semua request Gemini melalui server-side proxy (/api/gemini/extract-transaction).
 *
 * Alur:
 *   Frontend → /api/gemini/extract-transaction → Express proxy → Vertex AI
 *
 * Fitur:
 * - Retry with exponential backoff untuk rate limited errors
 * - Error classification untuk semua Gemini error codes
 * - Pass subject, sender, date ke server untuk prompt yang lebih kaya
 */

import { safeParseGeminiJson } from '../lib/geminiParser';
import { classifyRawGeminiError, getGeminiErrorInfo, GEMINI_ERROR_CODES } from '../lib/geminiErrors';
import type { ExtractedTransaction } from '../types';

// ===================== Configuration =====================

const AI_PROXY_BASE = '';
const MAX_RETRIES = 2;
const INITIAL_RETRY_DELAY_MS = 3000;
const BACKOFF_MULTIPLIER = 2.5;
const MAX_AI_EMAIL_TEXT_CHARS = 6000;

// Error codes that are retryable
const RETRYABLE_ERROR_CODES: ReadonlySet<string> = new Set([
  GEMINI_ERROR_CODES.NETWORK_ERROR,
  GEMINI_ERROR_CODES.MODEL_UNAVAILABLE,
  GEMINI_ERROR_CODES.EMPTY_RESPONSE,
  GEMINI_ERROR_CODES.UNKNOWN,
]);

// Error codes that indicate config issues (stop batch processing)
const CONFIG_ERROR_CODES: ReadonlySet<string> = new Set([
  GEMINI_ERROR_CODES.API_DISABLED,
  GEMINI_ERROR_CODES.REFERER_BLOCKED,
  GEMINI_ERROR_CODES.API_KEY_MISSING,
  GEMINI_ERROR_CODES.AUTH_ERROR,
  GEMINI_ERROR_CODES.PERMISSION_DENIED,
  GEMINI_ERROR_CODES.BILLING_DISABLED,
]);

function normalizeProxyErrorCode(errorCode: unknown, httpStatus?: number): string {
  const raw = typeof errorCode === 'string' ? errorCode : '';
  const aliases: Record<string, string> = {
    RATE_LIMITED: GEMINI_ERROR_CODES.RATE_LIMITED,
    NETWORK_ERROR: GEMINI_ERROR_CODES.NETWORK_ERROR,
    INVALID_JSON: GEMINI_ERROR_CODES.INVALID_JSON,
    EMPTY_RESPONSE: GEMINI_ERROR_CODES.EMPTY_RESPONSE,
    UNKNOWN: GEMINI_ERROR_CODES.UNKNOWN,
    API_KEY_MISSING: GEMINI_ERROR_CODES.API_KEY_MISSING,
    GEMINI_AUTH_ERROR: GEMINI_ERROR_CODES.AUTH_ERROR,
    GEMINI_PERMISSION_DENIED: GEMINI_ERROR_CODES.PERMISSION_DENIED,
    GEMINI_BILLING_DISABLED: GEMINI_ERROR_CODES.BILLING_DISABLED,
    GEMINI_QUOTA_EXCEEDED: GEMINI_ERROR_CODES.QUOTA_EXCEEDED,
    GEMINI_CREDITS_DEPLETED: GEMINI_ERROR_CODES.CREDITS_DEPLETED,
    GEMINI_RATE_LIMITED: GEMINI_ERROR_CODES.RATE_LIMITED,
    GEMINI_UNAUTHORIZED: GEMINI_ERROR_CODES.UNAUTHORIZED,
  };

  if (aliases[raw]) return aliases[raw];
  if (Object.values(GEMINI_ERROR_CODES).includes(raw as any)) return raw;
  if (httpStatus === 401) return GEMINI_ERROR_CODES.UNAUTHORIZED;
  if (httpStatus === 429) return GEMINI_ERROR_CODES.RATE_LIMITED;
  if (httpStatus === 422) return GEMINI_ERROR_CODES.INVALID_JSON;
  if (httpStatus === 502 || httpStatus === 503 || httpStatus === 504) {
    return GEMINI_ERROR_CODES.NETWORK_ERROR;
  }
  return GEMINI_ERROR_CODES.UNKNOWN;
}

// ===================== Retry Logic =====================

/**
 * Sleep for given milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check if an error code is retryable
 */
function isRetryableError(errorCode: string): boolean {
  return RETRYABLE_ERROR_CODES.has(errorCode);
}

/**
 * Check if an error code is a config error (should stop batch)
 */
export function isConfigErrorCode(errorCode: string): boolean {
  return CONFIG_ERROR_CODES.has(errorCode);
}

/**
 * Retry a function with exponential backoff
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = MAX_RETRIES,
  initialDelay: number = INITIAL_RETRY_DELAY_MS,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const errorCode = (error as any)?.errorCode || '';

      // Only retry retryable errors
      if (!isRetryableError(errorCode)) {
        throw error; // Non-retryable, throw immediately
      }

      // Last attempt — throw
      if (attempt >= maxRetries) {
        throw error;
      }

      // Wait with exponential backoff
      const delay = initialDelay * Math.pow(BACKOFF_MULTIPLIER, attempt);
      await sleep(delay);
    }
  }

  throw lastError;
}

// ===================== Service Functions =====================

/**
 * Extract transaction data from email text using Gemini API.
 * Includes retry with exponential backoff for rate-limited/network errors.
 */
export async function extractWithGemini(
  emailText: string,
  options?: {
    subject?: string;
    sender?: string;
    emailDate?: string;
  },
): Promise<ExtractedTransaction> {
  const baseUrl = AI_PROXY_BASE;
  const endpoint = `${baseUrl}/api/gemini/extract-transaction`;
  const compactEmailText = compactTextForAi(emailText);

  const executeRequest = async (): Promise<ExtractedTransaction> => {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        emailText: compactEmailText,
        subject: options?.subject || '',
        sender: options?.sender || '',
        emailDate: options?.emailDate || new Date().toISOString().split('T')[0],
      }),
      // Endpoint dilindungi requireAuth (Phase 1) — cookie sesi WAJIB dikirim,
      // tanpa ini setiap request 401 dan AI scan Gmail rusak total.
      credentials: 'include',
    });

    // Handle HTTP errors from proxy
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorCode = normalizeProxyErrorCode(errorData.errorCode, response.status);
      let userMessage =
        errorData.userMessage ||
        errorData.error ||
        getGeminiErrorInfo(errorCode as any).userMessage ||
        `Server AI mengembalikan HTTP ${response.status}`;

      // For invalid JSON, try the comprehensive frontend parser before giving up
      if (errorCode === GEMINI_ERROR_CODES.INVALID_JSON && errorData.rawResponse) {
        const frontendParsed = safeParseGeminiJson(errorData.rawResponse);
        if (frontendParsed.success && frontendParsed.data) {
          // Frontend parser succeeded where server parser failed
          return frontendParsed.data;
        }
        userMessage = `AI menghasilkan JSON tidak valid`;
      }

      const error = new Error(userMessage);
      (error as any).errorCode = errorCode;
      (error as any).httpStatus = response.status;
      (error as any).finalStatus = errorData.finalStatus;
      (error as any).retryable = errorData.retryable ?? isRetryableError(errorCode);
      (error as any).requestId = errorData.requestId;
      (error as any).technicalMessage = errorData.technicalMessage;
      (error as any).rawResponse = errorData.rawResponse;
      (error as any).cleanedResponse = errorData.cleanedResponse;
      (error as any).repairAttempted = errorData.repairAttempted;
      (error as any).repairSuccess = errorData.repairSuccess;
      (error as any).modelUsed = errorData.modelUsed;
      throw error;
    }

    const data = await response.json();

    // Server returns { success: true, parsed: {...}, rawResponse: "..." }
    if (data.success) {
      // If server already parsed it, use the parsed data directly
      if (data.parsed) {
        return data.parsed as ExtractedTransaction;
      }

      // Otherwise parse the raw response
      if (data.rawResponse) {
        const parsed = safeParseGeminiJson(data.rawResponse);
        if (!parsed.success) {
          const error = new Error(`AI menghasilkan JSON tidak valid: ${parsed.error}`);
          (error as any).errorCode = GEMINI_ERROR_CODES.INVALID_JSON;
          (error as any).rawResponse = data.rawResponse;
          (error as any).cleanedResponse = parsed.cleanedResponse;
          throw error;
        }
        if (!parsed.data) {
          const error = new Error('AI mengembalikan data kosong');
          (error as any).errorCode = GEMINI_ERROR_CODES.UNKNOWN;
          throw error;
        }
        return parsed.data;
      }
    }

    // Fallback: ExtractedTransaction directly (Cloud Functions compatibility)
    if (data.is_transaction !== undefined) {
      return data as ExtractedTransaction;
    }

    throw new Error('Server mengembalikan response tidak dikenal');
  };

  try {
    return await retryWithBackoff(executeRequest);
  } catch (error) {
    // Network error (server down, no connection)
    if (error instanceof TypeError && error.message.includes('fetch')) {
      const networkError = new Error(
        'Gagal terhubung ke server AI proxy. Pastikan server sudah berjalan.'
      );
      (networkError as any).errorCode = GEMINI_ERROR_CODES.NETWORK_ERROR;
      throw networkError;
    }

    // Re-throw with errorCode if already classified
    if ((error as any).errorCode) {
      throw error;
    }

    // Fallback classification
    const errorInfo = classifyRawGeminiError(
      error instanceof Error ? error.message : String(error)
    );
    const classifiedError = new Error(errorInfo.userMessage);
    (classifiedError as any).errorCode = errorInfo.code;
    throw classifiedError;
  }
}

function compactTextForAi(text: string): string {
  return text
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, MAX_AI_EMAIL_TEXT_CHARS);
}

/**
 * Check Gemini API health via server proxy.
 */
export async function checkGeminiHealth(): Promise<{
  ok: boolean;
  status: string;
  message: string;
} | null> {
  const baseUrl = AI_PROXY_BASE;
  const endpoint = `${baseUrl}/api/gemini/health`;

  try {
    const response = await fetch(endpoint, { credentials: 'omit' });
    if (!response.ok) {
      return {
        ok: false,
        status: 'error',
        message: `Health check gagal: HTTP ${response.status}`,
      };
    }
    return await response.json();
  } catch {
    return {
      ok: false,
      status: 'unreachable',
      message: 'Server AI proxy tidak dapat dijangkau. Jalankan npm run dev:server.',
    };
  }
}

/**
 * Check whether a Gemini error is a configuration error.
 * Config errors should stop the entire AI batch processing.
 */
export function isGeminiConfigError(error: unknown): boolean {
  const errorCode = (error as any)?.errorCode;
  if (!errorCode) return false;
  const info = getGeminiErrorInfo(errorCode);
  return info.isConfigError;
}
