/**
 * Gemini JSON Parser — Comprehensive Repair & Validation
 *
 * Safe parsing utilities untuk output Gemini API.
 * Membersihkan markdown code block, trailing comma, dan format tidak valid.
 * Dilengkapi schema validation dan auto-repair.
 */

import type { ExtractedTransaction, TransactionType, PaymentMethod } from '../types';

// ===================== Types =====================

export interface ParseResult {
  success: boolean;
  data?: ExtractedTransaction;
  error?: string;
  rawResponse?: string;
  /** Cleaned text after sanitization */
  cleanedResponse?: string;
  /** Whether repair was attempted */
  repairAttempted?: boolean;
  /** Whether repair succeeded */
  repairSuccess?: boolean;
  /** How many repair strategies were tried */
  repairStrategiesTried?: number;
}

// ===================== JSON Sanitization =====================

/**
 * Step 1: Sanitize raw text — remove markdown, trim, normalize whitespace
 */
export function sanitizeJsonText(text: string): string {
  return String(text || '')
    .trim()
    // Remove markdown code blocks: ```json ... ``` or ``` ... ```
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/i, '')
    .trim();
}

/**
 * Step 2: Extract the first valid JSON object {...} from text
 * Handles cases where AI returns extra text before/after the JSON
 */
export function extractFirstJsonObject(text: string): string | null {
  const trimmed = text.trim();

  // Find the first '{' and last '}'
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }

  return trimmed.substring(firstBrace, lastBrace + 1);
}

/**
 * Step 3: Repair common JSON issues
 * - Trailing commas before } or ]
 * - Smart quotes → regular quotes
 * - undefined → null
 * - NaN → null
 * - Single quotes → double quotes
 * - Unquoted keys → quoted keys
 * - Replace '|' union type artifacts (like "income | expense")
 */
export function repairCommonJsonIssues(text: string): string {
  if (!text) return '{}';

  let cleaned = text;

  // Replace smart/curly quotes with regular quotes
  cleaned = cleaned.replace(/[\u2018\u2019]/g, "'");
  cleaned = cleaned.replace(/[\u201C\u201D]/g, '"');

  // Replace single quotes used as string delimiters with double quotes
  // But be careful: don't replace apostrophes inside words
  // Match: 'value' patterns (single-quoted strings)
  cleaned = cleaned.replace(/(\s)'([^']*?)'([\s,}\]])/g, '$1"$2"$3');
  // Also handle leading single-quoted keys like 'key': value
  cleaned = cleaned.replace(/^'([^']+?)'\s*:/, '"$1":');
  cleaned = cleaned.replace(/,\s*'([^']+?)'\s*:/g, ',"$1":');

  // Replace undefined with null
  cleaned = cleaned.replace(/\bundefined\b/g, 'null');

  // Replace NaN with null
  cleaned = cleaned.replace(/\bNaN\b/g, 'null');

  // Replace union type artifacts like "income | expense | transfer"
  // If a string value contains " | ", it's likely a union type description
  cleaned = cleaned.replace(/"\s*([^"]+?)\s*\|\s*([^"]+?)\s*\|\s*([^"]+?)\s*"/g, '"$1"');

  // Also handle two-item unions
  cleaned = cleaned.replace(/"\s*([^"]+?)\s*\|\s*([^"]+?)\s*"/g, '"$1"');

  // Remove trailing commas before closing brace
  cleaned = cleaned.replace(/,\s*}/g, '}');
  cleaned = cleaned.replace(/,\s*]/g, ']');

  // Remove trailing comma before closing brace with whitespace
  cleaned = cleaned.replace(/,\s*\n\s*}/g, '\n}');
  cleaned = cleaned.replace(/,\s*\n\s*]/g, '\n]');

  // Remove control characters (except \n, \t, \r)
  cleaned = cleaned.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

  // Unquoted keys: {key: "value"} → {"key": "value"}
  // Match patterns like {identifier: but not {"identifier":
  cleaned = cleaned.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)(\s*:)/g, '$1"$2"$3');

  return cleaned;
}

/**
 * Combined JSON sanitization pipeline
 */
export function cleanGeminiResponse(text: string): string {
  // Step 1: Sanitize raw text
  const sanitized = sanitizeJsonText(text);

  // Step 2: Extract first JSON object
  const extracted = extractFirstJsonObject(sanitized) || sanitized;

  // Step 3: Repair common issues
  const repaired = repairCommonJsonIssues(extracted);

  return repaired;
}

// ===================== Schema Validation =====================

