import type { ExtractedTransaction } from '../types';
import { clearGmailAccessToken, getCurrentUser, requestGmailAccessToken } from './authService';
import { extractWithGemini } from './geminiService';
import { buildFallbackTransactionFromEmail } from '../lib/geminiFallbackParser';
import { triggerSessionExpired } from '../store/useSessionExpiryStore';
import { isSessionExpiredError } from '../lib/sessionErrors';
import { logger } from '../lib/logger';

/**
 * Request Gmail access token.
 */
export async function getGmailAccessToken(): Promise<string | null> {
  try {
    return await requestGmailAccessToken();
  } catch {
    return null;
  }
}

/**
 * Get current Auth user
 */
async function getCurrentAuthUser() {
  const user = await getCurrentUser();
  if (!user) throw new Error('User belum login');
  return { id: user.id, email: user.email };
}


/**
 * Gmail date format helper: YYYY/MM/DD
 */
export function formatGmailDate(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}/${mm}/${dd}`;
}

/**
 * Get tomorrow's date (today + 1 day)
 */
export function getTomorrow(date = new Date()): Date {
  const tomorrow = new Date(date);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow;
}

/**
 * Build Gmail date range query
 * Start: 2026-01-01, End: today + 1 day
 */
export function buildGmailDateRangeQuery(): string {
  const start = '2026/01/01';
  const before = formatGmailDate(getTomorrow());
  return `after:${start} before:${before}`;
}

/**
 * Get the date range display string
 */
export function getGmailSyncDateRangeDisplay(): { start: string; end: string } {
  const start = new Date('2026-01-01');
  const end = new Date();
  return {
    start: start.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }),
    end: end.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }),
  };
}

/**
 * MAX_EMAILS_PER_SCAN — Safety limit untuk mencegah pengambilan email tak terbatas.
 * Jika user memiliki ribuan email sejak 1 Jan 2026, kita batasi hingga batas aman
 * untuk menghindari rate limit dan memory exhaustion.
 */
const MAX_EMAILS_PER_SCAN = 5000;

export interface GmailFetchProgress {
  phase: 'search_page' | 'message_detail';
  gmailPagesFetched: number;
  gmailHasNextPage: boolean;
  totalFound: number;
  totalEstimated: number;
  detailsFetched: number;
  currentMessageId?: string;
}

/**
 * Fetch ALL transaction emails from Gmail API sejak 1 Januari 2026 sampai hari ini.
 * Menggunakan Gmail API pagination (nextPageToken) untuk mengambil semua email.
 * Tidak ada hardcoded limit 200 — semua email hasil query akan diambil.
 *
 * Safety: dibatasi MAX_EMAILS_PER_SCAN (5000) untuk mencegah infinite loop.
 *
 * Note: full body hanya dipakai sementara di memori untuk AI extraction dan tidak disimpan ke database.
 */
export async function fetchTransactionEmails(
  onProgress?: (progress: GmailFetchProgress) => void,
): Promise<GmailEmail[]> {
  // Verifikasi user sudah login (throw error if not)
  await getCurrentAuthUser();

  // Token OAuth Google dari session user dengan scope gmail.readonly.
  const token = await getGmailAccessToken();
  if (!token) {
    throw new Error('Gagal mendapatkan token akses Gmail.');
  }

  try {
    // Search for financial transaction emails
    // Gunakan query yang lebih spesifik untuk mengurangi promo/newsletter
    // Gmail search syntax: from:domain1 OR from:domain2 OR {from:domain3 from:domain4}
    const dateRange = buildGmailDateRangeQuery();
    const searchQuery = [
      dateRange,
      // Keyword filter — hanya email dengan kata kunci transaksi
      '(pembayaran OR transfer OR transaksi OR invoice OR receipt OR tagihan OR',
      '"top up" OR refund OR cashback OR e-ticket OR e-tiket OR booking OR',
      'struk OR "order confirmed" OR "payment confirmation" OR',
      '"virtual account" OR qris OR',
      'pembelian OR subscription OR langganan)',
      // From filter — pakai format from:domain karena Gmail API tidak support from:(a OR b)
      '{from:bca.co.id from:mandiri.co.id from:bni.co.id from:bri.co.id',
      'from:blubybcadigital.id from:jago.com from:jenius.com from:linebank.co.id',
      'from:shopee.co.id from:tokopedia.com from:blibli.com from:traveloka.com',
      'from:tiket.com from:agoda.com from:kai.id from:gojek.com from:grab.com',
      'from:ovo.id from:dana.id from:gopay.co.id}',
    ].join(' ');
    const messages: Array<{ id: string; threadId: string }> = [];
    let pageToken = '';
    let gmailPagesFetched = 0;

    while (messages.length < MAX_EMAILS_PER_SCAN) {
      const pageSize = 100;
      const pageTokenParam = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '';
      const searchUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(searchQuery)}&maxResults=${pageSize}${pageTokenParam}`;

      const searchResponse = await fetch(searchUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!searchResponse.ok) {
        const errorData = await searchResponse.json().catch(() => null);
        const detail = formatGoogleApiError(searchResponse.status, errorData);
        // CF-056: an invalid/expired OAuth credential (HTTP 401 /
        // "invalid authentication credentials") must route through the
        // centralized session-expired flow instead of surfacing the raw
        // Google error to the user.
        if (searchResponse.status === 401 || isSessionExpiredError(detail, searchResponse.status)) {
          clearGmailAccessToken();
          triggerSessionExpired();
          throw new Error('Sesi Anda telah berakhir. Anda akan keluar secara otomatis.');
        }
        if (searchResponse.status === 403) {
          clearGmailAccessToken();
          throw new Error(detail);
        }
        throw new Error(detail);
      }

      const searchData = await searchResponse.json();
      const pageMessages = searchData.messages || [];
      messages.push(...pageMessages);
      pageToken = searchData.nextPageToken || '';
      gmailPagesFetched++;
      onProgress?.({
        phase: 'search_page',
        gmailPagesFetched,
        gmailHasNextPage: Boolean(pageToken),
        totalFound: messages.length,
        totalEstimated: messages.length,
        detailsFetched: 0,
      });
      if (!pageToken || pageMessages.length === 0) break;
    }
    const emails: GmailEmail[] = [];
    let detailsFetched = 0;

    // Fetch full message details
    for (const msg of messages) {
      const msgUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`;
      const msgResponse = await fetch(msgUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!msgResponse.ok) {
        logger.warn('[GmailService] Gagal membaca detail email', { status: msgResponse.status });
        continue;
      }

      const msgData = await msgResponse.json();
      const email = parseGmailMessage(msgData);
      if (email) {
        emails.push(email);
      }
      detailsFetched++;
      onProgress?.({
        phase: 'message_detail',
        gmailPagesFetched,
        gmailHasNextPage: false,
        totalFound: messages.length,
        totalEstimated: messages.length,
        detailsFetched,
        currentMessageId: msg.id,
      });
    }

    return emails;
  } catch (error) {
    const err = error as Error;
    if (err.message?.includes('Failed to fetch') || err.message?.includes('NetworkError')) {
      throw new Error('Terjadi masalah koneksi. Periksa koneksi internet Anda.');
    }
    throw err;
  }
}

function formatGoogleApiError(status: number, errorData: unknown): string {
  const data = errorData as {
    error?: {
      message?: string;
      status?: string;
      errors?: Array<{ reason?: string; message?: string }>;
    };
  } | null;
  const message = data?.error?.message || 'Gagal mengambil data dari Gmail.';
  const reason = data?.error?.errors?.[0]?.reason || data?.error?.status || `HTTP_${status}`;

  if (reason === 'accessNotConfigured' || message.toLowerCase().includes('has not been used')) {
    return `Gmail API belum diaktifkan di Google Cloud project OAuth ini. Detail: ${message}`;
  }

  if (reason === 'insufficientPermissions' || message.toLowerCase().includes('insufficient')) {
    return `Token Google belum memiliki izin Gmail readonly. Klik Hubungkan Gmail lagi dan centang/izinkan akses Gmail. Detail: ${message}`;
  }

  if (status === 401 || status === 403) {
    return `Akses Gmail ditolak oleh Google (${reason}). Detail: ${message}`;
  }

  return `Gmail API error (${reason}). Detail: ${message}`;
}

/**
 * Parse Gmail API message response — enhanced with full content + attachment metadata
 */
function parseGmailMessage(messageData: GmailMessageData): GmailEmail | null {
  const headers = messageData.payload?.headers || [];
  const subject = headers.find((h: GmailHeader) => h.name === 'Subject')?.value || 'No Subject';
  const from = headers.find((h: GmailHeader) => h.name === 'From')?.value || '';
  const headerDate = headers.find((h: GmailHeader) => h.name === 'Date')?.value || '';
  const date = getGmailMessageDate(messageData.internalDate, headerDate);
  const messageId = messageData.id;

  // Extract full content recursively (plain text + stripped HTML)
  const content = extractFullContent(messageData.payload);
  const fullContent = content.mainContent || messageData.snippet || '';
  if (!fullContent) return null;

  // Extract attachment metadata
  const attachments: GmailAttachmentMeta[] = [];
  extractAttachments(messageData.payload, attachments);

  return {
    id: messageId,
    threadId: messageData.threadId,
    subject,
    from,
    date,
    body: [subject, from, fullContent].join('\n').substring(0, 8000), // Limit body size, but bigger for doc extraction
    fullContent: fullContent.substring(0, 15000), // Longer full content for document extraction
    attachments: attachments.length > 0 ? attachments : undefined,
    hasDocumentParts: attachments.length > 0 || hasInlineDocumentParts(messageData.payload),
  };
}

/**
 * Extract full text content recursively from payload
 */
function extractFullContent(payload: GmailPayload): {
  mainContent: string;
  htmlContent: string;
  docParts: string[];
} {
  let mainContent = '';
  let htmlContent = '';
  const docParts: string[] = [];

  if (!payload) return { mainContent, htmlContent, docParts };

  // Helper to classify a part
  const isDocument = (p: GmailPayload) => {
    if (!p.filename || p.filename === '') return false;
    const fn = p.filename.toLowerCase();
    return fn.endsWith('.pdf') || fn.endsWith('.html') || fn.endsWith('.htm') || fn.endsWith('.txt');
  };

  const isInlineDoc = (p: GmailPayload) => {
    return p.mimeType === 'text/html' && p.body?.data;
  };

  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    mainContent = decodeBase64(payload.body.data);
  } else if (payload.mimeType === 'text/html' && payload.body?.data) {
    const html = decodeBase64(payload.body.data);
    htmlContent = html;
    mainContent = stripHtml(html);
  }

  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        const text = decodeBase64(part.body.data);
        if (text.length > mainContent.length) mainContent = text;
      } else if (part.mimeType === 'text/html' && part.body?.data) {
        const html = decodeBase64(part.body.data);
        if (html.length > htmlContent.length) htmlContent = html;
        const stripped = stripHtml(html);
        if (stripped.length > mainContent.length) mainContent = stripped;
      } else if (isDocument(part) && part.body?.data) {
        const docText = decodeBase64(part.body.data);
        const stripped = stripHtml(docText);
        if (stripped.trim()) docParts.push(stripped);
      } else if (isInlineDoc(part) && part.body?.data) {
        const html = decodeBase64(part.body.data);
        const stripped = stripHtml(html);
        if (stripped.trim()) docParts.push(stripped);
      }

      // Recurse into nested parts
      if (part.parts) {
        const nested = extractFullContent(part);
        if (nested.mainContent && nested.mainContent.length > mainContent.length) mainContent = nested.mainContent;
        if (nested.htmlContent && nested.htmlContent.length > htmlContent.length) htmlContent = nested.htmlContent;
        docParts.push(...nested.docParts);
      }
    }
  }

  // Combine main + doc parts for the final content
  if (docParts.length > 0) {
    mainContent = [mainContent, ...docParts].join('\n\n---\n\n');
  }

  return { mainContent: mainContent.trim(), htmlContent, docParts };
}

/**
 * Extract attachment metadata from payload recursively
 */
function extractAttachments(payload: GmailPayload, results: GmailAttachmentMeta[]): void {
  if (!payload) return;

  if (payload.filename && payload.filename !== '' && payload.body?.attachmentId) {
    const fn = payload.filename.toLowerCase();
    // Only collect document-type attachments
    if (fn.endsWith('.pdf') || fn.endsWith('.html') || fn.endsWith('.htm') || fn.endsWith('.txt')) {
      results.push({
        attachmentId: payload.body.attachmentId,
        filename: payload.filename,
        mimeType: payload.mimeType,
        size: payload.body.size || 0,
      });
    }
  }

  if (payload.parts) {
    for (const part of payload.parts) {
      extractAttachments(part, results);
    }
  }
}

/**
 * Check if payload has inline document parts (HTML that could contain invoice)
 */
function hasInlineDocumentParts(payload: GmailPayload): boolean {
  if (!payload) return false;
  if (payload.mimeType === 'text/html' && payload.body?.data && payload.body.size && payload.body.size > 3000) {
    return true;
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.filename && part.filename !== '') return true;
      if (hasInlineDocumentParts(part)) return true;
    }
  }
  return false;
}

/**
 * Strip HTML tags and decode entities
 */
function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[^<]*<\/style>/gi, '')
    .replace(/<script[^>]*>[^<]*<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<p[^>]*>/gi, '\n')
    .replace(/<div[^>]*>/gi, '\n')
    .replace(/<tr[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Extract message body from Gmail payload (legacy — kept for backwards compat)
 */
function getMessageBody(payload: GmailPayload): string | null {
  if (!payload) return null;

  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return decodeBase64(payload.body.data);
  }

  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return decodeBase64(part.body.data);
      }
      if (part.parts) {
        const result = getMessageBody(part);
        if (result) return result;
      }
    }
  }

  if (payload.mimeType === 'text/html' && payload.body?.data) {
    const html = decodeBase64(payload.body.data);
    return html.replace(/<[^>]*>/g, '').substring(0, 5000);
  }

  return null;
}

/**
 * Decode base64 string
 */
function decodeBase64(data: string): string {
  try {
    // Replace URL-safe characters
    const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(normalized), (char) => char.charCodeAt(0));
    return new TextDecoder('utf-8').decode(bytes);
  } catch {
    return '';
  }
}

function getGmailMessageDate(internalDate?: string, headerDate?: string): string {
  const internalDateNumber = Number(internalDate);
  if (Number.isFinite(internalDateNumber) && internalDateNumber > 0) {
    return new Date(internalDateNumber).toISOString();
  }

  if (headerDate) {
    const parsedHeaderDate = new Date(headerDate);
    if (!Number.isNaN(parsedHeaderDate.getTime())) {
      return parsedHeaderDate.toISOString();
    }
  }

  return new Date().toISOString();
}

/**
 * Fetch specific emails by their Gmail message IDs
 * Digunakan untuk retry email yang gagal diproses sebelumnya
 */
export async function fetchEmailsById(
  messageIds: string[],
  onProgress?: (progress: GmailFetchProgress) => void,
): Promise<GmailEmail[]> {
  await getCurrentAuthUser();

  const token = await getGmailAccessToken();
  if (!token) throw new Error('Gagal mendapatkan token akses Gmail.');

  const emails: GmailEmail[] = [];

  for (const [index, msgId] of messageIds.entries()) {
    try {
      const msgUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgId}?format=full`;
      const msgResponse = await fetch(msgUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!msgResponse.ok) {
        logger.warn('[GmailService] Gagal membaca email', { msgId, status: msgResponse.status });
        continue;
      }

      const msgData = await msgResponse.json();
      const email = parseGmailMessage(msgData);
      if (email) emails.push(email);
    } catch (err) {
      logger.warn('[GmailService] Error fetching email', err);
    }

    onProgress?.({
      phase: 'message_detail',
      gmailPagesFetched: 0,
      gmailHasNextPage: false,
      totalFound: messageIds.length,
      totalEstimated: messageIds.length,
      detailsFetched: index + 1,
      currentMessageId: msgId,
    });

    // Small delay to avoid hitting rate limits
    await new Promise((r) => setTimeout(r, 200));
  }

  return emails;
}

