/**
 * Gmail Auto Sync — Supabase Edge Function
 *
 * Background sync untuk CashFlow. Dipicu oleh Supabase Cron (scheduled function).
 * Mengecek user dengan auto_sync_enabled = true dan next_sync_at <= now(),
 * lalu menjalankan incremental Gmail Sync.
 *
 * Cara deploy:
 *   supabase functions deploy gmail-auto-sync --no-verify-jwt
 *   supabase secrets set SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=...
 *
 * Cara setup cron:
 *   schedule: every 15 minutes
 *   function hook: https://<project>.supabase.co/functions/v1/gmail-auto-sync
 */

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.2';

// ===================== Configuration =====================

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const GEMINI_PROXY_BASE = Deno.env.get('GEMINI_PROXY_BASE') || ''; // Optional: for AI extraction
const MAX_EMAILS_PER_USER = Number(Deno.env.get('MAX_EMAILS_PER_USER') || '50');
const CONCURRENCY_LIMIT = Number(Deno.env.get('CONCURRENCY_LIMIT') || '3');
const HISTORY_START_DATE = '2026-01-01';

// ===================== Supabase Client =====================

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// ===================== Helper Functions =====================

function extractDomain(sender: string): string {
  const match = sender.match(/@([^\s>]+)/);
  return match ? match[1].toLowerCase() : sender.toLowerCase();
}

function getLocalDateString(date: Date = new Date()): string {
  return date.toISOString().split('T')[0];
}

function getTomorrowDateString(): string {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow.toISOString().split('T')[0];
}

function buildGmailSearchQuery(lastSyncedAt?: string | null): string {
  if (lastSyncedAt) {
    const date = new Date(lastSyncedAt);
    const after = date.toISOString().split('T')[0];
    return `after:${after.replace(/-/g, '/')}`;
  }
  return `after:${HISTORY_START_DATE.replace(/-/g, '/')}`;
}

function extractAmount(text: string): number | null {
  const patterns = [
    /(?:total|nominal|jumlah|sebesar|pembayaran|tagihan)\s*:?\s*(?:Rp|IDR)\s?([0-9][\d.,]*(?:,\d{2})?)/i,
    /(?:Rp|IDR)\s?([0-9][\d.,]*(?:,\d{2})?)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;

    const trimmed = match[1].trim();
    const hasDecimalComma = /,\d{2}$/.test(trimmed);
    const cleaned = hasDecimalComma
      ? trimmed.replace(/\./g, '').replace(/,/g, '.')
      : trimmed.replace(/[.,]/g, '');
    const amount = parseFloat(cleaned);
    if (Number.isFinite(amount) && amount > 0) return amount;
  }
  return null;
}

function classifyEmail(subject: string, body: string, sender: string): string {
  const lowerSubject = subject.toLowerCase();
  const lowerBody = body.toLowerCase();
  const combined = `${lowerSubject} ${lowerBody}`;

  // Non-transaction patterns
  const skipPatterns = [
    /promo|cashback\s*hingga|newsletter|diskon|kupon/i,
    /kartu\s*telah\s*aktif|request\s*card\s*berhasil|bluspending.*berhasil dibuat/i,
    /welcome to blu|let's make your move/i,
  ];

  for (const pattern of skipPatterns) {
    if (pattern.test(subject) || pattern.test(combined)) return 'skipped';
  }

  // Transaction patterns
  const txPatterns = [
    /pembayaran|transfer|receipt|invoice|tagihan|refund|top up/i,
    /bukti\s*pembayaran|berhasil|transaksi|e-?tiket/i,
  ];

  for (const pattern of txPatterns) {
    if (pattern.test(subject) || pattern.test(combined)) return 'send_to_ai';
  }

  return 'skipped';
}

function extractSenderDomain(sender: string): string {
  const match = sender.match(/@([^>\s]+)/);
  return (match?.[1] || '').toLowerCase();
}

// ===================== Gmail API Calls =====================