const VALID_TRANSACTION_TYPES = ['income', 'expense', 'transfer', 'refund'] as const;
const VALID_CATEGORIES = [
  'Makanan & Minuman', 'Transportasi', 'Belanja', 'Tagihan', 'Hiburan',
  'Pendidikan', 'Kesehatan', 'Langganan', 'Keluarga', 'Investasi',
  'Gaji', 'Freelance', 'Bisnis', 'Cashback', 'Refund',
  'Transfer', 'Bank', 'Travel', 'Hotel', 'Tiket', 'Lainnya',
];
const VALID_PAYMENT_METHODS = [
  'Cash', 'Transfer Bank', 'QRIS', 'E-wallet',
  'Kartu Debit', 'Kartu Kredit', 'Virtual Account',
  'LINE Bank', 'blu', 'ShopeePay', 'GoPay', 'OVO', 'DANA',
  'LinkAja', 'Jago', 'BCA', 'Mandiri', 'BRI', 'BNI', 'Lainnya',
];

export interface ValidationResult {
  valid: boolean;
  issues: string[];
  warnings: string[];
  normalized: ExtractedTransaction;
}

/**
 * Validate and normalize extracted transaction data
 * Fixes common schema issues automatically
 */
export function validateExtractedTransaction(
  data: Record<string, unknown>,
  emailDate?: string,
): ValidationResult {
  const issues: string[] = [];
  const warnings: string[] = [];

  // Helper: safe string getter
  const str = (key: string): string | undefined =>
    typeof data[key] === 'string' ? (data[key] as string) : undefined;

  const num = (key: string): number | undefined =>
    typeof data[key] === 'number' ? (data[key] as number) : undefined;

  // 1. is_transaction — wajib boolean
  let isTransaction: boolean;
  if (typeof data.is_transaction === 'boolean') {
    isTransaction = data.is_transaction;
  } else if (typeof data.is_transaction === 'string') {
    isTransaction = data.is_transaction.toLowerCase() === 'true';
    issues.push(`is_transaction adalah string, dikonversi ke boolean: ${isTransaction}`);
  } else {
    isTransaction = false;
    issues.push('is_transaction tidak ditemukan atau bukan boolean, default false');
  }

  // 2. transaction_type
  let transactionType: TransactionType | undefined;
  const rawType = str('transaction_type');
  if (rawType && VALID_TRANSACTION_TYPES.includes(rawType as any)) {
    transactionType = rawType as TransactionType;
  } else if (rawType) {
    // Try Indonesian mapping
    const typeMap: Record<string, TransactionType> = {
      pemasukan: 'income',
      pengeluaran: 'expense',
      transfer: 'transfer',
      refund: 'refund',
      income: 'income',
      expense: 'expense',
    };
    const lower = rawType.toLowerCase().trim();
    if (typeMap[lower]) {
      transactionType = typeMap[lower];
      warnings.push(`transaction_type "${rawType}" dinormalisasi ke "${transactionType}"`);
    } else {
      issues.push(`transaction_type tidak dikenal: "${rawType}", default undefined`);
    }
  }

  // 3. amount — normalize from string if needed
  let amount: number | null = null;
  const rawAmount = data.amount;
  if (typeof rawAmount === 'number' && Number.isFinite(rawAmount) && rawAmount > 0) {
    amount = rawAmount;
  } else if (typeof rawAmount === 'string') {
    // Handle "Rp150.000", "Rp 150.000", "Rp150,000", "150.000", "150000"
    const cleanedStr = rawAmount
      .replace(/^Rp\s*/i, '')
      .replace(/^IDR\s*/i, '')
      .replace(/\./g, '')
      .replace(/,/g, '')
      .trim();
    const parsed = parseFloat(cleanedStr);
    if (!isNaN(parsed) && parsed > 0) {
      amount = parsed;
      warnings.push(`amount adalah string "${rawAmount}", dikonversi ke ${parsed}`);
    } else {
      issues.push(`amount tidak bisa dikonversi dari string: "${rawAmount}"`);
    }
  } else if (rawAmount === null || rawAmount === undefined) {
    amount = null;
  } else {
    issues.push(`amount tipe tidak dikenal: ${typeof rawAmount}`);
  }

  // 4. currency
  let currency = str('currency') || 'IDR';
  currency = currency.toUpperCase();
  if (currency !== 'IDR' && currency !== 'USD') {
    warnings.push(`currency "${currency}" tidak umum, gunakan IDR`);
    currency = 'IDR';
  }

  // 5. date — validate format
  let date: string | null = str('date') || null;
  if (date) {
    // Try YYYY-MM-DD
    const isoMatch = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoMatch) {
      // Valid ISO date
    } else {
      // Try DD/MM/YYYY (Indonesian format)
      const dmyMatch = date.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (dmyMatch) {
        date = `${dmyMatch[3]}-${dmyMatch[2]}-${dmyMatch[1]}`;
        warnings.push(`date "${str('date')}" dikonversi dari DD/MM/YYYY ke ${date}`);
      } else {
        // Try other common formats
        const parsedDate = new Date(date);
        if (!isNaN(parsedDate.getTime())) {
          date = parsedDate.toISOString().split('T')[0];
          warnings.push(`date "${str('date')}" diparse ke ${date}`);
        } else {
          // Fallback to email date
          date = emailDate || new Date().toISOString().split('T')[0];
          warnings.push(`date "${str('date')}" tidak valid, fallback ke email date: ${date}`);
        }
      }
    }
  } else {
    date = emailDate || null;
    if (date) {
      warnings.push(`date tidak ditemukan, fallback ke email date: ${date}`);
    }
  }

  // 6. merchant
  let merchant = str('merchant') || null;
  if (merchant !== null && merchant.trim() === '') merchant = null;

  // 7. category — validate against known list
  let category = str('category') || null;
  if (category) {
    const matchedCategory = VALID_CATEGORIES.find(
      (c) => c.toLowerCase() === category!.toLowerCase()
    );
    if (matchedCategory) {
      category = matchedCategory;
    } else {
      warnings.push(`category "${category}" tidak dikenal, dipertahankan`);
    }
  }

  // 8. payment_method — validate against known list
  let paymentMethod = str('payment_method') || null;
  if (paymentMethod) {
    const matchedMethod = VALID_PAYMENT_METHODS.find(
      (m) => m.toLowerCase() === paymentMethod!.toLowerCase()
    );
    if (matchedMethod) {
      paymentMethod = matchedMethod;
    } else {
      warnings.push(`payment_method "${paymentMethod}" tidak dikenal, dipertahankan`);
    }
  }

  // 9. description
  let description = str('description') || null;
  if (description && description.length > 500) {
    description = description.substring(0, 500);
    warnings.push('description dipotong ke 500 karakter');
  }

  // 10. confidence_score — normalize
  let confidenceScore: number | undefined;
  const rawScore = data.confidence_score;
  if (typeof rawScore === 'number' && rawScore >= 0 && rawScore <= 1) {
    confidenceScore = Math.round(rawScore * 100) / 100;
  } else if (typeof rawScore === 'number' && rawScore > 1) {
    // Probably percentage (0-100)
    if (rawScore <= 100) {
      confidenceScore = Math.round((rawScore / 100) * 100) / 100;
      warnings.push(`confidence_score ${rawScore} adalah persentase, dikonversi ke ${confidenceScore}`);
    } else {
      confidenceScore = 0.5;
      warnings.push(`confidence_score ${rawScore} di luar range, default 0.5`);
    }
  } else if (typeof rawScore === 'string') {
    const parsed = parseFloat(rawScore);
    if (!isNaN(parsed) && parsed >= 0 && parsed <= 1) {
      confidenceScore = Math.round(parsed * 100) / 100;
    } else if (!isNaN(parsed) && parsed <= 100) {
      confidenceScore = Math.round((parsed / 100) * 100) / 100;
      warnings.push(`confidence_score "${rawScore}" adalah persentase, dikonversi`);
    } else {
      confidenceScore = isTransaction ? 0.5 : 0;
      warnings.push(`confidence_score "${rawScore}" tidak valid`);
    }
  } else if (rawScore === null || rawScore === undefined) {
    confidenceScore = isTransaction ? 0.5 : 0;
  }

  // 11. reason
  let reason = str('reason') || null;
  if (!isTransaction && !reason) {
    reason = 'Email bukan transaksi keuangan';
  }
  if (isTransaction && !reason) {
    reason = null;
  }

  // Build normalized result
  const normalized: ExtractedTransaction = {
    is_transaction: isTransaction,
    transaction_type: transactionType,
    amount: amount ?? undefined,
    currency,
    date: date ?? undefined,
    merchant: merchant ?? undefined,
    category: category ?? undefined,
    payment_method: paymentMethod ?? undefined,
    description: description ?? undefined,
    confidence_score: confidenceScore,
    reason: reason ?? undefined,
  };

  // Remove undefined keys for cleaner output
  Object.keys(normalized).forEach((key) => {
    if (normalized[key as keyof ExtractedTransaction] === undefined) {
      delete normalized[key as keyof ExtractedTransaction];
    }
  });

  return {
    valid: issues.length === 0,
    issues,
    warnings,
    normalized,
  };
}