/**
 * Extract transactions using Gemini API (via Cloud Functions)
 * Di frontend development, kita panggil endpoint Cloud Functions
 */
export async function extractTransactionWithAI(emailBody: string): Promise<ExtractedTransaction> {
  try {
    return await extractWithGemini(emailBody);
  } catch (error) {
    logger.warn('[GmailService] AI extraction failed, using rule-based fallback', error);
    const fallback = buildFallbackTransactionFromEmail('', '', emailBody, new Date().toISOString());
    if (fallback.success && fallback.data) return fallback.data;
    return {
      is_transaction: false,
      reason: fallback.reason || 'AI dan fallback regex tidak menemukan transaksi valid.',
      confidence_score: 0,
    };
  }
}

function detectMerchant(text: string): string {
  const firstUsefulLine = text
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line && !/^from:/i.test(line));

  const knownMerchants = [
    'Shopee',
    'Tokopedia',
    'Gojek',
    'Grab',
    'Netflix',
    'Spotify',
    'PLN',
    'Indomaret',
    'Alfamart',
    'BCA',
    'Mandiri',
    'BNI',
    'BRI',
    'DANA',
    'OVO',
    'GoPay',
    'LinkAja',
  ];
  const found = knownMerchants.find((merchant) => new RegExp(merchant, 'i').test(text));
  return found || firstUsefulLine?.replace(/^(subject|subjek):\s*/i, '').substring(0, 60) || 'Tidak diketahui';
}