async function fetchGmailMessages(
  accessToken: string,
  query: string,
  maxResults: number = 50,
): Promise<Array<{ id: string; threadId: string }>> {
  const messages: Array<{ id: string; threadId: string }> = [];
  let pageToken = '';

  while (messages.length < maxResults) {
    const pageSize = Math.min(100, maxResults - messages.length);
    const pageTokenParam = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '';
    const searchUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=${pageSize}${pageTokenParam}`;

    const response = await fetch(searchUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error('GMAIL_TOKEN_INVALID');
      }
      const err = await response.json().catch(() => ({}));
      throw new Error(`GMAIL_FETCH_FAILED: ${(err as any).error?.message || response.statusText}`);
    }

    const data = await response.json();
    messages.push(...(data.messages || []));
    pageToken = data.nextPageToken || '';
    if (!pageToken || !data.messages?.length) break;
  }

  return messages;
}

async function fetchGmailMessageDetails(
  accessToken: string,
  messageId: string,
): Promise<{
  id: string;
  threadId: string;
  subject: string;
  from: string;
  date: string;
  body: string;
  snippet: string;
} | null> {
  try {
    const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) return null;

    const data = await response.json();
    const headers = data.payload?.headers || [];
    const subject = headers.find((h: any) => h.name === 'Subject')?.value || 'No Subject';
    const from = headers.find((h: any) => h.name === 'From')?.value || '';
    const headerDate = headers.find((h: any) => h.name === 'Date')?.value || '';
    const date = getGmailDate(data.internalDate, headerDate);
    const body = getMessageBody(data.payload) || data.snippet || '';

    return {
      id: data.id,
      threadId: data.threadId,
      subject,
      from,
      date,
      body: [subject, from, body].join('\n').substring(0, 5000),
      snippet: data.snippet || '',
    };
  } catch {
    return null;
  }
}

function getGmailDate(internalDate?: string, headerDate?: string): string {
  const num = Number(internalDate);
  if (Number.isFinite(num) && num > 0) return new Date(num).toISOString();
  if (headerDate) {
    const parsed = new Date(headerDate);
    if (!isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return new Date().toISOString();
}

function getMessageBody(payload: any): string | null {
  if (!payload) return null;
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return decodeBase64(payload.body.data);
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) return decodeBase64(part.body.data);
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

function decodeBase64(data: string): string {
  try {
    const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(normalized), (char) => char.charCodeAt(0));
    return new TextDecoder('utf-8').decode(bytes);
  } catch {
    return '';
  }
}

// ===================== Token Retrieval =====================

async function getGmailAccessToken(userId: string): Promise<string | null> {
  // Access provider_token from auth.sessions table (requires service_role)
  const { data: sessions, error } = await supabase
    .from('auth.sessions')
    .select('provider_token, provider_refresh_token')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1);

  if (error || !sessions?.length) {
    console.error(`[AutoSync] No session found for user ${userId}:`, error?.message);
    return null;
  }

  const providerToken = sessions[0].provider_token;
  if (providerToken) return providerToken;

  // If no provider_token, try to refresh (simplified - in production use proper OAuth refresh)
  const refreshToken = sessions[0].provider_refresh_token;
  if (refreshToken) {
    console.log(`[AutoSync] Attempting token refresh for user ${userId}`);
    // In a production Edge Function, you would call Google's OAuth token endpoint
    // For now, return null — user needs to reconnect
  }

  return null;
}

// ===================== Main Sync Logic =====================

async function processUserSync(userId: string): Promise<{
  processed: number;
  pendingReview: number;
  skipped: number;
  failed: number;
  error?: string;
}> {
  const stats = { processed: 0, pendingReview: 0, skipped: 0, failed: 0 };

  // 1. Get Gmail token
  const accessToken = await getGmailAccessToken(userId);
  if (!accessToken) {
    stats.failed++;
    return { ...stats, error: 'GMAIL_TOKEN_MISSING' };
  }

  // 2. Get user settings
  const { data: settings } = await supabase
    .from('gmail_sync_settings')
    .select('last_synced_at, sync_interval_minutes, history_sync_completed')
    .eq('user_id', userId)
    .maybeSingle();

  // 3. Build search query
  const lastSynced = settings?.last_synced_at || null;
  const query = buildGmailSearchQuery(lastSynced);

  // 4. Fetch emails
  let messages: Array<{ id: string; threadId: string }>;
  try {
    messages = await fetchGmailMessages(accessToken, query, MAX_EMAILS_PER_USER);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'GMAIL_FETCH_FAILED';
    return { ...stats, error: msg };
  }

  if (messages.length === 0) {
    return stats;
  }

  // 5. Check duplicates — get existing message_ids
  const messageIds = messages.map((m) => m.id);
  const { data: existingLogs } = await supabase
    .from('gmail_sync_logs')
    .select('gmail_message_id')
    .eq('user_id', userId)
    .in('gmail_message_id', messageIds);

  const existingIds = new Set((existingLogs || []).map((l: any) => l.gmail_message_id));
  const newMessages = messages.filter((m) => !existingIds.has(m.id));

  // 6. Process each new message
  for (const msg of newMessages) {
    try {
      const details = await fetchGmailMessageDetails(accessToken, msg.id);
      if (!details) {
        stats.failed++;
        continue;
      }

      // Classify
      const decision = classifyEmail(details.subject, details.body, details.from);

      if (decision === 'skipped') {
        // Save as skipped
        await supabase.from('gmail_sync_logs').upsert({
          user_id: userId,
          gmail_message_id: details.id,
          message_id: details.id,
          thread_id: details.threadId,
          subject: details.subject,
          sender: details.from,
          sender_domain: extractSenderDomain(details.from),
          email_date: details.date,
          prefilter_status: 'skipped',
          final_status: 'skipped',
          status: 'skipped',
          ai_called: false,
          ai_parsed: false,
          fallback_used: false,
          scanned_at: new Date().toISOString(),
          metadata: { source: 'auto_sync_background' },
        }, { onConflict: 'user_id,message_id' });
        stats.skipped++;
        continue;
      }

      // Extract amount via fallback (no AI call in background sync to save costs)
      const amount = extractAmount(details.body);
      if (amount) {
        await supabase.from('gmail_sync_logs').upsert({
          user_id: userId,
          gmail_message_id: details.id,
          message_id: details.id,
          thread_id: details.threadId,
          subject: details.subject,
          sender: details.from,
          sender_domain: extractSenderDomain(details.from),
          email_date: details.date,
          prefilter_status: 'send_to_ai',
          final_status: 'pending_review',
          status: 'pending_review',
          ai_called: true,
          ai_parsed: false,
          fallback_used: true,
          error_code: 'BACKGROUND_FALLBACK_USED',
          confidence_score: 0.60,
          scanned_at: new Date().toISOString(),
          metadata: {
            source: 'auto_sync_background',
            extractedAmount: amount,
            merchant: details.from.split('@')[0] || '',
            method: 'fallback_extraction',
          },
        }, { onConflict: 'user_id,message_id' });
        stats.pendingReview++;
      } else {
        await supabase.from('gmail_sync_logs').upsert({
          user_id: userId,
          gmail_message_id: details.id,
          message_id: details.id,
          thread_id: details.threadId,
          subject: details.subject,
          sender: details.from,
          sender_domain: extractSenderDomain(details.from),
          email_date: details.date,
          prefilter_status: 'send_to_ai',
          final_status: 'skipped',
          status: 'skipped',
          ai_called: true,
          ai_parsed: false,
          fallback_used: true,
          error_code: 'NO_AMOUNT_FOUND',
          scanned_at: new Date().toISOString(),
          metadata: { source: 'auto_sync_background', method: 'fallback_no_amount' },
        }, { onConflict: 'user_id,message_id' });
        stats.skipped++;
      }

      stats.processed++;
    } catch {
      stats.failed++;
    }
  }

  // 7. Update settings
  const interval = settings?.sync_interval_minutes || 60;
  const now = new Date();
  const nextSync = new Date(now.getTime() + interval * 60 * 1000);

  await supabase.from('gmail_sync_settings').upsert({
    user_id: userId,
    last_synced_at: now.toISOString(),
    next_sync_at: nextSync.toISOString(),
    last_status: stats.failed > 0 ? 'partial_failed' : 'completed',
    last_result_summary: `${stats.pendingReview} pending, ${stats.skipped} skipped, ${stats.failed} failed`,
    last_error_code: stats.error || null,
  }, { onConflict: 'user_id' });

  // 8. Create notification if pending review found
  if (stats.pendingReview > 0) {
    const dateKey = getLocalDateString();
    await supabase.from('notifications').upsert({
      user_id: userId,
      type: 'gmail',
      priority: 'normal',
      title: 'Transaksi baru dari Gmail',
      message: `${stats.pendingReview} transaksi ditemukan oleh Auto Sync dan menunggu review.`,
      action_href: '/gmail-sync',
      action_label: 'Lihat',
      dedupe_key: `gmail-auto-sync-summary-${userId}-${dateKey}`,
      read: false,
      metadata: {
        source: 'auto_sync_background',
        pendingCount: stats.pendingReview,
        skippedCount: stats.skipped,
        failedCount: stats.failed,
        scanDate: dateKey,
      },
    }, { onConflict: 'user_id,dedupe_key' });
  }

  return stats;
}

// ===================== HTTP Handler =====================

serve(async (req: Request) => {
  const startTime = Date.now();
  const headers = {
    'Content-Type': 'application/json',
    'X-Robots-Tag': 'noindex',
  };

  // Verify cron secret or service role
  const authHeader = req.headers.get('authorization') || '';
  const cronSecret = Deno.env.get('CRON_SECRET') || '';

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers,
    });
  }

  try {
    // Find users with auto sync enabled and next_sync_at <= now()
    const now = new Date().toISOString();
    const { data: users, error: settingsError } = await supabase
      .from('gmail_sync_settings')
      .select('user_id, auto_sync_enabled, next_sync_at')
      .eq('auto_sync_enabled', true)
      .lte('next_sync_at', now)
      .limit(50); // Max 50 users per run

    if (settingsError) {
      return new Response(JSON.stringify({
        ok: false,
        error: 'GAGAL_AMBIL_SETTINGS',
        message: settingsError.message,
      }), { status: 500, headers });
    }

    if (!users?.length) {
      return new Response(JSON.stringify({
        ok: true,
        message: 'Tidak ada user yang perlu di-sync',
        usersProcessed: 0,
        elapsedMs: Date.now() - startTime,
      }), { status: 200, headers });
    }

    // Process each user
    const results: Array<{
      userId: string;
      processed: number;
      pendingReview: number;
      skipped: number;
      failed: number;
      error?: string;
    }> = [];

    for (const user of users) {
      try {
        const result = await processUserSync(user.user_id);
        results.push({ userId: user.user_id, ...result });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'UNKNOWN_ERROR';
        results.push({
          userId: user.user_id,
          processed: 0,
          pendingReview: 0,
          skipped: 0,
          failed: 1,
          error: msg,
        });
      }
    }

    const totalProcessed = results.reduce((sum, r) => sum + r.processed, 0);
    const totalPending = results.reduce((sum, r) => sum + r.pendingReview, 0);
    const totalSkipped = results.reduce((sum, r) => sum + r.skipped, 0);
    const totalFailed = results.reduce((sum, r) => sum + r.failed, 0);

    return new Response(JSON.stringify({
      ok: true,
      usersProcessed: results.length,
      summary: {
        totalProcessed,
        totalPending,
        totalSkipped,
        totalFailed,
      },
      results,
      elapsedMs: Date.now() - startTime,
    }), { status: 200, headers });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'UNKNOWN_ERROR';
    return new Response(JSON.stringify({
      ok: false,
      error: 'BACKGROUND_SYNC_FAILED',
      message: msg,
      elapsedMs: Date.now() - startTime,
    }), { status: 500, headers });
  }
});