// ===================== Main Parsing Function =====================

/**
 * Safe parse output Gemini ke ExtractedTransaction
 *
 * Includes multi-step repair pipeline:
 * 1. sanitizeJsonText — remove markdown
 * 2. extractFirstJsonObject — find JSON in text
 * 3. repairCommonJsonIssues — fix trailing commas, quotes, etc.
 * 4. JSON.parse
 * 5. validateExtractedTransaction — schema validation + normalization
 *
 * Tidak throw — selalu return ParseResult.
 */
export function safeParseGeminiJson(
  rawResponse: string,
  emailDate?: string,
): ParseResult {
  try {
    if (!rawResponse || rawResponse.trim() === '') {
      return {
        success: false,
        error: 'AI mengembalikan response kosong',
        rawResponse: '',
        repairAttempted: false,
        repairSuccess: false,
        repairStrategiesTried: 0,
      };
    }

    // Step 1-3: Clean & repair
    const cleaned = cleanGeminiResponse(rawResponse);
    let repairStrategiesTried = 0;

    if (cleaned !== rawResponse.trim()) repairStrategiesTried++;

    if (!cleaned || cleaned === '{}') {
      // Try alternate repair: raw text extraction without common issues
      const rawExtract = extractFirstJsonObject(rawResponse);
      if (rawExtract && rawExtract !== '{}') {
        const altCleaned = repairCommonJsonIssues(rawExtract);
        repairStrategiesTried++;
        if (altCleaned !== '{}') {
          // Try parsing the alternated cleaned version
          try {
            const parsed = JSON.parse(altCleaned);
            const validated = validateExtractedTransaction(
              parsed as Record<string, unknown>,
              emailDate,
            );
            return {
              success: validated.valid,
              data: validated.normalized,
              cleanedResponse: altCleaned,
              repairAttempted: true,
              repairSuccess: validated.valid,
              repairStrategiesTried,
              ...(validated.issues.length > 0 ? {
                error: validated.issues.join('; '),
              } : {}),
            };
          } catch {
            // Continue to fallback
          }
        }
      }
      return {
        success: false,
        error: 'Response setelah dibersihkan kosong atau hanya {}',
        rawResponse: rawResponse.substring(0, 500),
        cleanedResponse: cleaned,
        repairAttempted: true,
        repairSuccess: false,
        repairStrategiesTried,
      };
    }

    // Step 4: Parse JSON
    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch (parseError) {
      // Try more aggressive repair
      const aggressivelyCleaned = cleaned
        .replace(/'/g, '"')           // Replace all single quotes
        .replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)(\s*:)/g, '$1"$2"$3')  // Quote all keys
        .replace(/,\s*}/g, '}')       // Remove trailing commas
        .replace(/,\s*]/g, ']')       // Remove trailing commas in arrays
        .replace(/"\s*\|\s*"/g, '"')  // Fix union type artifacts
        .replace(/"\s*\|\s*/g, '"')   // Fix partial unions
        .replace(/\s*\|\s*"/g, '"');  // Fix partial unions

      repairStrategiesTried++;
      try {
        parsed = JSON.parse(aggressivelyCleaned);
      } catch {
        return {
          success: false,
          error: `JSON tidak valid setelah repair: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`,
          rawResponse: rawResponse.substring(0, 500),
          cleanedResponse: aggressivelyCleaned,
          repairAttempted: true,
          repairSuccess: false,
          repairStrategiesTried,
        };
      }
    }

    // Step 5: Validate schema
    const validated = validateExtractedTransaction(
      parsed as Record<string, unknown>,
      emailDate,
    );

    return {
      success: validated.valid,
      data: validated.normalized,
      cleanedResponse: cleaned,
      repairAttempted: repairStrategiesTried > 0,
      repairSuccess: true,
      repairStrategiesTried,
      error: validated.issues.length > 0
        ? validated.issues.join('; ')
        : validated.warnings.length > 0
          ? validated.warnings.join('; ')
          : undefined,
    };
  } catch (error) {
    return {
      success: false,
      error: `Unexpected error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      rawResponse: rawResponse.substring(0, 500),
      repairAttempted: true,
      repairSuccess: false,
    };
  }
}

// ===================== Helper: Schema Check =====================

/**
 * Cek apakah ExtractedTransaction memiliki data transaksi yang valid
 */
export function hasValidTransactionData(extracted: ExtractedTransaction): boolean {
  if (!extracted.is_transaction) return false;
  return extracted.amount !== null && extracted.amount !== undefined && extracted.amount > 0;
}

/**
 * Convert ExtractedTransaction to a more lenient format for fallback
 */
export function buildLenientResult(
  data: Partial<ExtractedTransaction>,
  reason: string,
  confidenceScore: number,
): ExtractedTransaction {
  return {
    is_transaction: data.is_transaction ?? false,
    transaction_type: data.transaction_type,
    amount: data.amount,
    currency: data.currency || 'IDR',
    date: data.date,
    merchant: data.merchant,
    category: data.category,
    payment_method: data.payment_method,
    description: data.description,
    confidence_score: confidenceScore,
    reason,
  };
}

// Re-export from geminiErrors — actually normalizeTransactionType is defined locally in geminiParser
// so we don't need the re-export