function detectCategory(text: string): string {
  const lowerText = text.toLowerCase();
  if (/makan|food|restaurant|resto|indomaret|alfamart|kopi|coffee/.test(lowerText)) return 'Makanan & Minuman';
  if (/grab|gojek|transport|parkir|tol|bensin/.test(lowerText)) return 'Transportasi';
  if (/shopee|tokopedia|lazada|belanja|purchase|pembelian/.test(lowerText)) return 'Belanja';
  if (/tagihan|pln|listrik|internet|pdam|invoice/.test(lowerText)) return 'Tagihan';
  if (/netflix|spotify|subscription|langganan/.test(lowerText)) return 'Langganan';
  if (/cashback/.test(lowerText)) return 'Cashback';
  if (/refund/.test(lowerText)) return 'Refund';
  if (/gaji|salary|payroll/.test(lowerText)) return 'Gaji';
  return 'Lainnya';
}

function detectPaymentMethod(text: string): string {
  const lowerText = text.toLowerCase();
  if (/qris/.test(lowerText)) return 'QRIS';
  if (/gopay|ovo|dana|linkaja|e-wallet|ewallet/.test(lowerText)) return 'E-wallet';
  if (/kartu kredit|credit card/.test(lowerText)) return 'Kartu Kredit';
  if (/kartu debit|debit card/.test(lowerText)) return 'Kartu Debit';
  if (/transfer|bca|mandiri|bni|bri|bank/.test(lowerText)) return 'Transfer Bank';
  return 'Lainnya';
}

// ===================== Types =====================

export interface GmailAttachmentMeta {
  attachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
  /** Extracted text content (only set after processing) */
  extractedText?: string;
  /** Whether text was successfully extracted */
  textExtracted?: boolean;
  /** Parser used */
  parserUsed?: 'html' | 'plain_text' | 'pdf' | 'none';
}

export interface GmailEmail {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  date: string;
  body: string;
  /** Full extracted content (plain text + stripped HTML) */
  fullContent?: string;
  /** Attachment metadata */
  attachments?: GmailAttachmentMeta[];
  /** Whether the email has document parts worth extracting */
  hasDocumentParts?: boolean;
}

interface GmailHeader {
  name: string;
  value: string;
}

interface GmailPayload {
  headers?: GmailHeader[];
  mimeType: string;
  body?: {
    data?: string;
    size?: number;
    attachmentId?: string;
  };
  parts?: GmailPayload[];
  filename?: string;
  attachmentId?: string;
}

interface GmailMessageData {
  id: string;
  threadId: string;
  internalDate?: string;
  snippet?: string;
  payload: GmailPayload;
}
