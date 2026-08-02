/**
 * Gmail Document Extractor
 *
 * Mengekstrak text dari inline document parts (HTML invoicelike bodies)
 * dan attachment metadata. Jangan menyimpan full attachment ke database.
 *
 * AMANAH:
 *  - Hanya proses document dari sender terpercaya
 *  - Batasi ukuran file yang diproses
 *  - Jangan simpan full attachment ke database
 *  - Jangan kirim full attachment ke AI
 */

import { isTrustedTransactionDomain } from './gmailClassifier';
import { extractAmountFromText } from './geminiFallbackParser';

// ===================== Constants =====================

const MAX_DOCUMENT_SIZE = 5 * 1024 * 1024; // 5 MB max untuk PDF
const MAX_HTML_TXT_SIZE = 1 * 1024 * 1024; // 1 MB max untuk HTML/TXT
const MAX_EXTRACTED_TEXT = 10000; // Maks text yang dikirim ke AI

const TRUSTED_DOCUMENT_DOMAINS = [
  /tiket\.com/i,
  /kai\.id/i,
  /agoda\.com/i,
  /traveloka\.com/i,
  /grab\.com/i,
  /shopee\.co\.id/i,
  /tokopedia\.com/i,
  /blibli\.com/i,
  /blubybcadigital\.id/i,
  /jago\.com/i,
  /linebank\.co\.id/i,
];

// ===================== Types =====================

export interface DocumentExtractionResult {
  success: boolean;
  text: string | null;
  parser: 'html' | 'plain_text' | 'pdf' | 'inline_html' | 'none';
  errorCode?: string;
  errorMessage?: string;
  metadata: {
    filename?: string;
    mimeType?: string;
    size?: number;
    textLength?: number;
  };
}

export interface ProcessedDocumentContent {
  fullText: string;
  extractedAmount: number | null;
  hasAmount: boolean;
  orderId: string | null;
  parserUsed: string;
}

// ===================== Sender Check =====================

export function isTrustedForDocumentExtraction(sender: string): boolean {
  return TRUSTED_DOCUMENT_DOMAINS.some((pattern) => pattern.test(sender));
}

// ===================== HTML Text Extraction =====================

/**
 * Strip HTML and extract readable text
 */
export function extractTextFromHtml(html: string, maxLength: number = MAX_EXTRACTED_TEXT): string {
  const text = html
    .replace(/<style[^>]*>[^<]*<\/style>/gi, '')
    .replace(/<script[^>]*>[^<]*<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/td>/gi, ' ')
    .replace(/<\/th>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim();

  return text.substring(0, maxLength);
}

// ===================== Amount Extraction from Document =====================

/**
 * Extract amount from document text with priority for labeled amounts
 * Prioritaskan label: Total Pembayaran, Total, Grand Total, Jumlah, Paid Amount
 */
export function extractAmountFromDocumentText(text: string): number | null {
  // Priority 1: Labeled total patterns
  const labeledPatterns = [
    /(?:grand\s*total|total\s*pembayaran|total\s*bayar|total\s*tagihan|jumlah\s*pembayaran|harga\s*total|paid\s*amount|payment\s*amount|order\s*total|amount\s*paid)\s*:?\s*(?:rp|idr)\s?([0-9][0-9.,]*(?:,\d{2})?)/i,
    /(?:total|subtotal)\s*(?:rp|idr)\s?([0-9][0-9.,]*(?:,\d{2})?)/i,
  ];

  for (const pattern of labeledPatterns) {
    const match = text.match(pattern);
    if (match) {
      const amount = normalizeAmountFromDoc(match[1]);
      if (amount && amount > 0) return amount;
    }
  }

  // Priority 2: First Rp/IDR amount after total/grand total keywords
  const totalKeywords = /(?:total|grand\s*total|total\s*pembayaran|jumlah\s*pembayaran)/i;
  const totalSection = text.split(totalKeywords);
  if (totalSection.length > 1) {
    for (let i = 1; i < totalSection.length; i++) {
      const amountMatch = totalSection[i].match(/(?:rp|idr)\s?([0-9][0-9.,]*(?:,\d{2})?)/i);
      if (amountMatch) {
        const amount = normalizeAmountFromDoc(amountMatch[1]);
        if (amount && amount > 0) return amount;
      }
    }
  }

  // Priority 3: Use generic amount extraction from fallback parser
  return extractAmountFromText(text);
}

function normalizeAmountFromDoc(raw: string): number | null {
  const trimmed = raw.trim();
  const hasDecimalComma = /,\d{2}$/.test(trimmed);
  const cleaned = hasDecimalComma
    ? trimmed.replace(/\./g, '').replace(/,/g, '.')
    : trimmed.replace(/[.,]/g, '');
  const amount = parseFloat(cleaned);
  return Number.isFinite(amount) ? amount : null;
}

// ===================== Order ID Extraction =====================

/**
 * Extract order/booking/invoice ID from text
 */
export function extractOrderId(text: string): string | null {
  // Priority: explicit labeled order IDs
  const patterns = [
    /order\s*(?:id|number|no|#)\s*:?\s*(\d{6,20})/i,
    /booking\s*(?:id|number|no|#|code)\s*:?\s*(\w{6,20})/i,
    /invoice\s*(?:id|number|no|#)\s*:?\s*(\w{6,20})/i,
    /reservation\s*(?:id|number|no|#)\s*:?\s*(\w{6,20})/i,
    /transaction\s*(?:id|number|no|#)\s*:?\s*(\w{6,20})/i,
    /payment\s*(?:id|number|no|#)\s*:?\s*(\w{6,20})/i,
    /reference\s*(?:id|number|no|#)\s*:?\s*(\w{6,20})/i,
    // tiket.com specific
    /order\s*id\s+(\d{6,20})/i,
    /orderid[:\s]*(\d{6,20})/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1];
  }

  return null;
}

// ===================== Main Entry =====================

/**
 * Process document content extracted from email
 * Returns extracted amount, order ID, and clean text
 */
export function processDocumentContent(
  body: string,
  fullContent?: string,
  attachments?: Array<{ filename: string; mimeType: string; size: number; extractedText?: string }>,
): ProcessedDocumentContent {
  let fullText = fullContent || body;
  const orderId = extractOrderId(`${body} ${fullContent || ''}`);

  // Add attachment text if available
  if (attachments) {
    for (const att of attachments) {
      if (att.extractedText && att.extractedText.trim()) {
        fullText += `\n\n--- Dokumen: ${att.filename} ---\n\n${att.extractedText}`;
      }
    }
  }

  // Extract amount from document content
  const extractedAmount = extractAmountFromDocumentText(fullText);
  const hasAmount = extractedAmount !== null && extractedAmount >= 1000;

  return {
    fullText: fullText.substring(0, MAX_EXTRACTED_TEXT),
    extractedAmount,
    hasAmount,
    orderId,
    parserUsed: hasAmount ? 'document_parser' : 'none',
  };
}

/**
 * Get combined text for AI extraction (body + document parts, limited)
 */
export function getCombinedTextForAI(
  body: string,
  fullContent?: string,
  attachments?: Array<{ extractedText?: string }>,
): string {
  let combined = fullContent || body;

  if (attachments) {
    for (const att of attachments) {
      if (att.extractedText && att.extractedText.trim()) {
        combined += `\n\n[Dokumen Lampiran]\n${att.extractedText.substring(0, 5000)}`;
      }
    }
  }

  return combined.substring(0, 15000);
}
